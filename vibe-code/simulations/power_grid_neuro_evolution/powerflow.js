// The physics. Everything the controller is graded on comes out of this file,
// so it is the one place where being approximately right is not good enough.
//
// Three solvers live here and they are not interchangeable:
//
//   NEWTON-RAPHSON (polar)   The reference. Builds the full Jacobian and does a
//                            dense LU every iteration. Quadratic convergence,
//                            robust right up to the nose of the PV curve, and
//                            O(n^3) per iteration - which is why it is not the
//                            one that runs 23 000 times a generation.
//   FAST DECOUPLED (XB)      The workhorse. B' and B'' are constant real
//                            matrices that depend only on the topology, so they
//                            are factorised ONCE per switching state and cached;
//                            each iteration is then two triangular solves.
//                            ~25x cheaper on a 40-node case. It is also the
//                            solver an actual control room runs.
//   DC + LODF                The N-1 screen. Linearised, lossless, ignores Q -
//                            and therefore fast enough to test every single
//                            branch outage every five minutes, which is exactly
//                            why real operators screen this way and then verify
//                            the worst few with AC.
//
// The AC path drives the reward and the protection relays. The DC path drives
// the security screen only, and its result is reported as a separate metric
// precisely because it is an approximation.
//
// Convention: per unit on a 100 MVA base, polar voltages, MATPOWER branch model
// with an off-nominal tap on the FROM side.
'use strict';

const PF = {
    BASE_MVA: 100,
    NR_TOL: 1e-8,
    NR_MAX: 30,
    FD_TOL: 1e-6,      // 1e-6 pu is 0.1 kW: far past what a rating cares about
    FD_MAX: 40,
    VM_MIN: 0.5,      // below this the case is called collapsed, not solved
    VM_MAX: 1.6
};

// --- dense linear algebra ---------------------------------------------------
// Row-major LU with partial pivoting. n stays under ~90 here, so a dense
// factorisation with no ordering is the right trade: an AMD ordering would save
// flops on the 33-bus case and cost more code than it is worth.
function luFactor(A, n) {
    const piv = new Int32Array(n);
    for (let i = 0; i < n; i++) piv[i] = i;
    for (let k = 0; k < n; k++) {
        let p = k, best = Math.abs(A[k * n + k]);
        for (let i = k + 1; i < n; i++) {
            const v = Math.abs(A[i * n + k]);
            if (v > best) { best = v; p = i; }
        }
        if (best < 1e-13) return null;              // singular: island or collapse
        if (p !== k) {
            const t = piv[k]; piv[k] = piv[p]; piv[p] = t;
            for (let j = 0; j < n; j++) {
                const tmp = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = tmp;
            }
        }
        const d = A[k * n + k];
        for (let i = k + 1; i < n; i++) {
            const m = A[i * n + k] / d;
            A[i * n + k] = m;
            if (m === 0) continue;
            for (let j = k + 1; j < n; j++) A[i * n + j] -= m * A[k * n + j];
        }
    }
    return piv;
}

