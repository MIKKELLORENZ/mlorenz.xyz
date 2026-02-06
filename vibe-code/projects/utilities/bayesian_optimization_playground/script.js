/* =========================================================
 *  Bayesian Optimization Playground – script.js
 *  Pure JS: Gaussian Process, Acquisition Funcs, Canvas Viz
 * ========================================================= */

"use strict";

/* -------------------------------------------------------
 *  MATH HELPERS
 * ------------------------------------------------------- */
const MathU = (() => {
  const EPS = 1e-8;

  /** Standard normal PDF */
  function normalPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  /** Standard normal CDF (Abramowitz & Stegun approx.) */
  function normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
          a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const t = 1 / (1 + p * Math.abs(x));
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
    return 0.5 * (1 + sign * y);
  }

  /** Cholesky decomposition of symmetric PD matrix (returns lower triangular) */
  function cholesky(A) {
    const n = A.length;
    const L = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = 0;
        for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
        if (i === j) {
          const val = A[i][i] - s;
          L[i][j] = Math.sqrt(Math.max(val, EPS));
        } else {
          L[i][j] = (A[i][j] - s) / (L[j][j] + EPS);
        }
      }
    }
    return L;
  }

  /** Solve L*x = b where L is lower triangular */
  function forwardSolve(L, b) {
    const n = L.length;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < i; k++) s += L[i][k] * x[k];
      x[i] = (b[i] - s) / (L[i][i] + EPS);
    }
    return x;
  }

  /** Solve L^T * x = b where L is lower triangular */
  function backSolve(L, b) {
    const n = L.length;
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = 0;
      for (let k = i + 1; k < n; k++) s += L[k][i] * x[k];
      x[i] = (b[i] - s) / (L[i][i] + EPS);
    }
    return x;
  }

  /** Solve (K + σ²I) * α = y using Cholesky */
  function choleskySolve(L, y) {
    return backSolve(L, forwardSolve(L, y));
  }

  function linspace(a, b, n) {
    const out = new Float64Array(n);
    const step = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) out[i] = a + i * step;
    return out;
  }

  return { normalPDF, normalCDF, cholesky, forwardSolve, backSolve, choleskySolve, linspace, EPS };
})();

/* -------------------------------------------------------
 *  KERNELS
 * ------------------------------------------------------- */
const Kernels = {
  rbf(x1, x2, ls) {
    const d = x1 - x2;
    return Math.exp(-0.5 * d * d / (ls * ls));
  },
  matern32(x1, x2, ls) {
    const r = Math.abs(x1 - x2) / ls;
    const s3 = Math.sqrt(3) * r;
    return (1 + s3) * Math.exp(-s3);
  },
  matern52(x1, x2, ls) {
    const r = Math.abs(x1 - x2) / ls;
    const s5 = Math.sqrt(5) * r;
    return (1 + s5 + (5 * r * r) / 3) * Math.exp(-s5);
  }
};

/* -------------------------------------------------------
 *  OBJECTIVE FUNCTIONS  (domain [0, 1])
 * ------------------------------------------------------- */
const Objectives = {
  sineMix: {
    name: "Sine Mixture",
    fn: x => Math.sin(3 * Math.PI * x) * 0.5 + Math.sin(7 * Math.PI * x) * 0.3 + 0.2 * Math.cos(11 * Math.PI * x),
    desc: "A blend of sine waves with varying frequency."
  },
  doublePeak: {
    name: "Double Peaks",
    fn: x => Math.exp(-40 * (x - 0.3) ** 2) + 0.8 * Math.exp(-60 * (x - 0.75) ** 2) - 0.3,
    desc: "Two sharp Gaussian peaks of different heights."
  },
  rastrigin1d: {
    name: "Rastrigin 1D",
    fn: x => { const z = 6 * x - 3; return -(z * z - 10 * Math.cos(2 * Math.PI * z)) / 25; },
    desc: "Classic Rastrigin function with many local optima."
  },
  noisyQuad: {
    name: "Noisy Quadratic",
    fn: x => -(4 * (x - 0.55) ** 2) + 0.2 * Math.sin(20 * x),
    desc: "A parabola perturbed by high-frequency oscillation."
  },
  cliff: {
    name: "Cliff Edge",
    fn: x => x < 0.6 ? 0.4 * Math.sin(4 * Math.PI * x) : 1.0 - 5 * (x - 0.65) ** 2,
    desc: "Smooth region with a sudden peak — tests exploitation."
  },
  multiModal: {
    name: "Multi-Modal",
    fn: x => 0.5 * Math.sin(2 * Math.PI * x) + 0.3 * Math.sin(6 * Math.PI * x + 1) + 0.15 * Math.cos(14 * Math.PI * x) + 0.3,
    desc: "Complex surface with many local optima of similar height."
  }
};

