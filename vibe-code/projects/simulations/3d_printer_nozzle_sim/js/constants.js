// ──────────────────────── Constants ────────────────────────
// Scale: 1 unit in 3D = 1mm real world. Y-axis is vertical (up).
// The nozzle assembly is centered at origin, tip at y=0, extending upward.

const S = 2.5, PX = S * 10; // legacy pixel scale (used in physics)

// ──────────────────────── Geometry Layout (in mm, mapped to 3D units) ────────────────────────
// All Y values are in simulation-space (positive = downward in original 2D).
// In 3D we flip: 3D_Y = -simY (so nozzle tip is at bottom, extruder at top).
const GEOM = {
  // Extruder / gear region
  gY: 78, gH: 50, gTE: 58, gBo: 105,
  // Heat break
  hT: 111, hB: 193,
  // Melt zone (heater block)
  mT: 193, mB: 298,
  // Nozzle taper + land
  nT: 298, nLS: 342, nB: 358,
  // Filament top
  fTY: -10,
  // Build plate
  bY: 384, bSp: 0.6,
  // Canvas dimensions (legacy, for physics compatibility)
  W: 420, H: 520, cx: 210
};

// Convert sim-Y to 3D-Y (center nozzle tip at y=0)
function simToWorld(simY) {
  return -(simY - GEOM.nB) * 0.04; // scale factor: 0.04 units per sim-pixel
}

// World scale factor
const WS = 0.04;

// ──────────────────────── Noise / Math helpers ────────────────────────
function n1(x) {
  return (Math.sin(x*1.17+.3)*.5 + Math.sin(x*2.74+1.1)*.25 + Math.sin(x*5.83+2.7)*.125 + Math.sin(x*11.2+.8)*.0625) / .9375;
}
function n2(x, y) {
  return (Math.sin(x*1.7+y*2.3+.3)*.5 + Math.sin(x*3.1-y*1.8+1.1)*.25 + Math.sin(x*5.3+y*4.7+2.7)*.125) / .875;
}
function gs(m, s) {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function lC(a, b, t) {
  const ah = parseInt(a.replace("#",""), 16), bh = parseInt(b.replace("#",""), 16);
  return `rgb(${Math.round(((ah>>16)&0xff) + ((((bh>>16)&0xff) - ((ah>>16)&0xff)) * t))},${Math.round(((ah>>8)&0xff) + ((((bh>>8)&0xff) - ((ah>>8)&0xff)) * t))},${Math.round((ah&0xff) + (((bh&0xff) - (ah&0xff)) * t))})`;
}
function lCa(a, b, t) {
  const ah = parseInt(a.replace("#",""), 16), bh = parseInt(b.replace("#",""), 16);
  return [
    Math.round(((ah>>16)&0xff) + ((((bh>>16)&0xff) - ((ah>>16)&0xff)) * t)),
    Math.round(((ah>>8)&0xff) + ((((bh>>8)&0xff) - ((ah>>8)&0xff)) * t)),
    Math.round((ah&0xff) + (((bh&0xff) - (ah&0xff)) * t))
  ];
}
function hexToRgbNorm(hex) {
  const h = parseInt(hex.replace("#",""), 16);
  return [(h>>16&0xff)/255, (h>>8&0xff)/255, (h&0xff)/255];
}
function lerpColor3(a, b, t) {
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) { const t = clamp((x-e0)/(e1-e0), 0, 1); return t*t*(3-2*t); }

// ──────────────────────── Materials ────────────────────────
const MAT = {
  PLA: { l:"PLA Wood", mt:180, pt:200, fl:1, cr:1, hc:1, col:"#C8A878", colDark:"#8E6B3E", colMelt:"#D4944A", st:.6,
    mst:1.2, ds:1.15, wr:1.3, sp:1.8, tc:.13, vh:.04,
    d:"Low temp, higher viscosity. Prone to moisture absorption. High wood wear on brass nozzles." },
  ABS: { l:"ABS Wood", mt:220, pt:240, fl:1.25, cr:1.4, hc:1.3, col:"#D4C8A0", colDark:"#9A8E66", colMelt:"#DCA85A", st:.55,
    mst:.6, ds:1.25, wr:1.1, sp:2.0, tc:.17, vh:.06,
    d:"Higher temp, lower viscosity. Less moisture-sensitive. Faster carbonization. More die swell." },
  PETG: { l:"PETG Wood", mt:220, pt:235, fl:1.15, cr:1.1, hc:1.15, col:"#B8C0A8", colDark:"#7E866E", colMelt:"#C4A870", st:.58,
    mst:.8, ds:1.20, wr:1.0, sp:1.3, tc:.15, vh:.05,
    d:"Medium viscosity, good layer adhesion. Moderate carbonization. Stringing-prone." }
};

// ──────────────────────── Default Parameters ────────────────────────
const DEFAULT_PARAMS = {
  nd: .4, pm: .08, ps: .03, mp: .15, fn: 1.75, fv: .03, ff: .008, fr: 3, wt: .85, cc: .02,
  mat: "PLA", pt: 200, pd: 3,
  ret: 1.0, retSpd: 25, moist: 0.02, amb: 25, fan: 0, drive: "direct"
};

// ──────────────────────── Know-How content ────────────────────────
const KNOW_HOW = [
  { t:"Wood Fill Ratio", d:"Commercial wood filament is typically 10-30% wood fiber by weight in a polymer matrix. More fill = more clog risk but better wood appearance." },
  { t:"Poiseuille Flow", d:"Molten plastic flows fastest at center, near-zero at walls. Edge particles crawl — increasing bridge chance." },
  { t:"Nozzle Land", d:"Short straight section at tip (~0.5mm). Bridging happens here, not in the taper." },
  { t:"Shear Thinning", d:"Higher shear rate → lower viscosity. Faster printing can actually reduce clogging risk." },
  { t:"Temperature", d:"Higher = lower viscosity but faster carbonization → more fouling. Find the sweet spot." },
  { t:"Clog Cascade", d:"Each stuck particle narrows the opening → positive feedback loop. The bed keeps moving regardless, causing gaps." },
  { t:"Carbonization", d:"Wood chars from cumulative time at temperature. Stuck particles foul fastest." },
  { t:"Filament Spring", d:"Solid filament stores elastic energy. High compression can pop clogs free — or buckle the filament." },
  { t:"Die Swell", d:"Extrudate expands 15-25% after exiting the nozzle due to elastic recovery." },
  { t:"Moisture & Steam", d:"Wood fibers absorb moisture. In the melt zone, water flashes to steam creating bubbles and inconsistent extrusion." },
  { t:"Nozzle Wear", d:"Wood fibers are abrasive. Brass nozzles erode over time, widening the bore." },
  { t:"Bowden vs Direct", d:"Bowden tubes add compliance and delay. More pressure loss, more buckling risk." },
  { t:"Retraction", d:"Pulling filament back prevents oozing. Too little → strings. Too much → air or re-clogging." },
];