function luSolve(LU, piv, n, b, out) {
    const y = out || new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = b[piv[i]];
    for (let i = 1; i < n; i++) {
        let s = y[i];
        for (let j = 0; j < i; j++) s -= LU[i * n + j] * y[j];
        y[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
        let s = y[i];
        for (let j = i + 1; j < n; j++) s -= LU[i * n + j] * y[j];
        y[i] = s / LU[i * n + i];
    }
    return y;
}

// --- topology resolution ----------------------------------------------------
// A substation is not a node. It is a pair of busbars, and every element hanging
// off it (each branch end, each generator, the load) is clamped to one of them.
// Clamp everything to busbar 1 and the substation behaves like a single node;
// split the elements across both busbars and one substation becomes two
// electrically separate nodes, which is the entire point of busbar switching:
// it re-routes power with no new copper and no fuel cost.
function resolveTopology(net, topo) {
    const nSub = net.nBus;
    const subNode2 = new Int32Array(nSub).fill(-1);
    let nNode = nSub;
    for (let s = 0; s < nSub; s++) {
        const t = topo[s];
        if (!t) continue;
        let uses2 = false;
        for (let i = 0; i < t.length; i++) if (t[i] === 2) { uses2 = true; break; }
        if (uses2) subNode2[s] = nNode++;
    }
    const nodeOf = (s, i) => (topo[s] && topo[s][i] === 2 && subNode2[s] >= 0) ? subNode2[s] : s;

    const brNode = new Int32Array(net.nBranch * 2);
    for (let b = 0; b < net.nBranch; b++) {
        const ef = net.brElem[b * 2], et = net.brElem[b * 2 + 1];
        brNode[b * 2] = nodeOf(ef.sub, ef.idx);
        brNode[b * 2 + 1] = nodeOf(et.sub, et.idx);
    }
    const genNode = new Int32Array(net.nGen);
    for (let g = 0; g < net.nGen; g++) {
        const e = net.genElem[g];
        genNode[g] = nodeOf(e.sub, e.idx);
    }
    const loadNode = new Int32Array(net.nBus);
    for (let s = 0; s < net.nBus; s++) {
        const e = net.loadElem[s];
        loadNode[s] = e ? nodeOf(e.sub, e.idx) : s;
    }
    return { nNode, subNode2, brNode, genNode, loadNode };
}

// A stable string for one switching state, used to key the factorisation cache.
function topologyKey(net, status, topo) {
    let k = '';
    for (let b = 0; b < net.nBranch; b++) k += status[b] ? '1' : '0';
    for (let s = 0; s < net.nBus; s++) {
        const t = topo[s];
        if (!t) continue;
        let any = false;
        for (let i = 0; i < t.length; i++) if (t[i] === 2) { any = true; break; }
        if (!any) continue;
        k += '|' + s + ':';
        for (let i = 0; i < t.length; i++) k += t[i];
    }
    return k;
}

// --- admittance -------------------------------------------------------------
function buildYbus(net, res, status) {
    const n = res.nNode;
    const G = new Float64Array(n * n);
    const B = new Float64Array(n * n);
    for (let s = 0; s < net.nBus; s++) {
        const bs = net.bus[s];
        const nd = res.loadNode[s];
        G[nd * n + nd] += bs.gs / PF.BASE_MVA;
        B[nd * n + nd] += bs.bs / PF.BASE_MVA;
    }
    for (let b = 0; b < net.nBranch; b++) {
        if (!status[b]) continue;
        const br = net.branch[b];
        const f = res.brNode[b * 2], t = res.brNode[b * 2 + 1];
        if (f === t) continue;                       // both ends on the same busbar
        const den = br.r * br.r + br.x * br.x;
        const gs = br.r / den, bs = -br.x / den;     // series admittance y = g + jb
        const bc = br.b * 0.5;                       // half line charging
        const tap = br.tap || 1;
        const tt = tap * tap;
        // Yff, Ytt, Yft = Ytf (no phase shifters in these networks)
        G[f * n + f] += gs / tt; B[f * n + f] += (bs + bc) / tt;
        G[t * n + t] += gs;      B[t * n + t] += bs + bc;
        G[f * n + t] -= gs / tap; B[f * n + t] -= bs / tap;
        G[t * n + f] -= gs / tap; B[t * n + f] -= bs / tap;
    }
    // A compressed-row view of the same matrix. A power system's admittance
    // matrix is nearly empty - a node touches three or four others - and the
    // mismatch calculation is the innermost loop of every iteration of every
    // solve. Walking the row list instead of the full row is the difference
    // between O(n^2) and O(nnz) on exactly the loop that dominates the profile.
    let nnz = 0;
    for (let i = 0; i < n * n; i++) if (G[i] !== 0 || B[i] !== 0) nnz++;
    const rowPtr = new Int32Array(n + 1);
    const col = new Int32Array(nnz);
    const gv = new Float64Array(nnz);
    const bv = new Float64Array(nnz);
    let p = 0;
    for (let i = 0; i < n; i++) {
        rowPtr[i] = p;
        for (let j = 0; j < n; j++) {
            const g = G[i * n + j], b = B[i * n + j];
            if (g === 0 && b === 0) continue;
            col[p] = j; gv[p] = g; bv[p] = b; p++;
        }
    }
    rowPtr[n] = p;
    return { n, G, B, rowPtr, col, gv, bv };
}

// P and Q injected at every node of one island, from the current voltages.
function injections(Y, nodes, vm, va, Pc, Qc) {
    const { rowPtr, col, gv, bv } = Y;
    for (let a = 0; a < nodes.length; a++) {
        const i = nodes[a];
        let p = 0, q = 0;
        const vi = vm[i], ai = va[i];
        for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
            const j = col[k];
            const d = ai - va[j];
            const cs = Math.cos(d), sn = Math.sin(d);
            const vj = vm[j], g = gv[k], b = bv[k];
            p += vj * (g * cs + b * sn);
            q += vj * (g * sn - b * cs);
        }
        Pc[i] = vi * p; Qc[i] = vi * q;
    }
}

