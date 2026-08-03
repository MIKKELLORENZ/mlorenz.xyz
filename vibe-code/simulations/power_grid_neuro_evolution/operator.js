// The controllers. Four of them run the identical world on the identical day,
// and three are not neural networks - because a fitness curve that only ever
// rises against itself answers nothing.
//
//   DO NOTHING    takes the market's economic dispatch and reconnects what has
//                 come back from repair. No redispatch, no switching. This is
//                 not a straw man: on a calm day with generous ratings it is
//                 the cheapest possible operation and nothing can beat it.
//   REDISPATCH    sensitivity-based preventive control - the poor man's
//                 security-constrained dispatch that every control room runs.
//                 It finds the binding constraint, reads the PTDF row for it,
//                 picks the generator pair with the best relief per euro, and
//                 moves as much as the ramps allow. It is the baseline that
//                 actually has to be beaten.
//   EXPERT        redispatch, plus topology when redispatch runs out of ramp:
//                 every single-line opening is evaluated against the LODF table
//                 and the best one is taken if it helps.
//   BRAIN         the genome.
//
// The brain is given the same PTDF and LODF numbers the other two read. It has
// no private information; what it can do that they cannot is act before a limit
// is broken, use both busbars, and price the whole thing against the fuel bill
// instead of one constraint at a time.
'use strict';

// --- shared helpers ---------------------------------------------------------
function freeToSwitch(w, b) {
    if (w.st.cd[b] !== 0 || w.st.repair[b] >= 0) return false;
    // A locked-out line cannot be closed, so offering it as a candidate only
    // wastes the one topological action this interval allows.
    if (!w.st.status[b] && w.st.reclose[b] >= SIM.RECLOSE_LIMIT) return false;
    return true;
}

// A line that is out and free to come back. Reconnecting is almost always worth
// doing and all three classical controllers do it, so the brain gets no credit
// for merely remembering to.
function pickReconnect(w) {
    for (let b = 0; b < w.net.nBranch; b++) {
        if (!w.st.status[b] && freeToSwitch(w, b)) return b;
    }
    return -1;
}

// Would opening this branch leave both of its substations with more than one
// line still on? A DC contingency screen cannot see a voltage collapse, so a
// switching action that reduces a substation to a single feed is refused on
// principle rather than on a calculation.
function leavesMeshed(w, b) {
    const net = w.net, br = net.branch[b];
    for (const s of [br.f, br.t]) {
        let live = 0;
        for (const e of net.subs[s].elems) {
            if (e.kind === 'br' && e.ref !== b && w.st.status[e.ref]) live++;
        }
        if (live < 2) return false;
    }
    return true;
}

function blankAction(w) {
    return {
        dP: new Float64Array(w.net.nGen),
        curtail: new Float64Array(w.net.nGen),
        topo: null
    };
}

// The binding constraint right now: the worst actual loading if anything is
// over, otherwise the worst single-contingency loading. The distinction is
// preventive versus corrective control and it is the whole difference between
// an operator who keeps the lights on and one who reacts.
function bindingConstraint(w) {
    let maxLd = 0, worstB = -1;
    for (let b = 0; b < w.net.nBranch; b++) {
        if (!w.st.status[b]) continue;
        if (w.flows.load[b] > maxLd) { maxLd = w.flows.load[b]; worstB = b; }
    }
    // The thresholds are economic, not doctrinal. Under this reward an overload
    // is charged for and an N-1 insecurity is not, so a controller that
    // redispatches every time a contingency case goes a percent over its limit
    // spends far more than the risk it removes - measured, about fifteen times
    // more on the 22-bus network. It acts hard on real overloads and only on
    // serious insecurities.
    if (maxLd > 0.99) return { kind: 'flow', branch: worstB, level: maxLd, target: 0.94 };
    if (w.n1.worst > 1.25 && w.n1.worstBranch >= 0) {
        return { kind: 'n1', branch: w.n1.worstBranch, level: w.n1.worst, target: 1.10 };
    }
    return { kind: 'none', branch: worstB, level: maxLd, target: 1 };
}

// Sensitivity of the loading on `branch` to a megawatt injected at each bus,
// straight out of the PTDF table the world already built for the N-1 screen.
// Positive means injecting there RELIEVES the constraint.
function reliefRates(w, branch) {
    const net = w.net, out = new Float64Array(net.nGen);
    if (branch < 0 || !w.dcs) return out;
    const rate = Math.max(1, net.branch[branch].rate);
    const sgn = w.flows.pf[branch] >= 0 ? 1 : -1;
    for (const dc of w.dcs) {
        const li = dc.liveOfBr[branch];
        if (li < 0) continue;
        for (let g = 0; g < net.nGen; g++) {
            const nd = w.res.genNode[g];
            out[g] = -sgn * dc.ptdf[li * dc.n + nd] / rate;
        }
        break;
    }
    return out;
}

