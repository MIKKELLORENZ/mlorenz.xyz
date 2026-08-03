/* machine.js — the fixed hardware: vessel, coils, passive structure, sensors.
 *
 * Nothing in here moves. Coils sit where they sit, the vessel wall is welded
 * in place, the magnetic probes are bolted to it. So everything that depends
 * only on that geometry — mutual inductances, and the field each circuit
 * produces anywhere in the plasma region — can be computed ONCE and shared by
 * every plasma in the population. That is the single most important
 * performance decision in this simulator: a generation of 24 tokamaks costs 24
 * plasmas, not 24 machines.
 *
 * Layout is TCV-flavoured but not TCV: a tall, narrow vessel with two columns
 * of shaping coils, an ohmic transformer, and one fast in-vessel coil.
 *
 *      Z
 *    +0.75 ┌───────────────┐        E = inner shaping column (8)
 *          │ E           F │        F = outer shaping column (8)
 *    OH1 ▌ │ E     ▓     F │        ▓ = plasma
 *      ▌   │ E    ▓▓▓    F │        G = fast in-vessel pair (1 circuit)
 *      ▌   │ E  G  ▓  G  F │        ○ = passive vessel loops, all round the wall
 *    -0.75 └───────────────┘
 *        0.3   0.62   1.14  R (m)
 */
"use strict";

/* ------------------------------------------------------------------ vessel */
const VESSEL = {
    Rin: 0.624, Rout: 1.136,     // inner / outer wall radius
    Ztop: 0.75, Zbot: -0.75,     // half-height ±0.75 m
    corner: 0.10,                // corner rounding
    R0: 0.88                     // nominal major radius (geometric centre)
};

/* Signed distance from (R, Z) to the wall, positive INSIDE the vessel.
 * Used for the limiter contact test and by the renderer. */
function wallClearance(R, Z) {
    const cx = 0.5 * (VESSEL.Rin + VESSEL.Rout);
    const hx = 0.5 * (VESSEL.Rout - VESSEL.Rin) - VESSEL.corner;
    const hz = VESSEL.Ztop - VESSEL.corner;
    const qx = Math.abs(R - cx) - hx;
    const qz = Math.abs(Z) - hz;
    const ax = Math.max(qx, 0), az = Math.max(qz, 0);
    const d = Math.hypot(ax, az) + Math.min(Math.max(qx, qz), 0) - VESSEL.corner;
    return -d;
}

/* The wall contour as a closed polyline, plus unit tangent and outward normal
 * at each vertex. Everything mounted on the wall — passive loops, flux loops,
 * field probes — is placed by walking this at constant arc length, which is
 * roughly how a real machine is instrumented. */
function buildWallContour(samples) {
    const pts = [];
    const cr = VESSEL.corner;
    const x0 = VESSEL.Rin + cr, x1 = VESSEL.Rout - cr;
    const z0 = VESSEL.Zbot + cr, z1 = VESSEL.Ztop - cr;
    const arc = (cxx, czz, a0, a1) => {
        const n = 10;
        for (let i = 0; i <= n; i++) {
            const a = a0 + (a1 - a0) * (i / n);
            pts.push([cxx + cr * Math.cos(a), czz + cr * Math.sin(a)]);
        }
    };
    // counter-clockwise in (R, Z), starting at the outboard midplane
    pts.push([VESSEL.Rout, 0]);
    arc(x1, z1, 0, Math.PI / 2);
    pts.push([x0, VESSEL.Ztop]);
    arc(x0, z1, Math.PI / 2, Math.PI);
    pts.push([VESSEL.Rin, z0]);
    arc(x0, z0, Math.PI, 1.5 * Math.PI);
    pts.push([x1, VESSEL.Zbot]);
    arc(x1, z0, 1.5 * Math.PI, 2 * Math.PI);

    // Close the loop explicitly before measuring arc length. Leaving the final
    // segment out is how the first version put three of sixteen vessel loops on
    // top of each other, which makes the inductance matrix exactly singular —
    // two identical rings are one ring described twice.
    pts.push(pts[0].slice());
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = cum[cum.length - 1];
    const out = [];
    for (let s = 0; s < samples; s++) {
        const target = (s / samples) * total;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < target) i++;
        const a = pts[i - 1], b = pts[i];
        const seg = Math.max(1e-9, cum[i] - cum[i - 1]);
        const t = Math.min(1, Math.max(0, (target - cum[i - 1]) / seg));
        const R = a[0] + (b[0] - a[0]) * t, Z = a[1] + (b[1] - a[1]) * t;
        // tangent along the contour; outward normal is the tangent rotated -90°
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
        out.push({ R, Z, tR: tx, tZ: tz, nR: tz, nZ: -tx });
    }
    return out;
}