// --- islands ----------------------------------------------------------------
// After a cascade the network is usually not one network any more. Each piece is
// solved on its own with its own slack, and a piece with no generator in it is
// simply dark - which is the single most consequential thing that can happen in
// this simulation, so it gets found explicitly rather than showing up as a
// solver failure.
function findIslands(net, res, status) {
    const n = res.nNode;
    const comp = new Int32Array(n).fill(-1);
    const adjHead = new Int32Array(n).fill(-1);
    const adjNext = new Int32Array(net.nBranch * 2).fill(-1);
    const adjTo = new Int32Array(net.nBranch * 2);
    let e = 0;
    for (let b = 0; b < net.nBranch; b++) {
        if (!status[b]) continue;
        const f = res.brNode[b * 2], t = res.brNode[b * 2 + 1];
        if (f === t) continue;
        adjTo[e] = t; adjNext[e] = adjHead[f]; adjHead[f] = e; e++;
        adjTo[e] = f; adjNext[e] = adjHead[t]; adjHead[t] = e; e++;
    }
    const stack = new Int32Array(n);
    let nComp = 0;
    for (let s = 0; s < n; s++) {
        if (comp[s] >= 0) continue;
        let sp = 0;
        stack[sp++] = s; comp[s] = nComp;
        while (sp > 0) {
            const u = stack[--sp];
            for (let a = adjHead[u]; a >= 0; a = adjNext[a]) {
                const v = adjTo[a];
                if (comp[v] < 0) { comp[v] = nComp; stack[sp++] = v; }
            }
        }
        nComp++;
    }
    return { comp, nComp };
}