/* -------------------------------------------------------
 *  GAUSSIAN PROCESS
 * ------------------------------------------------------- */
class GaussianProcess {
  constructor(kernelFn, lengthScale, noiseSigma) {
    this.kernelFn = kernelFn;
    this.ls = lengthScale;
    this.noise = noiseSigma;
    this.X = [];
    this.Y = [];
    this.L = null;
    this.alpha = null;
  }

  addPoint(x, y) {
    this.X.push(x);
    this.Y.push(y);
    this._updateModel();
  }

  setHyperparams(ls, noise) {
    this.ls = ls;
    this.noise = noise;
    if (this.X.length > 0) this._updateModel();
  }

  setKernel(kFn) {
    this.kernelFn = kFn;
    if (this.X.length > 0) this._updateModel();
  }

  _updateModel() {
    const n = this.X.length;
    if (n === 0) return;
    const K = Array.from({ length: n }, (_, i) =>
      Float64Array.from({ length: n }, (_, j) =>
        this.kernelFn(this.X[i], this.X[j], this.ls) + (i === j ? this.noise * this.noise + 1e-6 : 0)
      )
    );
    this.L = MathU.cholesky(K);
    this.alpha = MathU.choleskySolve(this.L, Float64Array.from(this.Y));
  }

  predict(xStar) {
    const n = this.X.length;
    if (n === 0) return { mean: 0, variance: 1 };
    const kStar = new Float64Array(n);
    for (let i = 0; i < n; i++) kStar[i] = this.kernelFn(this.X[i], xStar, this.ls);
    let mean = 0;
    for (let i = 0; i < n; i++) mean += kStar[i] * this.alpha[i];
    const v = MathU.forwardSolve(this.L, kStar);
    let varReduction = 0;
    for (let i = 0; i < v.length; i++) varReduction += v[i] * v[i];
    const kSelf = this.kernelFn(xStar, xStar, this.ls) + 1e-6;
    const variance = Math.max(kSelf - varReduction, 1e-8);
    return { mean, variance };
  }

  /** Predict arrays at once (for plotting) */
  predictBatch(xs) {
    const means = new Float64Array(xs.length);
    const vars = new Float64Array(xs.length);
    for (let i = 0; i < xs.length; i++) {
      const p = this.predict(xs[i]);
      means[i] = p.mean;
      vars[i] = p.variance;
    }
    return { means, vars };
  }
}

/* -------------------------------------------------------
 *  ACQUISITION FUNCTIONS
 * ------------------------------------------------------- */
const Acquisition = {
  /** Expected Improvement */
  ei(mean, variance, bestY, xi) {
    const sigma = Math.sqrt(variance);
    if (sigma < 1e-8) return 0;
    const z = (mean - bestY - xi) / sigma;
    return (mean - bestY - xi) * MathU.normalCDF(z) + sigma * MathU.normalPDF(z);
  },
  /** Upper Confidence Bound */
  ucb(mean, variance, _bestY, kappa) {
    return mean + kappa * Math.sqrt(variance);
  },
  /** Probability of Improvement */
  poi(mean, variance, bestY, xi) {
    const sigma = Math.sqrt(variance);
    if (sigma < 1e-8) return 0;
    return MathU.normalCDF((mean - bestY - xi) / sigma);
  }
};

/* -------------------------------------------------------
 *  STATE
 * ------------------------------------------------------- */
const State = {
  gp: null,
  objectiveKey: "sineMix",
  kernelKey: "rbf",
  acqKey: "ei",
  ls: 0.15,
  noise: 0.05,
  explore: 0.01,
  initSamples: 3,
  iteration: 0,
  bestX: null,
  bestY: -Infinity,
  nextX: null,
  autoRunning: false,
  autoTimer: null,
  showTruth: true,
  showAcq: true,
  convergenceHistory: [],
  plotXs: MathU.linspace(0, 1, 200),
  truthCache: null,
  legendVisibility: { truth: true, mean: true, ci: true, samples: true, next: true, acq: true },
  animProgress: 1,
  animTarget: null,
  lastFrameTime: 0,
};