/* -------------------------------------------------------------- circuits */
/* A "circuit" is one power-supply channel. It may be several physical turns
 * bundles at different places — the ohmic transformer is a stack, and the fast
 * vertical coil is an ANTI-SERIES PAIR (equal and opposite currents above and
 * below the midplane), which is the only way to make a coil that produces a
 * radial field at the plasma and therefore a pure vertical force.
 *
 * `tau` is the intended open-circuit L/R time constant; the resistance is
 * derived from the self-inductance we actually compute, so the two can never
 * drift apart. */
const ZROWS = [0.70, 0.51, 0.30, 0.09, -0.09, -0.30, -0.51, -0.70];

function buildCircuits() {
    const c = [];
    // 0-7 : outer shaping column (F). Gross shape, radial position, elongation.
    ZROWS.forEach((z, i) => c.push({
        name: "F" + (i + 1), kind: "shape", rc: 0.040, tau: 0.040,
        vmax: 1400, imax: 10000,
        el: [{ R: 1.30, Z: z, turns: 36 }]
    }));
    // 8-15 : inner shaping column (E). Fine shaping, X-point, divertor legs.
    ZROWS.forEach((z, i) => c.push({
        name: "E" + (i + 1), kind: "shape", rc: 0.035, tau: 0.025,
        vmax: 1400, imax: 10000,
        el: [{ R: 0.52, Z: z, turns: 30 }]
    }));
    // 16 : ohmic primary — the central solenoid stack. Drives I_p by transformer
    //      action, and it is a genuine engineering squeeze: turns buy volt-seconds
    //      of flux swing (M ∝ N) but cost ramp rate, because the loop voltage a
    //      1.4 kV supply can produce is V·M/L ∝ 1/N. 180 turns is the compromise
    //      that gets ~0.35 Wb of swing AND ~3×10⁵ A/s of current ramp.
    //      Its L/R is 0.4 s, not the ~100 ms of the shaping coils: a solenoid
    //      this size with a 100 ms time constant would need several kilovolts
    //      just to sit still at its operating current.
    c.push({
        name: "OH1", kind: "ohmic", rc: 0.045, tau: 0.400, vmax: 1400, imax: 12000,
        el: [
            { R: 0.30, Z: 0.52, turns: 45 }, { R: 0.30, Z: 0.17, turns: 45 },
            { R: 0.30, Z: -0.17, turns: 45 }, { R: 0.30, Z: -0.52, turns: 45 }
        ]
    });
    // 17 : ohmic return pair. Its current *difference* from OH1 is what leaves a
    //      stray radial field behind, which is why the observation vector gives
    //      I(OH1) − I(OH2) its own neuron.
    c.push({
        name: "OH2", kind: "ohmic", rc: 0.040, tau: 0.300, vmax: 1400, imax: 12000,
        el: [{ R: 1.45, Z: 0.62, turns: 30 }, { R: 1.45, Z: -0.62, turns: 30 }]
    });
    // 18 : fast in-vessel vertical stability coil (G). Anti-series pair — equal
    //      and opposite currents above and below the midplane — which is the only
    //      winding that produces a RADIAL field at the plasma and therefore a
    //      pure vertical force. Few turns, low current, ~50× the bandwidth of
    //      everything above. This is the actuator the instability is fought with,
    //      and it is the only one fast enough to matter.
    //
    //      Two turns, not three, and 0.5 ms rather than 0.3. This coil is limited
    //      by BOTH its 100 V supply and its 1 kA rating, and the force it can
    //      produce is maximised where those two limits meet: force per amp scales
    //      with N while the current a 100 V supply can push scales with 1/N², so
    //      adding turns makes the coil weaker, not stronger. At three turns and
    //      0.3 ms it saturated at 305 A — 570 N, enough to hold about 3 cm of
    //      displacement, and every episode ended in a VDE the moment the plasma
    //      got further out than that.
    c.push({
        name: "G", kind: "fast", rc: 0.015, tau: 0.0005, vmax: 100, imax: 1000,
        el: [{ R: 1.05, Z: 0.42, turns: 2 }, { R: 1.05, Z: -0.42, turns: -2 }]
    });
    return c;
}