// --- the AC solve -----------------------------------------------------------
// One island. `spec` carries the node classification and the injections; the
// caller has already decided who the slack is.
//   type[]  0 = PQ, 1 = PV, 2 = slack
//   psch/qsch  scheduled injection in per unit (generation minus load)
//   vset[]  voltage setpoint for PV and slack nodes
function newtonRaphson(Y, nodes, type, psch, qsch, vm, va, qmin, qmax, opts) {
    const n = Y.n, G = Y.G, B = Y.B;
    const m = nodes.length;
    const pvpq = [], pq = [];
    for (let k = 0; k < m; k++) {
        const i = nodes[k];
        if (type[i] === 2) continue;
        pvpq.push(i);
        if (type[i] === 0) pq.push(i);
    }
    const npvpq = pvpq.length, npq = pq.length;
    const sz = npvpq + npq;
    if (sz === 0) return { ok: true, iters: 0, mismatch: 0 };
    const idxT = new Int32Array(n).fill(-1);
    const idxV = new Int32Array(n).fill(-1);
    for (let k = 0; k < npvpq; k++) idxT[pvpq[k]] = k;
    for (let k = 0; k < npq; k++) idxV[pq[k]] = npvpq + k;

    const J = new Float64Array(sz * sz);
    const F = new Float64Array(sz);
    const Pc = new Float64Array(n), Qc = new Float64Array(n);
    const maxIter = (opts && opts.maxIter) || PF.NR_MAX;
    const tol = (opts && opts.tol) || PF.NR_TOL;
    let mism = Infinity, it = 0;

    for (it = 0; it < maxIter; it++) {
        injections(Y, nodes, vm, va, Pc, Qc);
        mism = 0;
        for (let k = 0; k < npvpq; k++) {
            const i = pvpq[k];
            F[k] = psch[i] - Pc[i];
            if (Math.abs(F[k]) > mism) mism = Math.abs(F[k]);
        }
        for (let k = 0; k < npq; k++) {
            const i = pq[k];
            F[npvpq + k] = qsch[i] - Qc[i];
            if (Math.abs(F[npvpq + k]) > mism) mism = Math.abs(F[npvpq + k]);
        }
        if (mism < tol) return { ok: true, iters: it, mismatch: mism };

        J.fill(0);
        // dP/dth, dP/dV, dQ/dth, dQ/dV in polar form, walking the sparse rows.
        for (let a = 0; a < m; a++) {
            const i = nodes[a];
            const ti = idxT[i], vi = idxV[i];
            if (ti < 0 && vi < 0) continue;
            for (let k = Y.rowPtr[i]; k < Y.rowPtr[i + 1]; k++) {
                const j = Y.col[k];
                const g = Y.gv[k], bb = Y.bv[k];
                const tj = idxT[j], vj = idxV[j];
                if (i === j) {
                    const gii = G[i * n + i], bii = B[i * n + i];
                    if (ti >= 0) {
                        J[ti * sz + ti] = -Qc[i] - bii * vm[i] * vm[i];
                        if (vi >= 0) J[ti * sz + vi] = Pc[i] / vm[i] + gii * vm[i];
                    }
                    if (vi >= 0) {
                        J[vi * sz + ti] = Pc[i] - gii * vm[i] * vm[i];
                        J[vi * sz + vi] = Qc[i] / vm[i] - bii * vm[i];
                    }
                } else {
                    const d = va[i] - va[j];
                    const cs = Math.cos(d), sn = Math.sin(d);
                    const vij = vm[i] * vm[j];
                    const dPdt = vij * (g * sn - bb * cs);
                    const dPdv = vm[i] * (g * cs + bb * sn);
                    const dQdt = -vij * (g * cs + bb * sn);
                    const dQdv = vm[i] * (g * sn - bb * cs);
                    if (ti >= 0 && tj >= 0) J[ti * sz + tj] = dPdt;
                    if (ti >= 0 && vj >= 0) J[ti * sz + vj] = dPdv;
                    if (vi >= 0 && tj >= 0) J[vi * sz + tj] = dQdt;
                    if (vi >= 0 && vj >= 0) J[vi * sz + vj] = dQdv;
                }
            }
        }
        const piv = luFactor(J, sz);
        if (!piv) return { ok: false, iters: it, mismatch: mism, reason: 'singular' };
        const dx = luSolve(J, piv, sz, F);
        for (let k = 0; k < npvpq; k++) va[pvpq[k]] += dx[k];
        for (let k = 0; k < npq; k++) {
            const i = pq[k];
            vm[i] += dx[npvpq + k];
            if (vm[i] < 0.2) vm[i] = 0.2;
            if (vm[i] > 2.0) vm[i] = 2.0;
        }
        for (let k = 0; k < sz; k++) if (!Number.isFinite(dx[k])) {
            return { ok: false, iters: it, mismatch: mism, reason: 'diverged' };
        }
    }
    return { ok: false, iters: it, mismatch: mism, reason: 'maxiter' };
}

// Fast decoupled (XB variant). B' drops resistance and line charging; B'' drops
// the tap ratio and keeps the shunts. Both are constant for a switching state,
// so the caller hands in the cached factorisation.
function buildFDMatrices(net, res, status, nodes, type) {
    const n = res.nNode;
    const pvpq = [], pq = [];
    for (const i of nodes) {
        if (type[i] === 2) continue;
        pvpq.push(i);
        if (type[i] === 0) pq.push(i);
    }
    const np = pvpq.length, nq = pq.length;
    const ip = new Int32Array(n).fill(-1), iq = new Int32Array(n).fill(-1);
    for (let k = 0; k < np; k++) ip[pvpq[k]] = k;
    for (let k = 0; k < nq; k++) iq[pq[k]] = k;

    const Bp = new Float64Array(np * np);
    const Bpp = new Float64Array(nq * nq);
    for (let b = 0; b < net.nBranch; b++) {
        if (!status[b]) continue;
        const br = net.branch[b];
        const f = res.brNode[b * 2], t = res.brNode[b * 2 + 1];
        if (f === t) continue;
        const bx = 1 / br.x;                            // B' ignores r
        if (ip[f] >= 0) Bp[ip[f] * np + ip[f]] += bx;
        if (ip[t] >= 0) Bp[ip[t] * np + ip[t]] += bx;
        if (ip[f] >= 0 && ip[t] >= 0) {
            Bp[ip[f] * np + ip[t]] -= bx;
            Bp[ip[t] * np + ip[f]] -= bx;
        }
        const den = br.r * br.r + br.x * br.x;
        const bs = -br.x / den, bc = br.b * 0.5;        // B'' keeps r and charging
        const tap = br.tap || 1;
        if (iq[f] >= 0) Bpp[iq[f] * nq + iq[f]] -= (bs + bc) / (tap * tap);
        if (iq[t] >= 0) Bpp[iq[t] * nq + iq[t]] -= (bs + bc);
        if (iq[f] >= 0 && iq[t] >= 0) {
            Bpp[iq[f] * nq + iq[t]] += bs / tap;
            Bpp[iq[t] * nq + iq[f]] += bs / tap;
        }
    }
    for (let s = 0; s < net.nBus; s++) {
        const nd = res.loadNode[s];
        if (iq[nd] >= 0) Bpp[iq[nd] * nq + iq[nd]] -= net.bus[s].bs / PF.BASE_MVA;
    }
    const pivP = np ? luFactor(Bp, np) : null;
    const pivQ = nq ? luFactor(Bpp, nq) : null;
    if (np && !pivP) return null;
    if (nq && !pivQ) return null;
    return { pvpq, pq, np, nq, ip, iq, Bp, Bpp, pivP, pivQ };
}