// The core of the classical controller: choose one pair of units to move in
// opposite directions. A pair, not a single unit, because redispatch has to sum
// to zero - the megawatts have to come from somewhere.
function greedyRedispatch(w, action, con) {
    const net = w.net, st = w.st;
    if (con.kind === 'none') {
        // Nothing is binding, so unwind whatever deviation is still on the
        // system. Every megawatt of deviation is being billed every interval.
        let any = false;
        for (const g of net.dispatchable) {
            if (!st.genOn[g] || Math.abs(st.redisp[g]) < 0.5) continue;
            action.dP[g] = -Math.sign(st.redisp[g]) *
                Math.min(1, Math.abs(st.redisp[g]) / net.gen[g].ramp);
            any = true;
        }
        return any ? 0 : 0;
    }
    const rel = reliefRates(w, con.branch);
    const need = (con.level - con.target) * Math.max(1, net.branch[con.branch].rate);
    const cands = net.dispatchable.filter(g => st.genOn[g]);
    let best = null;
    for (const up of cands) {
        const hUp = Math.min(net.gen[up].ramp, net.gen[up].pmax - st.pg[up]);
        if (hUp < 0.5) continue;
        for (const dn of cands) {
            if (dn === up) continue;
            const hDn = Math.min(net.gen[dn].ramp, st.pg[dn] - net.gen[dn].pmin);
            if (hDn < 0.5) continue;
            const gain = rel[up] - rel[dn];              // loading relieved per MW
            if (gain <= 1e-9) continue;
            const mw = Math.min(hUp, hDn, need / Math.max(1e-9, gain * Math.max(1, net.branch[con.branch].rate)));
            if (mw < 0.25) continue;
            const eur = mw * (net.gen[up].cost - net.gen[dn].cost
                + REDISPATCH_PREMIUM_UP + REDISPATCH_PREMIUM_DOWN);
            const relieved = gain * mw * Math.max(1, net.branch[con.branch].rate);
            // Relief per euro, with a floor on the denominator so that a pair
            // which happens to save money does not score infinitely well.
            const score = relieved / Math.max(60, eur);
            if (!best || score > best.score) best = { up, dn, mw, score, relieved };
        }
    }
    if (!best) return 0;
    action.dP[best.up] = Math.min(1, best.mw / net.gen[best.up].ramp);
    action.dP[best.dn] = -Math.min(1, best.mw / net.gen[best.dn].ramp);
    return best.relieved;
}

// --- classical controllers --------------------------------------------------
function doNothingController() {
    return {
        name: 'do nothing',
        act(w) {
            const a = blankAction(w);
            const b = pickReconnect(w);
            if (b >= 0) a.topo = { kind: 'line', ref: b };
            return a;
        }
    };
}

function redispatchController(opts) {
    const aggressive = opts && opts.aggressive;
    return {
        name: 'sensitivity redispatch',
        act(w) {
            const a = blankAction(w);
            const con = bindingConstraint(w);
            greedyRedispatch(w, a, con);
            // Reconnecting is only free when nothing is on fire; a reconnection
            // during an overload redistributes flow in a direction nobody has
            // checked.
            if (con.kind === 'none' || aggressive) {
                const b = pickReconnect(w);
                if (b >= 0) a.topo = { kind: 'line', ref: b };
            }
            return a;
        }
    };
}

function expertController() {
    return {
        name: 'redispatch + topology',
        act(w) {
            const a = blankAction(w);
            const con = bindingConstraint(w);
            const relieved = greedyRedispatch(w, a, con);
            if (con.kind === 'none') {
                const b = pickReconnect(w);
                if (b >= 0) a.topo = { kind: 'line', ref: b };
                return a;
            }
            // Redispatch could not clear it. Every single-line opening has
            // already been evaluated by the N-1 screen - perOutage[b] IS the
            // worst loading anywhere after opening b - so the best switching
            // action is a table lookup.
            //
            // Only ever taken against a REAL overload. Opening a line to improve
            // a contingency case makes the system worse in the case that is
            // actually happening, and an earlier version of this controller
            // blacked out a six-bus network doing exactly that.
            if (con.kind !== 'flow' || con.level <= 1.0) return a;
            const shortfall = (con.level - con.target) * Math.max(1, w.net.branch[con.branch].rate);
            if (relieved >= shortfall * 0.85) return a;

            // Shortlist by the DC screen, which is cheap and can look at every
            // branch at once...
            const cands = [];
            for (let b = 0; b < w.net.nBranch; b++) {
                if (!w.st.status[b] || !freeToSwitch(w, b)) continue;
                const after = w.n1.perOutage[b];
                if (after <= 0) continue;                    // opening b islands the grid
                if (!leavesMeshed(w, b)) continue;
                if (after < con.level - 0.03) cands.push({ b, after });
            }
            cands.sort((x, y) => x.after - y.after);
            // ...then VERIFY the best three with a real AC solve, because the
            // screen is lossless and ignores reactive power entirely. Acting on
            // the screen alone, an earlier version of this controller cheerfully
            // opened lines that the DC model said were fine and the AC model
            // said were the start of a voltage collapse. Studying a switching
            // action in the network model before executing it is exactly what a
            // control room does, and the cost - two extra power flows on the
            // handful of intervals where switching is even a candidate - is
            // nothing next to being wrong.
            for (let i = 0; i < Math.min(3, cands.length); i++) {
                const v = w.previewSwitch(cands[i].b);
                if (!v || !v.ok) continue;
                if (v.lostMW > 0.5) continue;
                if (v.vmin < 0.95) continue;
                if (v.maxLoading > Math.min(0.97, con.level - 0.04)) continue;
                a.topo = { kind: 'line', ref: cands[i].b };
                break;
            }
            return a;
        }
    };
}