/* -------------------------------------------------------
 *  DOM REFS
 * ------------------------------------------------------- */
const $ = id => document.getElementById(id);
const DOM = {};

function cacheDom() {
  DOM.canvas = $("canvas-main");
  DOM.ctx = DOM.canvas.getContext("2d");
  DOM.tooltip = $("tooltip");
  DOM.canvasConv = $("canvas-convergence");
  DOM.ctxConv = DOM.canvasConv.getContext("2d");
  DOM.statIter = $("stat-iter");
  DOM.statBestY = $("stat-best-y");
  DOM.statBestX = $("stat-best-x");
  DOM.statNextX = $("stat-next-x");
  DOM.statKernel = $("stat-kernel");
  DOM.statAcqMax = $("stat-acq-max");
  DOM.btnStep = $("btn-step");
  DOM.btnAuto = $("btn-auto");
  DOM.btnReset = $("btn-reset");
  DOM.btnHelp = $("btn-help");
  DOM.selObj = $("sel-objective");
  DOM.selKernel = $("sel-kernel");
  DOM.selAcq = $("sel-acquisition");
  DOM.selInit = $("sel-init-samples");
  DOM.rngLs = $("rng-ls");
  DOM.rngNoise = $("rng-noise");
  DOM.rngExplore = $("rng-explore");
  DOM.lblLs = $("lbl-ls");
  DOM.lblNoise = $("lbl-noise");
  DOM.lblExplore = $("lbl-explore");
  DOM.toggleTruth = $("toggle-true-fn");
  DOM.toggleAcq = $("toggle-acq");
  DOM.onboarding = $("onboarding");
  DOM.btnStart = $("btn-start");
  DOM.toastContainer = $("toast-container");
  DOM.conceptGrid = $("concept-grid");
  DOM.eduContent = $("edu-content");
}

/* -------------------------------------------------------
 *  TOAST NOTIFICATIONS
 * ------------------------------------------------------- */
function showToast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  DOM.toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.3s"; setTimeout(() => el.remove(), 300); }, 2800);
}

/* -------------------------------------------------------
 *  INITIALIZATION
 * ------------------------------------------------------- */
function initState() {
  State.gp = new GaussianProcess(Kernels[State.kernelKey], State.ls, State.noise);
  State.iteration = 0;
  State.bestX = null;
  State.bestY = -Infinity;
  State.nextX = null;
  State.convergenceHistory = [];
  State.animProgress = 1;
  cacheObjectiveTruth();
}

function cacheObjectiveTruth() {
  const fn = Objectives[State.objectiveKey].fn;
  State.truthCache = Float64Array.from(State.plotXs, x => fn(x));
}

function addInitialSamples() {
  const n = State.initSamples;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n + (Math.random() - 0.5) * 0.15;
    const xc = Math.max(0.02, Math.min(0.98, x));
    const y = Objectives[State.objectiveKey].fn(xc) + (Math.random() - 0.5) * State.noise * 2;
    State.gp.addPoint(xc, y);
    if (y > State.bestY) { State.bestY = y; State.bestX = xc; }
  }
  State.convergenceHistory.push(State.bestY);
  computeNextPoint();
}

function computeNextPoint() {
  if (State.gp.X.length === 0) { State.nextX = 0.5; return; }
  const acqFn = Acquisition[State.acqKey];
  const xs = MathU.linspace(0.005, 0.995, 300);
  let bestAcq = -Infinity, bestXi = 0.5;
  for (const x of xs) {
    const p = State.gp.predict(x);
    const a = acqFn(p.mean, p.variance, State.bestY, State.explore);
    if (a > bestAcq) { bestAcq = a; bestXi = x; }
  }
  State.nextX = bestXi;
}

function doStep() {
  if (State.nextX === null) return;
  const x = State.nextX;
  const y = Objectives[State.objectiveKey].fn(x) + (Math.random() - 0.5) * State.noise * 2;
  State.gp.addPoint(x, y);
  State.iteration++;
  if (y > State.bestY) { State.bestY = y; State.bestX = x; }
  State.convergenceHistory.push(State.bestY);
  // Trigger animation
  State.animProgress = 0;
  State.animTarget = x;
  computeNextPoint();
  updateStats();
  if (typeof BayesEdu !== "undefined") BayesEdu.onStep(State);
}