function fastDecoupled(Y, fd, nodes, psch, qsch, vm, va, opts) {
    const n = Y.n, G = Y.G, B = Y.B;
    const m = nodes.length;
    const { pvpq, pq, np, nq, pivP, pivQ, Bp, Bpp } = fd;
    const dP = new Float64Array(np), dQ = new Float64Array(nq);
    const Pc = new Float64Array(n), Qc = new Float64Array(n);
    const tol = (opts && opts.tol) || PF.FD_TOL;
    const maxIter = (opts && opts.maxIter) || PF.FD_MAX;
    void G; void B; void m;

    let mism = Infinity;
    for (let it = 0; it < maxIter; it++) {
        injections(Y, nodes, vm, va, Pc, Qc);
        mism = 0;
        for (let k = 0; k < np; k++) {
            const i = pvpq[k];
            dP[k] = (psch[i] - Pc[i]) / vm[i];
            const e = Math.abs(psch[i] - Pc[i]);
            if (e > mism) mism = e;
        }
        for (let k = 0; k < nq; k++) {
            const i = pq[k];
            dQ[k] = (qsch[i] - Qc[i]) / vm[i];
            const e = Math.abs(qsch[i] - Qc[i]);
            if (e > mism) mism = e;
        }
        if (mism < tol) return { ok: true, iters: it, mismatch: mism };
        if (!Number.isFinite(mism) || mism > 1e6) {
            return { ok: false, iters: it, mismatch: mism, reason: 'diverged' };
        }
        if (np) {
            // Bp and Bpp were factorised in place by luFactor and are never
            // written again, so the same factors serve every iteration and every
            // step until the switching state changes. That reuse is the whole
            // reason this solver is cheap.
            const dth = luSolve(Bp, pivP, np, dP);
            for (let k = 0; k < np; k++) va[pvpq[k]] += dth[k];
        }
        injections(Y, nodes, vm, va, Pc, Qc);
        if (nq) {
            for (let k = 0; k < nq; k++) {
                const i = pq[k];
                dQ[k] = (qsch[i] - Qc[i]) / vm[i];
            }
            const dv = luSolve(Bpp, pivQ, nq, dQ);
            for (let k = 0; k < nq; k++) {
                const i = pq[k];
                vm[i] += dv[k];
                if (vm[i] < 0.2) vm[i] = 0.2;
                if (vm[i] > 2.0) vm[i] = 2.0;
            }
        }
    }
    return { ok: false, iters: maxIter, mismatch: mism, reason: 'maxiter' };
}

