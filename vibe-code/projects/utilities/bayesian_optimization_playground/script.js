/* =========================================================
 *  Bayesian Optimization Playground – script.js
 *  Pure JS: Gaussian Process, Acquisition Funcs, Canvas Viz
 *  v2 – Custom objectives, comparison mode, undo/redo,
 *        speed control, export, improved numerics
 * ========================================================= */

"use strict";

/* -------------------------------------------------------
 *  MATH HELPERS
 * ------------------------------------------------------- */
const MathU = (() => {
  const EPS = 1e-8;

  function normalPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  function normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
          a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const t = 1 / (1 + p * Math.abs(x));
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
    return 0.5 * (1 + sign * y);
  }

  /** Cholesky with adaptive jitter for near-singular matrices */
  function cholesky(A) {
    const n = A.length;
    let jitter = 1e-6;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const L = _choleskyCore(A, jitter);
        return L;
      } catch {
        jitter *= 10;
      }
    }
    return _choleskyCore(A, 1e-2);
  }

  function _choleskyCore(A, jitter) {
    const n = A.length;
    const L = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = 0;
        for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
        if (i === j) {
          const val = A[i][i] + jitter - s;
          if (val <= 0) throw new Error("Not positive definite");
          L[i][j] = Math.sqrt(val);
        } else {
          L[i][j] = (A[i][j] - s) / (L[j][j] + EPS);
        }
      }
    }
    return L;
  }

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

  function choleskySolve(L, y) {
    return backSolve(L, forwardSolve(L, y));
  }

  function linspace(a, b, n) {
    const out = new Float64Array(n);
    const step = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) out[i] = a + i * step;
    return out;
  }

  /** Log marginal likelihood (for diagnostics) */
  function logMarginalLikelihood(L, alpha, Y) {
    const n = Y.length;
    let dataFit = 0;
    for (let i = 0; i < n; i++) dataFit += Y[i] * alpha[i];
    let logDet = 0;
    for (let i = 0; i < n; i++) logDet += Math.log(L[i][i]);
    return -0.5 * dataFit - logDet - 0.5 * n * Math.log(2 * Math.PI);
  }

  return { normalPDF, normalCDF, cholesky, forwardSolve, backSolve, choleskySolve, linspace, logMarginalLikelihood, EPS };
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
  },
  periodic(x1, x2, ls) {
    const d = Math.abs(x1 - x2);
    const s = Math.sin(Math.PI * d / 0.5);
    return Math.exp(-2 * s * s / (ls * ls));
  }
};

/* -------------------------------------------------------
 *  OBJECTIVE FUNCTIONS  (domain [0, 1])
 * ------------------------------------------------------- */
const Objectives = {
  sineMix: {
    name: "Sine Mixture",
    fn: x => Math.sin(3 * Math.PI * x) * 0.5 + Math.sin(7 * Math.PI * x) * 0.3 + 0.2 * Math.cos(11 * Math.PI * x),
    desc: "A blend of sine waves with varying frequency.",
    difficulty: 1
  },
  doublePeak: {
    name: "Double Peaks",
    fn: x => Math.exp(-40 * (x - 0.3) ** 2) + 0.8 * Math.exp(-60 * (x - 0.75) ** 2) - 0.3,
    desc: "Two sharp Gaussian peaks of different heights.",
    difficulty: 2
  },
  rastrigin1d: {
    name: "Rastrigin 1D",
    fn: x => { const z = 6 * x - 3; return -(z * z - 10 * Math.cos(2 * Math.PI * z)) / 25; },
    desc: "Classic Rastrigin function with many local optima.",
    difficulty: 3
  },
  noisyQuad: {
    name: "Noisy Quadratic",
    fn: x => -(4 * (x - 0.55) ** 2) + 0.2 * Math.sin(20 * x),
    desc: "A parabola perturbed by high-frequency oscillation.",
    difficulty: 1
  },
  cliff: {
    name: "Cliff Edge",
    fn: x => x < 0.6 ? 0.4 * Math.sin(4 * Math.PI * x) : 1.0 - 5 * (x - 0.65) ** 2,
    desc: "Smooth region with a sudden peak — tests exploitation.",
    difficulty: 2
  },
  multiModal: {
    name: "Multi-Modal",
    fn: x => 0.5 * Math.sin(2 * Math.PI * x) + 0.3 * Math.sin(6 * Math.PI * x + 1) + 0.15 * Math.cos(14 * Math.PI * x) + 0.3,
    desc: "Complex surface with many local optima of similar height.",
    difficulty: 3
  },
  stepFunction: {
    name: "Step Function",
    fn: x => {
      if (x < 0.2) return 0.1;
      if (x < 0.4) return 0.6;
      if (x < 0.6) return 0.3;
      if (x < 0.8) return 0.9;
      return 0.5;
    },
    desc: "Piecewise constant — tests GP on discontinuities.",
    difficulty: 2
  },
  camelback: {
    name: "Six-Hump Camel (1D slice)",
    fn: x => {
      const z = 4 * x - 2;
      return -(4 - 2.1 * z * z + z ** 4 / 3) * z * z / 10 + 0.5;
    },
    desc: "Slice of the classic six-hump camelback function.",
    difficulty: 2
  }
};

