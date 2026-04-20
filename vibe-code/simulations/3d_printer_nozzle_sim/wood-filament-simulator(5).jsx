import { useState, useEffect, useRef, useCallback, memo } from "react";

// ──────────────────────── Constants ────────────────────────
const S = 2.5, PX = S * 10;

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

// ──────────────────────── UI Components ────────────────────────
const Inf = memo(({ text }) => {
  const [s, sS] = useState(false);
  return (
    <span style={{ position:"relative", display:"inline-flex", marginLeft:4, cursor:"help" }}
      onMouseEnter={() => sS(true)} onMouseLeave={() => sS(false)} onTouchStart={() => sS(v => !v)}>
      <svg width="13" height="13" viewBox="0 0 16 16" style={{ opacity:.35 }}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="#888" strokeWidth="1.5"/>
        <text x="8" y="12" textAnchor="middle" fontSize="10" fill="#888" fontWeight="600">i</text>
      </svg>
      {s && <div style={{ position:"absolute", bottom:18, left:"50%", transform:"translateX(-50%)",
        background:"#2A2520", color:"#DDD", fontSize:10.5, lineHeight:1.45, padding:"8px 10px",
        borderRadius:6, width:210, zIndex:100, boxShadow:"0 4px 16px rgba(0,0,0,.25)", pointerEvents:"none" }}>
        {text}
        <div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)",
          borderLeft:"6px solid transparent", borderRight:"6px solid transparent", borderTop:"6px solid #2A2520" }}/>
      </div>}
    </span>
  );
});

const Sl = memo(({ label, value, min, max, step, unit, accent, onValue, info }) => {
  const [l, sL] = useState(value);
  const dr = useRef(false);
  useEffect(() => { if (!dr.current) sL(value); }, [value]);
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:1 }}>
        <span style={{ color:"#666", fontSize:10.5, display:"flex", alignItems:"center" }}>
          {label}{info && <Inf text={info}/>}
        </span>
        <span style={{ color:accent||"#666", fontSize:11.5, fontWeight:600, fontVariantNumeric:"tabular-nums" }}>
          {l.toFixed(step < .01 ? 3 : step < 1 ? 2 : 0)}
          {unit && <span style={{ color:"#BBB", fontWeight:400, fontSize:9, marginLeft:2 }}>{unit}</span>}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={l}
        onPointerDown={() => { dr.current = true; }}
        onPointerUp={() => { dr.current = false; }}
        onLostPointerCapture={() => { dr.current = false; }}
        onChange={e => { const v = parseFloat(e.target.value); sL(v); onValue(v); }}
        style={{ width:"100%", accentColor:accent||"#666", height:2, cursor:"pointer" }}/>
    </div>
  );
});

const Dt = memo(({ on, warn, label }) => (
  <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#666", marginBottom:2 }}>
    <div style={{ width:5, height:5, borderRadius:"50%",
      background: on ? (warn ? "#D44" : "#E80") : "#5A8F5A",
      boxShadow: on ? `0 0 3px ${warn ? "#D44" : "#E80"}` : "none" }}/>
    {label}
  </div>
));