// --- branch flows -----------------------------------------------------------
// Full AC flows at both ends. Loading is judged on the larger of the two, which
// is what a protection relay sees, and it is an apparent-power (MVA) limit -
// grading a controller on MW alone lets it push reactive power through a line
// for free.
function branchFlows(net, res, status, vm, va, out) {
    const o = out || {
        pf: new Float64Array(net.nBranch), qf: new Float64Array(net.nBranch),
        pt: new Float64Array(net.nBranch), qt: new Float64Array(net.nBranch),
        sMax: new Float64Array(net.nBranch), load: new Float64Array(net.nBranch)
    };
    for (let b = 0; b < net.nBranch; b++) {
        if (!status[b]) { o.pf[b] = o.qf[b] = o.pt[b] = o.qt[b] = o.sMax[b] = o.load[b] = 0; continue; }
        const br = net.branch[b];
        const f = res.brNode[b * 2], t = res.brNode[b * 2 + 1];
        if (f === t) { o.pf[b] = o.qf[b] = o.pt[b] = o.qt[b] = o.sMax[b] = o.load[b] = 0; continue; }
        const den = br.r * br.r + br.x * br.x;
        const g = br.r / den, bb = -br.x / den, bc = br.b * 0.5;
        const tap = br.tap || 1, tt = tap * tap;
        const vf = vm[f], vt = vm[t], d = va[f] - va[t];
        const cs = Math.cos(d), sn = Math.sin(d);
        // S_ft = Vf * conj(Yff Vf + Yft Vt)
        const gff = g / tt, bff = (bb + bc) / tt;
        const gft = -g / tap, bft = -bb / tap;
        const pf = vf * vf * gff + vf * vt * (gft * cs + bft * sn);
        const qf = -vf * vf * bff + vf * vt * (gft * sn - bft * cs);
        const gtt = g, btt = bb + bc;
        const gtf = -g / tap, btf = -bb / tap;
        const pt = vt * vt * gtt + vt * vf * (gtf * cs - btf * sn);
        const qt = -vt * vt * btt + vt * vf * (-gtf * sn - btf * cs);
        o.pf[b] = pf * PF.BASE_MVA; o.qf[b] = qf * PF.BASE_MVA;
        o.pt[b] = pt * PF.BASE_MVA; o.qt[b] = qt * PF.BASE_MVA;
        const sf = Math.hypot(o.pf[b], o.qf[b]);
        const st = Math.hypot(o.pt[b], o.qt[b]);
        o.sMax[b] = Math.max(sf, st);
        o.load[b] = br.rate > 0 ? o.sMax[b] / br.rate : 0;
    }
    return o;
}