/* -------------------------------------------------------
 *  CUSTOM OBJECTIVE PARSER (safe eval)
 * ------------------------------------------------------- */
const CustomObjective = (() => {
  const ALLOWED = new Set([
    "Math","sin","cos","tan","exp","log","sqrt","abs","pow","PI","E",
    "min","max","floor","ceil","round","atan","asin","acos","sign",
    "sinh","cosh","tanh"
  ]);

  function compile(expr) {
    // Replace common shorthand
    let code = expr
      .replace(/\bsin\b/g, "Math.sin")
      .replace(/\bcos\b/g, "Math.cos")
      .replace(/\btan\b/g, "Math.tan")
      .replace(/\bexp\b/g, "Math.exp")
      .replace(/\blog\b/g, "Math.log")
      .replace(/\bsqrt\b/g, "Math.sqrt")
      .replace(/\babs\b/g, "Math.abs")
      .replace(/\bpow\b/g, "Math.pow")
      .replace(/\bPI\b/g, "Math.PI")
      .replace(/\bpi\b/g, "Math.PI")
      .replace(/\be\b(?!x)/g, "Math.E")
      .replace(/\bsign\b/g, "Math.sign")
      .replace(/\bfloor\b/g, "Math.floor")
      .replace(/\bceil\b/g, "Math.ceil")
      .replace(/\bsinh\b/g, "Math.sinh")
      .replace(/\bcosh\b/g, "Math.cosh")
      .replace(/\btanh\b/g, "Math.tanh")
      .replace(/\^/g, "**");

    // Fix double-prefixing (Math.Math.sin -> Math.sin)
    code = code.replace(/Math\.Math\./g, "Math.");

    try {
      const fn = new Function("x", `"use strict"; return (${code});`);
      // Test it
      const testVals = [0, 0.25, 0.5, 0.75, 1];
      for (const v of testVals) {
        const result = fn(v);
        if (typeof result !== "number" || !isFinite(result)) {
          throw new Error(`Returns non-finite value at x=${v}`);
        }
      }
      return { fn, error: null };
    } catch (e) {
      return { fn: null, error: e.message };
    }
  }

  return { compile };
})();

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
    this.logML = null;
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
        this.kernelFn(this.X[i], this.X[j], this.ls) + (i === j ? this.noise * this.noise : 0)
      )
    );
    this.L = MathU.cholesky(K);
    this.alpha = MathU.choleskySolve(this.L, Float64Array.from(this.Y));
    this.logML = MathU.logMarginalLikelihood(this.L, this.alpha, this.Y);
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
    const kSelf = this.kernelFn(xStar, xStar, this.ls);
    const variance = Math.max(kSelf - varReduction, 1e-8);
    return { mean, variance };
  }

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

  /** Clone state for undo history */
  snapshot() {
    return {
      X: [...this.X],
      Y: [...this.Y],
      ls: this.ls,
      noise: this.noise,
    };
  }

  /** Restore from snapshot */
  restore(snap) {
    this.X = [...snap.X];
    this.Y = [...snap.Y];
    this.ls = snap.ls;
    this.noise = snap.noise;
    this._updateModel();
  }
}

/* -------------------------------------------------------
 *  ACQUISITION FUNCTIONS
 * ------------------------------------------------------- */
const Acquisition = {
  ei(mean, variance, bestY, xi) {
    const sigma = Math.sqrt(variance);
    if (sigma < 1e-8) return 0;
    const z = (mean - bestY - xi) / sigma;
    return (mean - bestY - xi) * MathU.normalCDF(z) + sigma * MathU.normalPDF(z);
  },
  ucb(mean, variance, _bestY, kappa) {
    return mean + kappa * Math.sqrt(variance);
  },
  poi(mean, variance, bestY, xi) {
    const sigma = Math.sqrt(variance);
    if (sigma < 1e-8) return 0;
    return MathU.normalCDF((mean - bestY - xi) / sigma);
  },
  thompson(mean, variance, _bestY, _xi) {
    // Thompson sampling: draw from the posterior
    const sigma = Math.sqrt(variance);
    // Box-Muller transform for a standard normal sample
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
    return mean + sigma * z;
  }
};

/* -------------------------------------------------------
 *  MULTI-START ACQUISITION OPTIMIZER
 * ------------------------------------------------------- */