const MC = memo(({ data, color, label, h: mH }) => {
  if (!data || data.length < 2) return null;
  const h = mH || 32, w = 240;
  const mx = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h - ((v/mx)*h*.85) - 1}`).join(" ");
  return (
    <div style={{ marginBottom:3 }}>
      <div style={{ fontSize:8.5, color:"#AAA", marginBottom:1 }}>
        {label}<span style={{ color, fontWeight:600, marginLeft:4 }}>{data[data.length-1]}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display:"block", height:h }}>
        <polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity=".1"/>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    </div>
  );
});

const PGauge = memo(({ pressure, max }) => {
  const pct = clamp(pressure / max, 0, 1);
  const angle = -135 + pct * 270;
  const r = 22;
  const cx = 28, cy = 28;
  const nx = cx + Math.cos(angle * Math.PI / 180) * (r - 4);
  const ny = cy + Math.sin(angle * Math.PI / 180) * (r - 4);
  const col = pct > .7 ? "#D44" : pct > .4 ? "#E80" : "#5A8F5A";
  return (
    <svg width={56} height={42} style={{ display:"block", margin:"0 auto" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E0DDD8" strokeWidth="3"/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth="3"
        strokeDasharray={`${pct * 170} 170`} strokeDashoffset="-15"
        strokeLinecap="round" transform={`rotate(-135 ${cx} ${cy})`}/>
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={col} strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="2.5" fill="#444"/>
      <text x={cx} y={cy+14} textAnchor="middle" fontSize="7" fill="#999" fontWeight="600">
        {pressure.toFixed(2)} bar
      </text>
    </svg>
  );
});


// ══════════════════════════════════════════════════════════════
//                     MAIN SIMULATOR
// ══════════════════════════════════════════════════════════════
export default function Sim() {
  const cR = useRef(null), aR = useRef(null), tR = useRef(0);
  const pR = useRef([]);
  const bpR = useRef([]);
  const boR = useRef(0);
  const saR = useRef(0);
  const sR = useRef({ p:0, c:0, j:0, b:0, g:0 });
  const clR = useRef({ a:false, ps:[], sv:0, pr:0, cn:0 });
  const gR = useRef({ sp:1, st:false, gd:0, stT:0 });
  const fR = useRef(0);
  const hcR = useRef(0);
  const fdR = useRef(1.75);
  const spR = useRef({ c:0, e:0 });
  const csvR = useRef([]);
  const cdR = useRef({ p:[], c:[], r:[], f:[] });
  const prePopRef = useRef(false);

  const vapR = useRef([]);
  const bubR = useRef([]);
  const nzWR = useRef(0);
  const retR = useRef({ active:false, t:0, dist:0 });
  const ambR = useRef(25);
  const moistR = useRef(0);
  const vhR = useRef(0);
  const dsR = useRef(1);
  const ueR = useRef(0);
  const fanR = useRef(0);
  const buckR = useRef(0);
  const oozR = useRef(0);
  const strR = useRef([]);
  const driveR = useRef("direct");
  const tZoneR = useRef([]);
  // Extrudate bead tracking
  const beadR = useRef([]);
  // Drip/ooze blobs
  const dripR = useRef([]);

  const PR = useRef({
    nd:.4, pm:.08, ps:.03, mp:.15, fn:1.75, fv:.03, ff:.008, fr:3, wt:.85, cc:.02,
    mat:"PLA", pt:200, pd:3,
    ret:1.0, retSpd:25, moist:0.02, amb:25, fan:0, drive:"direct"
  });

  const [pa, sPa] = useState({ ...PR.current });
  const [run, sRun] = useState(true);
  const rnR = useRef(true);
  const [st, sSt] = useState({ p:0, c:0, j:0, b:0, g:0 });
  const [lG, sLG] = useState({ sp:1, st:false, gd:0 });
  const [lP, sLP] = useState(0);
  const [lF, sLF] = useState(0);
  const [lH, sLH] = useState(0);
  const [lD, sLD] = useState(1.75);
  const [cd, sCD] = useState({ p:[], c:[], r:[], f:[] });
  const [kh, sKH] = useState(false);
  const [lW, sLW] = useState(0);
  const [lDS, sLDS] = useState(1);
  const [lUE, sLUE] = useState(0);
  const [lBk, sLBk] = useState(0);
  const [lMo, sLMo] = useState(0);
  const [lVH, sLVH] = useState(0);
  const [retAct, sRetAct] = useState(false);

  const clr = useCallback(() => {
    pR.current = []; bpR.current = []; boR.current = 0;
    clR.current = { a:false, ps:[], sv:0, pr:0, cn:0 };
    spR.current = { c:0, e:0 }; prePopRef.current = false;
    vapR.current = []; bubR.current = []; strR.current = [];
    nzWR.current = 0; vhR.current = 0; buckR.current = 0; oozR.current = 0;
    beadR.current = []; dripR.current = [];
  }, []);

  const mH = useCallback(k => v => { PR.current[k] = v; sPa(p => ({ ...p, [k]:v })); clr(); }, [clr]);
  const mL = useCallback(k => v => { PR.current[k] = v; sPa(p => ({ ...p, [k]:v })); }, []);
  const hs = useRef({});
  const h = k => { if (!hs.current[k]) hs.current[k] = mH(k); return hs.current[k]; };
  const hL = k => { if (!hs.current["l"+k]) hs.current["l"+k] = mL(k); return hs.current["l"+k]; };

  const sM = useCallback(k => {
    const m = MAT[k]; PR.current.mat = k; PR.current.pt = m.pt;
    sPa(p => ({ ...p, mat:k, pt:m.pt })); clr();
  }, [clr]);

  const rst = useCallback(() => {
    pR.current = []; bpR.current = []; boR.current = 0;
    sR.current = { p:0, c:0, j:0, b:0, g:0 };
    clR.current = { a:false, ps:[], sv:0, pr:0, cn:0 };
    gR.current = { sp:1, st:false, gd:0, stT:0 };
    fR.current = 0; hcR.current = 0; tR.current = 0;
    spR.current = { c:0, e:0 }; saR.current = 0;
    csvR.current = []; cdR.current = { p:[], c:[], r:[], f:[] };
    prePopRef.current = false;
    vapR.current = []; bubR.current = []; nzWR.current = 0;
    retR.current = { active:false, t:0, dist:0 };
    moistR.current = 0; vhR.current = 0; dsR.current = 1;
    ueR.current = 0; buckR.current = 0; oozR.current = 0;
    strR.current = []; beadR.current = []; dripR.current = [];
    sSt({ p:0, c:0, j:0, b:0, g:0 }); sLG({ sp:1, st:false, gd:0 });
    sLP(0); sLF(0); sLH(0); sLD(1.75);
    sCD({ p:[], c:[], r:[], f:[] });
    sLW(0); sLDS(1); sLUE(0); sLBk(0); sLMo(0); sLVH(0);
  }, []);

  const doRetract = useCallback(() => {
    if (retR.current.active) return;
    retR.current = { active:true, t:0, dist:PR.current.ret };
    sRetAct(true);
  }, []);

  const dlCSV = useCallback(() => {
    const s = sR.current;
    const rows = [
      ["metric","value"],["passed",s.p],["clogged",s.c],["bridged",s.b],["jams",s.j],["grinds",s.g],
      ["clog_pct",(s.p+s.c>0?((s.c/(s.p+s.c))*100).toFixed(2):"0")],
      ["fouling",fR.current.toFixed(5)],["nozzle_wear_mm",nzWR.current.toFixed(4)],
      [],["t","passed","clogged","bridged","jams","fouling","wear"],
      ...csvR.current.map(r => [r.t,r.p,r.c,r.b,r.j,r.f.toFixed(5),r.w?.toFixed(5)||0])
    ];
    const b = new Blob([rows.map(r => r.join(",")).join("\n")], { type:"text/csv" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = "clog_report.csv"; a.click();
    URL.revokeObjectURL(u);
  }, []);

  useEffect(() => { rnR.current = run; }, [run]);

  // ══════════════════════════════════════════════════════════
  //                   CANVAS SIMULATION
  // ══════════════════════════════════════════════════════════
  useEffect(() => {
    const cv = cR.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = 420, H = 520, cx = W / 2;

    // Redistributed: hotend gets ~65% of canvas, build plate ~22%
    const gY = 78, gH = 50, gTE = gY - 20, gBo = gY + gH/2 + 2;
    const hT = gBo + 6, hB = hT + 82;
    const mT = hB, mB = mT + 105;
    const nT = mB, nLS = nT + 44, nB = nLS + 16;
    const fTY = -10;
    const bY = nB + 26, bSp = .6;

    const bW = () => 1.75 * PX;
    const p = () => PR.current;
    const mt = () => MAT[p().mat];

    // ── Offscreen textures ──
    const mkTexture = (w, h, drawFn) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      drawFn(c.getContext("2d"), w, h);
      return c;
    };

    // Paper grain - finer, more realistic
    const texGrain = mkTexture(W, H, (tc, tw, th) => {
      const id = tc.createImageData(tw, th);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = 242 + (Math.random() - .5) * 6;
        id.data[i] = v; id.data[i+1] = v - 1; id.data[i+2] = v - 2; id.data[i+3] = 14;
      }
      tc.putImageData(id, 0, 0);
    });

    // Workshop dust
    const texDust = mkTexture(W * 2, H, (tc, tw, th) => {
      tc.fillStyle = "rgba(180,160,130,.02)";
      for (let i = 0; i < 80; i++) {
        const x = Math.random() * tw, y = Math.random() * th;
        const r = .3 + Math.random() * 1.5;
        tc.beginPath(); tc.arc(x, y, r, 0, Math.PI * 2); tc.fill();
      }
    });

    // Workbench scratches
    const texScr = mkTexture(W * 2, H, (tc, tw, th) => {
      tc.strokeStyle = "rgba(0,0,0,.01)"; tc.lineWidth = .3;
      for (let i = 0; i < 20; i++) {
        const x = Math.random() * tw, y = Math.random() * th;
        const len = 10 + Math.random() * 40, ang = (Math.random() - .5) * .3;
        tc.beginPath(); tc.moveTo(x, y);
        tc.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
        tc.stroke();
      }
    });

    // Metal brushed texture for nozzle
    const texMetal = mkTexture(80, 80, (tc, tw, th) => {
      for (let y = 0; y < th; y++) {
        const brightness = 180 + Math.random() * 30 + Math.sin(y * .8) * 8;
        tc.strokeStyle = `rgba(${brightness},${brightness * .88},${brightness * .6},.15)`;
        tc.lineWidth = .5;
        tc.beginPath(); tc.moveTo(0, y); tc.lineTo(tw, y); tc.stroke();
      }
    });

    // Wood grain pattern for filament
    const texWoodGrain = mkTexture(40, 400, (tc, tw, th) => {
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const grain = Math.sin(y * .15 + Math.sin(x * .3 + y * .02) * 3) * .5 + .5;
          const fiber = Math.sin(y * 2.3 + x * .8 + Math.sin(y * .07) * 5) * .12;
          const v = grain * .15 + fiber;
          const r = 160 + v * 80, g = 120 + v * 60, b = 60 + v * 40;
          tc.fillStyle = `rgba(${r|0},${g|0},${b|0},.08)`;
          tc.fillRect(x, y, 1, 1);
        }
      }
    });

    // Build plate texture - PEI sheet look
    const texBuildPlate = mkTexture(W, 100, (tc, tw, th) => {
      // Base PEI amber-yellow tint
      tc.fillStyle = "rgba(200,180,120,.04)";
      tc.fillRect(0, 0, tw, th);
      // Fine grid texture
      tc.strokeStyle = "rgba(0,0,0,.02)"; tc.lineWidth = .3;
      for (let x = 0; x < tw; x += 6) {
        tc.beginPath(); tc.moveTo(x, 0); tc.lineTo(x, th); tc.stroke();
      }
      for (let y = 0; y < th; y += 6) {
        tc.beginPath(); tc.moveTo(0, y); tc.lineTo(tw, y); tc.stroke();
      }
      // Random micro scratches from previous prints
      tc.strokeStyle = "rgba(180,160,120,.04)"; tc.lineWidth = .5;
      for (let i = 0; i < 40; i++) {
        const x1 = Math.random() * tw, y1 = Math.random() * th;
        tc.beginPath(); tc.moveTo(x1, y1);
        tc.lineTo(x1 + (Math.random() - .5) * 30, y1 + (Math.random() - .5) * 8);
        tc.stroke();
      }
    });

    const nW_ = () => (p().nd + nzWR.current) * PX;
    const eM = () => Math.max(.01, (p().nd + nzWR.current) * p().wt - fR.current - clR.current.cn);
    const fD = (t) => p().fn + n1(t * p().ff) * p().fv;
    const gMTY = () => mT + (mB - mT) * .1 - hcR.current * 30;

    const nW = (y) => {
      const bw = bW(), nw = nW_();
      if (y < nT) return { l: cx - bw/2, r: cx + bw/2 };
      if (y >= nLS) return { l: cx - nw/2, r: cx + nw/2 };
      const t = Math.min(1, (y - nT) / (nLS - nT));
      const w = bw + (nw - bw) * Math.pow(t, .55);
      return { l: cx - w/2, r: cx + w/2 };
    };

    const fHW = (y, t) => {
      const d = fD(t) * PX, hw = d/2;
      if (y < gTE) return hw;
      if (y < hT) { const bl = (y - gTE) / (hT - gTE); return hw*(1-bl) + Math.min(hw, bW()/2)*bl; }
      return Math.min(hw, bW()/2);
    };

    const pp_ = (rf) => { const r = Math.min(1, Math.abs(rf)); return .2 + .8*(1 - r*r); };
    const fA = (y) => { const w = nW(y); const lw = w.r - w.l; return lw > 0 ? Math.min(3, bW()/lw) : 1; };
    const stV = (bv, sr, md) => bv * Math.min(1, Math.max(.4, Math.pow(Math.max(.1, sr), md.st - 1)));
    
    const gD = (pt, m, pp) => {
      const mTY = gMTY();
      const d = pt.y - mTY;
      const mr = Math.min(1, Math.max(0, d / 30));
      const tf = 1 + Math.max(0, pp.pt - m.mt) * .015 + vhR.current * .5;
      const fl = m.fl * tf;
      const inN = pt.y > nT;
      const np = inN ? Math.min(1, (pt.y - nT) / (nB - nT)) : 0;
      const bd = inN ? (.985 - np * .025) : .99;
      const md = 1 - (1 - bd) / fl;
      const fd = 1 - (1 - md) * mr;
      const w = nW(pt.y);
      const lw = w.r - w.l;
      const rf = Math.abs((pt.x - cx) / (lw/2 + .01));
      const wd = rf > .85 ? 1 - (1 - fd) * (1 + (rf - .85)*2) : fd;
      const dtw = Math.max(1, (lw/2) - Math.abs(pt.x - cx));
      const sr = Math.abs(pt.vy) / (dtw/PX + .01) * 10;
      const moistFactor = 1 + moistR.current * .15;
      return Math.min(.999, Math.max(.7, 1 - (1 - wd) * stV(1, sr, m) * moistFactor));
    };

    // ── Spawn particle ──
    const spawnAt = (yPos) => {
      const pp = p();
      let cr = gs(pp.pm, pp.ps);
      cr = Math.max(.01, Math.min(pp.mp, cr));
      const off = (Math.random() - .5);
      // More varied wood fiber shapes
      const fiberShape = [];
      const numVerts = 5 + Math.floor(Math.random() * 5);
      const elongation = .6 + Math.random() * .8; // wood fibers are often elongated
      const fiberAngle = Math.random() * Math.PI;
      for (let i = 0; i < numVerts; i++) {
        const a = (i / numVerts) * Math.PI * 2;
        const rx = .6 + Math.sin(a * 2.3 + Math.random()) * .2 + Math.random() * .15;
        const ry = rx * elongation;
        fiberShape.push({ a, rx, ry });
      }
      pR.current.push({
        x:0, y:yPos, radius:cr*PX, vx:0, vy:0,
        tp: Math.random() < .25 ? "w" : "p",
        sk:false, br:false, pa:false, fr:true, ex:false, ec:false,
        mp:0, op:1, sd: Math.random()*100,
        fo: off, mrp: off,
        cl: Math.random() > .3
          ? lC("#6E4E14", "#B08530", Math.random())
          : lC("#B08E6E", "#D0B898", Math.random()),
        clDark: lC("#4A3008", "#7A5A20", Math.random()),
        ro:0, av:0, dt:0, cb:0,
        moist: Math.random() < pp.moist * 15,
        swollen: false,
        fiberShape, fiberAngle,
        stretch: 1, // velocity-dependent stretching
        prevVy: 0
      });
    };

    const spawnTop = () => {
      const pp = p();
      const isC = Math.random() < pp.cc;
      const n = isC ? Math.floor(2 + Math.random()*3) : 1;
      for (let i = 0; i < n; i++) spawnAt(fTY + gs(pp.pm, pp.ps)*PX + Math.random()*6);
    };

    const prePopulate = () => {
      const pp = p();
      const mTY = gMTY();
      const solidLength = mTY - fTY;
      const count = Math.floor((solidLength / 3) * pp.pd * 0.5);
      for (let i = 0; i < count; i++) {
        const y = fTY + Math.random() * solidLength;
        spawnAt(y);
      }
    };

    const spawnVapor = (x, y, type) => {
      vapR.current.push({
        x, y, vx: (Math.random()-.5) * .3, vy: -(Math.random()*.4 + .2),
        life: 1, decay: .006 + Math.random()*.005,
        r: type === "steam" ? 2.5 + Math.random()*3 : 2 + Math.random()*3,
        type, grow: 1 + Math.random() * .025,
        turbulence: Math.random() * Math.PI * 2
      });
    };

    const spawnBubble = (x, y) => {
      bubR.current.push({
        x, y, r: .8 + Math.random() * 2.5, vy: -(Math.random()*.8 + .3),
        vx: (Math.random()-.5) * .4, life:1, wobble: Math.random() * Math.PI * 2,
        highlight: .3 + Math.random() * .4
      });
    };

    const spawnString = (x, y) => {
      strR.current.push({
        x, y, len: 3 + Math.random()*8, life:1, sway: Math.random()*Math.PI*2,
        thickness: .2 + Math.random() * .4
      });
    };

    // ── Draw gear with realistic metal look ──
    const dG = (gx, gy, rot, col, bdr, pressure) => {
      const R = 16, iR = 10;
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(rot);
      
      // Gear body with metallic gradient
      const gg = ctx.createRadialGradient(1, -1, 0, 0, 0, R);
      gg.addColorStop(0, lC(col, "#FFF", .2));
      gg.addColorStop(.6, col);
      gg.addColorStop(1, lC(col, "#000", .15));
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI*2);
      ctx.fillStyle = gg; ctx.fill();
      ctx.strokeStyle = bdr; ctx.lineWidth = 1; ctx.stroke();
      
      // Teeth with beveled look
      for (let i = 0; i < 20; i++) {
        const a = (i/20) * Math.PI * 2;
        const cosA = Math.cos(a), sinA = Math.sin(a);
        ctx.strokeStyle = lC(bdr, "#FFF", .1); ctx.lineWidth = .6;
        ctx.beginPath();
        ctx.moveTo(cosA*iR, sinA*iR);
        ctx.lineTo(cosA*(R+.5), sinA*(R+.5));
        ctx.stroke();
        // Shadow side of tooth
        ctx.strokeStyle = lC(bdr, "#000", .15); ctx.lineWidth = .3;
        const a2 = a + .08;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a2)*iR, Math.sin(a2)*iR);
        ctx.lineTo(Math.cos(a2)*R, Math.sin(a2)*R);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, iR, 0, Math.PI*2);
      ctx.strokeStyle = bdr; ctx.lineWidth = .5; ctx.stroke();
      
      // Axle with depth
      const ag = ctx.createRadialGradient(.5, -.5, 0, 0, 0, 4);
      ag.addColorStop(0, "#666"); ag.addColorStop(1, "#333");
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI*2);
      ctx.fillStyle = ag; ctx.fill();
      
      // Pressure glow
      if (pressure > .3) {
        ctx.beginPath(); ctx.arc(0, 0, R+4, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(220,60,40,${(pressure-.3)*.3})`;
        ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
    };

    // ── Draw solid filament with wood grain ──
    const dSF = () => {
      const pp = p(), seg = 80, sY = fTY, mTY = gMTY(), eY = mTY;
      const nHW = pp.fn * PX / 2;
      const lp = [], rp = [];
      for (let i = 0; i <= seg; i++) {
        const y = sY + (eY - sY) * (i / seg);
        const t = tR.current - (eY - y) * 2;
        const hw = fHW(y, t);
        lp.push({ x: cx - hw, y }); rp.push({ x: cx + hw, y });
      }
      
      // Main filament body
      ctx.save();
      ctx.beginPath();
      lp.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      for (let i = rp.length - 1; i >= 0; i--) ctx.lineTo(rp[i].x, rp[i].y);
      ctx.closePath();
      ctx.clip();
      
      // Base color
      ctx.fillStyle = mt().col;
      ctx.fillRect(cx - nHW - 5, sY, nHW * 2 + 10, eY - sY + 5);
      
      // Wood grain overlay - scrolls with filament motion
      const grainOffset = (tR.current * .35 * gR.current.sp) % 400;
      ctx.globalAlpha = .6;
      ctx.drawImage(texWoodGrain, cx - 20, sY - grainOffset, 40, 400);
      ctx.drawImage(texWoodGrain, cx - 20, sY - grainOffset + 400, 40, 400);
      ctx.globalAlpha = 1;
      
      // Cylindrical shading - gives 3D roundness
      const cylGrad = ctx.createLinearGradient(cx - nHW, 0, cx + nHW, 0);
      cylGrad.addColorStop(0, "rgba(0,0,0,.12)");
      cylGrad.addColorStop(.15, "rgba(0,0,0,.03)");
      cylGrad.addColorStop(.35, "rgba(255,255,255,.08)");
      cylGrad.addColorStop(.5, "rgba(255,255,255,.04)");
      cylGrad.addColorStop(.85, "rgba(0,0,0,.03)");
      cylGrad.addColorStop(1, "rgba(0,0,0,.12)");
      ctx.fillStyle = cylGrad;
      ctx.fillRect(cx - nHW - 5, sY, nHW * 2 + 10, eY - sY + 5);
      
      // Diameter variation overlay
      for (let i = 0; i < seg; i++) {
        const y = sY + (eY - sY) * (i / seg);
        if (y > gTE + 4) break;
        const t = tR.current - (eY - y) * 2;
        const dv = fD(t) - pp.fn;
        const ny = sY + (eY - sY) * ((i+1) / seg);
        const hw = fHW(y, t), nhw = fHW(ny, tR.current - (eY - ny)*2);
        if (Math.abs(dv) > .005) {
          ctx.fillStyle = dv > 0
            ? `rgba(200,60,40,${Math.min(1, dv/.06)*.2})`
            : `rgba(40,100,180,${Math.min(1, -dv/.06)*.15})`;
          ctx.beginPath();
          ctx.moveTo(cx - hw, y); ctx.lineTo(cx + hw, y);
          ctx.lineTo(cx + nhw, ny); ctx.lineTo(cx - nhw, ny);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();

      // Filament edges with subtle shadow
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.08)";
      ctx.shadowBlur = 2;
      ctx.shadowOffsetX = 1;
      ctx.beginPath();
      lp.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.strokeStyle = mt().colDark; ctx.lineWidth = .8; ctx.stroke();
      ctx.shadowOffsetX = -1;
      ctx.beginPath();
      rp.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
      ctx.restore();

      // Nominal OD guides
      ctx.strokeStyle = "rgba(100,100,100,.12)"; ctx.lineWidth = .5;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(cx - nHW, fTY); ctx.lineTo(cx - nHW, gTE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + nHW, fTY); ctx.lineTo(cx + nHW, gTE); ctx.stroke();
      ctx.setLineDash([]);

      // Gradual melt transition - realistic softening zone
      const meltLen = 28;
      for (let i = 0; i < meltLen; i++) {
        const y = mTY - meltLen + i;
        const t2 = i / meltLen;
        const alpha = smoothstep(0, 1, t2);
        const hw = fHW(y, tR.current);
        // Transition from solid color to melt orange
        const [mr, mg, mb] = lCa(mt().col, mt().colMelt, alpha);
        ctx.fillStyle = `rgba(${mr},${mg},${mb},${alpha * .6})`;
        ctx.fillRect(cx - hw, y, hw * 2, 1.5);
      }

      // Buckling visualization
      if (buckR.current > .1) {
        const bk = buckR.current;
        ctx.save();
        ctx.strokeStyle = `rgba(200,60,40,${bk*.5})`;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        for (let y = fTY; y < gTE - 5; y += 2) {
          const wave = Math.sin(y * .15 + tR.current * .1) * bk * 5;
          if (y === fTY) ctx.moveTo(cx - nHW - 2 + wave, y);
          else ctx.lineTo(cx - nHW - 2 + wave, y);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let y = fTY; y < gTE - 5; y += 2) {
          const wave = Math.sin(y * .15 + tR.current * .1 + 1) * bk * 5;
          if (y === fTY) ctx.moveTo(cx + nHW + 2 + wave, y);
          else ctx.lineTo(cx + nHW + 2 + wave, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      fdR.current = fD(tR.current);
    };

    // ── Draw molten material - fluid-like with flow lines ──
    const dMF = () => {
      const bw = bW(), nw = nW_(), mTY = gMTY();
      
      // Rich molten material gradient
      const mg = ctx.createLinearGradient(0, mTY, 0, nB);
      mg.addColorStop(0, "rgba(210,130,50,.5)");
      mg.addColorStop(.3, "rgba(200,115,42,.4)");
      mg.addColorStop(.6, "rgba(195,105,38,.35)");
      mg.addColorStop(1, "rgba(185,95,32,.25)");
      ctx.fillStyle = mg;
      ctx.fillRect(cx - bw/2 + 1, mTY, bw - 2, nT - mTY);
      
      // Nozzle taper fill
      ctx.beginPath();
      ctx.moveTo(cx - bw/2+1, nT); ctx.lineTo(cx + bw/2-1, nT);
      ctx.lineTo(cx + nw/2-1, nLS); ctx.lineTo(cx + nw/2-1, nB);
      ctx.lineTo(cx - nw/2+1, nB); ctx.lineTo(cx - nw/2+1, nLS);
      ctx.closePath(); ctx.fill();
      
      // Flow lines in melt zone - animated
      ctx.save();
      ctx.globalAlpha = .08;
      const flowT = tR.current * .03 * gR.current.sp;
      for (let i = -3; i <= 3; i++) {
        const xOff = i * (bw / 8);
        // Poiseuille-like: center moves faster
        const speedFactor = 1 - Math.abs(i) / 4;
        const yOff = flowT * speedFactor * 20;
        ctx.strokeStyle = `rgba(255,180,80,${.3 + speedFactor * .4})`;
        ctx.lineWidth = .4 + speedFactor * .3;
        ctx.beginPath();
        for (let y = mTY; y < nT; y += 4) {
          const yy = y;
          const wobble = Math.sin((y + yOff) * .1 + i) * (1 - speedFactor) * 2;
          if (y === mTY) ctx.moveTo(cx + xOff + wobble, yy);
          else ctx.lineTo(cx + xOff + wobble, yy);
        }
        ctx.stroke();
      }
      ctx.restore();

      // Convection-like swirling in melt zone
      ctx.save();
      ctx.globalAlpha = .04;
      for (let i = 0; i < 3; i++) {
        const cy2 = mTY + (nT - mTY) * (.3 + i * .25);
        const phase = tR.current * .015 + i * 2;
        const r2 = 4 + Math.sin(phase) * 2;
        ctx.strokeStyle = "rgba(255,150,60,.3)";
        ctx.lineWidth = .5;
        ctx.beginPath();
        ctx.arc(cx + Math.sin(phase * .7) * 3, cy2, r2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    };

    // ── Draw extrudate stream from nozzle to bed ──
    const dExtrudate = () => {
      const g = gR.current, cl = clR.current;
      const nw = nW_();
      const ds = dsR.current;
      const isFlowing = g.sp > .1 && !cl.a && !retR.current.active;
      const flowAlpha = isFlowing ? Math.min(1, g.sp * .8) : Math.max(0, oozR.current * .5);
      
      if (flowAlpha < .02) return;
      
      // Stream width: nozzle bore at top, swells then narrows as it falls
      const streamTop = nB + 3;
      const streamBot = bY - 1;
      const streamLen = streamBot - streamTop;
      if (streamLen < 5) return;
      
      ctx.save();
      ctx.globalAlpha = flowAlpha;
      
      // Build the stream path with die swell bulge
      const segments = 20;
      const leftPts = [], rightPts = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const y = streamTop + t * streamLen;
        
        // Width profile: starts at nozzle bore, swells, then narrows into bead
        let halfW;
        if (t < .15) {
          // Die swell zone: expand
          halfW = (nw/2) * lerp(1, ds, smoothstep(0, .15, t));
        } else if (t < .4) {
          // Peak swell then narrow
          halfW = (nw/2) * ds * lerp(1, .7, smoothstep(.15, .4, t));
        } else {
          // Narrowing into bead on bed
          halfW = (nw/2) * ds * lerp(.7, .5, smoothstep(.4, 1, t));
        }
        
        // Slight lateral drift toward bed motion direction
        const drift = t * t * -2;
        // Wobble from flow instability
        const wobble = Math.sin(tR.current * .06 + t * 8) * t * .5 * (1 + moistR.current * 3);
        
        leftPts.push({ x: cx + drift + wobble - halfW, y });
        rightPts.push({ x: cx + drift + wobble + halfW, y });
      }
      
      // Draw stream body
      ctx.beginPath();
      leftPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      for (let i = rightPts.length - 1; i >= 0; i--) ctx.lineTo(rightPts[i].x, rightPts[i].y);
      ctx.closePath();
      
      // Gradient from hot orange to cooler material color
      const sg = ctx.createLinearGradient(0, streamTop, 0, streamBot);
      const m = mt();
      sg.addColorStop(0, "rgba(210,130,55,.7)");
      sg.addColorStop(.3, "rgba(200,140,70,.55)");
      sg.addColorStop(.7, lC(m.col, "#D09040", .4));
      sg.addColorStop(1, m.col);
      ctx.fillStyle = sg;
      ctx.fill();
      
      // Cylindrical highlight on stream
      const hlGrad = ctx.createLinearGradient(cx - nw/2, 0, cx + nw/2, 0);
      hlGrad.addColorStop(0, "rgba(0,0,0,.06)");
      hlGrad.addColorStop(.35, "rgba(255,255,255,.1)");
      hlGrad.addColorStop(.5, "rgba(255,255,255,.06)");
      hlGrad.addColorStop(1, "rgba(0,0,0,.06)");
      ctx.fillStyle = hlGrad;
      ctx.fill();
      
      ctx.restore();
    };

    // ── Draw build plate with realistic bead ──
    const dBd = () => {
      const m = mt();
      
      // Build plate body with 3D thickness
      const plateThickness = 12;
      
      // Plate top surface - PEI amber sheet look
      const bpGrad = ctx.createLinearGradient(0, bY, 0, bY + 4);
      bpGrad.addColorStop(0, "#D8D2C6");
      bpGrad.addColorStop(.5, "#E2DDD4");
      bpGrad.addColorStop(1, "#E6E2DA");
      ctx.fillStyle = bpGrad;
      ctx.fillRect(0, bY, W, H - bY);
      
      // PEI texture overlay (scrolls with bed)
      const off = -(boR.current % W);
      ctx.drawImage(texBuildPlate, off, bY);
      ctx.drawImage(texBuildPlate, off + W, bY);
      
      // Plate front edge - shows thickness with 3D bevel
      const edgeY = H - plateThickness;
      const edgeGrad = ctx.createLinearGradient(0, edgeY, 0, H);
      edgeGrad.addColorStop(0, "#B8B2A8");
      edgeGrad.addColorStop(.15, "#C5BFB5");
      edgeGrad.addColorStop(.5, "#A8A298");
      edgeGrad.addColorStop(1, "#908A80");
      ctx.fillStyle = edgeGrad;
      ctx.fillRect(0, edgeY, W, plateThickness);
      // Edge top highlight
      ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = .6;
      ctx.beginPath(); ctx.moveTo(0, edgeY); ctx.lineTo(W, edgeY); ctx.stroke();
      // Edge bottom shadow
      ctx.strokeStyle = "rgba(0,0,0,.08)"; ctx.lineWidth = .4;
      ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
      
      // Surface edge highlight at top of plate
      ctx.strokeStyle = "#C8C2B8"; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(0, bY); ctx.lineTo(W, bY); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = .4;
      ctx.beginPath(); ctx.moveTo(0, bY + 1); ctx.lineTo(W, bY + 1); ctx.stroke();

      // Nozzle shadow on build plate
      const shadowAlpha = .04 + clamp(1 - (bY - nB) / 50, 0, .06);
      const shGrad = ctx.createRadialGradient(cx, bY, 2, cx, bY, 30);
      shGrad.addColorStop(0, `rgba(0,0,0,${shadowAlpha})`);
      shGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shGrad;
      ctx.fillRect(cx - 35, bY, 70, 20);

      // ── Previously deposited bead layers (cross-section at leading edge) ──
      const layerH = 3;
      const numLayers = Math.min(4, Math.floor(bpR.current.length / 20) + 1);
      if (numLayers > 0 && bpR.current.length > 5) {
        // Draw layer cross-sections visible on the plate
        for (let layer = 0; layer < numLayers; layer++) {
          const ly = bY - (layer + 1) * layerH + layerH;
          const layerAlpha = .15 + layer * .05;
          // Each layer is a slightly different shade (older layers cooler)
          const layerColor = lC(m.col, "#A08060", layer * .15);
          ctx.fillStyle = layerColor;
          ctx.globalAlpha = .5 + layer * .1;
          ctx.fillRect(0, ly, W, layerH);
          // Layer line
          ctx.strokeStyle = `rgba(0,0,0,${layerAlpha})`;
          ctx.lineWidth = .3;
          ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Deposited bead - continuous extrudate line (top layer)
      const beads = beadR.current;
      if (beads.length > 1) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.06)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;
        
        for (let i = 1; i < beads.length; i++) {
          const b0 = beads[i-1], b1 = beads[i];
          const sx0 = b0.wx - boR.current + cx;
          const sx1 = b1.wx - boR.current + cx;
          if (sx1 < -5 || sx0 > W + 5) continue;
          
          const w0 = b0.w * .5, w1 = b1.w * .5;
          ctx.beginPath();
          ctx.moveTo(sx0, bY - w0);
          ctx.lineTo(sx1, bY - w1);
          ctx.lineTo(sx1, bY + w1 * .3);
          ctx.lineTo(sx0, bY + w0 * .3);
          ctx.closePath();
          
          const beadColor = b1.cb > .2 
            ? lC(m.col, "#4A2808", b1.cb * .6)
            : m.col;
          ctx.fillStyle = beadColor;
          ctx.fill();
        }
        
        // Bead top highlight (rounded appearance)
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        for (let i = 1; i < beads.length; i++) {
          const b0 = beads[i-1], b1 = beads[i];
          const sx0 = b0.wx - boR.current + cx;
          const sx1 = b1.wx - boR.current + cx;
          if (sx1 < -5 || sx0 > W + 5) continue;
          const w = (b0.w + b1.w) * .25;
          ctx.strokeStyle = `rgba(255,255,255,.12)`;
          ctx.lineWidth = w * .6;
          ctx.beginPath();
          ctx.moveTo(sx0, bY - w * .6);
          ctx.lineTo(sx1, bY - w * .6);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Under-extrusion gaps
      if (ueR.current > .15) {
        ctx.save();
        const gapCount = Math.floor(ueR.current * 6);
        for (let i = 0; i < gapCount; i++) {
          const gx = ((-(boR.current * .8) + i * 47) % W + W) % W;
          ctx.fillStyle = "#E2DDD4";
          ctx.fillRect(gx, bY - 3, 3 + ueR.current * 5, 5);
        }
        ctx.restore();
      }

      // Embedded wood particles visible on bead surface
      for (const d of bpR.current) {
        const sx = d.wx - boR.current + cx;
        if (sx < -15 || sx > W + 15) continue;
        if (d.r < 1.5) continue;
        ctx.save(); ctx.globalAlpha = .5;
        ctx.beginPath(); ctx.arc(sx, bY - d.r * .3, d.r * .6, 0, Math.PI * 2);
        ctx.fillStyle = d.cb > .2 ? lC(d.cl, "#2A1A08", d.cb*.7) : d.cl;
        ctx.fill();
        ctx.beginPath(); ctx.arc(sx - d.r * .15, bY - d.r * .5, d.r * .15, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fill();
        ctx.restore();
      }
      
      // Grid pattern on plate surface for scale reference (scrolling)
      ctx.save();
      ctx.globalAlpha = .025;
      ctx.strokeStyle = "#000"; ctx.lineWidth = .3;
      const gridOff = -(boR.current % 20);
      for (let x = gridOff; x < W + 20; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, bY + 2); ctx.lineTo(x, edgeY); ctx.stroke();
      }
      for (let y = bY + 20; y < edgeY; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.restore();
    };

    // ── Draw vapor/smoke - soft billowing clouds ──
    const dVapor = () => {
      for (const v of vapR.current) {
        ctx.save();
        if (v.type === "steam") {
          const sg = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r);
          sg.addColorStop(0, `rgba(210,225,240,${v.life*.35})`);
          sg.addColorStop(.5, `rgba(220,235,250,${v.life*.2})`);
          sg.addColorStop(1, `rgba(230,240,255,0)`);
          ctx.fillStyle = sg;
          ctx.fillRect(v.x - v.r, v.y - v.r, v.r * 2, v.r * 2);
        } else {
          const sg = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r);
          sg.addColorStop(0, `rgba(70,50,30,${v.life*.3})`);
          sg.addColorStop(.4, `rgba(90,70,50,${v.life*.15})`);
          sg.addColorStop(1, `rgba(120,100,80,0)`);
          ctx.fillStyle = sg;
          ctx.fillRect(v.x - v.r, v.y - v.r, v.r * 2, v.r * 2);
        }
        ctx.restore();
      }
    };

    // ── Draw steam bubbles - translucent with refraction ──
    const dBubbles = () => {
      for (const b of bubR.current) {
        ctx.save();
        const wobX = Math.sin(b.wobble + tR.current * .1) * 1.5;
        const bx = b.x + wobX, by = b.y;
        
        // Bubble body - subtle fill
        ctx.globalAlpha = b.life * .3;
        ctx.fillStyle = "rgba(200,220,240,.15)";
        ctx.beginPath(); ctx.arc(bx, by, b.r, 0, Math.PI*2); ctx.fill();
        
        // Bubble outline
        ctx.globalAlpha = b.life * .5;
        ctx.strokeStyle = "rgba(180,200,220,.5)";
        ctx.lineWidth = .5;
        ctx.beginPath(); ctx.arc(bx, by, b.r, 0, Math.PI*2); ctx.stroke();
        
        // Highlight specular
        ctx.globalAlpha = b.life * .6;
        ctx.fillStyle = "rgba(240,250,255,.4)";
        ctx.beginPath();
        ctx.arc(bx - b.r * .3, by - b.r * .3, b.r * b.highlight, 0, Math.PI*2);
        ctx.fill();
        
        ctx.restore();
      }
    };

    // ── Draw stringing with realistic thin filament ──
    const dStrings = () => {
      for (const s of strR.current) {
        ctx.save();
        ctx.globalAlpha = s.life * .6;
        const sway = Math.sin(s.sway + tR.current * .05) * 2;
        const sway2 = Math.sin(s.sway * 1.3 + tR.current * .03) * 1.5;
        
        // String with thinning
        ctx.strokeStyle = mt().col;
        ctx.lineWidth = s.thickness * s.life;
        ctx.beginPath();
        ctx.moveTo(s.x, nB + 2);
        ctx.bezierCurveTo(
          s.x + sway * .5, nB + s.len * .3,
          s.x + sway2, nB + s.len * .6,
          s.x + sway * .3, nB + s.len
        );
        ctx.stroke();
        
        // Tiny blob at end
        if (s.life > .5) {
          ctx.beginPath();
          ctx.arc(s.x + sway * .3, nB + s.len, s.thickness * s.life * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = mt().col;
          ctx.fill();
        }
        ctx.restore();
      }
    };

    // ── Die swell with smooth bulging profile ──
    const dDieSwell = () => {
      const ds = dsR.current;
      if (ds <= 1.02) return;
      const nw = nW_();
      const swellW = nw * ds;
      const swellH = 8;
      
      ctx.save();
      // Smooth bulge shape
      ctx.beginPath();
      ctx.moveTo(cx - nw/2, nB);
      ctx.bezierCurveTo(
        cx - swellW/2, nB + 2,
        cx - swellW/2, nB + swellH * .6,
        cx - nw * .4, nB + swellH
      );
      ctx.lineTo(cx + nw * .4, nB + swellH);
      ctx.bezierCurveTo(
        cx + swellW/2, nB + swellH * .6,
        cx + swellW/2, nB + 2,
        cx + nw/2, nB
      );
      ctx.closePath();
      
      const swGrad = ctx.createLinearGradient(cx - swellW/2, 0, cx + swellW/2, 0);
      swGrad.addColorStop(0, `rgba(180,120,50,.2)`);
      swGrad.addColorStop(.3, `rgba(200,140,60,.3)`);
      swGrad.addColorStop(.5, `rgba(210,150,70,.35)`);
      swGrad.addColorStop(.7, `rgba(200,140,60,.3)`);
      swGrad.addColorStop(1, `rgba(180,120,50,.2)`);
      ctx.fillStyle = swGrad;
      ctx.fill();
      ctx.restore();
    };

    // ── Heat shimmer - more realistic wavy distortion ──
    const dShimmer = () => {
      const pp = p();
      const intensity = clamp((pp.pt - mt().mt) / 60, 0, 1) * .12;
      if (intensity < .01) return;
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const y = mT - 4 - i * 6;
        const w = 20 + i * 8;
        const phase = tR.current * .04 + i * 1.7;
        ctx.globalAlpha = intensity * (1 - i*.18);
        ctx.strokeStyle = `rgba(255,180,100,${.1 + Math.sin(phase) * .03})`;
        ctx.lineWidth = 1 + (1 - i/5) * .5;
        ctx.beginPath();
        for (let x = -w/2; x <= w/2; x += 2) {
          const yOff = Math.sin(x * .15 + phase) * (1.5 + i * .5) + Math.sin(x * .3 + phase * 1.3) * .5;
          if (x === -w/2) ctx.moveTo(cx + x, y + yOff);
          else ctx.lineTo(cx + x, y + yOff);
        }
        ctx.stroke();
      }
      ctx.restore();
    };

    // ── Thermal gradient glow - realistic heat radiation ──
    const dThermalGradient = () => {
      const pp = p(), m = mt();
      const heatRatio = clamp((pp.pt - m.mt) / 80, 0, 1);
      if (heatRatio < .01) return;
      
      ctx.save();
      // Multi-layered heat glow
      for (let layer = 0; layer < 3; layer++) {
        const r2 = 35 + layer * 14 + heatRatio * 10;
        const glow = ctx.createRadialGradient(cx, (mT+mB)/2, 18, cx, (mT+mB)/2, r2);
        const alpha = heatRatio * (.06 - layer * .015);
        glow.addColorStop(0, `rgba(255,${60 + layer*20},${20 + layer*10},${alpha})`);
        glow.addColorStop(1, "rgba(255,80,30,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(cx - r2, mT - r2/2, r2 * 2, mB - mT + r2);
      }
      ctx.restore();
    };

    // ══════════════════════════════════════════════════════════
    //          MAIN DRAW HARDWARE
    // ══════════════════════════════════════════════════════════
    const dH = () => {
      const pp = p(), bw = bW(), nw = nW_(), em = eM(), ep = em*PX;
      const fl = fR.current, hc = hcR.current, g = gR.current, cl = clR.current;
      const m = mt(), mTY = gMTY();

      ctx.fillStyle = "#F5F2ED"; ctx.fillRect(0, 0, W, H);

      // Parallax backgrounds
      const bo = boR.current;
      ctx.drawImage(texGrain, 0, 0);
      const dustOff = -(bo * .05) % W;
      ctx.drawImage(texDust, dustOff, 0);
      ctx.drawImage(texDust, dustOff + W * 2, 0);
      const scrOff = -(bo * .15) % W;
      ctx.drawImage(texScr, scrOff, 0);
      ctx.drawImage(texScr, scrOff + W * 2, 0);

      // Zone labels
      ctx.save(); ctx.font = "600 8px -apple-system,sans-serif";
      ctx.fillStyle = "#C0B8AD"; ctx.textAlign = "right";
      ctx.fillText("EXTRUDER", cx - 56, gY + 2);
      ctx.fillText("HEAT BREAK", cx - 46, (hT + hB)/2 + 2);
      ctx.fillText("MELT ZONE", cx - 50, (mT + mB)/2 + 2);
      ctx.fillText("NOZZLE", cx - 46, (nT + nLS)/2 + 2);
      ctx.fillStyle = "#B8B0A5";
      ctx.fillText("LAND", cx - 46, nLS + 8);
      ctx.restore();

      // Dimensions
      const fd = fdR.current;
      const fdc = fd > pp.fn + .02 ? "#C44" : fd < pp.fn - .02 ? "#3878AA" : "#999";
      ctx.save(); ctx.font = "500 8px -apple-system,sans-serif"; ctx.textAlign = "left";
      ctx.fillStyle = fdc;
      ctx.fillText("\u2300" + fd.toFixed(3), cx + fd*PX/2+4, gTE - 3);
      ctx.fillStyle = "#999";
      ctx.fillText("\u2300" + (pp.nd + nzWR.current).toFixed(3), cx + nw/2+7, nB - 2);
      ctx.fillStyle = "#C44";
      ctx.fillText("eff" + em.toFixed(3), cx + nw/2+7, nB + 7);
      if (nzWR.current > .001) {
        ctx.fillStyle = "#D08020";
        ctx.fillText("wear+" + nzWR.current.toFixed(3), cx + nw/2+7, nB + 15);
      }
      ctx.restore();

      // Thermal glow
      dThermalGradient();

      // Extruder housing with subtle 3D
      const hBg = g.st ? "#F0E0E0" : "#E8E4DD";
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.06)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
      ctx.fillStyle = hBg; ctx.strokeStyle = g.st ? "#D5A0A0" : "#C5C0B8"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(cx - 48, gTE, 96, gH+2, 4); ctx.fill(); ctx.stroke();
      ctx.restore();
      
      // Housing top highlight
      ctx.fillStyle = "rgba(255,255,255,.15)";
      ctx.beginPath(); ctx.roundRect(cx - 47, gTE + 1, 94, 2, 1); ctx.fill();

      // Drive type label
      ctx.save(); ctx.font = "500 6px -apple-system,sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "#AAA";
      ctx.fillText(driveR.current === "bowden" ? "BOWDEN" : "DIRECT", cx, gTE - 3);
      ctx.restore();

      // Solid filament
      dSF();

      // Heat creep marker
      if (hc > .1) {
        ctx.save();
        ctx.strokeStyle = `rgba(220,80,40,${hc*.4})`; ctx.lineWidth = .8;
        ctx.setLineDash([2,2]);
        ctx.beginPath(); ctx.moveTo(cx - bw/2-3, mTY); ctx.lineTo(cx + bw/2+3, mTY);
        ctx.stroke(); ctx.setLineDash([]);
        // Arrow showing creep direction
        if (hc > .3) {
          ctx.fillStyle = `rgba(220,80,40,${(hc-.3)*.6})`;
          ctx.beginPath();
          ctx.moveTo(cx + bw/2 + 6, mTY);
          ctx.lineTo(cx + bw/2 + 10, mTY - 4);
          ctx.lineTo(cx + bw/2 + 10, mTY + 4);
          ctx.fill();
        }
        ctx.restore();
      }

      // Gears
      const gc = g.st ? "#C88" : g.sp < .5 ? "#C9A878" : "#A0A0A0";
      const gs_ = g.st ? "#A66" : g.sp < .5 ? "#A08050" : "#808080";
      const rot = g.st ? Math.sin(tR.current * .3) * .015 : tR.current * .04 * g.sp;
      const retMul = retR.current.active ? -1 : 1;
      dG(cx - 30, gY+1, rot * retMul, gc, gs_, spR.current.c);
      dG(cx + 30, gY+1, -rot * retMul, gc, gs_, spR.current.c);

      // Heat break fins with thermal gradient & 3D bevel
      const fc = 6;
      for (let i = 0; i < fc; i++) {
        const y = hT + i * ((hB - hT)/fc), fH_ = 6;
        const finHeat = hc * (fc - i) / fc;
        const finColor = finHeat > .3 ? lC("#DEDAD3", "#E8C0A0", finHeat) : "#DEDAD3";
        
        // Left fin
        ctx.fillStyle = finColor;
        ctx.strokeStyle = "#C5C0B8"; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.roundRect(cx - 38, y, 38 - bw/2-1, fH_, 1); ctx.fill(); ctx.stroke();
        // Top highlight
        ctx.fillStyle = "rgba(255,255,255,.15)";
        ctx.fillRect(cx - 37, y + .5, 36 - bw/2, 1);
        
        // Right fin
        ctx.fillStyle = finColor;
        ctx.strokeStyle = "#C5C0B8"; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.roundRect(cx + bw/2+1, y, 38 - bw/2-1, fH_, 1); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.15)";
        ctx.fillRect(cx + bw/2+2, y + .5, 36 - bw/2, 1);
        
        if (hc > .3) {
          const ti = `rgba(220,80,40,${(hc-.3)*.08*(fc-i)/fc})`;
          ctx.fillStyle = ti;
          ctx.beginPath(); ctx.roundRect(cx-38, y, 38-bw/2-1, fH_, 1); ctx.fill();
          ctx.beginPath(); ctx.roundRect(cx+bw/2+1, y, 38-bw/2-1, fH_, 1); ctx.fill();
        }
      }

      // Fan visual
      if (fanR.current > 0) {
        ctx.save(); ctx.font = "500 6px -apple-system,sans-serif";
        ctx.fillStyle = `rgba(60,120,200,${fanR.current})`;
        ctx.textAlign = "right";
        ctx.fillText("FAN " + Math.round(fanR.current*100) + "%", cx - 52, nB + 2);
        ctx.strokeStyle = `rgba(100,160,220,${fanR.current*.25})`;
        ctx.lineWidth = .4;
        for (let i = 0; i < 4; i++) {
          const fy = nB + 5 + i * 3;
          const phase = tR.current * .25 + i * .8;
          ctx.beginPath();
          for (let x = -20; x <= 0; x += 2) {
            const yy = fy + Math.sin(x * .2 + phase) * 1.5;
            if (x === -20) ctx.moveTo(cx - nw/2 + x, yy);
            else ctx.lineTo(cx - nw/2 + x, yy);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // Heat break bore walls
      ctx.strokeStyle = "#888"; ctx.lineWidth = .5;
      ctx.beginPath(); ctx.moveTo(cx - bw/2, hT); ctx.lineTo(cx - bw/2, hB); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + bw/2, hT); ctx.lineTo(cx + bw/2, hB); ctx.stroke();

      if (hc > .3) {
        ctx.save(); ctx.font = "bold 5.5px -apple-system,sans-serif";
        ctx.fillStyle = `rgba(220,60,20,${(hc-.3)*1.2})`; ctx.textAlign = "left";
        ctx.fillText("HEAT CREEP\u26A0", cx + 44, (hT+hB)/2+1);
        ctx.restore();
      }

      // Heater block with realistic rendering
      const heatIntensity = clamp((pp.pt - m.mt) / 60, 0, 1);
      ctx.save();
      ctx.shadowColor = `rgba(200,40,20,${heatIntensity * .15})`;
      ctx.shadowBlur = 6;
      
      const hg = ctx.createLinearGradient(cx - 42, mT, cx - 42, mB);
      hg.addColorStop(0, lC("#C44", "#FF6030", heatIntensity));
      hg.addColorStop(.3, lC("#D55", "#FF7040", heatIntensity));
      hg.addColorStop(.7, lC("#C44", "#FF5530", heatIntensity));
      hg.addColorStop(1, lC("#B33", "#E04020", heatIntensity));
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.roundRect(cx - 42, mT, 84, mB - mT, 3); ctx.fill();
      ctx.restore();
      
      // Heater block edge highlight
      ctx.fillStyle = `rgba(255,255,255,${.08 + heatIntensity * .05})`;
      ctx.beginPath(); ctx.roundRect(cx - 41, mT + 1, 82, 2, 1); ctx.fill();
      
      ctx.strokeStyle = "#A22"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(cx - 42, mT, 84, mB - mT, 3); ctx.stroke();
      
      // Heater coil lines (subtle)
      ctx.save();
      ctx.strokeStyle = `rgba(0,0,0,.08)`;
      ctx.lineWidth = .4;
      for (let y2 = mT + 8; y2 < mB - 5; y2 += 7) {
        ctx.beginPath();
        ctx.moveTo(cx - 40, y2);
        ctx.lineTo(cx + 40, y2);
        ctx.stroke();
      }
      ctx.restore();
      
      // Temp label
      ctx.font = "bold 8px -apple-system,sans-serif";
      ctx.fillStyle = `rgba(255,255,255,${.4 + heatIntensity * .2})`; ctx.textAlign = "center";
      ctx.fillText("~" + pp.pt + "\u00B0C " + m.l, cx, (mT+mB)/2 + 2);
      
      // Thermistor with wire
      ctx.beginPath(); ctx.arc(cx + 34, (mT+mB)/2, 3, 0, Math.PI*2);
      const tGrad = ctx.createRadialGradient(cx + 34, (mT+mB)/2 - 1, 0, cx + 34, (mT+mB)/2, 3.5);
      tGrad.addColorStop(0, "#FFB060"); tGrad.addColorStop(1, "#CC7020");
      ctx.fillStyle = tGrad; ctx.fill();
      ctx.strokeStyle = "#A44"; ctx.lineWidth = .5; ctx.stroke();
      // Wire
      ctx.strokeStyle = "#888"; ctx.lineWidth = .4;
      ctx.beginPath(); ctx.moveTo(cx + 37, (mT+mB)/2); ctx.lineTo(cx + 48, (mT+mB)/2); ctx.stroke();
      
      // Melt channel
      const mcGrad = ctx.createLinearGradient(cx - bw/2, 0, cx + bw/2, 0);
      mcGrad.addColorStop(0, "#3A1000"); mcGrad.addColorStop(.5, "#4A1800"); mcGrad.addColorStop(1, "#3A1000");
      ctx.fillStyle = mcGrad; ctx.fillRect(cx - bw/2, mT, bw, mB - mT);

      // ── Nozzle body — realistic brass with reflections ──
      const wearTint = Math.min(1, nzWR.current * 20);
      
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.1)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
      
      // Outer nozzle shape
      ctx.beginPath();
      ctx.moveTo(cx - bw/2-7, nT); ctx.lineTo(cx + bw/2+7, nT);
      ctx.lineTo(cx + nw/2+4, nLS); ctx.lineTo(cx + nw/2+4, nB);
      ctx.lineTo(cx - nw/2-4, nB); ctx.lineTo(cx - nw/2-4, nLS);
      ctx.closePath();
      
      const ng = ctx.createLinearGradient(cx - bw/2 - 7, 0, cx + bw/2 + 7, 0);
      ng.addColorStop(0, lC("#A07830", "#806020", wearTint));
      ng.addColorStop(.2, lC("#C9A84C", "#A08030", wearTint));
      ng.addColorStop(.4, lC("#E0C468", "#C0A048", wearTint));
      ng.addColorStop(.5, lC("#ECD070", "#D0B050", wearTint));
      ng.addColorStop(.6, lC("#DDB95E", "#B89840", wearTint));
      ng.addColorStop(.8, lC("#C9A84C", "#A08030", wearTint));
      ng.addColorStop(1, lC("#A07830", "#806020", wearTint));
      ctx.fillStyle = ng; ctx.fill();
      ctx.restore();
      
      ctx.strokeStyle = lC("#A07830", "#806020", wearTint); ctx.lineWidth = .8;
      ctx.beginPath();
      ctx.moveTo(cx - bw/2-7, nT); ctx.lineTo(cx + bw/2+7, nT);
      ctx.lineTo(cx + nw/2+4, nLS); ctx.lineTo(cx + nw/2+4, nB);
      ctx.lineTo(cx - nw/2-4, nB); ctx.lineTo(cx - nw/2-4, nLS);
      ctx.closePath(); ctx.stroke();

      // Inner nozzle bore
      const nb = ctx.createLinearGradient(cx - bw/2, 0, cx + bw/2, 0);
      nb.addColorStop(0, "#C89838"); nb.addColorStop(.3, "#DAAD50");
      nb.addColorStop(.5, "#E8C060"); nb.addColorStop(.7, "#DAAD50"); nb.addColorStop(1, "#C89838");
      ctx.fillStyle = nb;
      ctx.beginPath();
      ctx.moveTo(cx - bw/2, nT); ctx.lineTo(cx + bw/2, nT);
      ctx.lineTo(cx + nw/2, nLS); ctx.lineTo(cx + nw/2, nB);
      ctx.lineTo(cx - nw/2, nB); ctx.lineTo(cx - nw/2, nLS);
      ctx.closePath(); ctx.fill();

      // Molten material
      dMF();

      // Fouling buildup with texture
      if (fl > .002) {
        const fp = fl * PX;
        // Left wall fouling
        ctx.save();
        for (let dy = 0; dy < nB - nT - 3; dy += 1.5) {
          const y2 = nT + 2 + dy;
          const w2 = nW(y2);
          const foulW = fp * (1 + Math.sin(dy * .5 + 1.3) * .3);
          const alpha = Math.min(.7, fl * 6) * (.6 + Math.sin(dy * .8) * .2);
          ctx.fillStyle = `rgba(40,20,5,${alpha})`;
          ctx.fillRect(w2.l, y2, foulW, 1.5);
          ctx.fillRect(w2.r - foulW, y2, foulW, 1.5);
        }
        ctx.restore();
      }

      // Effective bore markers
      ctx.strokeStyle = "rgba(160,40,40,.3)"; ctx.lineWidth = .7;
      ctx.setLineDash([2,2]);
      ctx.beginPath(); ctx.moveTo(cx-ep/2, nB-4); ctx.lineTo(cx-ep/2, nB+3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx+ep/2, nB-4); ctx.lineTo(cx+ep/2, nB+3); ctx.stroke();
      ctx.setLineDash([]);

      // Nozzle tip with chamfer
      ctx.fillStyle = lC("#B08A3A", "#907028", wearTint);
      ctx.fillRect(cx - nw/2-4, nB, nw+8, 2.5);
      // Bottom chamfer highlight
      ctx.fillStyle = lC("#D0AA50", "#B09040", wearTint);
      ctx.fillRect(cx - nw/2-4, nB, nw+8, .8);
      // Bore opening
      ctx.fillStyle = "#F5F2ED";
      ctx.fillRect(cx - nw/2, nB, nw, 2.5);

      // Pressure glow
      if (cl.pr > .1) {
        const pg = ctx.createRadialGradient(cx, nT+12, 4, cx, nT+12, 24 + cl.pr*10);
        pg.addColorStop(0, `rgba(255,120,40,${cl.pr*.08})`);
        pg.addColorStop(1, "rgba(255,120,40,0)");
        ctx.fillStyle = pg; ctx.fillRect(cx - 34, nT-3, 68, 30);
      }

      // Clog indicator
      if (cl.a) {
        ctx.fillStyle = `rgba(210,50,50,${.02 + cl.sv*.06})`;
        ctx.beginPath(); ctx.arc(cx, nB-4, 10 + cl.sv*3, 0, Math.PI*2); ctx.fill();
      }

      // Die swell, stringing, shimmer
      dDieSwell();
      dStrings();
      dShimmer();

      // Extrudate stream from nozzle to bed
      dExtrudate();

      // Build plate
      dBd();

      // Vapor/smoke overlay
      dVapor();
      dBubbles();

      // Retraction indicator
      if (retR.current.active) {
        ctx.save(); ctx.globalAlpha = .7;
        ctx.strokeStyle = "#3878AA"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, gTE - 8); ctx.lineTo(cx, gTE - 20);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 4, gTE - 16); ctx.lineTo(cx, gTE - 22); ctx.lineTo(cx + 4, gTE - 16);
        ctx.fillStyle = "#3878AA"; ctx.fill();
        ctx.font = "bold 7px -apple-system,sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "#3878AA";
        ctx.fillText("RETRACT", cx, gTE - 24);
        ctx.restore();
      }

      // Ambient cold tint
      if (pp.amb < 30) {
        const coolAlpha = clamp((30 - pp.amb) / 40, 0, .05);
        ctx.fillStyle = `rgba(100,140,200,${coolAlpha})`;
        ctx.fillRect(0, 0, W, gTE);
      }
      
      // Subtle vignette
      const vig = ctx.createRadialGradient(cx, H/2, W * .4, cx, H/2, W * .75);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,.03)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    };

    // ══════════════════════════════════════════════════════════
    //          UPDATE GEARS
    // ══════════════════════════════════════════════════════════
    const uG = () => {
      const pp = p(), g = gR.current, cl = clR.current, fd = fdR.current;
      const ex = Math.max(0, fd - pp.fn - .02);
      const tot = Math.min(1, ex/.08 + (cl.a ? cl.sv*1.5 : 0) + spR.current.c * .3);
      const driveFactor = driveR.current === "bowden" ? .7 : 1;
      g.sp = Math.max(0, 1 - tot * 1.2 * driveFactor);
      g.st = g.sp < .05;

      if (g.st) {
        g.stT++;
        if (g.stT > 60 && g.gd < 1) {
          g.gd += .002;
          if (g.gd > .3 && Math.random() < .01) sR.current.g++;
        }
        cl.pr = Math.min(2, cl.pr + .005);
      } else {
        g.stT = 0;
        cl.pr = Math.max(0, cl.pr - .01);
        if (g.gd > 0) g.gd = Math.max(0, g.gd - .0002);
      }
      if (tot > .5 && !g.st) sR.current.j++;

      const buckPressure = spR.current.c * (driveR.current === "bowden" ? 1.5 : .8);
      buckR.current = clamp(buckR.current + (buckPressure > .7 && g.st ? .003 : -.005), 0, 1);
    };

    // ══════════════════════════════════════════════════════════
    //          UPDATE PARTICLE
    // ══════════════════════════════════════════════════════════
    const uP = (pt) => {
      if (pt.sk) return;
      const g = gR.current, cl = clR.current, m = mt(), pp = p(), mTY = gMTY();

      // Frozen
      if (pt.fr) {
        const retPull = retR.current.active ? -.5 : 0;
        const fs = g.st ? 0 : .35 * g.sp * pp.fr * .3;
        pt.vy = fs + retPull;
        pt.vx = 0;
        const t = tR.current - (mTY - pt.y) * 2;
        pt.x = cx + pt.fo * fHW(pt.y, t) * .95;
        pt.y += pt.vy;
        if (pt.y - pt.radius < fTY) pt.y = fTY + pt.radius;
        const meltZoneStart = mTY - 12;
        if (pt.y >= meltZoneStart) {
          const meltProgress = clamp((pt.y - meltZoneStart) / 12, 0, 1);
          const tempBoost = 1 + Math.max(0, pp.pt - m.mt) * .01;
          if (meltProgress * tempBoost > .6 || (meltProgress > .2 && Math.random() < meltProgress * .15 * tempBoost)) {
            pt.fr = false; pt.vy = fs + .05; pt.vx = 0;
            const w = nW(pt.y);
            pt.mrp = (pt.x - cx) / ((w.r - w.l)/2 + .01);
            if (pt.moist && moistR.current > .01) {
              spawnBubble(pt.x, pt.y);
              if (Math.random() < .3) spawnVapor(pt.x, pt.y - 5, "steam");
            }
          }
        }
        return;
      }

      // Exited
      if (pt.ex) {
        pt.vy += .04;
        if (!pt.swollen && dsR.current > 1.02) {
          pt.radius *= lerp(1, dsR.current, .3);
          pt.vx += (pt.x - cx) * .01 * (dsR.current - 1);
          pt.swollen = true;
        }
        if (!pt.pa) pt.vx -= bSp * .06;
        pt.x += pt.vx;
        pt.y += pt.vy;
        // Track stretch for visual deformation
        pt.stretch = clamp(1 + Math.abs(pt.vy) * .3, 1, 2);
        if (pt.y + pt.radius >= bY) {
          if (!pt.pa) { pt.pa = true; sR.current.p++; }
          bpR.current.push({
            wx: boR.current + (pt.x - cx), y: bY - pt.radius*.5,
            r: pt.radius, cl: pt.cl, cb: pt.cb
          });
          // Add to bead
          beadR.current.push({
            wx: boR.current + (pt.x - cx),
            w: pt.radius * 2 * dsR.current,
            cb: pt.cb
          });
          pt.y = H + 100;
        }
        return;
      }

      if (pt.y - pt.radius < mTY) { pt.y = mTY + pt.radius; pt.vy = Math.max(pt.vy, 0); }

      const dr = gD(pt, m, pp);
      const w = nW(pt.y);
      const lw = w.r - w.l;
      const rf = Math.abs((pt.x - cx) / (lw/2 + .01));
      const pb = pp_(rf);
      const ac = fA(pt.y);

      const sf = spR.current.c * .015;
      pt.vy += (.015 + (g.sp * .012) + (cl.pr > .3 ? cl.pr * .008 : 0) + sf) * pb * ac;

      if (retR.current.active && pt.y > mTY) {
        const retForce = .08 * pp.retSpd / 25;
        const nozzleAtten = pt.y > nT ? Math.max(.3, 1 - (pt.y - nT) / (nB - nT) * .7) : 1;
        pt.vy -= retForce * nozzleAtten;
      }

      pt.vx *= dr; pt.vy *= dr;

      const inN = pt.y > nT;
      const mV = inN
        ? (1.6 - Math.min(1, (pt.y - nT)/(nB - nT)) * .2) * m.fl
        : 1.8 * m.fl;
      pt.vy = Math.min(pt.vy, mV + (cl.pr > .5 ? cl.pr*.3 : 0));

      pt.vx += (cx + pt.mrp*(lw/2)*.45 - pt.x) * .001;

      // Track velocity-dependent stretch
      pt.stretch = clamp(1 + Math.abs(pt.vy) * .15, 1, 1.8);

      if (pt.y > mT && pt.y < mB) {
        pt.mp = Math.min(1, pt.mp + .008);
        const tf = 1 + Math.max(0, pp.pt - m.mt) * .02;
        pt.radius *= pt.tp === "p"
          ? (1 - .0015 * pt.mp * tf)
          : (1 - .0003 * pt.mp);
      }

      if (pt.tp === "w" && pt.y > mT) {
        pt.dt++;
        const tempFactor = 1 + Math.max(0, pp.pt - m.mt) * .01;
        pt.cb = Math.min(1, pt.cb + .00005 * m.cr * tempFactor);
        if (pt.cb > .3) pt.radius *= (1 - .0001 * pt.cb);
        if (pt.cb > .4 && Math.random() < .003 * pt.cb) {
          spawnVapor(pt.x, pt.y - 3, "smoke");
        }
      }

      if (rf > .85) {
        const wc = Math.min(1, (rf - .85) / .15);
        pt.av += (pt.vy * .02 - pt.av) * .1 * wc * ((pt.x - cx) > 0 ? 1 : -1);
      }
      pt.ro += pt.av; pt.av *= .98;

      if (pt.y < nB + 3) {
        if (pt.x - pt.radius < w.l) { pt.x = w.l + pt.radius; pt.vx = Math.abs(pt.vx) * .15; }
        if (pt.x + pt.radius > w.r) { pt.x = w.r - pt.radius; pt.vx = -Math.abs(pt.vx) * .15; }
      }

      // Clog / bridge check
      if (!pt.ec && pt.y + pt.radius > nLS + 2) {
        pt.ec = true;
        const ef = eM(), pD = (pt.radius * 2) / PX;
        if (pD > ef) {
          pt.sk = true; cl.a = true;
          cl.sv = Math.min(1, cl.sv + .3);
          cl.ps.push(pt); sR.current.c++;
          cl.cn = Math.min(.15, cl.cn + pD * .3);
          nzWR.current += .0001 * m.wr;
          return;
        }
        const lW_ = nW(nLS), eW = lW_.r - lW_.l;
        const nb_ = pR.current.filter(o => o !== pt && !o.sk && !o.pa && !o.fr && !o.ex
          && o.y > nT && Math.abs(o.y - pt.y) < (pt.radius + o.radius)*1.8
          && Math.abs(o.x - pt.x) < eW);
        for (const o of nb_) {
          const cm = (pt.radius + o.radius) / PX;
          const fr = cm / ef;
          const bm = (1/m.fl) * (1/(1 + Math.max(0, pp.pt - m.mt)*.01))
            * Math.max(.3, 1 - Math.abs(pt.av + o.av)*2);
          if (fr > 1 || (fr > .82 && Math.random() < (fr - .82)*2.5*bm)) {
            pt.sk = true; o.sk = true; pt.br = true; o.br = true; o.ec = true;
            cl.a = true; cl.sv = Math.min(1, cl.sv + .5);
            sR.current.b++; sR.current.c += 2;
            cl.cn = Math.min(.15, cl.cn + cm * .2);
            nzWR.current += .00005 * m.wr;
            return;
          }
        }
        if (nb_.length >= 2) {
          for (let i = 0; i < nb_.length-1; i++) {
            for (let j = i+1; j < nb_.length; j++) {
              const o1 = nb_[i], o2 = nb_[j];
              const tm = (pt.radius + o1.radius + o2.radius) / PX;
              if (tm/ef > 1.1 && Math.random() < .15/m.fl) {
                pt.sk = true; o1.sk = true; o2.sk = true;
                pt.br = true; o1.br = true; o2.br = true;
                o1.ec = true; o2.ec = true;
                cl.a = true; cl.sv = Math.min(1, cl.sv + .6);
                sR.current.b++; sR.current.c += 3;
                cl.cn = Math.min(.15, cl.cn + tm * .15);
                return;
              }
            }
          }
        }
      }

      if (pt.y > nB + 1) { pt.ex = true; return; }

      for (const o of pR.current) {
        if (o === pt || o.pa || o.fr || o.ex) continue;
        const dx = o.x - pt.x, dy = o.y - pt.y;
        const d = Math.sqrt(dx*dx + dy*dy), m2 = pt.radius + o.radius;
        if (d < m2 && d > 0) {
          const nx = dx/d, ny = dy/d, ov = m2 - d;
          pt.x -= nx * ov * .35; pt.y -= ny * ov * .35;
          if (!o.sk) { o.x += nx * ov * .35; o.y += ny * ov * .35; }
          pt.vx -= nx * .05; pt.vy -= ny * .03;
          pt.av += (pt.vx*(-ny) + pt.vy*(-nx)) * .01;
        }
      }

      if (cl.a && pt.y > nT && pt.y < nB + 3) {
        pt.vy *= .85;
        if (pt.y > nLS - 5) pt.vy -= .02 * cl.sv;
      }

      if (pt.y - pt.radius < mTY) { pt.y = mTY + pt.radius; pt.vy = Math.max(pt.vy, 0); }

      pt.x += pt.vx; pt.y += pt.vy;

      if (inN && pt.tp === "w" && Math.abs(pt.vy) > .5) {
        nzWR.current += .0000002 * m.wr * Math.abs(pt.vy);
      }
    };

    // ── Draw particle with enhanced realism ──
    const dP = (pt) => {
      if (pt.y > H + 20 || pt.y < fTY - 10) return;
      ctx.save();
      if (pt.ex) ctx.globalAlpha = .9;
      else if (pt.fr) ctx.globalAlpha = .7;
      ctx.translate(pt.x, pt.y); ctx.rotate(pt.ro);

      const stretch = pt.stretch || 1;
      // Apply velocity-dependent stretching
      if (stretch > 1.05) {
        const stretchAngle = Math.atan2(pt.vy, pt.vx);
        ctx.rotate(stretchAngle - pt.ro);
        ctx.scale(stretch, 1 / Math.sqrt(stretch));
        ctx.rotate(-(stretchAngle - pt.ro));
      }

      // Melt glow - softer, more realistic
      if (pt.mp > .3 && !pt.fr) {
        const gr = pt.radius * (1 + pt.mp * .3);
        const gd = ctx.createRadialGradient(0, 0, pt.radius * .3, 0, 0, gr);
        gd.addColorStop(0, `rgba(220,100,30,${pt.mp * .06})`);
        gd.addColorStop(1, "rgba(220,100,30,0)");
        ctx.fillStyle = gd;
        ctx.fillRect(-gr, -gr, gr*2, gr*2);
      }

      // Particle shape
      ctx.beginPath();
      if (pt.tp === "w" && pt.mp < .5) {
        // Detailed irregular wood fiber
        const shape = pt.fiberShape;
        const angle = pt.fiberAngle;
        ctx.rotate(angle);
        for (let i = 0; i < shape.length; i++) {
          const s = shape[i];
          const r = pt.radius * s.rx;
          const ry = pt.radius * s.ry;
          const x2 = Math.cos(s.a) * r;
          const y2 = Math.sin(s.a) * ry;
          if (i === 0) ctx.moveTo(x2, y2);
          else {
            // Smooth curves between vertices
            const prev = shape[(i - 1 + shape.length) % shape.length];
            const prevR = pt.radius * prev.rx;
            const prevRy = pt.radius * prev.ry;
            const px = Math.cos(prev.a) * prevR;
            const py = Math.sin(prev.a) * prevRy;
            const cpx = (px + x2) / 2 + (Math.random() - .5) * pt.radius * .1;
            const cpy = (py + y2) / 2 + (Math.random() - .5) * pt.radius * .1;
            ctx.quadraticCurveTo(cpx, cpy, x2, y2);
          }
        }
        ctx.closePath();
        ctx.rotate(-angle);
      } else {
        // Plastic particles are smoother circles
        ctx.arc(0, 0, pt.radius, 0, Math.PI*2);
      }

      // Color with depth
      let c = pt.cl;
      if (pt.cb > .2) c = lC(pt.cl, "#2A1A08", pt.cb * .8);
      else if (pt.mp > 0) c = lC(pt.cl, mt().colMelt, pt.mp * .4);
      if (pt.sk) c = pt.br ? "#D44" : "#C33";
      if (pt.moist && pt.fr) c = lC(c, "#8899AA", .15);
      ctx.fillStyle = c; ctx.fill();

      // Depth shading on particles
      if (pt.radius > 1.5 && !pt.sk) {
        const pg = ctx.createRadialGradient(
          -pt.radius * .2, -pt.radius * .2, 0,
          0, 0, pt.radius
        );
        pg.addColorStop(0, "rgba(255,255,255,.12)");
        pg.addColorStop(.5, "rgba(255,255,255,0)");
        pg.addColorStop(1, "rgba(0,0,0,.1)");
        ctx.fillStyle = pg; ctx.fill();
      }
      
      if (pt.sk) { ctx.strokeStyle = "#A22"; ctx.lineWidth = .7; ctx.stroke(); }
      
      // Wood grain lines on larger wood particles
      if (pt.tp === "w" && pt.radius > 2 && pt.mp < .3) {
        ctx.strokeStyle = pt.clDark || "rgba(80,50,15,.2)";
        ctx.lineWidth = .3;
        ctx.beginPath();
        ctx.moveTo(-pt.radius * .5, -pt.radius * .2);
        ctx.lineTo(pt.radius * .5, -pt.radius * .1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-pt.radius * .3, pt.radius * .3);
        ctx.lineTo(pt.radius * .4, pt.radius * .25);
        ctx.stroke();
      }
      
      ctx.restore();
    };

    // ══════════════════════════════════════════════════════════
    //                    TICK
    // ══════════════════════════════════════════════════════════
    const tick = () => {
      if (!rnR.current) { aR.current = requestAnimationFrame(tick); return; }
      const pp = p(), g = gR.current, cl = clR.current, m = mt();
      tR.current++;

      if (!prePopRef.current) { prePopRef.current = true; prePopulate(); }

      // Retraction
      const ret = retR.current;
      if (ret.active) {
        ret.t++;
        const retDuration = (pp.ret / pp.retSpd) * 60;
        if (ret.t > retDuration) {
          ret.active = false; ret.t = 0;
          sRetAct(false);
          oozR.current = clamp(oozR.current + .3 * m.fl, 0, 1);
          if (Math.random() < m.fl * .3 + moistR.current) {
            spawnString(cx + (Math.random()-.5)*4, nB);
          }
        }
      }

      // Moisture
      moistR.current = pp.moist * m.mst;
      if (moistR.current > .01 && Math.random() < moistR.current * .15) {
        const bx = cx + (Math.random()-.5) * bW() * .6;
        const by = gMTY() + Math.random() * (nT - gMTY());
        spawnBubble(bx, by);
      }

      // Spawn
      const sr = pp.pd * pp.fr * Math.max(.1, g.sp) * .12;
      saR.current += sr;
      const mx = 250 + pp.pd * 80;
      while (saR.current >= 1 && pR.current.length < mx) { saR.current -= 1; spawnTop(); }

      // Bed movement
      boR.current += bSp;

      uG();

      // Heat creep
      const ambFactor = 1 + Math.max(0, (pp.amb - 25)) * .02;
      const tempExcess = Math.max(0, pp.pt - m.mt) / 80;
      const baseCreep = tempExcess * .0002 * ambFactor;
      const stallCreep = (g.st || cl.a) ? .001 * m.hc * ambFactor : 0;
      const fanCooling = fanR.current > 0 ? (1 + fanR.current * 2) : 1;
      hcR.current = clamp(hcR.current + baseCreep + stallCreep - .003 / fanCooling, 0, 1);

      fanR.current = pp.fan / 100;
      driveR.current = pp.drive;

      // Spring / pressure
      const sp = spR.current;
      const bowdenExtra = driveR.current === "bowden" ? 1.3 : 1;
      if (cl.a || g.st) {
        sp.c = Math.min(1.5, sp.c + g.sp * .003 * bowdenExtra);
        sp.e = sp.c * sp.c * .5;
      } else {
        sp.c = Math.max(0, sp.c - .01);
        sp.e = sp.c * sp.c * .5;
      }
      if (sp.c > 1 && cl.a && Math.random() < .005 * sp.e) {
        cl.a = false; cl.sv *= .2;
        cl.ps.forEach(x => { x.sk = false; x.ex = true; x.vy = .5 + sp.e*.3; x.pa = true; sR.current.p++; });
        cl.ps = []; cl.pr *= .2; cl.cn *= .3; sp.c *= .3;
      }

      // Fouling
      const sw = pR.current.filter(x => x.sk && x.tp === "w" && x.y > nT);
      if (sw.length > 0) {
        const ac = sw.reduce((s, x) => s + x.cb, 0) / sw.length;
        fR.current = Math.min(.15, fR.current + .00002 * m.cr * (1 + ac));
      }
      fR.current = Math.max(0, fR.current - .000005);
      if (!cl.a) cl.cn = Math.max(0, cl.cn - .0002);

      // Pressure pop
      if (cl.a) {
        cl.sv *= .9995;
        if (cl.pr > 1.5 && Math.random() < .003) {
          cl.a = false; cl.sv *= .3;
          cl.ps.forEach(x => { x.sk = false; x.ex = true; x.vy = 1; x.pa = true; sR.current.p++; });
          cl.ps = []; cl.pr *= .3; cl.cn *= .3;
        }
      }

      // Viscous heating
      const avgSpeed = pR.current.filter(x => !x.fr && !x.ex && !x.sk && x.y > nT)
        .reduce((s, x) => s + Math.abs(x.vy), 0) / (pR.current.length + 1);
      vhR.current = clamp(vhR.current + (avgSpeed * m.vh * .001 - .0005), 0, .3);

      // Die swell
      dsR.current = lerp(dsR.current, m.ds * (1 + vhR.current * .5), .01);

      // Under-extrusion
      const flowRate = pR.current.filter(x => x.ex && !x.pa).length;
      const expectedFlow = pp.pd * pp.fr * .1;
      ueR.current = clamp(lerp(ueR.current, clamp(1 - flowRate / (expectedFlow + .01), 0, 1), .02), 0, 1);

      // Nozzle wear
      nzWR.current += .0000005 * m.wr * pp.fr;

      // Update particles
      pR.current.forEach(uP);
      pR.current.filter(x => x.sk && x.tp === "w" && x.y > mT).forEach(x => {
        x.dt++; x.cb = Math.min(1, x.cb + .0001 * m.cr);
      });

      // Update vapor - with turbulence
      vapR.current.forEach(v => {
        v.turbulence += .08;
        v.x += v.vx + Math.sin(v.turbulence) * .08;
        v.y += v.vy;
        v.r *= v.grow;
        v.life -= v.decay;
        v.vx += (Math.random()-.5) * .04;
        v.vy *= .995; // slow rise deceleration
      });
      vapR.current = vapR.current.filter(v => v.life > 0);

      // Update bubbles
      bubR.current.forEach(b => {
        b.x += b.vx; b.y += b.vy;
        b.life -= .015;
        b.r *= 1.005;
        b.wobble += .1;
        if (b.y < gMTY() + 5) {
          b.life = 0;
          spawnVapor(b.x, b.y, "steam");
        }
      });
      bubR.current = bubR.current.filter(b => b.life > 0);

      // Update strings
      strR.current.forEach(s => { s.life -= .008; s.len += .05; });
      strR.current = strR.current.filter(s => s.life > 0);

      oozR.current = Math.max(0, oozR.current - .002);

      // Cleanup
      pR.current = pR.current.filter(x => x.y < H + 10 && x.y > fTY - 15);
      const vM = boR.current - W;
      bpR.current = bpR.current.filter(d => d.wx > vM);
      beadR.current = beadR.current.filter(d => d.wx > vM);

      // DRAW
      dH();
      pR.current.filter(pt => pt.fr).forEach(dP);
      pR.current.filter(pt => !pt.fr && !pt.ex).forEach(dP);
      pR.current.filter(pt => pt.ex).forEach(dP);

      // Chart sampling
      if (tR.current % 60 === 0) {
        const s = sR.current;
        csvR.current.push({ t:tR.current, p:s.p, c:s.c, b:s.b, j:s.j, f:fR.current, w:nzWR.current });
        const cd_ = cdR.current;
        const cr = s.p + s.c > 0 ? Math.round((s.c/(s.p+s.c))*1000)/10 : 0;
        cd_.p.push(s.p); cd_.c.push(s.c); cd_.r.push(cr);
        cd_.f.push(Math.round(fR.current * 10000)/10);
        if (cd_.p.length > 80) { cd_.p.shift(); cd_.c.shift(); cd_.r.shift(); cd_.f.shift(); }
      }

      // React state updates
      if (tR.current % 15 === 0) {
        sSt({ p:sR.current.p, c:sR.current.c, j:sR.current.j, b:sR.current.b, g:sR.current.g });
        sLG({ ...gR.current });
        sLP(clR.current.pr);
        sLF(fR.current);
        sLH(hcR.current);
        sLD(fdR.current);
        sCD({ ...cdR.current });
        sLW(nzWR.current);
        sLDS(dsR.current);
        sLUE(ueR.current);
        sLBk(buckR.current);
        sLMo(moistR.current);
        sLVH(vhR.current);
      }

      aR.current = requestAnimationFrame(tick);
    };

    aR.current = requestAnimationFrame(tick);
    return () => { if (aR.current) cancelAnimationFrame(aR.current); };
  }, []);

  // ══════════════════════════════════════════════════════════
  //                        RENDER
  // ══════════════════════════════════════════════════════════
  const ef = Math.max(.01, pa.nd * pa.wt - lF);
  const tot = st.p + st.c;
  const cRt = tot > 0 ? ((st.c / tot) * 100).toFixed(1) : "0.0";
  const cm = MAT[pa.mat];

  // -- Collapsible section state --
  const [openSections, setOpenSections] = useState({
    material: true, nozzle: true, particles: true, filament: false,
    environment: true, retraction: false, simulation: true
  });
  const toggleSection = (k) => setOpenSections(s => ({ ...s, [k]: !s[k] }));

  // -- Styles --
  const sidebarCard = { background:"#fff", borderRadius:0, padding:"10px 14px",
    borderBottom:"1px solid #EAE7E2" };
  const sectionHead = (key) => ({
    fontSize:9, fontWeight:700, color:"#999", letterSpacing:.8, textTransform:"uppercase",
    display:"flex", alignItems:"center", justifyContent:"space-between",
    cursor:"pointer", userSelect:"none", padding:"0 0 4px 0",
    marginBottom: openSections[key] ? 7 : 0
  });
  const chevron = (key) => (
    <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity:.35,
      transform: openSections[key] ? "rotate(0deg)" : "rotate(-90deg)",
      transition:"transform .15s ease" }}>
      <path d="M2.5 3.5L5 6.5L7.5 3.5" fill="none" stroke="#888" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  const statCard = { background:"#fff", borderRadius:8, padding:"6px 10px",
    border:"1px solid #E0DDD8", boxShadow:"0 1px 3px rgba(0,0,0,.03)" };
  const btnBase = { padding:"6px 0", border:"1px solid", fontSize:10, fontWeight:600,
    borderRadius:5, cursor:"pointer", fontFamily:"inherit", flex:1, transition:"all .1s ease" };

  return (
    <div style={{ background:"#F0EDE8", minHeight:"100vh", display:"flex", flexDirection:"column",
      alignItems:"center", fontFamily:"'SF Pro Text',-apple-system,'Segoe UI','Helvetica Neue',sans-serif" }}>

      {/* ── Top bar ── */}
      <div style={{ width:"100%", background:"#2A2520", padding:"8px 16px",
        display:"flex", alignItems:"center", justifyContent:"center", gap:12,
        boxShadow:"0 2px 8px rgba(0,0,0,.15)" }}>
        <h1 style={{ color:"#E8DFD4", fontSize:14, fontWeight:600, margin:0, letterSpacing:.3 }}>
          Wood Filament Clog Simulator
        </h1>
        <div style={{ color:"#7A7268", fontSize:9, letterSpacing:.3, display:"flex", gap:6, alignItems:"center" }}>
          {["Poiseuille","Shear thin","Die swell","Melt","Moisture","Wear"].map((t,i) => (
            <span key={i} style={{ opacity:.7 }}>{t}</span>
          ))}
        </div>
        <button onClick={() => sKH(true)} style={{ background:"rgba(255,255,255,.08)", border:"1px solid rgba(255,255,255,.12)",
          borderRadius:4, padding:"3px 10px", cursor:"pointer", fontSize:10, color:"#B8AFA4",
          fontFamily:"inherit", fontWeight:500, marginLeft:4 }}>?</button>
      </div>

      {/* Know How Modal */}
      {kh && (
        <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => sKH(false)}>
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.4)", backdropFilter:"blur(3px)" }}/>
          <div style={{ position:"relative", background:"#fff", borderRadius:12, padding:"24px 28px",
            maxWidth:520, maxHeight:"80vh", overflow:"auto", boxShadow:"0 8px 40px rgba(0,0,0,.25)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:"#2A2520" }}>Know How</h2>
              <button onClick={() => sKH(false)} style={{ background:"none", border:"none", fontSize:18,
                cursor:"pointer", color:"#999", padding:4 }}>✕</button>
            </div>
            <div style={{ fontSize:12, color:"#666", lineHeight:1.6 }}>
              {[
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
              ].map(({ t, d }) => (
                <div key={t} style={{ marginBottom:8 }}>
                  <div style={{ fontWeight:700, color:"#444", marginBottom:1 }}>{t}</div>
                  <div>{d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ MAIN TWO-COLUMN LAYOUT ══════════════ */}
      <div style={{ display:"flex", gap:0, alignItems:"stretch", width:"100%", maxWidth:720,
        margin:"0 auto", flex:1, minHeight:0 }}>

        {/* ── LEFT: Canvas + Stats ── */}
        <div style={{ display:"flex", flexDirection:"column", flex:"1 1 auto", minWidth:0 }}>
          {/* Canvas */}
          <div style={{ background:"#F5F2ED", padding:"10px 10px 6px 10px",
            display:"flex", justifyContent:"center" }}>
            <canvas ref={cR} width={420} height={520}
              style={{ borderRadius:6, border:"1px solid #D8D4CE",
                boxShadow:"0 2px 12px rgba(0,0,0,.07), inset 0 0 0 .5px rgba(255,255,255,.5)",
                maxWidth:"100%", height:"auto" }}/>
          </div>

          {/* Stats strip */}
          <div style={{ display:"flex", justifyContent:"center", gap:2, padding:"4px 10px 6px",
            background:"#F5F2ED", flexWrap:"wrap" }}>
            {[
              { l:"Passed", v:st.p, c:"#5A8F5A" },
              { l:"Clogged", v:st.c, c:"#C44" },
              { l:"Bridged", v:st.b, c:"#D08020" },
              { l:"Jams", v:st.j, c:"#8855AA" },
              { l:"Grinds", v:st.g, c:"#C66" },
              { l:"Clog%", v:`${cRt}%`, c: parseFloat(cRt) > 10 ? "#C44" : "#5A8F5A" }
            ].map(s => (
              <div key={s.l} style={{ textAlign:"center", padding:"3px 6px", minWidth:36,
                background:"#fff", borderRadius:4, border:"1px solid #E8E5E0" }}>
                <div style={{ fontSize:7.5, color:"#B0AAA0", marginBottom:1, textTransform:"uppercase",
                  letterSpacing:.3, fontWeight:600 }}>{s.l}</div>
                <div style={{ fontSize:13, fontWeight:700, color:s.c, fontVariantNumeric:"tabular-nums",
                  lineHeight:1 }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Performance charts + pressure — compact bottom row */}
          <div style={{ display:"flex", gap:1, padding:"0 10px 10px", background:"#F5F2ED" }}>
            {/* Charts */}
            <div style={{ ...statCard, flex:1, borderRadius:6 }}>
              <div style={{ fontSize:8, fontWeight:700, color:"#BBB", letterSpacing:.6,
                textTransform:"uppercase", marginBottom:4 }}>Performance</div>
              <MC data={cd.p} color="#5A8F5A" label="Passed" h={22}/>
              <MC data={cd.c} color="#C44" label="Clogged" h={22}/>
              <MC data={cd.r} color="#D08020" label="Clog %" h={22}/>
              <MC data={cd.f} color="#963" label="Fouling" h={22}/>
            </div>
            {/* Pressure + CSV */}
            <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:80 }}>
              <div style={{ ...statCard, borderRadius:6, padding:"6px 8px", flex:1,
                display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                <PGauge pressure={lP} max={2}/>
              </div>
              <button onClick={dlCSV} style={{ padding:"5px 0", border:"1px solid #D5D0CA",
                fontSize:9, fontWeight:600, borderRadius:5, cursor:"pointer", fontFamily:"inherit",
                background:"#fff", color:"#999" }}>
                CSV ↓
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Control Sidebar ── */}
        <div style={{ width:260, minWidth:260, background:"#fff", borderLeft:"1px solid #E0DDD8",
          overflowY:"auto", maxHeight:"100vh", position:"sticky", top:0,
          boxShadow:"-2px 0 12px rgba(0,0,0,.03)" }}>

          {/* Action buttons — pinned at top */}
          <div style={{ padding:"10px 14px 8px", borderBottom:"1px solid #EAE7E2",
            display:"flex", gap:4, background:"#FAFAF8", position:"sticky", top:0, zIndex:10 }}>
            <button onClick={() => sRun(r => !r)} style={{ ...btnBase,
              borderColor: run ? "#C66" : "#5A8F5A",
              background: run ? "#FDF6F0" : "#F0F8F0",
              color: run ? "#C44" : "#5A8F5A" }}>
              {run ? "⏸ Pause" : "▶ Resume"}
            </button>
            <button onClick={doRetract} style={{ ...btnBase,
              borderColor: retAct ? "#3878AA" : "#D5D0CA",
              background: retAct ? "#EEF4FA" : "#fff",
              color: retAct ? "#3878AA" : "#888" }}>
              ↑ Retract
            </button>
            <button onClick={rst} style={{ ...btnBase,
              borderColor:"#D5D0CA", background:"#fff", color:"#888" }}>
              ↺ Reset
            </button>
          </div>

          {/* ── Material ── */}
          <div style={sidebarCard}>
            <div onClick={() => toggleSection("material")} style={sectionHead("material")}>
              <span style={{ display:"flex", alignItems:"center" }}>Material<Inf text="Carrier thermoplastic with wood fiber fill."/></span>
              {chevron("material")}
            </div>
            {openSections.material && <>
              <div style={{ display:"flex", gap:3, marginBottom:6 }}>
                {Object.entries(MAT).map(([k, m]) => (
                  <button key={k} onClick={() => sM(k)} style={{ flex:1, padding:"5px 0",
                    border:"1px solid", fontSize:9.5, fontWeight:600, borderRadius:4, cursor:"pointer",
                    fontFamily:"inherit", transition:"all .1s",
                    borderColor: pa.mat === k ? "#8B6914" : "#E0DDD8",
                    background: pa.mat === k ? "#F8F0E0" : "#FAFAF8",
                    color: pa.mat === k ? "#8B6914" : "#999" }}>
                    {m.l.replace(" Wood","")}
                  </button>
                ))}
              </div>
              <div style={{ fontSize:8.5, color:"#AAA", lineHeight:1.4, background:"#FDFBF7",
                borderRadius:4, padding:"4px 6px", marginBottom:6 }}>
                <span style={{ fontWeight:600, color:"#888" }}>{cm.l}</span> — {cm.mt}°C min · {cm.fl}× flow · {cm.ds}× swell
              </div>
              <Sl label="Print temp" value={pa.pt} min={cm.mt} max={cm.mt+80} step={5}
                unit="°C" accent="#C44" onValue={h("pt")} info="Nozzle temperature."/>
            </>}
          </div>

          {/* ── Nozzle ── */}
          <div style={sidebarCard}>
            <div onClick={() => toggleSection("nozzle")} style={sectionHead("nozzle")}>
              <span>Nozzle</span>{chevron("nozzle")}
            </div>
            {openSections.nozzle && <>
              <Sl label="Diameter" value={pa.nd} min={.2} max={1} step={.05}
                unit="mm" accent="#5A8F5A" onValue={h("nd")} info="Nominal land bore diameter."/>
              <Sl label="Wall tolerance" value={pa.wt} min={.6} max={1} step={.01}
                unit="" accent="#C44" onValue={h("wt")} info="Usable bore fraction."/>
              <div style={{ display:"flex", gap:4 }}>
                <div style={{ background:"#F8F5F0", borderRadius:4, padding:"3px 7px", flex:1,
                  display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:9, color:"#BBB" }}>Eff</span>
                  <span style={{ fontSize:10.5, fontWeight:700, color: ef < pa.nd*.6 ? "#C44" : "#888",
                    fontVariantNumeric:"tabular-nums" }}>{ef.toFixed(3)}</span>
                </div>
                {lW > .001 && (
                  <div style={{ background:"#FDF5EE", borderRadius:4, padding:"3px 7px", flex:1,
                    display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontSize:9, color:"#D08020" }}>Wear</span>
                    <span style={{ fontSize:10, fontWeight:600, color:"#D08020",
                      fontVariantNumeric:"tabular-nums" }}>+{lW.toFixed(4)}</span>
                  </div>
                )}
              </div>
            </>}
          </div>

          {/* ── Particles ── */}
          <div style={sidebarCard}>
            <div onClick={() => toggleSection("particles")} style={sectionHead("particles")}>
              <span>Wood Particles</span>{chevron("particles")}
            </div>
            {openSections.particles && <>
              <Sl label="Mean size" value={pa.pm} min={.02} max={.2} step={.005}
                unit="mm" accent="#8B6914" onValue={h("pm")} info="Average diameter."/>
              <Sl label="Std dev" value={pa.ps} min={.005} max={.1} step={.005}
                unit="mm" accent="#8B6914" onValue={h("ps")} info="Size spread."/>
              <div style={{ display:"flex", gap:6 }}>
                <div style={{ flex:1 }}>
                  <Sl label="Sieve cutoff" value={pa.mp} min={.05} max={.4} step={.01}
                    unit="mm" accent="#D08020" onValue={h("mp")} info="Max particle size."/>
                </div>
                <div style={{ flex:1 }}>
                  <Sl label="Cluster" value={pa.cc} min={0} max={.1} step={.005}
                    unit="" accent="#A07020" onValue={h("cc")} info="Clump probability."/>
                </div>
              </div>
            </>}
          </div>

          {/* ── Filament ── */}
          <div style={sidebarCard}>
            <div onClick={() => toggleSection("filament")} style={sectionHead("filament")}>
              <span>Filament</span>{chevron("filament")}
            </div>
            {openSections.filament && <>
              <Sl label="Nominal OD" value={pa.fn} min={1.65} max={1.85} step={.01}
                unit="mm" accent="#8855AA" onValue={h("fn")} info="Target diameter."/>
              <div style={{ display:"flex", gap:6 }}>
                <div style={{ flex:1 }}>
                  <Sl label="OD variation" value={pa.fv} min={0} max={.1} step={.005}
                    unit="mm" accent="#8855AA" onValue={h("fv")} info="Diameter variation."/>
                </div>
                <div style={{ flex:1 }}>
                  <Sl label="Var freq" value={pa.ff} min={.001} max={.03} step={.001}
                    unit="" accent="#8855AA" onValue={h("ff")} info="Spatial frequency."/>
                </div>
              </div>
            </>}
          </div>

          {/* ── Environment ── */}
          <div style={sidebarCard}>
            <div onClick={() => toggleSection("environment")} style={sectionHead("environment")}>
              <span>Environment</span>{chevron("environment")}
            </div>
            {openSections.environment && <>
              <div style={{ display:"flex", gap:6 }}>
                <div style={{ flex:1 }}>
                  <Sl label="Ambient" value={pa.amb} min={15} max={60} step={1}
                    unit="°C" accent="#E08040" onValue={hL("amb")}
                    info="Room temperature. Higher = more heat creep."/>
                </div>
                <div style={{ flex:1 }}>
                  <Sl label="Fan" value={pa.fan} min={0} max={100} step={5}
                    unit="%" accent="#3878AA" onValue={hL("fan")}
                    info="Part cooling fan."/>
                </div>
              </div>
              <Sl label="Moisture" value={pa.moist} min={0} max={.15} step={.005}
                unit="%" accent="#5588BB" onValue={hL("moist")}
                info="Wood absorbs moisture. Higher = more steam bubbles."/>
            </>}
          </div>

          {/* ── Retraction ── */}
          <div style={sidebarCard}>
            <div onClick={() => toggleSection("retraction")} style={sectionHead("retraction")}>
              <span>Retraction</span>{chevron("retraction")}
            </div>
            {openSections.retraction && <>
              <div style={{ display:"flex", gap:6 }}>
                <div style={{ flex:1 }}>
                  <Sl label="Distance" value={pa.ret} min={0} max={5} step={.1}
                    unit="mm" accent="#3878AA" onValue={hL("ret")}
                    info="How far to pull filament back."/>
                </div>
                <div style={{ flex:1 }}>
                  <Sl label="Speed" value={pa.retSpd} min={10} max={60} step={5}
                    unit="mm/s" accent="#3878AA" onValue={hL("retSpd")}
                    info="Retraction speed."/>
                </div>
              </div>
              <div style={{ display:"flex", gap:3, marginTop:2 }}>
                {["direct","bowden"].map(dt => (
                  <button key={dt} onClick={() => { PR.current.drive = dt; sPa(p => ({...p, drive:dt})); }}
                    style={{ flex:1, padding:"4px 0", border:"1px solid", fontSize:9.5, fontWeight:600,
                      borderRadius:4, cursor:"pointer", fontFamily:"inherit", transition:"all .1s",
                      borderColor: pa.drive === dt ? "#3878AA" : "#E0DDD8",
                      background: pa.drive === dt ? "#EEF4FA" : "#FAFAF8",
                      color: pa.drive === dt ? "#3878AA" : "#999" }}>
                    {dt === "direct" ? "Direct Drive" : "Bowden"}
                  </button>
                ))}
              </div>
            </>}
          </div>

          {/* ── Simulation ── */}
          <div style={sidebarCard}>
            <div onClick={() => toggleSection("simulation")} style={sectionHead("simulation")}>
              <span>Simulation</span>{chevron("simulation")}
            </div>
            {openSections.simulation && <>
              <div style={{ display:"flex", gap:6 }}>
                <div style={{ flex:1 }}>
                  <Sl label="Flow rate" value={pa.fr} min={1} max={8} step={.5}
                    unit="×" accent="#3377BB" onValue={hL("fr")} info="Speed multiplier."/>
                </div>
                <div style={{ flex:1 }}>
                  <Sl label="Density" value={pa.pd} min={1} max={8} step={1}
                    unit="" accent="#8B6914" onValue={hL("pd")} info="Particles per cycle."/>
                </div>
              </div>
            </>}
          </div>

          {/* ── Status — always visible ── */}
          <div style={{ ...sidebarCard, background:"#FAFAF8", borderBottom:"none" }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#999", letterSpacing:.8,
              textTransform:"uppercase", marginBottom:6 }}>Status</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 8px" }}>
              <Dt on={lG.st} warn label={lG.st ? "STALLED" : `Gears ${(lG.sp*100).toFixed(0)}%`}/>
              <Dt on={lG.gd > .05} warn label={lG.gd > .05 ? `Grind ${(lG.gd*100).toFixed(0)}%` : "No grind"}/>
              <Dt on={lP > .3} warn={lP > 1} label={`P ${lP.toFixed(2)} bar`}/>
              <Dt on={lF > .005} warn={lF > .05} label={`Foul −${lF.toFixed(3)}`}/>
              <Dt on={lH > .3} warn={lH > .6} label={lH > .3 ? `Creep ${(lH*100).toFixed(0)}%` : "Thermal OK"}/>
              <Dt on={lBk > .15} warn={lBk > .5} label={lBk > .15 ? `Buck ${(lBk*100).toFixed(0)}%` : "No buck"}/>
              <Dt on={lMo > .02} warn={lMo > .08} label={lMo > .02 ? `Moist ${(lMo*100).toFixed(1)}%` : "Dry"}/>
              <Dt on={lVH > .02} warn={lVH > .1} label={lVH > .02 ? `V-ht +${(lVH*100).toFixed(1)}%` : "V-ht OK"}/>
              <Dt on={lUE > .2} warn={lUE > .5} label={lUE > .2 ? `U-ext ${(lUE*100).toFixed(0)}%` : "Extr OK"}/>
              <Dt on={lDS > 1.1} warn={lDS > 1.2} label={`Swell ${lDS.toFixed(2)}×`}/>
            </div>
            <div style={{ marginTop:4, fontSize:8.5, color:"#BBB", display:"flex", gap:8 }}>
              <span>Fil <span style={{ color: lD > pa.fn+.02 ? "#C44" : lD < pa.fn-.02 ? "#3878AA" : "#5A8F5A",
                fontWeight:600 }}>{lD.toFixed(3)}</span></span>
              <span>Wear <span style={{ color: lW > .01 ? "#D08020" : "#5A8F5A",
                fontWeight:600 }}>+{lW.toFixed(4)}</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