// --- DC model, PTDF, LODF ---------------------------------------------------
// The security screen. Building the full PTDF costs one triangular solve per
// node and is done once per switching state; after that a contingency screen of
// every branch against every branch is a table lookup and two multiplies.
function buildDC(net, res, status, refNode, nodesOfIsland) {
    const n = res.nNode;
    const nodes = nodesOfIsland;
    const idx = new Int32Array(n).fill(-1);
    const free = [];
    for (const i of nodes) if (i !== refNode) { idx[i] = free.length; free.push(i); }
    const nf = free.length;
    const live = [];
    for (let b = 0; b < net.nBranch; b++) {
        if (!status[b]) continue;
        const f = res.brNode[b * 2], t = res.brNode[b * 2 + 1];
        if (f === t) continue;
        if (idx[f] < 0 && f !== refNode) continue;
        if (idx[t] < 0 && t !== refNode) continue;
        live.push(b);
    }
    if (nf === 0) return null;
    const Bm = new Float64Array(nf * nf);
    for (const b of live) {
        const br = net.branch[b];
        const f = res.brNode[b * 2], t = res.brNode[b * 2 + 1];
        const bx = 1 / br.x;
        const fi = idx[f], ti = idx[t];
        if (fi >= 0) Bm[fi * nf + fi] += bx;
        if (ti >= 0) Bm[ti * nf + ti] += bx;
        if (fi >= 0 && ti >= 0) { Bm[fi * nf + ti] -= bx; Bm[ti * nf + fi] -= bx; }
    }
    const piv = luFactor(Bm, nf);
    if (!piv) return null;

    // X = B^-1, one column at a time. nf <= ~90 so this is a few hundred k flops
    // and it happens only when the switching state changes.
    const X = new Float64Array(nf * nf);
    const e = new Float64Array(nf);
    for (let c = 0; c < nf; c++) {
        e.fill(0); e[c] = 1;
        const col = luSolve(Bm, piv, nf, e);
        for (let r = 0; r < nf; r++) X[r * nf + c] = col[r];
    }
    // PTDF[l][node] = (X[f][node] - X[t][node]) / x_l, referenced to refNode.
    const nl = live.length;
    const ptdf = new Float64Array(nl * n);
    for (let li = 0; li < nl; li++) {
        const b = live[li];
        const br = net.branch[b];
        const f = res.brNode[b * 2], t = res.brNode[b * 2 + 1];
        const fi = idx[f], ti = idx[t];
        for (let k = 0; k < nf; k++) {
            const nd = free[k];
            const xf = fi >= 0 ? X[fi * nf + k] : 0;
            const xt = ti >= 0 ? X[ti * nf + k] : 0;
            ptdf[li * n + nd] = (xf - xt) / br.x;
        }
    }
    // LODF[l][k] = (PTDF_l(f_k) - PTDF_l(t_k)) / (1 - (PTDF_k(f_k) - PTDF_k(t_k)))
    // A denominator near zero means removing k splits the island: no finite
    // redistribution exists and the outage is flagged rather than screened.
    const lodf = new Float64Array(nl * nl);
    const splits = new Uint8Array(nl);
    for (let ki = 0; ki < nl; ki++) {
        const bk = live[ki];
        const fk = res.brNode[bk * 2], tk = res.brNode[bk * 2 + 1];
        const self = ptdf[ki * n + fk] - ptdf[ki * n + tk];
        const den = 1 - self;
        if (Math.abs(den) < 1e-6) { splits[ki] = 1; continue; }
        for (let li = 0; li < nl; li++) {
            if (li === ki) { lodf[li * nl + ki] = -1; continue; }
            lodf[li * nl + ki] = (ptdf[li * n + fk] - ptdf[li * n + tk]) / den;
        }
    }
    const brOfLive = Int32Array.from(live);
    const liveOfBr = new Int32Array(net.nBranch).fill(-1);
    for (let i = 0; i < nl; i++) liveOfBr[live[i]] = i;
    return { nf, nl, idx, free, refNode, X, ptdf, lodf, splits, brOfLive, liveOfBr, n };
}

// Screen every single-branch outage. Returns the worst post-contingency loading
// anywhere, per-branch worst loading, and how many outages leave something over
// its limit. `flowMW` is the real power flow now (DC screening is MW-only).
function screenN1(net, dc, flowMW, out) {
    const nl = dc.nl, lodf = dc.lodf;
    const res = out || {
        worst: 0, worstBranch: -1, worstOutage: -1, nViolating: 0, nIslanding: 0,
        perBranch: new Float64Array(net.nBranch),      // worst loading this branch reaches
        perOutage: new Float64Array(net.nBranch)       // worst loading this outage causes
    };
    res.worst = 0; res.worstBranch = -1; res.worstOutage = -1;
    res.nViolating = 0; res.nIslanding = 0;
    res.perBranch.fill(0); res.perOutage.fill(0);
    const f = new Float64Array(nl);
    const rate = new Float64Array(nl);
    for (let i = 0; i < nl; i++) {
        const b = dc.brOfLive[i];
        f[i] = flowMW[b];
        rate[i] = net.branch[b].rate > 0 ? net.branch[b].rate : 1e9;
    }
    for (let k = 0; k < nl; k++) {
        if (dc.splits[k]) { res.nIslanding++; continue; }
        let worstHere = 0;
        for (let l = 0; l < nl; l++) {
            if (l === k) continue;
            const fl = f[l] + lodf[l * nl + k] * f[k];
            const ld = Math.abs(fl) / rate[l];
            if (ld > worstHere) worstHere = ld;
            const bl = dc.brOfLive[l];
            if (ld > res.perBranch[bl]) res.perBranch[bl] = ld;
            if (ld > res.worst) {
                res.worst = ld; res.worstBranch = bl; res.worstOutage = dc.brOfLive[k];
            }
        }
        res.perOutage[dc.brOfLive[k]] = worstHere;
        if (worstHere > 1) res.nViolating++;
    }
    return res;
}

if (typeof module !== 'undefined') {
    module.exports = {
        PF, luFactor, luSolve, resolveTopology, topologyKey, buildYbus,
        findIslands, newtonRaphson, buildFDMatrices, fastDecoupled,
        branchFlows, buildDC, screenN1
    };
}