function optimizeAcquisition(gp, acqKey, bestY, explore) {
  const acqFn = Acquisition[acqKey];

  // Coarse grid scan (300 points)
  const coarseXs = MathU.linspace(0.005, 0.995, 300);
  let bestAcq = -Infinity, bestX = 0.5;
  const acqVals = [];

  for (const x of coarseXs) {
    const p = gp.predict(x);
    const a = acqFn(p.mean, p.variance, bestY, explore);
    acqVals.push(a);
    if (a > bestAcq) { bestAcq = a; bestX = x; }
  }

  // Find top 5 peaks for local refinement
  const peaks = [];
  for (let i = 1; i < acqVals.length - 1; i++) {
    if (acqVals[i] > acqVals[i - 1] && acqVals[i] > acqVals[i + 1]) {
      peaks.push({ x: coarseXs[i], val: acqVals[i] });
    }
  }
  peaks.sort((a, b) => b.val - a.val);
  const topPeaks = peaks.slice(0, 5);
  if (topPeaks.length === 0) topPeaks.push({ x: bestX, val: bestAcq });

  // Local golden-section search around each peak
  for (const peak of topPeaks) {
    const result = goldenSection(x => {
      const p = gp.predict(x);
      return acqFn(p.mean, p.variance, bestY, explore);
    }, Math.max(0.001, peak.x - 0.05), Math.min(0.999, peak.x + 0.05), 20);
    if (result.val > bestAcq) {
      bestAcq = result.val;
      bestX = result.x;
    }
  }

  return bestX;
}

function goldenSection(f, a, b, maxIter) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < maxIter; i++) {
    if (fc < fd) {
      a = c; c = d; fc = fd;
      d = a + gr * (b - a); fd = f(d);
    } else {
      b = d; d = c; fd = fc;
      c = b - gr * (b - a); fc = f(c);
    }
  }
  const mid = (a + b) / 2;
  return { x: mid, val: f(mid) };
}

/* -------------------------------------------------------
 *  RANDOM SEARCH BASELINE
 * ------------------------------------------------------- */
class RandomSearchBaseline {
  constructor() { this.bestY = -Infinity; this.history = []; this.points = []; }

  reset() { this.bestY = -Infinity; this.history = []; this.points = []; }

  step(objectiveFn, noise) {
    const x = Math.random() * 0.98 + 0.01;
    const y = objectiveFn(x) + (Math.random() - 0.5) * noise * 2;
    this.points.push({ x, y });
    if (y > this.bestY) this.bestY = y;
    this.history.push(this.bestY);
  }

  /** Run to match iteration count */
  syncTo(n, objectiveFn, noise) {
    while (this.history.length < n) {
      this.step(objectiveFn, noise);
    }
  }
}

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
  autoSpeed: 600,
  showTruth: true,
  showAcq: true,
  convergenceHistory: [],
  plotXs: MathU.linspace(0, 1, 250),
  truthCache: null,
  legendVisibility: { truth: true, mean: true, ci: true, samples: true, next: true, acq: true },
  animProgress: 1,
  animTarget: null,
  lastFrameTime: 0,
  // New features
  history: [],          // undo stack: array of snapshots
  historyIdx: -1,       // current position in history
  compareMode: false,   // BO vs Random search
  randomBaseline: new RandomSearchBaseline(),
  customFn: null,       // compiled custom function or null
  customExpr: "",
  regret: [],           // simple regret over time
  trueOptimum: null,    // cached true optimum value
  showShortcuts: false,
  theme: "dark",
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
  DOM.ctxConv = DOM.canvasConv ? DOM.canvasConv.getContext("2d") : null;
  DOM.statIter = $("stat-iter");
  DOM.statBestY = $("stat-best-y");
  DOM.statBestX = $("stat-best-x");
  DOM.statNextX = $("stat-next-x");
  DOM.statKernel = $("stat-kernel");
  DOM.statAcqMax = $("stat-acq-max");
  DOM.statRegret = $("stat-regret");
  DOM.statLogML = $("stat-logml");
  DOM.btnStep = $("btn-step");
  DOM.btnAuto = $("btn-auto");
  DOM.btnReset = $("btn-reset");
  DOM.btnHelp = $("btn-help");
  DOM.btnUndo = $("btn-undo");
  DOM.btnExportCSV = $("btn-export-csv");
  DOM.btnExportPNG = $("btn-export-png");
  DOM.selObj = $("sel-objective");
  DOM.selKernel = $("sel-kernel");
  DOM.selAcq = $("sel-acquisition");
  DOM.selInit = $("sel-init-samples");
  DOM.rngLs = $("rng-ls");
  DOM.rngNoise = $("rng-noise");
  DOM.rngExplore = $("rng-explore");
  DOM.rngSpeed = $("rng-speed");
  DOM.lblLs = $("lbl-ls");
  DOM.lblNoise = $("lbl-noise");
  DOM.lblExplore = $("lbl-explore");
  DOM.lblSpeed = $("lbl-speed");
  DOM.toggleTruth = $("toggle-true-fn");
  DOM.toggleAcq = $("toggle-acq");
  DOM.toggleCompare = $("toggle-compare");
  DOM.onboarding = $("onboarding");
  DOM.btnStart = $("btn-start");
  DOM.toastContainer = $("toast-container");
  DOM.conceptGrid = $("concept-grid");
  DOM.eduContent = $("edu-content");
  DOM.customFnInput = $("custom-fn-input");
  DOM.customFnError = $("custom-fn-error");
  DOM.customFnBtn = $("btn-custom-fn");
  DOM.shortcutsModal = $("shortcuts-modal");
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
 *  TRUE OPTIMUM COMPUTATION
 * ------------------------------------------------------- */