const N_VESSEL = 16;    // passive wall segments

/* Extra series inductance on every passive loop, as a multiple of the ideal
 * ring value.
 *
 * THIS IS THE MOST IMPORTANT FUDGE IN THE SIMULATOR AND IT DESERVES ITS OWN
 * PARAGRAPH. A set of perfect, closed, coaxial rings hugging the plasma is an
 * extraordinarily good vertical stabiliser: it holds the rigid vertical mode
 * with roughly sixty times the stiffness of the instability driving it, which
 * pushes the growth time out to ~370 ms. Real vessels do not manage anything
 * like that. Two reasons, and this constant stands in for both:
 *
 *   - a real vessel is not a set of perfect rings. It has ports, bellows,
 *     welds and poloidal breaks, and the toroidal eddy-current path is long,
 *     tortuous and much more inductive than the ideal ring it replaces;
 *   - more fundamentally, the real unstable mode is NOT a rigid vertical shift.
 *     The plasma deforms as it goes, and a conducting wall couples far more
 *     weakly to the deforming mode than to the rigid one. Rigid-displacement
 *     filament models are known to over-estimate wall stabilisation for exactly
 *     this reason, and this simulator is a rigid-displacement filament model.
 *
 * Scaling the vessel-vessel block of the inductance matrix (and its resistance
 * with it, so the 6 ms L/R is preserved) is the cheapest way to buy back a
 * realistic stability margin. It is energy-consistent — the matrix stays
 * symmetric and positive definite — but it is a fit, not a derivation. Set it
 * to 1 and watch the elongated plasma become almost stable; that is the
 * experiment that shows you how much of the drama here rests on this number. */
const VESSEL_L_BOOST = 1;
const N_FLUX = 34;      // flux loops
const N_PROBE = 38;     // poloidal field probes

/* Field-table grid over the plasma region. Bilinear interpolation off these
 * tables replaces ~10^5 elliptic-integral evaluations per simulated
 * millisecond with a handful of multiply-adds.
 *
 * ASSUMPTION: the field varies smoothly on the scale of a grid cell (~1.1 cm
 * radially, 2.1 cm vertically). That fails within a couple of centimetres of a
 * conductor, which is why the plasma is never allowed to get that close to the
 * wall — it has disrupted long before. */
const GRID = { r0: 0.55, r1: 1.22, z0: -0.86, z1: 0.86, nr: 60, nz: 82 };
GRID.dr = (GRID.r1 - GRID.r0) / (GRID.nr - 1);
GRID.dz = (GRID.z1 - GRID.z0) / (GRID.nz - 1);

/* Gauss-Jordan inverse with partial pivoting. n ≤ 40 here, so the O(n³) is a
 * one-off few-hundred-microsecond cost at construction. */
function invert(A, n) {
    const a = new Float64Array(A);
    const inv = new Float64Array(n * n);
    for (let i = 0; i < n; i++) inv[i * n + i] = 1;
    for (let col = 0; col < n; col++) {
        let piv = col, best = Math.abs(a[col * n + col]);
        for (let r = col + 1; r < n; r++) {
            const v = Math.abs(a[r * n + col]);
            if (v > best) { best = v; piv = r; }
        }
        if (best < 1e-18) throw new Error("inductance matrix is singular at row " + col);
        if (piv !== col) {
            for (let k = 0; k < n; k++) {
                let t = a[col * n + k]; a[col * n + k] = a[piv * n + k]; a[piv * n + k] = t;
                t = inv[col * n + k]; inv[col * n + k] = inv[piv * n + k]; inv[piv * n + k] = t;
            }
        }
        const d = a[col * n + col];
        for (let k = 0; k < n; k++) { a[col * n + k] /= d; inv[col * n + k] /= d; }
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = a[r * n + col];
            if (f === 0) continue;
            for (let k = 0; k < n; k++) {
                a[r * n + k] -= f * a[col * n + k];
                inv[r * n + k] -= f * inv[col * n + k];
            }
        }
    }
    return inv;
}