// --- the genome -------------------------------------------------------------
// One forward pass over the graph, then one cheap head evaluation per candidate
// action. The continuous half is applied everywhere at once; the discrete half
// is a single choice made by comparing every candidate against a learned
// do-nothing bar.
function brainController(genome, opts) {
    const record = opts && opts.record;
    return {
        name: 'evolved',
        genome,
        usesObs: true,
        act(w, obs) {
            const net = w.net, st = w.st, emb = w.emb;
            const a = blankAction(w);
            encodeGraph(genome, obs, emb);

            const out = emb.tmpOut;
            for (let g = 0; g < net.nGen; g++) {
                headGen(genome, obs, emb, g, out);
                if (net.gen[g].renew) {
                    // Curtailment is one-sided: tanh output below zero simply
                    // means "no curtailment", which is what a near-zero output
                    // layer produces on a fresh genome.
                    a.curtail[g] = Math.max(0, Math.min(1, out[1]));
                } else if (st.genOn[g]) {
                    a.dP[g] = out[0];
                }
            }

            const bar = headNoop(genome, obs, emb);
            let bestScore = bar, best = null, second = null, secondScore = -Infinity;
            for (let b = 0; b < net.nBranch; b++) {
                if (!freeToSwitch(w, b)) continue;
                const s = headLine(genome, obs, emb, b);
                emb.lineLogit[b] = s;
                if (s > bestScore) {
                    second = best; secondScore = bestScore;
                    bestScore = s; best = { kind: 'line', ref: b };
                } else if (s > secondScore) { secondScore = s; second = { kind: 'line', ref: b }; }
            }
            for (const s of net.actionableSubs) {
                if (st.subCd[s] > 0) continue;
                const v = headSub(genome, obs, emb, s);
                emb.subLogit[s] = v;
                if (v > bestScore) {
                    second = best; secondScore = bestScore;
                    bestScore = v; best = { kind: 'sub', ref: s };
                } else if (v > secondScore) { secondScore = v; second = { kind: 'sub', ref: s }; }
            }

            const build = cand => {
                if (!cand) return null;
                if (cand.kind === 'line') return cand;
                const s = cand.ref, elems = net.subs[s].elems;
                const feat = w.fillElem(s);
                const assign = new Int8Array(elems.length);
                let br1 = 0, br2 = 0, on2 = 0;
                for (let i = 0; i < elems.length; i++) {
                    const v = headElem(genome, obs, emb, s, i, feat);
                    assign[i] = v > 0 ? 2 : 1;
                    if (assign[i] === 2) { on2++; if (elems[i].kind === 'br') br2++; }
                    else if (elems[i].kind === 'br') br1++;
                }
                // Same validity rule the world enforces, checked here so a bad
                // configuration costs the second-best action rather than the
                // whole interval.
                if (on2 > 0 && (br1 === 0 || br2 === 0)) return null;
                let changed = false;
                for (let i = 0; i < elems.length; i++) if (st.topo[s][i] !== assign[i]) changed = true;
                if (!changed) return null;
                return { kind: 'sub', ref: s, assign };
            };

            a.topo = build(best) || (secondScore > bar ? build(second) : null);
            if (record) {
                w.lastBrain = {
                    bar, bestScore, chose: a.topo ? a.topo.kind : 'nothing',
                    ref: a.topo ? a.topo.ref : -1
                };
            }
            return a;
        }
    };
}

function makeController(kind, genome) {
    if (kind === 'donothing') return doNothingController();
    if (kind === 'redispatch') return redispatchController();
    if (kind === 'expert') return expertController();
    return brainController(genome, { record: true });
}

if (typeof module !== 'undefined') {
    module.exports = {
        doNothingController, redispatchController, expertController,
        brainController, makeController, bindingConstraint, reliefRates,
        greedyRedispatch, pickReconnect, blankAction
    };
}