function computeTrueOptimum() {
  const fn = getObjectiveFn();
  let best = -Infinity;
  const xs = MathU.linspace(0, 1, 1000);
  for (const x of xs) {
    const y = fn(x);
    if (y > best) best = y;
  }
  State.trueOptimum = best;
}

function getObjectiveFn() {
  if (State.objectiveKey === "custom" && State.customFn) return State.customFn;
  return Objectives[State.objectiveKey].fn;
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
  State.history = [];
  State.historyIdx = -1;
  State.regret = [];
  State.randomBaseline.reset();
  cacheObjectiveTruth();
  computeTrueOptimum();
}

function cacheObjectiveTruth() {
  const fn = getObjectiveFn();
  State.truthCache = Float64Array.from(State.plotXs, x => fn(x));
}

function saveSnapshot() {
  const snap = {
    gpSnap: State.gp.snapshot(),
    iteration: State.iteration,
    bestX: State.bestX,
    bestY: State.bestY,
    nextX: State.nextX,
    convergenceHistory: [...State.convergenceHistory],
    regret: [...State.regret],
  };
  // Truncate any forward history
  State.history = State.history.slice(0, State.historyIdx + 1);
  State.history.push(snap);
  State.historyIdx = State.history.length - 1;
  // Cap history at 200 entries
  if (State.history.length > 200) {
    State.history.shift();
    State.historyIdx--;
  }
}

function undo() {
  if (State.historyIdx <= 0) { showToast("Nothing to undo", "info"); return; }
  State.historyIdx--;
  const snap = State.history[State.historyIdx];
  State.gp.restore(snap.gpSnap);
  State.iteration = snap.iteration;
  State.bestX = snap.bestX;
  State.bestY = snap.bestY;
  State.nextX = snap.nextX;
  State.convergenceHistory = [...snap.convergenceHistory];
  State.regret = [...snap.regret];
  computeNextPoint();
  updateStats();
  Renderer.drawConvergence();
  if (typeof BayesEdu !== "undefined") BayesEdu.onStep(State);
  showToast(`Undo → step ${State.iteration}`, "info");
}

function addInitialSamples() {
  const n = State.initSamples;
  const fn = getObjectiveFn();
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n + (Math.random() - 0.5) * 0.15;
    const xc = Math.max(0.02, Math.min(0.98, x));
    const y = fn(xc) + (Math.random() - 0.5) * State.noise * 2;
    State.gp.addPoint(xc, y);
    if (y > State.bestY) { State.bestY = y; State.bestX = xc; }
  }
  State.convergenceHistory.push(State.bestY);
  State.regret.push(State.trueOptimum - State.bestY);
  computeNextPoint();
  saveSnapshot();
}

function computeNextPoint() {
  if (State.gp.X.length === 0) { State.nextX = 0.5; return; }
  State.nextX = optimizeAcquisition(State.gp, State.acqKey, State.bestY, State.explore);
}