class Machine {
    constructor() {
        const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

        this.vessel = VESSEL;
        this.circuits = buildCircuits();
        this.nc = this.circuits.length;                       // 19

        // ---- passive structure: a ring of shorted loops on the wall ----------
        // ASSUMPTION: the conducting vessel is a set of independent axisymmetric
        // rings rather than a continuous shell. Sixteen rings reproduce the
        // gross eddy-current response (and hence the vertical growth rate) but
        // cannot carry the poloidal current pattern a real shell does.
        const wall = buildWallContour(N_VESSEL);
        this.vloops = wall.map(p => ({ R: p.R, Z: p.Z, rc: 0.020, turns: 1 }));
        this.nv = this.vloops.length;
        this.n = this.nc + this.nv;

        // ---- sensors --------------------------------------------------------
        // Flux loops sit just outside the wall (they are wound round the vessel);
        // field probes sit just inside it, and measure the POLOIDAL field
        // component tangential to the wall, which is what a real Mirnov-style
        // probe reads.
        const fl = buildWallContour(N_FLUX);
        this.fluxLoops = fl.map(p => ({ R: p.R + p.nR * 0.020, Z: p.Z + p.nZ * 0.020 }));
        const pb = buildWallContour(N_PROBE);
        this.probes = pb.map((p, i) => ({
            R: p.R - p.nR * 0.015, Z: p.Z - p.nZ * 0.015,
            tR: p.tR, tZ: p.tZ, idx: i
        }));

        this._buildInductance();
        this._buildFieldTables();
        this._buildSensorTables();

        this.buildMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    }

    /* --------------------------------------------------------------- circuits */
    /* Cached, because the self-inductance branch below compares element identity
     * — handing back a freshly built object each call quietly turns every
     * diagonal entry into a mutual-at-zero-separation instead. */
    _elements(j) {
        if (!this._els) {
            this._els = [];
            for (let i = 0; i < this.nc; i++) this._els.push(this.circuits[i].el);
            for (const v of this.vloops) this._els.push([{ R: v.R, Z: v.Z, turns: 1 }]);
        }
        return this._els[j];
    }
    _rc(j) { return j < this.nc ? this.circuits[j].rc : this.vloops[j - this.nc].rc; }

    _buildInductance() {
        const n = this.n;
        const M = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
            const ei = this._elements(i), rci = this._rc(i);
            for (let j = i; j < n; j++) {
                const ej = this._elements(j), rcj = this._rc(j);
                let m = 0;
                for (const A of ei) {
                    for (const B of ej) {
                        if (i === j && A === B) {
                            m += A.turns * A.turns * selfInductance(A.R, rci, 1);
                        } else {
                            m += A.turns * B.turns * mutual(A.R, A.Z, B.R, B.Z, Math.max(rci, rcj));
                        }
                    }
                }
                // Series inductance added to the passive structure — see the
                // VESSEL_L_BOOST comment. Only the vessel-vessel block moves, so
                // the coupling of the wall to the coils and to the plasma is
                // untouched; what changes is how much current a given flux
                // change drives round the wall.
                if (i >= this.nc && j >= this.nc) m *= VESSEL_L_BOOST;
                M[i * n + j] = m; M[j * n + i] = m;
            }
        }
        this.M = M;
        this.Minv = invert(M, n);

        // Resistances chosen so each circuit's own L/R matches its spec. The
        // vertical instability's growth rate is set by the VESSEL time constant,
        // so that number (6 ms) is the single most consequential constant here.
        const res = new Float64Array(n);
        for (let i = 0; i < this.nc; i++) res[i] = M[i * n + i] / this.circuits[i].tau;
        this.vesselTau = 0.006;
        for (let i = this.nc; i < n; i++) res[i] = M[i * n + i] / this.vesselTau;
        this.res = res;

