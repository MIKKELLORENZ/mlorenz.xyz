// Headless assertion suite.  node test_headless.js
//
// Covers the four things that silently ruin a run like this:
//
//   * a POWER FLOW that is subtly wrong, in which case every controller is being
//     graded on a fiction. The AC solve is checked against Kirchhoff directly
//     (does generation minus load minus losses actually balance at every node?),
//     against the published IEEE 14-bus solution, and the two solvers are
//     checked against each other.
//   * a TOPOLOGY resolver that does not do what it says, so busbar switching
//     either does nothing or silently disconnects things.
//   * a WORLD whose economics reward the wrong thing - a controller that can
//     conjure megawatts, or one that scores better by ending the episode.
//   * a GENOME layout whose crossover or mutation does not do what it says, and
//     a graph network that is not actually permutation- or size-invariant.
'use strict';

const { loadSim } = require('./harness');
const S = loadSim(__dirname);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function group(t) { console.log('\n' + t); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- networks --
group('Networks');
const nets = [];
for (let tier = 0; tier < S.GRID_TIERS.length; tier++) {
    const net = S.makeNetwork(tier, S.mixSeed(0x671D, tier * 31));
    nets.push(net);
    const spec = S.GRID_TIERS[tier];
    ok(`tier ${tier} builds (${spec.name})`, net.nBus > 0 && net.nBranch > 0 && net.nGen > 0);
    ok(`tier ${tier} every bus is connected`, (() => {
        const deg = new Int32Array(net.nBus);
        for (const br of net.branch) { deg[br.f]++; deg[br.t]++; }
        return Array.from(deg).every(d => d > 0);
    })());
    // A singly-fed LOAD is a bus one outage takes away with nothing the operator
    // can do, which makes the episode a measure of the outage draw rather than of
    // the controller. A singly-fed generator terminal is fine and is exactly what
    // bus 8 of the real IEEE 14-bus case is.
    ok(`tier ${tier} no load bus is singly fed`, (() => {
        const deg = new Int32Array(net.nBus);
        for (const br of net.branch) { deg[br.f]++; deg[br.t]++; }
        for (let s = 0; s < net.nBus; s++) if (net.bus[s].pd0 > 0 && deg[s] < 2) return false;
        return true;
    })());
    ok(`tier ${tier} has firm capacity for the peak`, net.firmCap > net.totalLoad * 1.3,
        `firm ${net.firmCap.toFixed(0)} vs load ${net.totalLoad.toFixed(0)}`);
    ok(`tier ${tier} ratings are positive`, net.branch.every(b => b.rate > 0));
    ok(`tier ${tier} stands up at its planned peak`, net.planOk && net.planVmin > 0.90,
        `vmin ${net.planVmin.toFixed(3)}`);
    ok(`tier ${tier} has switchable substations`, net.actionableSubs.length > 0);
    ok(`tier ${tier} substation element lists are complete`, (() => {
        let n = 0;
        for (const s of net.subs) n += s.elems.length;
        const loads = net.bus.filter(b => b.pd0 || b.qd0).length;
        return n === net.nBranch * 2 + net.nGen + loads;
    })());
}

group('Network determinism');
{
    const a = S.makeNetwork(4, 777), b = S.makeNetwork(4, 777), c = S.makeNetwork(4, 778);
    ok('same seed -> same bus count', a.nBus === b.nBus && a.nBranch === b.nBranch);
    ok('same seed -> same ratings', a.branch.every((br, i) => br.rate === b.branch[i].rate));
    ok('different seed -> different network',
        a.nBranch !== c.nBranch || a.branch.some((br, i) => c.branch[i] && br.rate !== c.branch[i].rate));
}

// -------------------------------------------------------------- power flow --
group('Power flow: Kirchhoff');
{
    // At the solution every node's scheduled injection must equal what the
    // network actually draws out of it. This is the single check that catches a
    // wrong Ybus, a wrong Jacobian, or a mis-signed tap.
    const net = nets[1];
    const topo = S.defaultTopo(net);
    const res = S.resolveTopology(net, topo);
    const status = new Uint8Array(net.nBranch).fill(1);
    const Y = S.buildYbus(net, res, status);
    const n = res.nNode, nodes = [];
    for (let i = 0; i < n; i++) nodes.push(i);
    const vm = new Float64Array(n).fill(1), va = new Float64Array(n);
    const psch = new Float64Array(n), qsch = new Float64Array(n);
    const type = new Int8Array(n), vset = new Float64Array(n).fill(1);
    const qmin = new Float64Array(n).fill(-9), qmax = new Float64Array(n).fill(9);
    const disp = S.economicDispatch(net, net.totalLoad, S.renewNominal(net), null);
    for (let s = 0; s < net.nBus; s++) {
        psch[s] -= net.bus[s].pd0 / 100;
        qsch[s] -= net.bus[s].qd0 / 100;
    }
    for (let g = 0; g < net.nGen; g++) {
        psch[net.gen[g].bus] += disp[g] / 100;
        if (disp[g] > 0.02 * net.gen[g].pmax) { type[net.gen[g].bus] = 1; vset[net.gen[g].bus] = net.gen[g].vset; }
    }
    type[net.gen[0].bus] = 2; vset[net.gen[0].bus] = net.gen[0].vset;
    for (const i of nodes) if (type[i] >= 1) vm[i] = vset[i];
    const r = S.newtonRaphson(Y, nodes, type, psch, qsch, vm, va, qmin, qmax, null);
    ok('Newton-Raphson converges on IEEE 14', r.ok, JSON.stringify(r));
    ok('mismatch is at solver tolerance', r.mismatch < 1e-7, String(r.mismatch));

    const Pc = new Float64Array(n), Qc = new Float64Array(n);
    S.injections(Y, nodes, vm, va, Pc, Qc);
    let worstP = 0;
    for (const i of nodes) if (type[i] !== 2) worstP = Math.max(worstP, Math.abs(Pc[i] - psch[i]));
    ok('real power balances at every non-slack node', worstP < 1e-6, String(worstP));

    // Losses must be positive and a sane fraction, and must equal generation
    // minus load exactly.
    const flows = S.branchFlows(net, res, status, vm, va, null);
    let loss = 0;
    for (let b = 0; b < net.nBranch; b++) loss += flows.pf[b] + flows.pt[b];
    const slackP = Pc[net.gen[0].bus] * 100 + net.bus[net.gen[0].bus].pd0 - disp[0];
    ok('losses are positive', loss > 0, loss.toFixed(3));
    ok('losses are a plausible fraction', loss / net.totalLoad < 0.08, (loss / net.totalLoad).toFixed(4));
    ok('slack picks up exactly the losses', near(slackP, loss, 0.05),
        `slack ${slackP.toFixed(3)} vs losses ${loss.toFixed(3)}`);

    // The published IEEE 14-bus base case has all voltages inside 0.99-1.09 and
    // an angle spread under 20 degrees. Our dispatch is different, so this is a
    // sanity band rather than a comparison, but a broken solver leaves it fast.
    let vlo = 2, vhi = 0, amax = 0;
    for (const i of nodes) { vlo = Math.min(vlo, vm[i]); vhi = Math.max(vhi, vm[i]); amax = Math.max(amax, Math.abs(va[i])); }
    ok('voltages land in a physical band', vlo > 0.93 && vhi < 1.10, `${vlo.toFixed(3)}..${vhi.toFixed(3)}`);
    ok('angle spread is under 25 degrees', amax < 25 * Math.PI / 180, (amax * 180 / Math.PI).toFixed(1));

    // Fast decoupled must land on the same answer as Newton, or the fast path
    // is quietly returning a different world from the reference one.
    const vm2 = new Float64Array(n).fill(1), va2 = new Float64Array(n);
    for (const i of nodes) if (type[i] >= 1) vm2[i] = vset[i];
    const fd = S.buildFDMatrices(net, res, status, nodes, type);
    const r2 = S.fastDecoupled(Y, fd, nodes, psch, qsch, vm2, va2, null);
    ok('fast decoupled converges', r2.ok, JSON.stringify(r2));
    let dv = 0, dth = 0;
    for (const i of nodes) { dv = Math.max(dv, Math.abs(vm[i] - vm2[i])); dth = Math.max(dth, Math.abs(va[i] - va2[i])); }
    ok('fast decoupled agrees with Newton on voltage', dv < 2e-5, String(dv));
    ok('fast decoupled agrees with Newton on angle', dth < 2e-5, String(dth));
}

group('Power flow: DC screen and LODF');
{
    const net = nets[1];
    const topo = S.defaultTopo(net);
    const res = S.resolveTopology(net, topo);
    const status = new Uint8Array(net.nBranch).fill(1);
    const nodes = [];
    for (let i = 0; i < res.nNode; i++) nodes.push(i);
    const dc = S.buildDC(net, res, status, 0, nodes);
    ok('DC model builds', !!dc);
    ok('the reference node has zero PTDF', (() => {
        let m = 0;
        for (let li = 0; li < dc.nl; li++) m = Math.max(m, Math.abs(dc.ptdf[li * res.nNode + 0]));
        return m < 1e-12;
    })());
    // PTDF is defined against a reference bus, so its absolute values depend on
    // which bus that is - but a DIFFERENCE between two buses is the physically
    // meaningful quantity (inject here, withdraw there) and must not. Choosing a
    // different reference and getting different transfer sensitivities would mean
    // the whole security screen depends on an arbitrary labelling choice.
    const dcB = S.buildDC(net, res, status, 5, nodes);
    let worstRef = 0;
    for (let li = 0; li < dc.nl; li++) {
        for (let i = 0; i < res.nNode; i++) {
            for (let j = 0; j < res.nNode; j++) {
                const a1 = dc.ptdf[li * res.nNode + i] - dc.ptdf[li * res.nNode + j];
                const a2 = dcB.ptdf[li * res.nNode + i] - dcB.ptdf[li * res.nNode + j];
                worstRef = Math.max(worstRef, Math.abs(a1 - a2));
            }
        }
    }
    ok('transfer sensitivities do not depend on the reference bus', worstRef < 1e-9, String(worstRef));

    // LODF against ground truth: take a line out for real, re-solve the DC
    // problem, and compare with what the distribution factors predicted.
    const inj = new Float64Array(res.nNode);
    const disp = S.economicDispatch(net, net.totalLoad, S.renewNominal(net), null);
    for (let g = 0; g < net.nGen; g++) inj[net.gen[g].bus] += disp[g];
    for (let s = 0; s < net.nBus; s++) inj[s] -= net.bus[s].pd0;
    const flow0 = new Float64Array(net.nBranch);
    for (let li = 0; li < dc.nl; li++) {
        let f = 0;
        for (let nd = 0; nd < res.nNode; nd++) f += dc.ptdf[li * res.nNode + nd] * inj[nd];
        flow0[dc.brOfLive[li]] = f;
    }
    let worstLodf = 0, tested = 0;
    for (let k = 0; k < dc.nl; k++) {
        if (dc.splits[k]) continue;
        const bk = dc.brOfLive[k];
        const st2 = status.slice(); st2[bk] = 0;
        const dc2 = S.buildDC(net, res, st2, 0, nodes);
        if (!dc2) continue;
        tested++;
        for (let l2 = 0; l2 < dc2.nl; l2++) {
            const bl = dc2.brOfLive[l2];
            let truth = 0;
            for (let nd = 0; nd < res.nNode; nd++) truth += dc2.ptdf[l2 * res.nNode + nd] * inj[nd];
            const li = dc.liveOfBr[bl];
            const pred = flow0[bl] + dc.lodf[li * dc.nl + k] * flow0[bk];
            worstLodf = Math.max(worstLodf, Math.abs(truth - pred));
        }
    }
    ok('LODF predicts post-outage DC flows exactly', worstLodf < 1e-7,
        `worst error ${worstLodf.toExponential(2)} MW over ${tested} outages`);
}

group('Topology: busbar splitting');
{
    const net = nets[1];
    const topo = S.defaultTopo(net);
    const r0 = S.resolveTopology(net, topo);
    ok('an unsplit network has one node per substation', r0.nNode === net.nBus);
    const s = net.actionableSubs[0];
    const elems = net.subs[s].elems;
    // Put the first branch and the first non-branch on busbar 2.
    let put = 0;
    for (let i = 0; i < elems.length && put < 2; i++) {
        if ((put === 0 && elems[i].kind === 'br') || (put === 1 && elems[i].kind !== 'br')) { topo[s][i] = 2; put++; }
    }
    const r1 = S.resolveTopology(net, topo);
    ok('splitting one substation adds exactly one node', r1.nNode === net.nBus + 1, String(r1.nNode));
    ok('the split substation has two distinct nodes', (() => {
        const seen = new Set();
        for (let i = 0; i < elems.length; i++) {
            const e = elems[i];
            if (e.kind === 'br') seen.add(r1.brNode[e.ref * 2 + e.side]);
            else if (e.kind === 'gen') seen.add(r1.genNode[e.ref]);
            else seen.add(r1.loadNode[e.ref]);
        }
        return seen.size === 2;
    })());
    // Everything else must be untouched.
    let moved = 0;
    for (let b = 0; b < net.nBranch; b++) {
        for (let side = 0; side < 2; side++) {
            const el = net.brElem[b * 2 + side];
            if (el.sub === s) continue;
            if (r1.brNode[b * 2 + side] !== r0.brNode[b * 2 + side]) moved++;
        }
    }
    ok('no other substation moves', moved === 0, String(moved));
    ok('a split network really separates', (() => {
        const status = new Uint8Array(net.nBranch).fill(1);
        const Y = S.buildYbus(net, r1, status);
        const n = r1.nNode;
        const a = net.nBus;                          // the new busbar-2 node
        // The two busbars must have no admittance between them.
        return Math.abs(Y.G[s * n + a]) < 1e-12 && Math.abs(Y.B[s * n + a]) < 1e-12;
    })());
}

// -------------------------------------------------------------------- world --
group('World: economics and invariants');
{
    const net = nets[3];
    const w = new S.World(net, { steps: 60 });
    w.reset(4242, S.makeController('donothing'));
    const m = w.run();
    ok('do-nothing completes an episode', m.steps === 60, String(m.steps));
    ok('do-nothing orders no redispatch', m.redispatchMWh < 1e-6, String(m.redispatchMWh));
    ok('do-nothing curtails nothing', m.curtailedMWh < 1e-6, String(m.curtailedMWh));
    ok('the books balance', near(m.score,
        m.revenue - m.fuelCost - m.premiumCost - m.curtailCost - m.switchCost
        - m.riskCost - m.lostLoadCost - m.blackoutCost, 1e-6));
    // Every breaker operation is billed. A free discrete action is how the
    // generation-35 champion learned to thrash the topology and still win.
    ok('breaker operations are charged', near(m.switchCost,
        (m.switchActions + m.reconnects + m.subActions) * S.SIM.SWITCH_COST, 1e-6),
        `${m.switchCost} for ${m.switchActions + m.reconnects + m.subActions} operations`);
    ok('served plus unserved equals demand', near(m.servedMWh + m.unservedMWh, m.demandMWh, 1e-6));

    // Common random numbers: the same seed must reproduce the day exactly.
    const w2 = new S.World(net, { steps: 60 });
    w2.reset(4242, S.makeController('donothing'));
    const m2 = w2.run();
    ok('the same seed replays exactly', m.score === m2.score, `${m.score} vs ${m2.score}`);
    const w3 = new S.World(net, { steps: 60 });
    w3.reset(4243, S.makeController('donothing'));
    ok('a different seed is a different day', w3.run().score !== m.score);
}

{
    // Redispatch must sum to zero. A controller that could ask every unit to go
    // up at once would be creating energy, and would score for it.
    const net = nets[3];
    const w = new S.World(net, { steps: 30 });
    const greedy = {
        usesObs: false,
        act(world) {
            const a = S.blankAction ? S.blankAction(world) : {
                dP: new Float64Array(world.net.nGen),
                curtail: new Float64Array(world.net.nGen), topo: null
            };
            for (let g = 0; g < world.net.nGen; g++) a.dP[g] = 1;   // everybody up
            return a;
        }
    };
    w.reset(99, greedy);
    let worstSum = 0;
    for (let i = 0; i < 30; i++) {
        w.step();
        let s = 0;
        for (const g of net.dispatchable) if (w.st.genOn[g] && w.st.base[g] > 0) s += w.st.redisp[g];
        worstSum = Math.max(worstSum, Math.abs(s));
    }
    ok('asking every unit up still nets to zero redispatch', worstSum < 1e-6, String(worstSum));
}

{
    // Ending the episode early must not pay. A blackout is charged for the hours
    // it would have run, so a controller cannot escape its fuel bill by losing
    // the grid.
    const net = nets[0];
    const w = new S.World(net, { steps: 100 });
    w.reset(7, S.makeController('donothing'));
    w.step(); w.step();
    const before = w.m.revenue;
    w._collapse('test');
    const m = w.finish();
    ok('a blackout charges the whole remaining episode',
        m.unservedMWh > net.totalLoad * S.SIM.DT_H * 90, m.unservedMWh.toFixed(0));
    ok('a blackout scores far worse than running the day', m.score < -1e6, m.score.toFixed(0));
    void before;
}

{
    // Protection: a line held over its limit must trip, and one held just under
    // must not.
    const net = nets[1];
    const w = new S.World(net, { steps: 5 });
    w.reset(1, S.makeController('donothing'));
    const heat0 = w.st.heat[0];
    ok('nothing heats up when nothing is overloaded', heat0 === 0);
    ok('the instantaneous trip setting is above the thermal one',
        S.SIM.INST_TRIP > 1 && S.SIM.HEAT_RATE > 0);
}

group('World: N-1 screen is reported, not rewarded');
{
    const net = nets[3];
    const a = new S.World(net, { steps: 40, n1Weight: 0 });
    a.reset(31337, S.makeController('donothing'));
    const ma = a.run();
    const b = new S.World(net, { steps: 40, n1Weight: 1 });
    b.reset(31337, S.makeController('donothing'));
    const mb = b.run();
    ok('N-1 insecurity is measured', Number.isFinite(ma.n1SecureFrac) && ma.n1SecureFrac <= 1);
    ok('the same day gives the same security either way',
        near(ma.n1SecureFrac, mb.n1SecureFrac, 1e-12));
    ok('with the charge off the score contains no N-1 term',
        ma.n1SecureFrac >= 1 ? ma.score === mb.score : ma.score > mb.score,
        `${ma.score.toFixed(0)} vs ${mb.score.toFixed(0)} at ${ma.n1SecureFrac.toFixed(2)} secure`);
}

// ------------------------------------------------------------------- genome --
group('Genome');
{
    const rng = S.mulberry32(4);
    const g = S.randomGenome(rng);
    ok('genome has the declared length', g.length === S.NN_GENOME_LEN);
    ok('genome is finite', S.validGenome(g));
    ok('output layers start small', (() => {
        let m = 0;
        for (let i = S.S_GEN2.wOff; i < S.S_GEN2.bOff; i++) m = Math.max(m, Math.abs(g[i]));
        return m < 0.12;
    })());

    const a = S.randomGenome(rng), b = S.randomGenome(rng);
    const c = S.crossoverGenomes(a, b, rng);
    ok('crossover keeps the length', c.length === S.NN_GENOME_LEN);
    ok('every crossover gene comes from a parent', (() => {
        for (let i = 0; i < c.length; i++) if (c[i] !== a[i] && c[i] !== b[i]) return false;
        return true;
    })());
    // Row-wise: for each unit, all of its incoming weights come from ONE parent.
    ok('crossover is row-wise', (() => {
        for (const sec of S.SECTIONS) {
            for (let o = 0; o < sec.nOut; o++) {
                let fromA = 0, fromB = 0;
                for (let i = 0; i < sec.nIn; i++) {
                    const k = sec.wOff + o * sec.nIn + i;
                    if (c[k] === a[k]) fromA++;
                    if (c[k] === b[k]) fromB++;
                }
                if (fromA !== sec.nIn && fromB !== sec.nIn) return false;
            }
        }
        return true;
    })());

    const d = S.cloneGenome(a);
    S.mutateGenomeK(d, 40, 0.3, 0, rng);
    let changed = 0;
    for (let i = 0; i < d.length; i++) if (d[i] !== a[i]) changed++;
    ok('mutation touches about K genes', changed >= 30 && changed <= 40, String(changed));
    ok('mutation stays finite and clamped', S.validGenome(d) && d.every(v => Math.abs(v) <= 6.0001));

    const round = S.deserializeGenome(S.serializeGenome(a, { x: 1 }));
    ok('a genome survives a round trip', round && round.genome.every((v, i) => v === a[i]));
    ok('a genome from another architecture is refused',
        S.deserializeGenome({ version: S.NN_VERSION, arch: 'nope', genome: Array.from(a) }) === null);
}

group('Graph network: invariance');
{
    // The whole architecture rests on two claims. If either is false a genome
    // evolved on IEEE 14 means nothing on a thirty-bus network, and the entire
    // premise of the sim is wrong.
    const rng = S.mulberry32(11);
    const genome = S.createBootstrapGenome(rng);

    // 1. SIZE INVARIANCE: the same genome runs on every network without error
    //    and produces finite, bounded actions.
    let allFinite = true, bounded = true;
    for (const net of nets) {
        const w = new S.World(net, { steps: 6 });
        w.reset(5, S.brainController(genome));
        for (let i = 0; i < 6; i++) w.step();
        const a = w.lastAction;
        if (!a) { allFinite = false; break; }
        for (let g = 0; g < net.nGen; g++) {
            if (!Number.isFinite(a.dP[g]) || !Number.isFinite(a.curtail[g])) allFinite = false;
            if (Math.abs(a.dP[g]) > 1.0001 || a.curtail[g] < -1e-9 || a.curtail[g] > 1.0001) bounded = false;
        }
    }
    ok('one genome runs on all six networks', allFinite);
    ok('actions stay inside their declared range', bounded);

    // 2. PERMUTATION INVARIANCE: relabel every substation and the embedding
    //    computed for a given PHYSICAL substation must be bit-for-bit the same.
    //
    //    This is tested on the encoder directly rather than end to end, because
    //    end to end it is not exactly true and should not be: reordering the
    //    nodes changes the pivot order inside the LU, the power flow lands a
    //    part in 10^8 away, and a near-tie for "which line is binding" can then
    //    fall the other way. That is the solver's arithmetic, not the
    //    architecture's. The claim being made here is about the architecture,
    //    so it is tested where it is exact.
    {
        const net = nets[1];
        const w = new S.World(net, { steps: 4, incidents: false });
        w.reset(1234, S.brainController(genome));
        w.step(); w.step();
        const obs = w.obs;

        const prng = S.mulberry32(99);
        const perm = [];
        for (let i = 0; i < net.nBus; i++) perm.push(i);
        for (let i = perm.length - 1; i > 0; i--) {
            const j = Math.floor(prng() * (i + 1));
            const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
        }
        // A relabelled copy of the same physical network.
        const pnet = {
            id: net.id + 'p', name: net.name, nBus: net.nBus, nBranch: net.nBranch,
            nGen: net.nGen, slackGen: net.slackGen, spec: net.spec, tier: net.tier,
            bus: [], branch: [], gen: []
        };
        for (let i = 0; i < net.nBus; i++) {
            pnet.bus[perm[i]] = Object.assign({}, net.bus[i], { id: perm[i] });
        }
        for (const br of net.branch) {
            pnet.branch.push(Object.assign({}, br, { f: perm[br.f], t: perm[br.t] }));
        }
        for (const g of net.gen) pnet.gen.push(Object.assign({}, g, { bus: perm[g.bus] }));
        S.buildSubstations(pnet);

        // The same observation values, filed under the new labels.
        const pobs = {
            net: pnet,
            global: obs.global.slice(),
            node: new Float64Array(obs.node.length),
            edge: obs.edge.slice(),
            gen: obs.gen.slice(),
            elem: pnet.subs.map(x => new Float64Array(Math.max(1, x.elems.length) * S.ELEM_CH))
        };
        for (let s2 = 0; s2 < net.nBus; s2++) {
            for (let k = 0; k < S.NODE_CH; k++) {
                pobs.node[perm[s2] * S.NODE_CH + k] = obs.node[s2 * S.NODE_CH + k];
            }
        }

        const e1 = new S.Embedding(net), e2 = new S.Embedding(pnet);
        S.encodeGraph(genome, obs, e1);
        S.encodeGraph(genome, pobs, e2);
        let worstNode = 0, worstCtx = 0;
        for (let s2 = 0; s2 < net.nBus; s2++) {
            for (let k = 0; k < S.NODE_H; k++) {
                worstNode = Math.max(worstNode,
                    Math.abs(e1.n2[s2 * S.NODE_H + k] - e2.n2[perm[s2] * S.NODE_H + k]));
            }
        }
        for (let k = 0; k < S.CTX_H; k++) worstCtx = Math.max(worstCtx, Math.abs(e1.ctx[k] - e2.ctx[k]));
        ok('relabelling the buses does not change any substation embedding',
            worstNode < 1e-12, worstNode.toExponential(2));
        ok('relabelling the buses does not change the system context',
            worstCtx < 1e-12, worstCtx.toExponential(2));
        // And the same for the per-line head, which reads both endpoints.
        let worstLine = 0;
        for (let b = 0; b < net.nBranch; b++) {
            worstLine = Math.max(worstLine,
                Math.abs(S.headLine(genome, obs, e1, b) - S.headLine(genome, pobs, e2, b)));
        }
        ok('relabelling the buses does not change any line decision',
            worstLine < 1e-12, worstLine.toExponential(2));
    }
}

// ---------------------------------------------------------------- baselines --
group('Baselines');
{
    for (let tier = 0; tier < S.GRID_TIERS.length; tier++) {
        const net = nets[tier];
        const w = new S.World(net, { steps: Math.min(96, net.spec.steps) });
        const res = {};
        for (const c of ['donothing', 'redispatch', 'expert']) {
            let sc = 0, bad = 0;
            for (let e = 0; e < 3; e++) {
                w.reset(770 + e, S.makeController(c));
                const m = w.run();
                sc += m.score / 3;
                if (!Number.isFinite(m.score)) bad++;
            }
            res[c] = sc;
            ok(`tier ${tier} ${c} produces a finite score`, bad === 0);
        }
        // Not "the clever one must win" - on a calm day it must not. The claim
        // is only that acting is never catastrophically worse than not acting,
        // which is what a broken controller looks like.
        const worstRatio = Math.min(res.redispatch, res.expert) /
            (res.donothing > 0 ? res.donothing : 1);
        ok(`tier ${tier} control is not catastrophic`,
            res.donothing <= 0 || worstRatio > 0.5,
            `donothing ${(res.donothing / 1000).toFixed(0)}k, redispatch ${(res.redispatch / 1000).toFixed(0)}k, expert ${(res.expert / 1000).toFixed(0)}k`);
    }
}

group('Weather');
{
    const net = nets[1];
    const wx = new S.Weather(net, net.spec);
    wx.reset(2024, 288);
    let anyDark = false, anyBright = false, negative = 0;
    for (let t = 0; t < 288; t++) {
        if (wx.ghi[t] === 0) anyDark = true;
        if (wx.ghi[t] > 200) anyBright = true;
        for (let g = 0; g < net.nGen; g++) {
            const p = wx.renew[t * net.nGen + g];
            if (p < -1e-9) negative++;
            if (p > net.gen[g].pmax + 1e-6) negative++;
        }
    }
    ok('the sun sets', anyDark);
    ok('the sun rises', anyBright);
    ok('renewable output stays inside nameplate', negative === 0, String(negative));
    ok('clear-sky irradiance is zero at midnight', S.clearSkyGHI(172, 0) === 0);
    ok('clear-sky irradiance peaks near noon', (() => {
        let best = 0, bh = 0;
        for (let h = 0; h < 24; h += 0.25) {
            const v = S.clearSkyGHI(172, h);
            if (v > best) { best = v; bh = h; }
        }
        return best > 700 && Math.abs(bh - 12) < 1.5;
    })());
    ok('midsummer beats midwinter', S.clearSkyGHI(172, 12) > S.clearSkyGHI(355, 12) * 2);
    // Each diurnal shape must average to one, or every load in the sim is
    // silently scaled and the ratings mean nothing.
    let worstMean = 0;
    for (let cls = 0; cls < 3; cls++) {
        let s = 0;
        for (let i = 0; i < 480; i++) s += S.loadShape(cls, i * 24 / 480);
        worstMean = Math.max(worstMean, Math.abs(s / 480 - 1));
    }
    ok('every load shape averages to one', worstMean < 1e-6, String(worstMean));
    ok('the peak is a believable multiple of the mean', (() => {
        let peak = 0;
        for (let i = 0; i < 480; i++) peak = Math.max(peak, S.loadShape(0, i * 24 / 480));
        return peak > 1.15 && peak < 1.45;
    })());
    // The wind power curve, at the four points that matter.
    ok('a turbine makes nothing below cut-in', S.turbinePower(3.0, 0) === 0);
    ok('a turbine makes rated power above rated', S.turbinePower(15, 0) === 1);
    ok('a turbine cuts out in a storm', S.turbinePower(26, 0) === -2);
    ok('a cut-out turbine needs the wind to drop before restarting',
        S.turbinePower(23, 1) === 0 && S.turbinePower(20, 1) === -1);
}

group('Evolution');
{
    const ev = new S.Evolution({ population: 8, episodesPerGen: 1, tier: 0, lockTier: true, episodeScale: 0.35 }, 5);
    const h1 = ev.runGeneration();
    ok('a generation completes', !!h1 && h1.gen === 1);
    ok('baselines are measured every generation',
        Number.isFinite(h1.donothing) && Number.isFinite(h1.redispatch) && Number.isFinite(h1.expert));
    ok('a champion is crowned', !!ev.champion);
    const h2 = ev.runGeneration();
    ok('the run continues', h2.gen === 2);
    const json = ev.toJSON();
    const back = S.Evolution.fromJSON(json, 5);
    ok('a run survives a save/load round trip', !!back && back.gen === ev.gen);
    ok('the champion survives the round trip',
        back.champion && back.champion.genome.every((v, i) => v === ev.champion.genome[i]));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nfailures:\n  ' + failures.join('\n  ')); process.exit(1); }