/* -------------------------------------------------------
 *  CANVAS RENDERER
 * ------------------------------------------------------- */
const Renderer = (() => {
  const COLORS = {
    truth: "#94a3b8",
    mean: "#22d3ee",
    ciFill: "rgba(34,211,238,0.12)",
    ciStroke: "rgba(34,211,238,0.25)",
    sample: "#fbbf24",
    sampleStroke: "#fef3c7",
    best: "#34d399",
    next: "#fb7185",
    nextGlow: "rgba(251,113,133,0.4)",
    acqFill: "rgba(52,211,153,0.15)",
    acqLine: "#34d399",
    acqPeak: "#86efac",
    grid: "rgba(100,140,255,0.06)",
    axis: "rgba(148,163,184,0.3)",
    axisLabel: "#64748b"
  };

  /* Layout margins (fraction of canvas) */
  const MARGINS = { top: 0.06, right: 0.04, bottom: 0.22, left: 0.07 };

  let W, H, plotL, plotR, plotT, plotB, acqT, acqB;
  let dpr = 1;

  function resize(canvas) {
    dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    plotL = W * MARGINS.left;
    plotR = W * (1 - MARGINS.right);
    plotT = H * MARGINS.top;
    plotB = H * (1 - MARGINS.bottom);
    acqT = plotB + 12;
    acqB = H - 8;
  }

  function xToCanvas(x) { return plotL + x * (plotR - plotL); }
  function canvasToX(cx) { return Math.max(0, Math.min(1, (cx - plotL) / (plotR - plotL))); }

  function yRange(truth, means, vars) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < truth.length; i++) {
      const t = truth[i];
      const m = means[i];
      const s = Math.sqrt(vars[i]) * 2;
      lo = Math.min(lo, t, m - s);
      hi = Math.max(hi, t, m + s);
    }
    // Also include sample points
    for (const y of State.gp.Y) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const pad = (hi - lo) * 0.1 || 0.5;
    return { lo: lo - pad, hi: hi + pad };
  }

  function yToCanvas(y, lo, hi) { return plotT + (1 - (y - lo) / (hi - lo)) * (plotB - plotT); }

  function draw() {
    const ctx = DOM.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const xs = State.plotXs;
    const truth = State.truthCache;
    const { means, vars } = State.gp.X.length > 0 ? State.gp.predictBatch(xs) : { means: new Float64Array(xs.length), vars: Float64Array.from(xs, () => 1) };
    const yr = yRange(truth, means, vars);

    // Grid
    drawGrid(ctx, yr);

    // Confidence interval
    if (State.legendVisibility.ci && State.gp.X.length > 0) {
      drawCI(ctx, xs, means, vars, yr);
    }

    // True function
    if (State.showTruth && State.legendVisibility.truth) {
      drawLine(ctx, xs, truth, yr, COLORS.truth, 1.5, [6, 4]);
    }

    // GP mean
    if (State.legendVisibility.mean && State.gp.X.length > 0) {
      drawLine(ctx, xs, means, yr, COLORS.mean, 2.5);
    }

    // Acquisition function
    if (State.showAcq && State.legendVisibility.acq && State.gp.X.length > 0) {
      drawAcquisition(ctx, xs, means, vars);
    }

    // Sampled points
    if (State.legendVisibility.samples) {
      drawSamples(ctx, yr);
    }

    // Next point indicator
    if (State.nextX !== null && State.legendVisibility.next && State.gp.X.length > 0) {
      drawNextPoint(ctx, yr);
    }

    // Animation dot (new sample flying in)
    if (State.animProgress < 1 && State.animTarget !== null) {
      drawAnimDot(ctx, yr);
    }

    ctx.restore();
  }

  function drawGrid(ctx, yr) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    // Vertical
    for (let i = 0; i <= 10; i++) {
      const x = xToCanvas(i / 10);
      ctx.beginPath(); ctx.moveTo(x, plotT); ctx.lineTo(x, plotB); ctx.stroke();
    }
    // Horizontal + labels
    const nTicks = 5;
    ctx.font = `${10}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = COLORS.axisLabel;
    ctx.textAlign = "right";
    for (let i = 0; i <= nTicks; i++) {
      const val = yr.lo + (yr.hi - yr.lo) * (i / nTicks);
      const y = yToCanvas(val, yr.lo, yr.hi);
      ctx.beginPath(); ctx.strokeStyle = COLORS.grid; ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.fillText(val.toFixed(2), plotL - 6, y + 3);
    }
    // X labels
    ctx.textAlign = "center";
    for (let i = 0; i <= 10; i += 2) {
      const v = i / 10;
      ctx.fillText(v.toFixed(1), xToCanvas(v), plotB + 14);
    }
    // Axis lines
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotL, plotT); ctx.lineTo(plotL, plotB); ctx.lineTo(plotR, plotB); ctx.stroke();
  }

  function drawLine(ctx, xs, ys, yr, color, width, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const cx = xToCanvas(xs[i]);
      const cy = yToCanvas(ys[i], yr.lo, yr.hi);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCI(ctx, xs, means, vars, yr) {
    // 95% CI = ±1.96σ
    ctx.fillStyle = COLORS.ciFill;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const cx = xToCanvas(xs[i]);
      const cy = yToCanvas(means[i] + 1.96 * Math.sqrt(vars[i]), yr.lo, yr.hi);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    for (let i = xs.length - 1; i >= 0; i--) {
      const cx = xToCanvas(xs[i]);
      const cy = yToCanvas(means[i] - 1.96 * Math.sqrt(vars[i]), yr.lo, yr.hi);
      ctx.lineTo(cx, cy);
    }
    ctx.closePath();
    ctx.fill();

    // CI borders
    ctx.strokeStyle = COLORS.ciStroke;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const cx = xToCanvas(xs[i]);
      const cy = yToCanvas(means[i] + 1.96 * Math.sqrt(vars[i]), yr.lo, yr.hi);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const cx = xToCanvas(xs[i]);
      const cy = yToCanvas(means[i] - 1.96 * Math.sqrt(vars[i]), yr.lo, yr.hi);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawAcquisition(ctx, xs, means, vars) {
    const acqFn = Acquisition[State.acqKey];
    const acqVals = new Float64Array(xs.length);
    let acqMin = Infinity, acqMax = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      acqVals[i] = acqFn(means[i], vars[i], State.bestY, State.explore);
      if (acqVals[i] < acqMin) acqMin = acqVals[i];
      if (acqVals[i] > acqMax) acqMax = acqVals[i];
    }
    const acqRange = acqMax - acqMin || 1;

    // Fill
    ctx.fillStyle = COLORS.acqFill;
    ctx.beginPath();
    ctx.moveTo(xToCanvas(xs[0]), acqB);
    for (let i = 0; i < xs.length; i++) {
      const cx = xToCanvas(xs[i]);
      const cy = acqB - ((acqVals[i] - acqMin) / acqRange) * (acqB - acqT);
      ctx.lineTo(cx, cy);
    }
    ctx.lineTo(xToCanvas(xs[xs.length - 1]), acqB);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = COLORS.acqLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const cx = xToCanvas(xs[i]);
      const cy = acqB - ((acqVals[i] - acqMin) / acqRange) * (acqB - acqT);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Acq label
    ctx.font = `10px 'JetBrains Mono', monospace`;
    ctx.fillStyle = COLORS.acqLine;
    ctx.textAlign = "left";
    ctx.fillText("Acq(x)", plotL + 4, acqT + 10);
  }

  function drawSamples(ctx, yr) {
    const gp = State.gp;
    for (let i = 0; i < gp.X.length; i++) {
      const cx = xToCanvas(gp.X[i]);
      const cy = yToCanvas(gp.Y[i], yr.lo, yr.hi);
      const isBest = gp.X[i] === State.bestX;
      const isNew = i === gp.X.length - 1 && State.animProgress < 1;

      // Glow
      ctx.beginPath();
      ctx.arc(cx, cy, isBest ? 12 : 8, 0, Math.PI * 2);
      ctx.fillStyle = isBest ? "rgba(52,211,153,0.2)" : "rgba(251,191,36,0.15)";
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(cx, cy, isBest ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isBest ? COLORS.best : COLORS.sample;
      ctx.fill();
      ctx.strokeStyle = isBest ? "#d1fae5" : COLORS.sampleStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Number label
      if (gp.X.length <= 25) {
        ctx.font = `bold 9px 'Inter', sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.textAlign = "center";
        ctx.fillText(i + 1, cx, cy - 10);
      }
    }
  }

  function drawNextPoint(ctx, yr) {
    const cx = xToCanvas(State.nextX);
    // Vertical dashed line
    ctx.strokeStyle = "rgba(251,113,133,0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, plotT);
    ctx.lineTo(cx, acqB);
    ctx.stroke();
    ctx.setLineDash([]);

    // Diamond marker at top
    const dy = plotT + 12;
    const ds = 7;
    ctx.fillStyle = COLORS.next;
    ctx.beginPath();
    ctx.moveTo(cx, dy - ds);
    ctx.lineTo(cx + ds, dy);
    ctx.lineTo(cx, dy + ds);
    ctx.lineTo(cx - ds, dy);
    ctx.closePath();
    ctx.fill();

    // Pulsing glow
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
    ctx.beginPath();
    ctx.arc(cx, dy, 12 + pulse * 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(251,113,133,${0.1 + pulse * 0.1})`;
    ctx.fill();
  }

  function drawAnimDot(ctx, yr) {
    const t = easeOut(State.animProgress);
    const x = State.animTarget;
    const y = Objectives[State.objectiveKey].fn(x);
    const cx = xToCanvas(x);
    const startY = plotT - 20;
    const endY = yToCanvas(y, yr.lo, yr.hi);
    const cy = startY + (endY - startY) * t;

    // Comet trail
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + (1 - t) * 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(251,191,36,${0.6 * (1 - t)})`;
    ctx.fill();

    // Impact ripple
    if (t > 0.8) {
      const r = (t - 0.8) * 5;
      ctx.beginPath();
      ctx.arc(cx, endY, 10 + r * 20, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(251,191,36,${0.4 * (1 - r)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /* Convergence mini-chart */
  function drawConvergence() {
    const canvas = DOM.canvasConv;
    const ctx = DOM.ctxConv;
    const rect = canvas.parentElement.getBoundingClientRect();
    const cW = rect.width, cH = rect.height;
    const d = window.devicePixelRatio || 1;
    canvas.width = cW * d;
    canvas.height = cH * d;
    canvas.style.width = cW + "px";
    canvas.style.height = cH + "px";
    ctx.save();
    ctx.scale(d, d);
    ctx.clearRect(0, 0, cW, cH);

    const data = State.convergenceHistory;
    if (data.length < 1) { ctx.restore(); return; }

    const m = 8;
    let lo = Math.min(...data), hi = Math.max(...data);
    const pad = (hi - lo) * 0.15 || 0.5;
    lo -= pad; hi += pad;

    // Fill gradient
    const grad = ctx.createLinearGradient(0, m, 0, cH - m);
    grad.addColorStop(0, "rgba(34,211,238,0.2)");
    grad.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(m, cH - m);
    for (let i = 0; i < data.length; i++) {
      const x = m + (i / Math.max(data.length - 1, 1)) * (cW - 2 * m);
      const y = (cH - m) - ((data[i] - lo) / (hi - lo)) * (cH - 2 * m);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(m + (cW - 2 * m), cH - m);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = m + (i / Math.max(data.length - 1, 1)) * (cW - 2 * m);
      const y = (cH - m) - ((data[i] - lo) / (hi - lo)) * (cH - 2 * m);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current best dot
    if (data.length > 0) {
      const lx = m + (cW - 2 * m);
      const ly = (cH - m) - ((data[data.length - 1] - lo) / (hi - lo)) * (cH - 2 * m);
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = "#22d3ee"; ctx.fill();
    }

    ctx.restore();
  }

  /* Tooltip handling */
  function setupTooltip() {
    const wrap = DOM.canvas.parentElement;
    wrap.addEventListener("mousemove", e => {
      const rect = DOM.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (mx < plotL || mx > plotR || my < plotT || my > plotB) {
        DOM.tooltip.classList.remove("visible");
        return;
      }
      const x = canvasToX(mx);
      const truth = Objectives[State.objectiveKey].fn(x);
      let text = `x: ${x.toFixed(3)} | f(x): ${truth.toFixed(3)}`;
      if (State.gp.X.length > 0) {
        const p = State.gp.predict(x);
        text += ` | μ: ${p.mean.toFixed(3)} | σ: ${Math.sqrt(p.variance).toFixed(3)}`;
      }
      DOM.tooltip.textContent = text;
      DOM.tooltip.classList.add("visible");
      const ttW = DOM.tooltip.offsetWidth;
      let ttx = mx + 12;
      if (ttx + ttW > W) ttx = mx - ttW - 12;
      DOM.tooltip.style.left = ttx + "px";
      DOM.tooltip.style.top = (my - 30) + "px";
    });
    wrap.addEventListener("mouseleave", () => DOM.tooltip.classList.remove("visible"));
  }

  return { resize, draw, drawConvergence, setupTooltip };
})();

/* -------------------------------------------------------
 *  CONCEPT GRID
 * ------------------------------------------------------- */
function updateConceptGrid() {
  const cards = [
    { label: "Kernel", val: { rbf: "RBF", matern32: "Matérn 3/2", matern52: "Matérn 5/2" }[State.kernelKey], color: "var(--cyan)" },
    { label: "Length Scale", val: State.ls.toFixed(2), color: "var(--purple)" },
    { label: "Noise σ", val: State.noise.toFixed(2), color: "var(--amber)" },
    { label: "Acquisition", val: { ei: "Exp. Improv.", ucb: "UCB", poi: "Prob. Improv." }[State.acqKey], color: "var(--green)" },
    { label: "Exploration", val: State.explore.toFixed(2), color: "var(--rose)" },
    { label: "Samples", val: State.gp ? State.gp.X.length : 0, color: "var(--blue)" },
  ];
  DOM.conceptGrid.innerHTML = cards.map(c => `
    <div class="concept-card">
      <div class="cc-label" style="color:${c.color}">${c.label}</div>
      <div class="cc-val">${c.val}</div>
    </div>
  `).join("");
}

/* -------------------------------------------------------
 *  STATS
 * ------------------------------------------------------- */
function updateStats() {
  DOM.statIter.textContent = State.iteration;
  DOM.statBestY.textContent = State.bestY > -Infinity ? State.bestY.toFixed(4) : "—";
  DOM.statBestX.textContent = State.bestX !== null ? State.bestX.toFixed(4) : "—";
  DOM.statNextX.textContent = State.nextX !== null ? State.nextX.toFixed(4) : "—";
  DOM.statKernel.textContent = { rbf: "RBF", matern32: "Matérn 3/2", matern52: "Matérn 5/2" }[State.kernelKey];

  if (State.gp.X.length > 0 && State.nextX !== null) {
    const p = State.gp.predict(State.nextX);
    const a = Acquisition[State.acqKey](p.mean, p.variance, State.bestY, State.explore);
    DOM.statAcqMax.textContent = a.toFixed(4);
  } else {
    DOM.statAcqMax.textContent = "—";
  }
  updateConceptGrid();
}

/* -------------------------------------------------------
 *  ANIMATION LOOP
 * ------------------------------------------------------- */
let rafId = null;
function animate(ts) {
  // Advance animation
  if (State.animProgress < 1) {
    State.animProgress = Math.min(1, State.animProgress + 0.035);
  }
  Renderer.draw();
  rafId = requestAnimationFrame(animate);
}

/* -------------------------------------------------------
 *  AUTO-RUN
 * ------------------------------------------------------- */
function toggleAutoRun() {
  if (State.autoRunning) {
    clearInterval(State.autoTimer);
    State.autoRunning = false;
    DOM.btnAuto.innerHTML = '<span class="icon">⟳</span> Auto-Run';
    DOM.btnAuto.className = "btn btn-success";
  } else {
    State.autoRunning = true;
    DOM.btnAuto.innerHTML = '<span class="icon">⏸</span> Pause';
    DOM.btnAuto.className = "btn btn-danger";
    State.autoTimer = setInterval(() => {
      doStep();
      Renderer.drawConvergence();
      if (State.iteration >= 50) {
        toggleAutoRun();
        showToast("Reached 50 iterations — auto-run stopped.", "info");
      }
    }, 600);
  }
}

/* -------------------------------------------------------
 *  RESET
 * ------------------------------------------------------- */
function fullReset() {
  if (State.autoRunning) toggleAutoRun();
  initState();
  addInitialSamples();
  updateStats();
  Renderer.drawConvergence();
  if (typeof BayesEdu !== "undefined") BayesEdu.reset(State);
  showToast("Reset — " + Objectives[State.objectiveKey].name, "success");
}

/* -------------------------------------------------------
 *  EVENT WIRING
 * ------------------------------------------------------- */
function wireEvents() {
  DOM.btnStep.addEventListener("click", () => { doStep(); Renderer.drawConvergence(); });
  DOM.btnAuto.addEventListener("click", toggleAutoRun);
  DOM.btnReset.addEventListener("click", fullReset);

  DOM.selObj.addEventListener("change", e => { State.objectiveKey = e.target.value; fullReset(); });
  DOM.selKernel.addEventListener("change", e => {
    State.kernelKey = e.target.value;
    State.gp.setKernel(Kernels[State.kernelKey]);
    computeNextPoint(); updateStats();
  });
  DOM.selAcq.addEventListener("change", e => {
    State.acqKey = e.target.value;
    DOM.lblLs.parentElement.querySelector(".val"); // update label
    computeNextPoint(); updateStats();
  });
  DOM.selInit.addEventListener("change", e => { State.initSamples = parseInt(e.target.value); });

  // Sliders
  DOM.rngLs.addEventListener("input", e => {
    State.ls = parseFloat(e.target.value);
    DOM.lblLs.textContent = State.ls.toFixed(2);
    State.gp.setHyperparams(State.ls, State.noise);
    computeNextPoint(); updateStats();
  });
  DOM.rngNoise.addEventListener("input", e => {
    State.noise = parseFloat(e.target.value);
    DOM.lblNoise.textContent = State.noise.toFixed(2);
    State.gp.setHyperparams(State.ls, State.noise);
    computeNextPoint(); updateStats();
  });
  DOM.rngExplore.addEventListener("input", e => {
    State.explore = parseFloat(e.target.value);
    DOM.lblExplore.textContent = State.explore.toFixed(2);
    computeNextPoint(); updateStats();
  });

  // Toggles
  DOM.toggleTruth.addEventListener("change", e => { State.showTruth = e.checked; });
  DOM.toggleAcq.addEventListener("change", e => { State.showAcq = e.checked; });

  // Legend toggles
  document.querySelectorAll(".legend-item").forEach(el => {
    el.addEventListener("click", () => {
      const k = el.dataset.key;
      State.legendVisibility[k] = !State.legendVisibility[k];
      el.style.opacity = State.legendVisibility[k] ? "1" : "0.35";
    });
  });

  // Help / onboarding
  DOM.btnHelp.addEventListener("click", () => DOM.onboarding.classList.remove("hidden"));
  DOM.btnStart.addEventListener("click", () => {
    DOM.onboarding.classList.add("hidden");
    localStorage.setItem("bo-onboarded", "1");
  });

  // Mobile tabs
  document.querySelectorAll(".mobile-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".mobile-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const sec = tab.dataset.section;
      document.querySelectorAll(".sidebar-section").forEach(s => {
        s.classList.toggle("active", s.dataset.section === sec);
        s.style.display = s.dataset.section === sec ? "" : "none";
      });
    });
  });

  // Resize
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      Renderer.resize(DOM.canvas);
      Renderer.drawConvergence();
    }, 100);
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === " " || e.key === "s") { e.preventDefault(); doStep(); Renderer.drawConvergence(); }
    if (e.key === "a") toggleAutoRun();
    if (e.key === "r") fullReset();
    if (e.key === "t") { DOM.toggleTruth.checked = !DOM.toggleTruth.checked; State.showTruth = DOM.toggleTruth.checked; }
  });
}

/* -------------------------------------------------------
 *  BOOT
 * ------------------------------------------------------- */
function boot() {
  cacheDom();

  // Show onboarding on first visit
  if (!localStorage.getItem("bo-onboarded")) {
    DOM.onboarding.classList.remove("hidden");
  }

  initState();
  addInitialSamples();
  wireEvents();

  Renderer.resize(DOM.canvas);
  Renderer.setupTooltip();
  updateStats();
  Renderer.drawConvergence();

  // Education
  if (typeof BayesEdu !== "undefined") BayesEdu.init(State, DOM.eduContent);

  // Start render loop
  rafId = requestAnimationFrame(animate);

  showToast("Press Space or click Step to iterate!", "info");
}

document.addEventListener("DOMContentLoaded", boot);