        this.vmax = new Float64Array(n);
        this.imax = new Float64Array(n);
        for (let i = 0; i < this.nc; i++) {
            this.vmax[i] = this.circuits[i].vmax;
            this.imax[i] = this.circuits[i].imax;
        }
    }

    /* Per-circuit response tables over the plasma region: Ψ (= mutual
     * inductance to a filament at that point), B_R and B_Z, all per ampere of
     * circuit current with turns already folded in. */
    _buildFieldTables() {
        const { nr, nz, r0, z0, dr, dz } = GRID;
        const N = nr * nz;
        this.gPsi = []; this.gBR = []; this.gBZ = [];
        const fo = [0, 0];
        for (let j = 0; j < this.n; j++) {
            const psi = new Float32Array(N), br = new Float32Array(N), bz = new Float32Array(N);
            const els = this._elements(j), rc = this._rc(j);
            for (const e of els) {
                for (let iz = 0; iz < nz; iz++) {
                    const Z = z0 + iz * dz;
                    for (let ir = 0; ir < nr; ir++) {
                        const R = r0 + ir * dr;
                        const k = iz * nr + ir;
                        psi[k] += e.turns * loopPsi(e.R, e.Z, R, Z, rc);
                        loopField(e.R, e.Z, R, Z, rc, fo);
                        br[k] += e.turns * fo[0];
                        bz[k] += e.turns * fo[1];
                    }
                }
            }
            this.gPsi.push(psi); this.gBR.push(br); this.gBZ.push(bz);
        }
    }

    /* Sensor response tables.
     *
     * Flux loops: by reciprocity, the flux a unit plasma filament at (R, Z)
     * links into loop s equals the flux the loop's own unit current would put
     * through a circle at (R, Z). One elliptic evaluation either way.
     *
     * Field probes: no such shortcut for B, so this is the direct calculation —
     * field at the probe from a unit loop at each grid point, dotted into the
     * probe's tangential direction. */
    _buildSensorTables() {
        const { nr, nz, r0, z0, dr, dz } = GRID;
        const N = nr * nz;
        const fo = [0, 0];

        this.gFlux = this.fluxLoops.map(s => {
            const g = new Float32Array(N);
            for (let iz = 0; iz < nz; iz++) {
                const Z = z0 + iz * dz;
                for (let ir = 0; ir < nr; ir++) {
                    g[iz * nr + ir] = loopPsi(s.R, s.Z, r0 + ir * dr, Z, 0.03);
                }
            }
            return g;
        });

        this.gProbe = this.probes.map(p => {
            const g = new Float32Array(N);
            for (let iz = 0; iz < nz; iz++) {
                const Z = z0 + iz * dz;
                for (let ir = 0; ir < nr; ir++) {
                    loopField(r0 + ir * dr, Z, p.R, p.Z, 0.03, fo);
                    g[iz * nr + ir] = fo[0] * p.tR + fo[1] * p.tZ;
                }
            }
            return g;
        });

        // Sensor response to the coils and the passive structure — a fixed
        // matrix, since neither the sensors nor the conductors ever move.
        const n = this.n;
        this.sFluxC = new Float64Array(N_FLUX * n);
        this.sProbeC = new Float64Array(N_PROBE * n);
        for (let j = 0; j < n; j++) {
            const els = this._elements(j), rc = this._rc(j);
            for (const e of els) {
                for (let s = 0; s < N_FLUX; s++) {
                    const L = this.fluxLoops[s];
                    this.sFluxC[s * n + j] += e.turns * loopPsi(e.R, e.Z, L.R, L.Z, rc);
                }
                for (let s = 0; s < N_PROBE; s++) {
                    const p = this.probes[s];
                    loopField(e.R, e.Z, p.R, p.Z, rc, fo);
                    this.sProbeC[s * n + j] += e.turns * (fo[0] * p.tR + fo[1] * p.tZ);
                }
            }
        }
    }

    /* Bilinear sample of one of the tables above. Returns 0 outside the grid,
     * which is safe because anything outside the grid has already disrupted. */
    sample(table, R, Z) {
        const { nr, nz, r0, z0, dr, dz } = GRID;
        let fr = (R - r0) / dr, fz = (Z - z0) / dz;
        if (fr < 0) fr = 0; else if (fr > nr - 1.001) fr = nr - 1.001;
        if (fz < 0) fz = 0; else if (fz > nz - 1.001) fz = nz - 1.001;
        const ir = fr | 0, iz = fz | 0;
        const tr = fr - ir, tz = fz - iz;
        const k = iz * nr + ir;
        const a = table[k], b = table[k + 1], c = table[k + nr], d = table[k + nr + 1];
        return (a + (b - a) * tr) * (1 - tz) + (c + (d - c) * tr) * tz;
    }
}

/* One shared instance. Building it costs a few hundred milliseconds of elliptic
 * integrals; every plasma in every generation reads from it and none of them
 * pay that again. */
let _machine = null;
function getMachine() {
    if (!_machine) _machine = new Machine();
    return _machine;
}

if (typeof module !== "undefined") {
    module.exports = {
        Machine, getMachine, VESSEL, GRID, wallClearance, buildWallContour,
        N_VESSEL, N_FLUX, N_PROBE, ZROWS, invert
    };
}