function doStep() {
  if (State.nextX === null) return;
  const x = State.nextX;
  const fn = getObjectiveFn();
  const y = fn(x) + (Math.random() - 0.5) * State.noise * 2;
  State.gp.addPoint(x, y);
  State.iteration++;
  if (y > State.bestY) { State.bestY = y; State.bestX = x; }
  State.convergenceHistory.push(State.bestY);
  State.regret.push(State.trueOptimum - State.bestY);

  // Sync random baseline if compare mode on
  if (State.compareMode) {
    State.randomBaseline.syncTo(State.convergenceHistory.length, fn, State.noise);
  }

  // Trigger animation
  State.animProgress = 0;
  State.animTarget = x;
  computeNextPoint();
  saveSnapshot();
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
    axisLabel: "#64748b",
    randomLine: "#f97316",
    regretLine: "#e879f9",
    uncertaintyHeat: (val) => `hsla(${190 - val * 30}, 80%, 60%, ${0.05 + val * 0.15})`,
  };

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

    drawGrid(ctx, yr);

    // Uncertainty heatmap (subtle background coloring)
    if (State.gp.X.length > 0 && State.legendVisibility.ci) {
      drawUncertaintyHeatmap(ctx, xs, vars);
    }

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

    // Animation dot
    if (State.animProgress < 1 && State.animTarget !== null) {
      drawAnimDot(ctx, yr);
    }

    // Iteration counter overlay
    drawIterBadge(ctx);

    ctx.restore();
  }

  function drawIterBadge(ctx) {
    const text = `Step ${State.iteration}`;
    ctx.font = `bold 11px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "rgba(148,163,184,0.5)";
    ctx.textAlign = "right";
    ctx.fillText(text, plotR - 4, plotT + 14);
  }

  function drawUncertaintyHeatmap(ctx, xs, vars) {
    let maxVar = 0;
    for (let i = 0; i < vars.length; i++) if (vars[i] > maxVar) maxVar = vars[i];
    if (maxVar < 1e-6) return;

    const stripW = (plotR - plotL) / xs.length + 1;
    for (let i = 0; i < xs.length; i++) {
      const norm = Math.sqrt(vars[i]) / Math.sqrt(maxVar);
      ctx.fillStyle = COLORS.uncertaintyHeat(norm);
      ctx.fillRect(xToCanvas(xs[i]) - stripW / 2, plotT, stripW, plotB - plotT);
    }
  }

  function drawGrid(ctx, yr) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = xToCanvas(i / 10);
      ctx.beginPath(); ctx.moveTo(x, plotT); ctx.lineTo(x, plotB); ctx.stroke();
    }
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
    ctx.textAlign = "center";
    for (let i = 0; i <= 10; i += 2) {
      const v = i / 10;
      ctx.fillText(v.toFixed(1), xToCanvas(v), plotB + 14);
    }
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

    // Gradient fill
    const grad = ctx.createLinearGradient(0, acqT, 0, acqB);
    grad.addColorStop(0, "rgba(52,211,153,0.2)");
    grad.addColorStop(1, "rgba(52,211,153,0)");
    ctx.fillStyle = grad;
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

    // Peak diamond on acquisition
    if (State.nextX !== null) {
      const peakCX = xToCanvas(State.nextX);
      const p = State.gp.predict(State.nextX);
      const peakVal = acqFn(p.mean, p.variance, State.bestY, State.explore);
      const peakCY = acqB - ((peakVal - acqMin) / acqRange) * (acqB - acqT);
      ctx.fillStyle = COLORS.acqPeak;
      ctx.beginPath();
      const ds = 5;
      ctx.moveTo(peakCX, peakCY - ds);
      ctx.lineTo(peakCX + ds, peakCY);
      ctx.lineTo(peakCX, peakCY + ds);
      ctx.lineTo(peakCX - ds, peakCY);
      ctx.closePath();
      ctx.fill();
    }

    // Acq label
    ctx.font = `10px 'JetBrains Mono', monospace`;
    ctx.fillStyle = COLORS.acqLine;
    ctx.textAlign = "left";
    const acqNames = { ei: "EI(x)", ucb: "UCB(x)", poi: "POI(x)", thompson: "Thompson(x)" };
    ctx.fillText(acqNames[State.acqKey] || "Acq(x)", plotL + 4, acqT + 10);
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

      // Best star marker
      if (isBest) {
        ctx.font = `bold 10px 'Inter', sans-serif`;
        ctx.fillStyle = COLORS.best;
        ctx.textAlign = "center";
        ctx.fillText("★", cx, cy - 12);
      }

      // Number label
      if (gp.X.length <= 30) {
        ctx.font = `bold 9px 'Inter', sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.textAlign = "center";
        ctx.fillText(i + 1, cx, cy + (isBest ? 18 : 14));
      }
    }

    // Draw random baseline points if compare mode
    if (State.compareMode) {
      for (const pt of State.randomBaseline.points) {
        const cx = xToCanvas(pt.x);
        const cy = yToCanvas(pt.y, yr.lo, yr.hi);
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(249,115,22,0.4)";
        ctx.fill();
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

    // Label
    ctx.font = `bold 9px 'JetBrains Mono', monospace`;
    ctx.fillStyle = COLORS.next;
    ctx.textAlign = "center";
    ctx.fillText(`x=${State.nextX.toFixed(3)}`, cx, dy + ds + 14);
  }

  function drawAnimDot(ctx, yr) {
    const t = easeOut(State.animProgress);
    const x = State.animTarget;
    const fn = getObjectiveFn();
    const y = fn(x);
    const cx = xToCanvas(x);
    const startY = plotT - 20;
    const endY = yToCanvas(y, yr.lo, yr.hi);
    const cy = startY + (endY - startY) * t;

    // Trail particles
    for (let p = 0; p < 3; p++) {
      const pT = Math.max(0, t - p * 0.08);
      const pY = startY + (endY - startY) * pT;
      ctx.beginPath();
      ctx.arc(cx + (Math.random() - 0.5) * 4, pY, 2 + (1 - pT) * 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(251,191,36,${0.3 * (1 - pT)})`;
      ctx.fill();
    }

    // Main dot
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + (1 - t) * 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(251,191,36,${0.6 * (1 - t) + 0.4})`;
    ctx.fill();

    // Impact ripple
    if (t > 0.8) {
      const r = (t - 0.8) * 5;
      ctx.beginPath();
      ctx.arc(cx, endY, 10 + r * 25, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(251,191,36,${0.5 * (1 - r)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Second ripple
      ctx.beginPath();
      ctx.arc(cx, endY, 5 + r * 15, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34,211,238,${0.3 * (1 - r)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /* Convergence chart (with comparison + regret) */
  function drawConvergence() {
    const canvas = DOM.canvasConv;
    if (!canvas || !DOM.ctxConv) return;
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

    // Include random baseline in range if compare mode
    if (State.compareMode && State.randomBaseline.history.length > 0) {
      lo = Math.min(lo, ...State.randomBaseline.history);
      hi = Math.max(hi, ...State.randomBaseline.history);
    }

    const pad = (hi - lo) * 0.15 || 0.5;
    lo -= pad; hi += pad;

    const totalPts = Math.max(data.length, State.compareMode ? State.randomBaseline.history.length : 0);

    // Fill gradient for BO
    const grad = ctx.createLinearGradient(0, m, 0, cH - m);
    grad.addColorStop(0, "rgba(34,211,238,0.15)");
    grad.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(m, cH - m);
    for (let i = 0; i < data.length; i++) {
      const x = m + (i / Math.max(totalPts - 1, 1)) * (cW - 2 * m);
      const y = (cH - m) - ((data[i] - lo) / (hi - lo)) * (cH - 2 * m);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(m + ((data.length - 1) / Math.max(totalPts - 1, 1)) * (cW - 2 * m), cH - m);
    ctx.closePath();
    ctx.fill();

    // BO line
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = m + (i / Math.max(totalPts - 1, 1)) * (cW - 2 * m);
      const y = (cH - m) - ((data[i] - lo) / (hi - lo)) * (cH - 2 * m);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Random baseline
    if (State.compareMode && State.randomBaseline.history.length > 0) {
      const rData = State.randomBaseline.history;
      ctx.strokeStyle = COLORS.randomLine;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let i = 0; i < rData.length; i++) {
        const x = m + (i / Math.max(totalPts - 1, 1)) * (cW - 2 * m);
        const y = (cH - m) - ((rData[i] - lo) / (hi - lo)) * (cH - 2 * m);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Legend
      ctx.font = `9px 'JetBrains Mono', monospace`;
      ctx.fillStyle = "#22d3ee";
      ctx.textAlign = "left";
      ctx.fillText("BO", m + 2, m + 10);
      ctx.fillStyle = COLORS.randomLine;
      ctx.fillText("Random", m + 22, m + 10);
    }

    // Current best dot
    if (data.length > 0) {
      const lx = m + ((data.length - 1) / Math.max(totalPts - 1, 1)) * (cW - 2 * m);
      const ly = (cH - m) - ((data[data.length - 1] - lo) / (hi - lo)) * (cH - 2 * m);
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = "#22d3ee"; ctx.fill();
    }

    // True optimum line
    if (State.trueOptimum !== null && State.showTruth) {
      const optY = (cH - m) - ((State.trueOptimum - lo) / (hi - lo)) * (cH - 2 * m);
      ctx.strokeStyle = "rgba(148,163,184,0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(m, optY);
      ctx.lineTo(cW - m, optY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `8px 'JetBrains Mono', monospace`;
      ctx.fillStyle = "rgba(148,163,184,0.6)";
      ctx.textAlign = "right";
      ctx.fillText("optimum", cW - m - 2, optY - 3);
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
      const fn = getObjectiveFn();
      const truth = fn(x);
      let lines = [`x: ${x.toFixed(3)}`, `f(x): ${truth.toFixed(3)}`];
      if (State.gp.X.length > 0) {
        const p = State.gp.predict(x);
        lines.push(`μ: ${p.mean.toFixed(3)}`);
        lines.push(`σ: ${Math.sqrt(p.variance).toFixed(3)}`);
        const acqVal = Acquisition[State.acqKey](p.mean, p.variance, State.bestY, State.explore);
        lines.push(`acq: ${acqVal.toFixed(4)}`);
      }
      DOM.tooltip.innerHTML = lines.join("<br>");
      DOM.tooltip.classList.add("visible");
      const ttW = DOM.tooltip.offsetWidth;
      let ttx = mx + 12;
      if (ttx + ttW > W) ttx = mx - ttW - 12;
      DOM.tooltip.style.left = ttx + "px";
      DOM.tooltip.style.top = (my - 50) + "px";
    });
    wrap.addEventListener("mouseleave", () => DOM.tooltip.classList.remove("visible"));
  }

  return { resize, draw, drawConvergence, setupTooltip };
})();

/* -------------------------------------------------------
 *  CONCEPT GRID
 * ------------------------------------------------------- */
function updateConceptGrid() {
  if (!DOM.conceptGrid) return;
  const cards = [
    { label: "Kernel", val: { rbf: "RBF", matern32: "Matérn 3/2", matern52: "Matérn 5/2", periodic: "Periodic" }[State.kernelKey], color: "var(--cyan)" },
    { label: "Length Scale", val: State.ls.toFixed(2), color: "var(--purple)" },
    { label: "Noise σ", val: State.noise.toFixed(2), color: "var(--amber)" },
    { label: "Acquisition", val: { ei: "Exp. Improv.", ucb: "UCB", poi: "Prob. Improv.", thompson: "Thompson" }[State.acqKey], color: "var(--green)" },
    { label: "Exploration", val: State.explore.toFixed(2), color: "var(--rose)" },
    { label: "Samples", val: State.gp ? State.gp.X.length : 0, color: "var(--blue)" },
    { label: "Log ML", val: State.gp && State.gp.logML !== null ? State.gp.logML.toFixed(2) : "—", color: "var(--text-dim)" },
    { label: "Regret", val: State.regret.length > 0 ? State.regret[State.regret.length - 1].toFixed(4) : "—", color: "var(--rose)" },
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
  if (DOM.statIter) DOM.statIter.textContent = State.iteration;
  if (DOM.statBestY) DOM.statBestY.textContent = State.bestY > -Infinity ? State.bestY.toFixed(4) : "—";
  if (DOM.statBestX) DOM.statBestX.textContent = State.bestX !== null ? State.bestX.toFixed(4) : "—";
  if (DOM.statNextX) DOM.statNextX.textContent = State.nextX !== null ? State.nextX.toFixed(4) : "—";
  if (DOM.statKernel) DOM.statKernel.textContent = { rbf: "RBF", matern32: "Matérn 3/2", matern52: "Matérn 5/2", periodic: "Periodic" }[State.kernelKey];
  if (DOM.statRegret) DOM.statRegret.textContent = State.regret.length > 0 ? State.regret[State.regret.length - 1].toFixed(4) : "—";
  if (DOM.statLogML) DOM.statLogML.textContent = State.gp && State.gp.logML !== null ? State.gp.logML.toFixed(1) : "—";

  if (State.gp.X.length > 0 && State.nextX !== null && DOM.statAcqMax) {
    const p = State.gp.predict(State.nextX);
    const a = Acquisition[State.acqKey](p.mean, p.variance, State.bestY, State.explore);
    DOM.statAcqMax.textContent = a.toFixed(4);
  } else if (DOM.statAcqMax) {
    DOM.statAcqMax.textContent = "—";
  }

  // Update undo button state
  if (DOM.btnUndo) {
    DOM.btnUndo.disabled = State.historyIdx <= 0;
  }

  updateConceptGrid();
}

/* -------------------------------------------------------
 *  ANIMATION LOOP
 * ------------------------------------------------------- */
let rafId = null;
function animate(ts) {
  if (State.animProgress < 1) {
    State.animProgress = Math.min(1, State.animProgress + 0.035);
  }
  Renderer.draw();
  rafId = requestAnimationFrame(animate);
}

/* -------------------------------------------------------
 *  AUTO-RUN (with speed control)
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
      if (State.iteration >= 100) {
        toggleAutoRun();
        showToast("Reached 100 iterations — auto-run stopped.", "info");
      }
    }, State.autoSpeed);
  }
}

function restartAutoRunTimer() {
  if (!State.autoRunning) return;
  clearInterval(State.autoTimer);
  State.autoTimer = setInterval(() => {
    doStep();
    Renderer.drawConvergence();
    if (State.iteration >= 100) {
      toggleAutoRun();
      showToast("Reached 100 iterations — auto-run stopped.", "info");
    }
  }, State.autoSpeed);
}

/* -------------------------------------------------------
 *  EXPORT FUNCTIONS
 * ------------------------------------------------------- */
function exportCSV() {
  let csv = "step,best_y,regret";
  if (State.compareMode) csv += ",random_best_y";
  csv += "\n";

  for (let i = 0; i < State.convergenceHistory.length; i++) {
    let row = `${i},${State.convergenceHistory[i].toFixed(6)},${(State.regret[i] || 0).toFixed(6)}`;
    if (State.compareMode && i < State.randomBaseline.history.length) {
      row += `,${State.randomBaseline.history[i].toFixed(6)}`;
    }
    csv += row + "\n";
  }

  // Add sample points
  csv += "\n# Sample Points\nindex,x,y\n";
  for (let i = 0; i < State.gp.X.length; i++) {
    csv += `${i},${State.gp.X[i].toFixed(6)},${State.gp.Y[i].toFixed(6)}\n`;
  }

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bayesian_opt_${State.objectiveKey}_${State.iteration}steps.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("CSV exported!", "success");
}

function exportPNG() {
  // Draw to a temp canvas at higher res
  const canvas = DOM.canvas;
  const dataURL = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataURL;
  a.download = `bayesian_opt_${State.objectiveKey}_step${State.iteration}.png`;
  a.click();
  showToast("PNG exported!", "success");
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
  const name = State.objectiveKey === "custom" ? "Custom Function" : Objectives[State.objectiveKey].name;
  showToast("Reset — " + name, "success");
}

/* -------------------------------------------------------
 *  CUSTOM FUNCTION HANDLING
 * ------------------------------------------------------- */
function applyCustomFunction() {
  const expr = DOM.customFnInput.value.trim();
  if (!expr) {
    DOM.customFnError.textContent = "Enter an expression using x (e.g. sin(3*x) + cos(7*x))";
    DOM.customFnError.style.display = "block";
    return;
  }
  const result = CustomObjective.compile(expr);
  if (result.error) {
    DOM.customFnError.textContent = result.error;
    DOM.customFnError.style.display = "block";
    return;
  }
  DOM.customFnError.style.display = "none";
  State.customFn = result.fn;
  State.customExpr = expr;
  State.objectiveKey = "custom";
  DOM.selObj.value = "custom";
  fullReset();
  showToast("Custom function applied!", "success");
}

/* -------------------------------------------------------
 *  KEYBOARD SHORTCUTS MODAL
 * ------------------------------------------------------- */
function toggleShortcutsModal() {
  if (!DOM.shortcutsModal) return;
  State.showShortcuts = !State.showShortcuts;
  DOM.shortcutsModal.classList.toggle("hidden", !State.showShortcuts);
}

/* -------------------------------------------------------
 *  EVENT WIRING
 * ------------------------------------------------------- */
function wireEvents() {
  DOM.btnStep.addEventListener("click", () => { doStep(); Renderer.drawConvergence(); });
  DOM.btnAuto.addEventListener("click", toggleAutoRun);
  DOM.btnReset.addEventListener("click", fullReset);

  if (DOM.btnUndo) DOM.btnUndo.addEventListener("click", undo);
  if (DOM.btnExportCSV) DOM.btnExportCSV.addEventListener("click", exportCSV);
  if (DOM.btnExportPNG) DOM.btnExportPNG.addEventListener("click", exportPNG);

  DOM.selObj.addEventListener("change", e => {
    if (e.target.value !== "custom") {
      State.objectiveKey = e.target.value;
      State.customFn = null;
      fullReset();
    }
  });
  DOM.selKernel.addEventListener("change", e => {
    State.kernelKey = e.target.value;
    State.gp.setKernel(Kernels[State.kernelKey]);
    computeNextPoint(); updateStats();
  });
  DOM.selAcq.addEventListener("change", e => {
    State.acqKey = e.target.value;
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

  // Speed slider
  if (DOM.rngSpeed) {
    DOM.rngSpeed.addEventListener("input", e => {
      State.autoSpeed = parseInt(e.target.value);
      if (DOM.lblSpeed) DOM.lblSpeed.textContent = State.autoSpeed + "ms";
      restartAutoRunTimer();
    });
  }

  // Toggles
  DOM.toggleTruth.addEventListener("change", e => { State.showTruth = e.target.checked; });
  DOM.toggleAcq.addEventListener("change", e => { State.showAcq = e.target.checked; });

  if (DOM.toggleCompare) {
    DOM.toggleCompare.addEventListener("change", e => {
      State.compareMode = e.checked;
      if (State.compareMode) {
        State.randomBaseline.syncTo(State.convergenceHistory.length, getObjectiveFn(), State.noise);
        showToast("Comparison mode ON — orange = random search", "info");
      }
      Renderer.drawConvergence();
    });
  }

  // Custom function
  if (DOM.customFnBtn) DOM.customFnBtn.addEventListener("click", applyCustomFunction);
  if (DOM.customFnInput) {
    DOM.customFnInput.addEventListener("keydown", e => {
      if (e.key === "Enter") applyCustomFunction();
    });
  }

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
  DOM.onboarding.addEventListener("click", e => {
    if (e.target === DOM.onboarding) {
      DOM.onboarding.classList.add("hidden");
      localStorage.setItem("bo-onboarded", "1");
    }
  });

  // Edu reset
  const eduReset = $("btn-edu-reset");
  if (eduReset) {
    eduReset.addEventListener("click", () => {
      if (typeof BayesEdu !== "undefined") BayesEdu.reset(State);
    });
  }

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

  // Shortcuts modal close
  if (DOM.shortcutsModal) {
    DOM.shortcutsModal.addEventListener("click", e => {
      if (e.target === DOM.shortcutsModal) toggleShortcutsModal();
    });
  }

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
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    switch (e.key) {
      case " ": case "s": e.preventDefault(); doStep(); Renderer.drawConvergence(); break;
      case "a": toggleAutoRun(); break;
      case "r": fullReset(); break;
      case "t": DOM.toggleTruth.checked = !DOM.toggleTruth.checked; State.showTruth = DOM.toggleTruth.checked; break;
      case "g": if (DOM.toggleAcq) { DOM.toggleAcq.checked = !DOM.toggleAcq.checked; State.showAcq = DOM.toggleAcq.checked; } break;
      case "z": if (e.ctrlKey || e.metaKey) { e.preventDefault(); undo(); } break;
      case "u": undo(); break;
      case "e": if (DOM.customFnInput) DOM.customFnInput.focus(); break;
      case "c": if (!e.ctrlKey && !e.metaKey && DOM.toggleCompare) { DOM.toggleCompare.checked = !DOM.toggleCompare.checked; DOM.toggleCompare.dispatchEvent(new Event("change")); } break;
      case "?": toggleShortcutsModal(); break;
      case "Escape": if (State.showShortcuts) toggleShortcutsModal(); break;
    }
  });
}

/* -------------------------------------------------------
 *  BOOT
 * ------------------------------------------------------- */
function boot() {
  cacheDom();

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

  if (typeof BayesEdu !== "undefined") BayesEdu.init(State, DOM.eduContent);

  rafId = requestAnimationFrame(animate);

  showToast("Press Space to step, ? for shortcuts", "info");
}

document.addEventListener("DOMContentLoaded", boot);
