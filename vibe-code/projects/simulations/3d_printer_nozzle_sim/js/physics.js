// ══════════════════════════════════════════════════════════════
//                   PHYSICS ENGINE
//   Ported from 2D Canvas to 3D cylindrical coordinates
// ══════════════════════════════════════════════════════════════

class PhysicsEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.particles = [];
    this.bedParticles = [];
    this.bedOffset = 0;
    this.spawnAccum = 0;
    this.stats = { p: 0, c: 0, j: 0, b: 0, g: 0 };
    this.clog = { a: false, ps: [], sv: 0, pr: 0, cn: 0 };
    this.gear = { sp: 1, st: false, gd: 0, stT: 0 };
    this.fouling = 0;
    this.heatCreep = 0;
    this.filamentDia = 1.75;
    this.spring = { c: 0, e: 0 };
    this.tick = 0;
    this.prePopulated = false;
    this.vapor = [];
    this.bubbles = [];
    this.nozzleWear = 0;
    this.retraction = { active: false, t: 0, dist: 0 };
    this.moisture = 0;
    this.viscousHeat = 0;
    this.dieSwell = 1;
    this.underExtrusion = 0;
    this.fan = 0;
    this.buckling = 0;
    this.ooze = 0;
    this.strings = [];
    this.drive = "direct";
    this.beads = [];
    this.drips = [];
    this.chartData = { p: [], c: [], r: [], f: [] };
    this.csvData = [];

    // Copy default params
    this.params = { ...DEFAULT_PARAMS };
  }

  getMat() { return MAT[this.params.mat]; }

  // Bore width at sim-Y position — returns radius in sim-pixels
  boreWidth() { return 1.75 * PX; }
  nozzleWidth() { return (this.params.nd + this.nozzleWear) * PX; }
  effectiveBore() { return Math.max(.01, (this.params.nd + this.nozzleWear) * this.params.wt - this.fouling - this.clog.cn); }
  filamentDiameter(t) { return this.params.fn + n1(t * this.params.ff) * this.params.fv; }
  meltTransitionY() { return GEOM.mT + (GEOM.mB - GEOM.mT) * .1 - this.heatCreep * 30; }

  // Channel radius at sim-Y position (replaces nW which returned {l, r})
  channelRadius(y) {
    const bw = this.boreWidth();
    const nw = this.nozzleWidth();
    if (y < GEOM.nT) return bw / 2;
    if (y >= GEOM.nLS) return nw / 2;
    const t = Math.min(1, (y - GEOM.nT) / (GEOM.nLS - GEOM.nT));
    return (bw + (nw - bw) * Math.pow(t, .55)) / 2;
  }

  // Filament half-width at y position
  filamentHalfWidth(y, t) {
    const d = this.filamentDiameter(t) * PX, hw = d / 2;
    if (y < GEOM.gTE) return hw;
    if (y < GEOM.hT) {
      const bl = (y - GEOM.gTE) / (GEOM.hT - GEOM.gTE);
      return hw * (1 - bl) + Math.min(hw, this.boreWidth() / 2) * bl;
    }
    return Math.min(hw, this.boreWidth() / 2);
  }

  // Poiseuille velocity profile
  poiseuille(rf) { const r = Math.min(1, Math.abs(rf)); return .2 + .8 * (1 - r * r); }

  // Flow acceleration from nozzle constriction
  flowAccel(y) {
    const cr = this.channelRadius(y);
    const bw = this.boreWidth() / 2;
    return cr > 0 ? Math.min(3, bw / cr) : 1;
  }

  // Shear-thinned velocity
  shearThinVel(bv, sr, md) {
    return bv * Math.min(1, Math.max(.4, Math.pow(Math.max(.1, sr), md.st - 1)));
  }

  // Drag coefficient for a particle
  getDrag(pt, m) {
    const pp = this.params;
    const mTY = this.meltTransitionY();
    const d = pt.y - mTY;
    const mr = Math.min(1, Math.max(0, d / 30));
    const tf = 1 + Math.max(0, pp.pt - m.mt) * .015 + this.viscousHeat * .5;
    const fl = m.fl * tf;
    const inN = pt.y > GEOM.nT;
    const np = inN ? Math.min(1, (pt.y - GEOM.nT) / (GEOM.nB - GEOM.nT)) : 0;
    const bd = inN ? (.985 - np * .025) : .99;
    const md = 1 - (1 - bd) / fl;
    const fd = 1 - (1 - md) * mr;

    // Radial fraction (replaces x-based calculation)
    const cr = this.channelRadius(pt.y);
    const rf = cr > 0 ? pt.r / cr : 0;
    const wd = rf > .85 ? 1 - (1 - fd) * (1 + (rf - .85) * 2) : fd;

    const dtw = Math.max(1, cr - pt.r);
    const sr = Math.abs(pt.vy) / (dtw / PX + .01) * 10;
    const moistFactor = 1 + this.moisture * .15;
    return Math.min(.999, Math.max(.7, 1 - (1 - wd) * this.shearThinVel(1, sr, m) * moistFactor));
  }

  // ── Spawn particle ──
  spawnAt(yPos) {
    const pp = this.params;
    let cr = gs(pp.pm, pp.ps);
    cr = Math.max(.01, Math.min(pp.mp, cr));

    // Cylindrical: random radial offset and angle
    const rOffset = Math.random(); // 0..1 normalized radial position
    const theta = Math.random() * Math.PI * 2;

    // Fiber shape for wood particles
    const fiberShape = [];
    const numVerts = 5 + Math.floor(Math.random() * 5);
    const elongation = .6 + Math.random() * .8;
    const fiberAngle = Math.random() * Math.PI;
    for (let i = 0; i < numVerts; i++) {
      const a = (i / numVerts) * Math.PI * 2;
      const rx = .6 + Math.sin(a * 2.3 + Math.random()) * .2 + Math.random() * .15;
      const ry = rx * elongation;
      fiberShape.push({ a, rx, ry });
    }

    this.particles.push({
      // Position in cylindrical coords
      r: rOffset * 0.45 * this.channelRadius(yPos), // radial distance from center
      theta: theta, // angle around axis
      y: yPos, // vertical position (sim-space)
      radius: cr * PX, // particle radius in sim-pixels
      // Velocities
      vr: 0, // radial velocity
      vy: 0, // axial velocity
      vTheta: 0, // angular velocity (minimal)
      // Type and state
      tp: Math.random() < .25 ? "w" : "p",
      sk: false, br: false, pa: false, fr: true, ex: false, ec: false,
      mp: 0, op: 1, sd: Math.random() * 100,
      fo: rOffset, mrp: rOffset, // normalized radial memory
      cl: Math.random() > .3
        ? lC("#6E4E14", "#B08530", Math.random())
        : lC("#B08E6E", "#D0B898", Math.random()),
      clDark: lC("#4A3008", "#7A5A20", Math.random()),
      ro: 0, av: 0, dt: 0, cb: 0,
      moist: Math.random() < pp.moist * 15,
      swollen: false,
      fiberShape, fiberAngle,
      stretch: 1,
      prevVy: 0,
      // Variant index for instanced geometry
      shapeVariant: Math.floor(Math.random() * 15)
    });
  }

  spawnTop() {
    const pp = this.params;
    const isC = Math.random() < pp.cc;
    const n = isC ? Math.floor(2 + Math.random() * 3) : 1;
    for (let i = 0; i < n; i++) {
      this.spawnAt(GEOM.fTY + gs(pp.pm, pp.ps) * PX + Math.random() * 6);
    }
  }

  prePopulate() {
    const pp = this.params;
    const mTY = this.meltTransitionY();
    const solidLength = mTY - GEOM.fTY;
    const count = Math.floor((solidLength / 3) * pp.pd * 0.5);
    for (let i = 0; i < count; i++) {
      this.spawnAt(GEOM.fTY + Math.random() * solidLength);
    }
  }

  spawnVapor(x3d, y3d, z3d, type) {
    this.vapor.push({
      x: x3d, y: y3d, z: z3d,
      vx: (Math.random() - .5) * .01, vy: (Math.random() * .4 + .2) * WS,
      vz: (Math.random() - .5) * .01,
      life: 1, decay: .006 + Math.random() * .005,
      r: (type === "steam" ? 2.5 + Math.random() * 3 : 2 + Math.random() * 3) * WS,
      type, grow: 1 + Math.random() * .025,
      turbulence: Math.random() * Math.PI * 2
    });
  }

  spawnBubble(simR, simY, simTheta) {
    this.bubbles.push({
      r: simR, y: simY, theta: simTheta,
      radius: (.8 + Math.random() * 2.5) * WS,
      vy: -(Math.random() * .8 + .3),
      vr: (Math.random() - .5) * .4,
      life: 1, wobble: Math.random() * Math.PI * 2,
      highlight: .3 + Math.random() * .4
    });
  }

  spawnString(simY) {
    this.strings.push({
      theta: Math.random() * Math.PI * 2,
      r: Math.random() * this.nozzleWidth() * 0.3,
      y: simY, len: 3 + Math.random() * 8, life: 1,
      sway: Math.random() * Math.PI * 2,
      thickness: .2 + Math.random() * .4
    });
  }

  // ══════════════════════════════════════════════════════════
  //          UPDATE GEARS
  // ══════════════════════════════════════════════════════════
  updateGears() {
    const pp = this.params, g = this.gear, cl = this.clog;
    const fd = this.filamentDia;
    const ex = Math.max(0, fd - pp.fn - .02);
    const tot = Math.min(1, ex / .08 + (cl.a ? cl.sv * 1.5 : 0) + this.spring.c * .3);
    const driveFactor = this.drive === "bowden" ? .7 : 1;
    g.sp = Math.max(0, 1 - tot * 1.2 * driveFactor);
    g.st = g.sp < .05;

    if (g.st) {
      g.stT++;
      if (g.stT > 60 && g.gd < 1) {
        g.gd += .002;
        if (g.gd > .3 && Math.random() < .01) this.stats.g++;
      }
      cl.pr = Math.min(2, cl.pr + .005);
    } else {
      g.stT = 0;
      cl.pr = Math.max(0, cl.pr - .01);
      if (g.gd > 0) g.gd = Math.max(0, g.gd - .0002);
    }
    if (tot > .5 && !g.st) this.stats.j++;

    const buckPressure = this.spring.c * (this.drive === "bowden" ? 1.5 : .8);
    this.buckling = clamp(this.buckling + (buckPressure > .7 && g.st ? .003 : -.005), 0, 1);
  }

  // ══════════════════════════════════════════════════════════
  //          UPDATE PARTICLE (cylindrical coords)
  // ══════════════════════════════════════════════════════════
  updateParticle(pt) {
    if (pt.sk) return;
    const g = this.gear, cl = this.clog, m = this.getMat(), pp = this.params;
    const mTY = this.meltTransitionY();
    const cx = GEOM.cx;

    // ── Frozen in solid filament ──
    if (pt.fr) {
      const retPull = this.retraction.active ? -.5 : 0;
      const fs = g.st ? 0 : .35 * g.sp * pp.fr * .3;
      pt.vy = fs + retPull;
      pt.vr = 0;
      // Keep radial position proportional to filament width
      const t = this.tick - (mTY - pt.y) * 2;
      const hw = this.filamentHalfWidth(pt.y, t);
      pt.r = pt.fo * hw * .95;
      pt.y += pt.vy;
      if (pt.y - pt.radius < GEOM.fTY) pt.y = GEOM.fTY + pt.radius;

      const meltZoneStart = mTY - 12;
      if (pt.y >= meltZoneStart) {
        const meltProgress = clamp((pt.y - meltZoneStart) / 12, 0, 1);
        const tempBoost = 1 + Math.max(0, pp.pt - m.mt) * .01;
        if (meltProgress * tempBoost > .6 || (meltProgress > .2 && Math.random() < meltProgress * .15 * tempBoost)) {
          pt.fr = false; pt.vy = fs + .05; pt.vr = 0;
          const cr = this.channelRadius(pt.y);
          pt.mrp = cr > 0 ? pt.r / cr : 0;
          if (pt.moist && this.moisture > .01) {
            this.spawnBubble(pt.r, pt.y, pt.theta);
            if (Math.random() < .3) {
              const wx = pt.r * Math.cos(pt.theta) * WS;
              const wz = pt.r * Math.sin(pt.theta) * WS;
              this.spawnVapor(wx, simToWorld(pt.y) + 5 * WS, wz, "steam");
            }
          }
        }
      }
      return;
    }

    // ── Exited nozzle ──
    if (pt.ex) {
      pt.vy += .04;
      if (!pt.swollen && this.dieSwell > 1.02) {
        pt.radius *= lerp(1, this.dieSwell, .3);
        pt.vr += pt.r * .01 * (this.dieSwell - 1);
        pt.swollen = true;
      }
      if (!pt.pa) pt.vr -= GEOM.bSp * .06;
      pt.r += pt.vr;
      pt.y += pt.vy;
      pt.stretch = clamp(1 + Math.abs(pt.vy) * .3, 1, 2);

      if (pt.y + pt.radius >= GEOM.bY) {
        if (!pt.pa) { pt.pa = true; this.stats.p++; }
        this.bedParticles.push({
          wx: this.bedOffset + pt.r * Math.cos(pt.theta),
          y: GEOM.bY - pt.radius * .5,
          r: pt.radius, cl: pt.cl, cb: pt.cb
        });
        this.beads.push({
          wx: this.bedOffset + pt.r * Math.cos(pt.theta),
          w: pt.radius * 2 * this.dieSwell,
          cb: pt.cb
        });
        pt.y = GEOM.H + 100;
      }
      return;
    }

    if (pt.y - pt.radius < mTY) { pt.y = mTY + pt.radius; pt.vy = Math.max(pt.vy, 0); }

    const dr = this.getDrag(pt, m);
    const cr = this.channelRadius(pt.y);
    const rf = cr > 0 ? pt.r / cr : 0;
    const pb = this.poiseuille(rf);
    const ac = this.flowAccel(pt.y);

    const sf = this.spring.c * .015;
    pt.vy += (.015 + (g.sp * .012) + (cl.pr > .3 ? cl.pr * .008 : 0) + sf) * pb * ac;

    if (this.retraction.active && pt.y > mTY) {
      const retForce = .08 * pp.retSpd / 25;
      const nozzleAtten = pt.y > GEOM.nT ? Math.max(.3, 1 - (pt.y - GEOM.nT) / (GEOM.nB - GEOM.nT) * .7) : 1;
      pt.vy -= retForce * nozzleAtten;
    }

    pt.vr *= dr; pt.vy *= dr;

    const inN = pt.y > GEOM.nT;
    const mV = inN
      ? (1.6 - Math.min(1, (pt.y - GEOM.nT) / (GEOM.nB - GEOM.nT)) * .2) * m.fl
      : 1.8 * m.fl;
    pt.vy = Math.min(pt.vy, mV + (cl.pr > .5 ? cl.pr * .3 : 0));

    // Centering force (radial)
    pt.vr += (pt.mrp * cr * .45 - pt.r) * .001;

    // Velocity-dependent stretch
    pt.stretch = clamp(1 + Math.abs(pt.vy) * .15, 1, 1.8);

    // Melt progress
    if (pt.y > GEOM.mT && pt.y < GEOM.mB) {
      pt.mp = Math.min(1, pt.mp + .008);
      const tf = 1 + Math.max(0, pp.pt - m.mt) * .02;
      pt.radius *= pt.tp === "p"
        ? (1 - .0015 * pt.mp * tf)
        : (1 - .0003 * pt.mp);
    }

    // Carbonization for wood particles
    if (pt.tp === "w" && pt.y > GEOM.mT) {
      pt.dt++;
      const tempFactor = 1 + Math.max(0, pp.pt - m.mt) * .01;
      pt.cb = Math.min(1, pt.cb + .00005 * m.cr * tempFactor);
      if (pt.cb > .3) pt.radius *= (1 - .0001 * pt.cb);
      if (pt.cb > .4 && Math.random() < .003 * pt.cb) {
        const wx = pt.r * Math.cos(pt.theta) * WS;
        const wz = pt.r * Math.sin(pt.theta) * WS;
        this.spawnVapor(wx, simToWorld(pt.y) + 3 * WS, wz, "smoke");
      }
    }

    // Angular velocity from wall interaction
    if (rf > .85) {
      const wc = Math.min(1, (rf - .85) / .15);
      pt.av += (pt.vy * .02 - pt.av) * .1 * wc;
    }
    pt.ro += pt.av; pt.av *= .98;

    // Wall collision (radial)
    if (pt.y < GEOM.nB + 3) {
      if (pt.r + pt.radius > cr) {
        pt.r = cr - pt.radius;
        pt.vr = -Math.abs(pt.vr) * .15;
      }
      if (pt.r < 0) { pt.r = 0; pt.vr = Math.abs(pt.vr) * .15; }
    }

    // ── Clog / bridge check ──
    if (!pt.ec && pt.y + pt.radius > GEOM.nLS + 2) {
      pt.ec = true;
      const ef = this.effectiveBore(), pD = (pt.radius * 2) / PX;
      if (pD > ef) {
        pt.sk = true; cl.a = true;
        cl.sv = Math.min(1, cl.sv + .3);
        cl.ps.push(pt); this.stats.c++;
        cl.cn = Math.min(.15, cl.cn + pD * .3);
        this.nozzleWear += .0001 * m.wr;
        return;
      }

      const eW = this.channelRadius(GEOM.nLS) * 2;
      const nb_ = this.particles.filter(o => o !== pt && !o.sk && !o.pa && !o.fr && !o.ex
        && o.y > GEOM.nT && Math.abs(o.y - pt.y) < (pt.radius + o.radius) * 1.8
        && this.particleDist2D(pt, o) < eW);

      for (const o of nb_) {
        const cm = (pt.radius + o.radius) / PX;
        const fr = cm / ef;
        const bm = (1 / m.fl) * (1 / (1 + Math.max(0, pp.pt - m.mt) * .01))
          * Math.max(.3, 1 - Math.abs(pt.av + o.av) * 2);
        if (fr > 1 || (fr > .82 && Math.random() < (fr - .82) * 2.5 * bm)) {
          pt.sk = true; o.sk = true; pt.br = true; o.br = true; o.ec = true;
          cl.a = true; cl.sv = Math.min(1, cl.sv + .5);
          this.stats.b++; this.stats.c += 2;
          cl.cn = Math.min(.15, cl.cn + cm * .2);
          this.nozzleWear += .00005 * m.wr;
          return;
        }
      }

      if (nb_.length >= 2) {
        for (let i = 0; i < nb_.length - 1; i++) {
          for (let j = i + 1; j < nb_.length; j++) {
            const o1 = nb_[i], o2 = nb_[j];
            const tm = (pt.radius + o1.radius + o2.radius) / PX;
            if (tm / ef > 1.1 && Math.random() < .15 / m.fl) {
              pt.sk = true; o1.sk = true; o2.sk = true;
              pt.br = true; o1.br = true; o2.br = true;
              o1.ec = true; o2.ec = true;
              cl.a = true; cl.sv = Math.min(1, cl.sv + .6);
              this.stats.b++; this.stats.c += 3;
              cl.cn = Math.min(.15, cl.cn + tm * .15);
              return;
            }
          }
        }
      }
    }

    if (pt.y > GEOM.nB + 1) { pt.ex = true; return; }

    // ── Particle-particle collisions (3D distance) ──
    for (const o of this.particles) {
      if (o === pt || o.pa || o.fr || o.ex) continue;
      const dist = this.particleDist3D(pt, o);
      const m2 = pt.radius + o.radius;
      if (dist < m2 && dist > 0) {
        // Push apart along radial+axial
        const dy = o.y - pt.y;
        const dr = o.r - pt.r;
        const d = Math.sqrt(dy * dy + dr * dr) || 1;
        const nx = dr / d, ny = dy / d;
        const ov = m2 - dist;
        pt.r -= nx * ov * .35; pt.y -= ny * ov * .35;
        if (!o.sk) { o.r += nx * ov * .35; o.y += ny * ov * .35; }
        pt.vr -= nx * .05; pt.vy -= ny * .03;
        pt.av += (pt.vr * (-ny) + pt.vy * (-nx)) * .01;
      }
    }

    if (cl.a && pt.y > GEOM.nT && pt.y < GEOM.nB + 3) {
      pt.vy *= .85;
      if (pt.y > GEOM.nLS - 5) pt.vy -= .02 * cl.sv;
    }

    if (pt.y - pt.radius < mTY) { pt.y = mTY + pt.radius; pt.vy = Math.max(pt.vy, 0); }

    pt.r += pt.vr; pt.y += pt.vy;
    // Slow theta drift for visual interest
    pt.theta += pt.vTheta;

    if (inN && pt.tp === "w" && Math.abs(pt.vy) > .5) {
      this.nozzleWear += .0000002 * m.wr * Math.abs(pt.vy);
    }
  }

  // Distance between two particles projected to 2D cross-section
  particleDist2D(a, b) {
    const ax = a.r * Math.cos(a.theta), az = a.r * Math.sin(a.theta);
    const bx = b.r * Math.cos(b.theta), bz = b.r * Math.sin(b.theta);
    const dx = bx - ax, dz = bz - az;
    return Math.sqrt(dx * dx + dz * dz + (b.y - a.y) * (b.y - a.y));
  }

  // Full 3D distance
  particleDist3D(a, b) {
    const ax = a.r * Math.cos(a.theta), az = a.r * Math.sin(a.theta);
    const bx = b.r * Math.cos(b.theta), bz = b.r * Math.sin(b.theta);
    const dx = bx - ax, dy = b.y - a.y, dz = bz - az;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ══════════════════════════════════════════════════════════
  //                    MAIN TICK
  // ══════════════════════════════════════════════════════════
  step() {
    const pp = this.params, g = this.gear, cl = this.clog, m = this.getMat();
    this.tick++;

    if (!this.prePopulated) { this.prePopulated = true; this.prePopulate(); }

    // Retraction
    const ret = this.retraction;
    if (ret.active) {
      ret.t++;
      const retDuration = (pp.ret / pp.retSpd) * 60;
      if (ret.t > retDuration) {
        ret.active = false; ret.t = 0;
        this.ooze = clamp(this.ooze + .3 * m.fl, 0, 1);
        if (Math.random() < m.fl * .3 + this.moisture) {
          this.spawnString(GEOM.nB);
        }
      }
    }

    // Moisture
    this.moisture = pp.moist * m.mst;
    if (this.moisture > .01 && Math.random() < this.moisture * .15) {
      const bTheta = Math.random() * Math.PI * 2;
      const bR = Math.random() * this.boreWidth() * .3;
      const bY = this.meltTransitionY() + Math.random() * (GEOM.nT - this.meltTransitionY());
      this.spawnBubble(bR, bY, bTheta);
    }

    // Spawn particles
    const sr = pp.pd * pp.fr * Math.max(.1, g.sp) * .12;
    this.spawnAccum += sr;
    const mx = 250 + pp.pd * 80;
    while (this.spawnAccum >= 1 && this.particles.length < mx) { this.spawnAccum -= 1; this.spawnTop(); }

    // Bed movement
    this.bedOffset += GEOM.bSp;

    this.updateGears();

    // Heat creep
    const ambFactor = 1 + Math.max(0, (pp.amb - 25)) * .02;
    const tempExcess = Math.max(0, pp.pt - m.mt) / 80;
    const baseCreep = tempExcess * .0002 * ambFactor;
    const stallCreep = (g.st || cl.a) ? .001 * m.hc * ambFactor : 0;
    const fanCooling = this.fan > 0 ? (1 + this.fan * 2) : 1;
    this.heatCreep = clamp(this.heatCreep + baseCreep + stallCreep - .003 / fanCooling, 0, 1);

    this.fan = pp.fan / 100;
    this.drive = pp.drive;

    // Spring / pressure
    const sp = this.spring;
    const bowdenExtra = this.drive === "bowden" ? 1.3 : 1;
    if (cl.a || g.st) {
      sp.c = Math.min(1.5, sp.c + g.sp * .003 * bowdenExtra);
      sp.e = sp.c * sp.c * .5;
    } else {
      sp.c = Math.max(0, sp.c - .01);
      sp.e = sp.c * sp.c * .5;
    }
    if (sp.c > 1 && cl.a && Math.random() < .005 * sp.e) {
      cl.a = false; cl.sv *= .2;
      cl.ps.forEach(x => { x.sk = false; x.ex = true; x.vy = .5 + sp.e * .3; x.pa = true; this.stats.p++; });
      cl.ps = []; cl.pr *= .2; cl.cn *= .3; sp.c *= .3;
    }

    // Fouling
    const sw = this.particles.filter(x => x.sk && x.tp === "w" && x.y > GEOM.nT);
    if (sw.length > 0) {
      const ac = sw.reduce((s, x) => s + x.cb, 0) / sw.length;
      this.fouling = Math.min(.15, this.fouling + .00002 * m.cr * (1 + ac));
    }
    this.fouling = Math.max(0, this.fouling - .000005);
    if (!cl.a) cl.cn = Math.max(0, cl.cn - .0002);

    // Pressure pop
    if (cl.a) {
      cl.sv *= .9995;
      if (cl.pr > 1.5 && Math.random() < .003) {
        cl.a = false; cl.sv *= .3;
        cl.ps.forEach(x => { x.sk = false; x.ex = true; x.vy = 1; x.pa = true; this.stats.p++; });
        cl.ps = []; cl.pr *= .3; cl.cn *= .3;
      }
    }

    // Viscous heating
    const avgSpeed = this.particles.filter(x => !x.fr && !x.ex && !x.sk && x.y > GEOM.nT)
      .reduce((s, x) => s + Math.abs(x.vy), 0) / (this.particles.length + 1);
    this.viscousHeat = clamp(this.viscousHeat + (avgSpeed * m.vh * .001 - .0005), 0, .3);

    // Die swell
    this.dieSwell = lerp(this.dieSwell, m.ds * (1 + this.viscousHeat * .5), .01);

    // Under-extrusion
    const flowRate = this.particles.filter(x => x.ex && !x.pa).length;
    const expectedFlow = pp.pd * pp.fr * .1;
    this.underExtrusion = clamp(lerp(this.underExtrusion, clamp(1 - flowRate / (expectedFlow + .01), 0, 1), .02), 0, 1);

    // Nozzle wear
    this.nozzleWear += .0000005 * m.wr * pp.fr;

    // Update all particles
    for (const pt of this.particles) this.updateParticle(pt);
    // Carbonize stuck wood particles
    for (const x of this.particles) {
      if (x.sk && x.tp === "w" && x.y > GEOM.mT) {
        x.dt++; x.cb = Math.min(1, x.cb + .0001 * m.cr);
      }
    }

    // Update vapor
    for (const v of this.vapor) {
      v.turbulence += .08;
      v.x += v.vx + Math.sin(v.turbulence) * .003;
      v.y += v.vy;
      v.z += v.vz + Math.cos(v.turbulence) * .003;
      v.r *= v.grow;
      v.life -= v.decay;
      v.vx += (Math.random() - .5) * .002;
      v.vz += (Math.random() - .5) * .002;
      v.vy *= .995;
    }
    this.vapor = this.vapor.filter(v => v.life > 0);

    // Update bubbles
    for (const b of this.bubbles) {
      b.r += b.vr; b.y += b.vy;
      b.life -= .015;
      b.radius *= 1.005;
      b.wobble += .1;
      if (b.y < this.meltTransitionY() + 5) {
        b.life = 0;
        const wx = b.r * Math.cos(b.theta) * WS;
        const wz = b.r * Math.sin(b.theta) * WS;
        this.spawnVapor(wx, simToWorld(b.y), wz, "steam");
      }
    }
    this.bubbles = this.bubbles.filter(b => b.life > 0);

    // Update strings
    for (const s of this.strings) { s.life -= .008; s.len += .05; }
    this.strings = this.strings.filter(s => s.life > 0);

    this.ooze = Math.max(0, this.ooze - .002);

    // Cleanup
    this.particles = this.particles.filter(x => x.y < GEOM.H + 10 && x.y > GEOM.fTY - 15);
    const vM = this.bedOffset - GEOM.W;
    this.bedParticles = this.bedParticles.filter(d => d.wx > vM);
    this.beads = this.beads.filter(d => d.wx > vM);

    // Filament diameter
    this.filamentDia = this.filamentDiameter(this.tick);

    // Chart sampling
    if (this.tick % 60 === 0) {
      const s = this.stats;
      this.csvData.push({ t: this.tick, p: s.p, c: s.c, b: s.b, j: s.j, f: this.fouling, w: this.nozzleWear });
      const cd = this.chartData;
      const cr = s.p + s.c > 0 ? Math.round((s.c / (s.p + s.c)) * 1000) / 10 : 0;
      cd.p.push(s.p); cd.c.push(s.c); cd.r.push(cr);
      cd.f.push(Math.round(this.fouling * 10000) / 10);
      if (cd.p.length > 80) { cd.p.shift(); cd.c.shift(); cd.r.shift(); cd.f.shift(); }
    }
  }

  // Get particle 3D world position
  getParticleWorldPos(pt) {
    const x = pt.r * Math.cos(pt.theta) * WS;
    const z = pt.r * Math.sin(pt.theta) * WS;
    const y = simToWorld(pt.y);
    return { x, y, z };
  }
}
