// The networks. Two are real test systems copied from the literature, the rest
// are generated, and all of them are described in the same structure so the
// controller cannot tell which is which.
//
// A note on the word "bus". In this file a bus is a SUBSTATION: a site with two
// busbars inside it. Every element at that site - each end of each line, each
// generator, the load - is clamped to busbar 1 or busbar 2. Clamp them all to
// busbar 1 and the substation behaves as one electrical node, which is how every
// network here starts. Split them and the site becomes two nodes and the power
// takes a different route. That is the discrete half of the action space, and it
// is why powerflow.js resolves a topology into nodes rather than assuming a node
// per bus.
//
// Thermal ratings are not copied from anywhere, because IEEE 14 does not ship
// with credible ones. They are computed: solve the DC base case at nominal load,
// then set each line's limit to its own base flow times a randomised headroom.
// That produces a network that is comfortable at nominal load and genuinely
// tight after one outage, which is the only regime where this problem is a
// problem.
'use strict';

// Marginal cost is euros per MWh of fuel and variable O&M. Ramp is the fraction
// of nameplate the unit can move in one five-minute dispatch interval - the
// number that decides whether the operator can respond to an event at all.
const GEN_KINDS = {
    nuclear: { cost: 11, ramp: 0.02, pminFrac: 0.60, qFrac: 0.45, renew: false, color: '#c084fc' },
    coal: { cost: 34, ramp: 0.035, pminFrac: 0.40, qFrac: 0.40, renew: false, color: '#94a3b8' },
    ccgt: { cost: 62, ramp: 0.09, pminFrac: 0.25, qFrac: 0.45, renew: false, color: '#fbbf24' },
    ocgt: { cost: 132, ramp: 0.28, pminFrac: 0.00, qFrac: 0.40, renew: false, color: '#fb923c' },
    hydro: { cost: 8, ramp: 0.45, pminFrac: 0.00, qFrac: 0.45, renew: false, color: '#38bdf8' },
    wind: { cost: 0, ramp: 1.00, pminFrac: 0.00, qFrac: 0.33, renew: true, color: '#5eead4' },
    solar: { cost: 0, ramp: 1.00, pminFrac: 0.00, qFrac: 0.30, renew: true, color: '#fde047' }
};

// Beyond fuel, moving a unit away from the dispatch the market cleared costs
// money: balancing-market premiums, wear, and the opportunity cost of the
// unit that was displaced. Priced per MWh of deviation, up and down.
const REDISPATCH_PREMIUM_UP = 19;
const REDISPATCH_PREMIUM_DOWN = 13;
const CURTAIL_PREMIUM = 42;      // paying a wind farm not to generate

const LOAD_CLASS = ['residential', 'commercial', 'industrial'];

// --- construction helpers ---------------------------------------------------
function makeBus(id, name, kv, x, y, pd, qd, cls) {
    return {
        id, name, baseKV: kv, x, y,
        pd0: pd, qd0: qd, gs: 0, bs: 0,
        loadClass: cls === undefined ? 0 : cls,
        // The statutory voltage band, which is not the same everywhere: the
        // transmission network is held tight, sub-transmission and generator
        // terminals are not.
        vlo: kv >= 150 ? 0.94 : 0.90,
        vhi: kv >= 150 ? 1.06 : 1.10
    };
}

function makeBranch(id, f, t, r, x, b, tap, kind) {
    return {
        id, f, t, r, x, b, tap: tap || 1,
        rate: 0, kind: kind || 'line',
        len: 0, name: `${f + 1}–${t + 1}`
    };
}

function makeGen(id, bus, kind, pmax, vset, name) {
    const k = GEN_KINDS[kind];
    return {
        id, bus, kind, name: name || `${kind[0].toUpperCase()}${kind.slice(1)} ${bus + 1}`,
        pmax, pmin: k.renew ? 0 : pmax * k.pminFrac,
        qmax: pmax * k.qFrac, qmin: -pmax * k.qFrac * 0.75,
        cost: k.cost, ramp: Math.max(1.5, pmax * k.ramp),
        vset: vset || 1.02, renew: k.renew, dispatchable: !k.renew
    };
}

// Substations are built last, from the finished element lists, so that the
// element ordering inside a substation is a deterministic function of the
// network and every genome sees the same one.
function buildSubstations(net) {
    net.subs = [];
    for (let s = 0; s < net.nBus; s++) net.subs.push({ id: s, elems: [] });
    net.brElem = new Array(net.nBranch * 2);
    net.genElem = new Array(net.nGen);
    net.loadElem = new Array(net.nBus).fill(null);

    for (let b = 0; b < net.nBranch; b++) {
        const br = net.branch[b];
        for (let side = 0; side < 2; side++) {
            const s = side === 0 ? br.f : br.t;
            const idx = net.subs[s].elems.length;
            net.subs[s].elems.push({ kind: 'br', ref: b, side, other: side === 0 ? br.t : br.f });
            net.brElem[b * 2 + side] = { sub: s, idx };
        }
    }
    for (let g = 0; g < net.nGen; g++) {
        const s = net.gen[g].bus;
        const idx = net.subs[s].elems.length;
        net.subs[s].elems.push({ kind: 'gen', ref: g, side: 0, other: -1 });
        net.genElem[g] = { sub: s, idx };
    }
    for (let s = 0; s < net.nBus; s++) {
        if (net.bus[s].pd0 === 0 && net.bus[s].qd0 === 0) continue;
        const idx = net.subs[s].elems.length;
        net.subs[s].elems.push({ kind: 'load', ref: s, side: 0, other: -1 });
        net.loadElem[s] = { sub: s, idx };
    }
    // A substation is only worth reconfiguring if both busbars can end up with
    // something on them that matters. Three elements can only ever be split
    // 1 + 2, which just isolates whatever is alone - that is a disconnection,
    // not a reconfiguration, and the line-switching action already covers it.
    net.actionableSubs = [];
    for (let s = 0; s < net.nBus; s++) {
        let nbr = 0;
        for (const e of net.subs[s].elems) if (e.kind === 'br') nbr++;
        if (net.subs[s].elems.length >= 4 && nbr >= 3) net.actionableSubs.push(s);
    }
    net.maxSubElems = 0;
    for (const s of net.subs) net.maxSubElems = Math.max(net.maxSubElems, s.elems.length);
}

function defaultTopo(net) {
    const topo = new Array(net.nBus);
    for (let s = 0; s < net.nBus; s++) topo[s] = new Int8Array(net.subs[s].elems.length).fill(1);
    return topo;
}

// --- IEEE 14-bus ------------------------------------------------------------
// Bus and branch data are the standard case (100 MVA base, 1962 AEP snapshot).
// The generation fleet is not: the published case has three synchronous
// condensers and one machine that swings the whole system, which is not a
// redispatch problem. The condensers at 3, 6 and 8 are replaced with real units
// and four renewable plants are added, giving a fleet with a merit order, ramp
// limits, and enough wind and solar to reverse the flow on the 33 kV side
// around noon.
function ieee14(rng, spec) {
    const P = [
        // id, name, kV, x, y, Pd, Qd, class
        [0, 'Wester', 132, 0.07, 0.83, 0, 0, 2],
        [1, 'Carrow', 132, 0.29, 0.83, 21.7, 12.7, 2],
        [2, 'Hallam', 132, 0.56, 0.85, 94.2, 19.0, 2],
        [3, 'Nordhav', 132, 0.52, 0.62, 47.8, -3.9, 1],
        [4, 'Ashby', 132, 0.29, 0.62, 7.6, 1.6, 1],
        [5, 'Brindle', 33, 0.14, 0.40, 11.2, 7.5, 0],
        [6, 'Kildare', 33, 0.62, 0.44, 0, 0, 0],
        [7, 'Tarn', 11, 0.81, 0.44, 0, 0, 0],
        [8, 'Merrow', 33, 0.55, 0.28, 29.5, 16.6, 0],
        [9, 'Alvern', 33, 0.42, 0.21, 9.0, 5.8, 0],
        [10, 'Penn', 33, 0.27, 0.28, 3.5, 1.8, 0],
        [11, 'Ogham', 33, 0.11, 0.20, 6.1, 1.6, 0],
        [12, 'Stane', 33, 0.22, 0.10, 13.5, 5.8, 0],
        [13, 'Vale', 33, 0.49, 0.09, 14.9, 5.0, 0]
    ];
    const L = [
        // f, t, r, x, b, tap
        [0, 1, 0.01938, 0.05917, 0.0528, 1],
        [0, 4, 0.05403, 0.22304, 0.0492, 1],
        [1, 2, 0.04699, 0.19797, 0.0438, 1],
        [1, 3, 0.05811, 0.17632, 0.0340, 1],
        [1, 4, 0.05695, 0.17388, 0.0346, 1],
        [2, 3, 0.06701, 0.17103, 0.0128, 1],
        [3, 4, 0.01335, 0.04211, 0.0000, 1],
        [3, 6, 0.00000, 0.20912, 0.0000, 0.978],
        [3, 8, 0.00000, 0.55618, 0.0000, 0.969],
        [4, 5, 0.00000, 0.25202, 0.0000, 0.932],
        [5, 10, 0.09498, 0.19890, 0.0000, 1],
        [5, 11, 0.12291, 0.25581, 0.0000, 1],
        [5, 12, 0.06615, 0.13027, 0.0000, 1],
        [6, 7, 0.00000, 0.17615, 0.0000, 1],
        [6, 8, 0.00000, 0.11001, 0.0000, 1],
        [8, 9, 0.03181, 0.08450, 0.0000, 1],
        [8, 13, 0.12711, 0.27038, 0.0000, 1],
        [9, 10, 0.08205, 0.19207, 0.0000, 1],
        [11, 12, 0.22092, 0.19988, 0.0000, 1],
        [12, 13, 0.17093, 0.34802, 0.0000, 1]
    ];
    const net = { id: 'ieee14', name: 'IEEE 14-bus', bus: [], branch: [], gen: [] };
    for (const p of P) net.bus.push(makeBus(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]));
    net.bus[8].bs = 19;                      // the 19 MVAr capacitor bank at bus 9
    for (let i = 0; i < L.length; i++) {
        const l = L[i];
        const br = makeBranch(i, l[0], l[1], l[2], l[3], l[4], l[5], l[5] !== 1 ? 'xfmr' : 'line');
        const a = net.bus[l[0]], b = net.bus[l[1]];
        br.len = Math.hypot(a.x - b.x, a.y - b.y);
        if (a.baseKV !== b.baseKV) br.kind = 'xfmr';
        net.branch.push(br);
    }
    const G = [
        makeGen(0, 0, 'ccgt', 190, 1.060, 'Wester CCGT'),
        makeGen(1, 1, 'coal', 140, 1.045, 'Carrow B'),
        makeGen(2, 2, 'ccgt', 100, 1.010, 'Hallam GT'),
        makeGen(3, 5, 'ocgt', 60, 1.070, 'Brindle peaker'),
        makeGen(4, 7, 'nuclear', 90, 1.090, 'Tarn Point'),
        makeGen(5, 12, 'wind', 90, 1.020, 'Stane Fen wind'),
        makeGen(6, 9, 'wind', 55, 1.020, 'Alvern wind'),
        makeGen(7, 4, 'solar', 70, 1.020, 'Ashby solar'),
        makeGen(8, 13, 'solar', 45, 1.020, 'Vale solar')
    ];
    net.gen = G;
    net.slackGen = 0;
    return finalizeNet(net, rng, spec);
}

// --- a six-bus warm-up ------------------------------------------------------
// Small enough that a single line outage is visible by eye and the whole state
// fits in a glance, which is what tier 0 is for.
function sixBus(rng, spec) {
    const net = { id: 'six', name: 'Sixmile', bus: [], branch: [], gen: [] };
    const P = [
        [0, 'Sixmile', 220, 0.16, 0.80, 0, 0, 2],
        [1, 'Drum', 220, 0.60, 0.84, 12, 5, 2],
        [2, 'Larne', 110, 0.82, 0.52, 45, 16, 1],
        [3, 'Moyle', 110, 0.50, 0.48, 58, 20, 0],
        [4, 'Glen', 110, 0.18, 0.36, 38, 13, 0],
        [5, 'Corrin', 110, 0.56, 0.14, 30, 10, 0]
    ];
    for (const p of P) net.bus.push(makeBus(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]));
    const L = [
        [0, 1, 0.020, 0.085, 0.040, 1], [0, 4, 0.000, 0.150, 0.000, 0.98],
        [1, 2, 0.000, 0.160, 0.000, 0.97], [1, 3, 0.000, 0.170, 0.000, 1.02],
        [2, 3, 0.048, 0.130, 0.014, 1], [3, 4, 0.055, 0.145, 0.016, 1],
        [3, 5, 0.062, 0.158, 0.012, 1], [2, 5, 0.071, 0.181, 0.010, 1]
    ];
    for (let i = 0; i < L.length; i++) {
        const l = L[i];
        const br = makeBranch(i, l[0], l[1], l[2], l[3], l[4], l[5]);
        const a = net.bus[l[0]], b = net.bus[l[1]];
        br.len = Math.hypot(a.x - b.x, a.y - b.y);
        if (a.baseKV !== b.baseKV) br.kind = 'xfmr';
        net.branch.push(br);
    }
    net.gen = [
        makeGen(0, 0, 'ccgt', 150, 1.045, 'Sixmile CCGT'),
        makeGen(1, 1, 'coal', 95, 1.035, 'Drum'),
        makeGen(2, 4, 'wind', 60, 1.020, 'Glen wind'),
        makeGen(3, 5, 'solar', 45, 1.020, 'Corrin solar')
    ];
    net.slackGen = 0;
    return finalizeNet(net, rng, spec);
}

// --- procedural regional networks -------------------------------------------
// A meshed transmission backbone with radial sub-transmission hanging off it and
// a scattering of cross-ties, which is what almost every real regional network
// looks like once you squint. The point of generating these is that the brain
// can then be graded on networks nobody trained on - a shared-weight graph net
// runs on any of them unchanged, so "did it learn power flow or did it memorise
// twenty lines" is a question with an actual answer.
function syntheticNet(rng, spec, nBus) {
    const NAMES = ['Aber', 'Braith', 'Cadair', 'Dinas', 'Eryri', 'Faenor', 'Garth', 'Hafod',
        'Idris', 'Jarn', 'Kenfig', 'Llyn', 'Moel', 'Nantle', 'Ogwen', 'Pwll', 'Quarry',
        'Rhiw', 'Sarn', 'Tryfan', 'Ulla', 'Vyrnwy', 'Wnion', 'Ynys', 'Zennor',
        'Alaw', 'Berw', 'Cefn', 'Dulas', 'Elan', 'Ffrwd', 'Gwyn', 'Hendre', 'Isaf'];
    const net = { id: 'syn' + nBus, name: `Regional ${nBus}-bus`, bus: [], branch: [], gen: [] };
    const nRing = Math.max(4, Math.min(12, Math.round(nBus * 0.42)));

    for (let i = 0; i < nRing; i++) {
        const a = (i / nRing) * Math.PI * 2 + rng() * 0.25;
        const rad = 0.30 + rng() * 0.07;
        net.bus.push(makeBus(i, NAMES[i % NAMES.length], 220,
            0.5 + Math.cos(a) * rad, 0.5 + Math.sin(a) * rad * 0.92, 0, 0, 2));
    }
    for (let i = nRing; i < nBus; i++) {
        const host = net.bus[Math.floor(rng() * Math.min(i, nRing + (i - nRing)))];
        const a = rng() * Math.PI * 2;
        const rad = 0.11 + rng() * 0.13;
        let x = host.x + Math.cos(a) * rad, y = host.y + Math.sin(a) * rad;
        x = Math.max(0.05, Math.min(0.95, x));
        y = Math.max(0.05, Math.min(0.95, y));
        net.bus.push(makeBus(i, NAMES[i % NAMES.length] + (i >= NAMES.length ? ' II' : ''),
            110, x, y, 0, 0, Math.floor(rng() * 3)));
        net.bus[i]._host = host.id;
    }

    const seen = new Set();
    const addLine = (f, t) => {
        if (f === t) return false;
        const k = Math.min(f, t) * 1000 + Math.max(f, t);
        if (seen.has(k)) return false;
        seen.add(k);
        const a = net.bus[f], b = net.bus[t];
        const len = Math.max(0.04, Math.hypot(a.x - b.x, a.y - b.y));
        const xfmr = a.baseKV !== b.baseKV;
        let br;
        if (xfmr) {
            br = makeBranch(net.branch.length, f, t, 0.0025, 0.09 + rng() * 0.09, 0,
                0.96 + rng() * 0.08, 'xfmr');
        } else {
            // Overhead line: X grows with length, R/X around 0.25 at 220 kV and
            // 0.45 at 110 kV, shunt charging proportional to length.
            const hv = a.baseKV >= 220 && b.baseKV >= 220;
            const x = len * (hv ? 0.42 : 0.70) * (0.85 + rng() * 0.3);
            br = makeBranch(net.branch.length, f, t, x * (hv ? 0.25 : 0.45), x,
                len * (hv ? 0.16 : 0.05), 1, 'line');
        }
        br.len = len;
        net.branch.push(br);
        return true;
    };

    for (let i = 0; i < nRing; i++) addLine(i, (i + 1) % nRing);
    const nChord = Math.max(1, Math.floor(nRing / 4));
    for (let i = 0; i < nChord; i++) {
        const a = Math.floor(rng() * nRing);
        addLine(a, (a + 2 + Math.floor(rng() * Math.max(1, nRing - 4))) % nRing);
    }
    for (let i = nRing; i < nBus; i++) addLine(i, net.bus[i]._host);
    // Cross-ties. Every spur gets a SECOND connection, without exception: a
    // radial tail is a bus whose supply one outage takes away and no operator
    // can do anything about it, so a network full of them measures the outage
    // draw rather than the controller. Real sub-transmission is meshed for
    // exactly this reason. The preferred tie is the nearest bus that is not
    // already its host; if nothing is close enough, it takes a second backbone
    // bus instead.
    const degree = new Int32Array(nBus);
    for (const br of net.branch) { degree[br.f]++; degree[br.t]++; }
    for (let i = nRing; i < nBus; i++) {
        if (degree[i] >= 2) continue;
        let best = -1, bd = 1e9;
        for (let j = 0; j < nBus; j++) {
            if (j === i || j === net.bus[i]._host) continue;
            const d = Math.hypot(net.bus[i].x - net.bus[j].x, net.bus[i].y - net.bus[j].y);
            if (d < bd) { bd = d; best = j; }
        }
        if (best >= 0 && addLine(i, best)) { degree[i]++; degree[best]++; }
    }
    // A few extra ties between neighbouring spurs, so the sub-transmission is
    // genuinely meshed rather than merely doubly-fed.
    for (let i = nRing; i < nBus; i++) {
        if (rng() > 0.3) continue;
        let best = -1, bd = 1e9;
        for (let j = nRing; j < nBus; j++) {
            if (j === i || net.bus[j]._host === net.bus[i]._host) continue;
            const d = Math.hypot(net.bus[i].x - net.bus[j].x, net.bus[i].y - net.bus[j].y);
            if (d < bd) { bd = d; best = j; }
        }
        if (best >= 0 && bd < 0.30) addLine(i, best);
    }

    // Loads. Spur buses carry most of it; backbone buses carry a little. Every
    // load bus of any size gets a shunt capacitor covering a bit over half its
    // reactive demand, because every real one does: without local compensation
    // the reactive power has to come down the same lines as the real power and a
    // thirty-bus network sits at 0.89 pu on a good day and collapses on a bad
    // one. That was not a solver problem, it was a missing capacitor bank.
    let total = 0;
    for (let i = 0; i < nBus; i++) {
        const spur = i >= nRing;
        if (!spur && rng() > 0.45) continue;
        const base = spur ? 16 + Math.exp(rng() * 1.5) * 9 : 8 + rng() * 22;
        net.bus[i].pd0 = Math.round(base);
        net.bus[i].qd0 = Math.round(base * (0.18 + rng() * 0.22));
        if (net.bus[i].qd0 >= 5) {
            net.bus[i].bs = Math.round(net.bus[i].qd0 * (0.45 + rng() * 0.3));
        }
        total += net.bus[i].pd0;
    }
    if (total < 40) { net.bus[nRing % nBus].pd0 += 60; total += 60; }

    // Fleet: enough firm capacity for ~1.85x nominal load, plus renewables at
    // roughly nameplate-equals-load, which is where the interesting hours are.
    const firmTarget = total * 1.85;
    const ringOrder = [];
    for (let i = 0; i < nRing; i++) ringOrder.push(i);
    for (let i = ringOrder.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = ringOrder[i]; ringOrder[i] = ringOrder[j]; ringOrder[j] = t;
    }
    const menu = ['ccgt', 'coal', 'ccgt', 'hydro', 'ocgt', 'nuclear', 'ccgt', 'coal'];
    let firm = 0, gi = 0, slot = 0;
    // The slack has to be able to swing both ways all day, so it is always a
    // large gas unit at a backbone bus.
    net.gen.push(makeGen(gi++, ringOrder[0], 'ccgt', Math.round(firmTarget * 0.34), 1.05));
    firm += net.gen[0].pmax;
    slot = 1;
    while (firm < firmTarget && slot < ringOrder.length) {
        const kind = menu[(slot - 1) % menu.length];
        const size = Math.round(Math.max(35, firmTarget * (0.12 + rng() * 0.16)));
        net.gen.push(makeGen(gi++, ringOrder[slot], kind, size, 1.03 + rng() * 0.03));
        firm += size;
        slot++;
    }
    let renew = 0;
    const renewTarget = total * (0.75 + rng() * 0.55);
    const far = [];
    for (let i = 0; i < nBus; i++) far.push(i);
    far.sort((a, b) => Math.hypot(net.bus[b].x - 0.5, net.bus[b].y - 0.5) -
        Math.hypot(net.bus[a].x - 0.5, net.bus[a].y - 0.5));
    let fi = 0;
    while (renew < renewTarget && fi < far.length) {
        const bus = far[fi++];
        if (net.gen.some(g => g.bus === bus && g.renew)) continue;
        const kind = rng() < 0.55 ? 'wind' : 'solar';
        const size = Math.round(Math.max(20, renewTarget * (0.16 + rng() * 0.2)));
        net.gen.push(makeGen(gi++, bus, kind, size, 1.02));
        renew += size;
    }
    net.slackGen = 0;
    for (const b of net.bus) delete b._host;
    return finalizeNet(net, rng, spec);
}

// --- finishing --------------------------------------------------------------
// Everything that has to be true of every network regardless of where it came
// from: indices consistent, substations built, and ratings sized off a real DC
// base case rather than guessed.
function finalizeNet(net, rng, spec) {
    net.nBus = net.bus.length;
    net.nBranch = net.branch.length;
    net.nGen = net.gen.length;
    for (let i = 0; i < net.nBranch; i++) net.branch[i].id = i;
    for (let i = 0; i < net.nGen; i++) net.gen[i].id = i;
    for (const br of net.branch) {
        if (!br.len) br.len = Math.hypot(net.bus[br.f].x - net.bus[br.t].x,
            net.bus[br.f].y - net.bus[br.t].y);
    }
    buildSubstations(net);

    net.totalLoad = 0;
    for (const b of net.bus) net.totalLoad += b.pd0;
    net.firmCap = 0; net.renewCap = 0;
    for (const g of net.gen) { if (g.renew) net.renewCap += g.pmax; else net.firmCap += g.pmax; }
    net.dispatchable = net.gen.filter(g => g.dispatchable).map(g => g.id);
    net.renewables = net.gen.filter(g => g.renew).map(g => g.id);

    // Reactive planning. A generated network can quite easily come out with a
    // heavy load at the end of a long high-reactance path and no local source of
    // reactive power, and such a network collapses at 1.1x nominal load no
    // matter who is operating it. A real planner would not build it; they would
    // size the capacitor banks until the peak case stands up. So that is what
    // happens here - shunt compensation is increased until the worst study case
    // solves with every voltage above 0.93 pu, or until it is clear the network
    // is beyond saving and the loads come down instead.
    //
    // This is not making the problem easier. It is removing a failure mode that
    // has nothing to do with the controller, so that when a network does collapse
    // later it is because of something the operator did or failed to do.
    reactivePlanning(net);

    // Thermal ratings. A transmission network is not built to carry its base
    // case; it is built so that it still carries every flow it has to, after any
    // single element is lost, in every operating condition the planner studied.
    // So the ratings here come out of exactly that: six study cases spanning the
    // load and renewable range, an N-1 sweep over every branch outage in each,
    // and the element-wise maximum.
    //
    // At a security factor of 1.00 the network is exactly N-1 secure across the
    // whole studied envelope and not one megawatt more. The tier sets the factor.
    // Below 1.0 the network is not secure even on paper, which is what the storm
    // tiers are, and the operator's job is to hold a system together that was
    // never designed to hold itself together.
    const worst = stressEnvelope(net);

    const lo = spec && spec.security ? spec.security[0] : 1.15;
    const hi = spec && spec.security ? spec.security[1] : 1.30;
    const n0f = spec && spec.n0Factor !== undefined ? spec.n0Factor : 1.25;
    const jitter = spec && spec.rateJitter !== undefined ? spec.rateJitter : 0.16;
    for (let b = 0; b < net.nBranch; b++) {
        const br = net.branch[b];
        const sec = lo + rng() * (hi - lo);
        const j = Math.exp((rng() * 2 - 1) * jitter);
        // A branch whose worst studied flow happens to be near zero still has
        // copper in it. The floor scales with system load so it means the same
        // thing on every network.
        const floorMVA = Math.max(10, net.totalLoad * (br.kind === 'xfmr' ? 0.07 : 0.045));
        br.rate = Math.round(Math.max(floorMVA,
            worst.n0[b] * n0f * j, worst.envelope[b] * sec * j));
        br.rate0 = br.rate;
    }
    net.baseFlow = worst.base;
    net.n0Envelope = worst.n0;
    net.n1Envelope = worst.envelope;
    return net;
}

// Typical renewable output used only for sizing: not a forecast, just a number
// that is neither zero nor nameplate.
function renewNominal(net) {
    const p = new Float64Array(net.nGen);
    for (const g of net.gen) if (g.renew) p[g.id] = g.pmax * (g.kind === 'wind' ? 0.32 : 0.22);
    return p;
}

// The dispatch the market clears, and the reference point everything the
// controller does is measured against. Three stages, in the order a real
// day-ahead process runs them:
//
//   1. renewables take everything they can, because their marginal cost is zero
//   2. UNIT COMMITMENT: dispatchable units come on in merit order until the
//      committed capacity covers the residual demand with a reserve margin. The
//      slack unit is always committed - a system whose swing machine is off has
//      nothing to swing.
//   3. committed units sit at their minimum stable generation and the remainder
//      is filled in merit order.
//
// Stage 2 is what makes redispatch possible at all. Without a reserve margin
// every unit sits pinned at a limit and the operator has no lever; with it there
// is headroom in both directions at several places on the network, which is
// exactly the resource a control room spends.
const RESERVE_MARGIN = 1.22;

function economicDispatch(net, demandMW, renewMW, availability) {
    const p = new Float64Array(net.nGen);
    const on = gi => (availability ? !!availability[gi] : true);
    let residual = demandMW;
    for (const g of net.gen) {
        if (!g.renew) continue;
        p[g.id] = on(g.id) ? Math.max(0, renewMW[g.id]) : 0;
        residual -= p[g.id];
    }

    const order = net.dispatchable.filter(on).sort((a, b) => net.gen[a].cost - net.gen[b].cost);
    const committed = [];
    let cap = 0, minSum = 0;
    if (on(net.slackGen) && net.gen[net.slackGen].dispatchable) {
        committed.push(net.slackGen);
        cap += net.gen[net.slackGen].pmax;
        minSum += net.gen[net.slackGen].pmin;
    }
    for (const gi of order) {
        if (committed.indexOf(gi) >= 0) continue;
        if (cap >= Math.max(0, residual) * RESERVE_MARGIN) break;
        committed.push(gi);
        cap += net.gen[gi].pmax;
        minSum += net.gen[gi].pmin;
    }
    // Technical minimum above the residual: back out the most expensive
    // committed units until it fits, keeping the slack.
    committed.sort((a, b) => net.gen[a].cost - net.gen[b].cost);
    while (minSum > residual && committed.length > 1) {
        const gi = committed.pop();
        if (gi === net.slackGen) { committed.push(gi); break; }
        minSum -= net.gen[gi].pmin;
    }

    for (const gi of committed) p[gi] = net.gen[gi].pmin;
    let rem = residual - minSum;
    for (const gi of committed) {
        if (rem <= 0) break;
        const take = Math.min(net.gen[gi].pmax - p[gi], rem);
        p[gi] += take;
        rem -= take;
    }
    // Still oversupplied at technical minimum: curtail renewables, most recently
    // built first. Negative residual demand is a real and increasingly common
    // condition on a windy Sunday night.
    if (rem < -1e-6) {
        let excess = -rem;
        for (let i = net.gen.length - 1; i >= 0 && excess > 0; i--) {
            const g = net.gen[i];
            if (!g.renew) continue;
            const cut = Math.min(p[g.id], excess);
            p[g.id] -= cut; excess -= cut;
        }
    }
    return p;
}

// A standalone DC flow used for rating and for the sanity checks. Uses the same
// machinery as the security screen so the two can never disagree.
function dcBaseFlow(net, injMW) {
    const topo = defaultTopo(net);
    const res = resolveTopology(net, topo);
    const status = new Uint8Array(net.nBranch).fill(1);
    const isl = findIslands(net, res, status);
    const flows = new Float64Array(net.nBranch);
    for (let c = 0; c < isl.nComp; c++) {
        const nodes = [];
        for (let i = 0; i < res.nNode; i++) if (isl.comp[i] === c) nodes.push(i);
        if (nodes.length < 2) continue;
        const ref = nodes[0];
        const dc = buildDC(net, res, status, ref, nodes);
        if (!dc) continue;
        for (let li = 0; li < dc.nl; li++) {
            let f = 0;
            for (const nd of nodes) {
                const p = dc.ptdf[li * res.nNode + nd];
                if (p) f += p * (injMW[nd] || 0);
            }
            flows[dc.brOfLive[li]] = f;
        }
    }
    return flows;
}

// One AC solve of a study case with everything in service, used only at build
// time. Returns whether it stands up and how low the voltage gets.
function acStudyCase(net, loadScale, renewFrac) {
    const topo = defaultTopo(net);
    const res = resolveTopology(net, topo);
    const status = new Uint8Array(net.nBranch).fill(1);
    const Y = buildYbus(net, res, status);
    const nN = res.nNode;
    const nodes = [];
    for (let i = 0; i < nN; i++) nodes.push(i);
    const vm = new Float64Array(nN).fill(1), va = new Float64Array(nN);
    const psch = new Float64Array(nN), qsch = new Float64Array(nN);
    const type = new Int8Array(nN), vset = new Float64Array(nN).fill(1);
    const qmin = new Float64Array(nN), qmax = new Float64Array(nN);
    const renew = new Float64Array(net.nGen);
    for (const g of net.gen) if (g.renew) renew[g.id] = g.pmax * renewFrac;
    const disp = economicDispatch(net, net.totalLoad * loadScale, renew, null);
    for (let s = 0; s < net.nBus; s++) {
        psch[res.loadNode[s]] -= net.bus[s].pd0 * loadScale / PF.BASE_MVA;
        qsch[res.loadNode[s]] -= net.bus[s].qd0 * loadScale / PF.BASE_MVA;
    }
    for (let g = 0; g < net.nGen; g++) {
        const nd = res.genNode[g];
        psch[nd] += disp[g] / PF.BASE_MVA;
        qmin[nd] += net.gen[g].qmin / PF.BASE_MVA;
        qmax[nd] += net.gen[g].qmax / PF.BASE_MVA;
        if (disp[g] > 0.02 * net.gen[g].pmax) { type[nd] = 1; vset[nd] = net.gen[g].vset; }
    }
    const slackNd = res.genNode[net.slackGen];
    type[slackNd] = 2; vset[slackNd] = net.gen[net.slackGen].vset;
    for (const i of nodes) if (type[i] >= 1) vm[i] = vset[i];
    const r = newtonRaphson(Y, nodes, type, psch, qsch, vm, va, qmin, qmax, null);
    let lo = 2;
    for (const i of nodes) if (vm[i] < lo) lo = vm[i];
    return { ok: r.ok, vmin: r.ok ? lo : 0 };
}

// Increase shunt compensation at load buses until the worst study case stands
// up with acceptable voltages. Every capacitor added here is one a real planner
// would have specified for exactly the same reason.
function reactivePlanning(net) {
    const worstCase = () => {
        const a = acStudyCase(net, 1.55, 0.05);       // peak, becalmed
        const b = acStudyCase(net, 1.15, 0.88);       // sunny noon
        return (!a.ok || (b.ok && b.vmin < a.vmin)) ? a : b;
    };
    let r = worstCase();
    net.svcAdded = 0;
    for (let pass = 0; pass < 8 && (!r.ok || r.vmin < 0.93); pass++) {
        let added = 0;
        for (const bus of net.bus) {
            if (bus.qd0 <= 0) continue;
            const step = Math.max(2, bus.qd0 * 0.3);
            bus.bs += step;
            added += step;
        }
        if (added <= 0) break;
        net.svcAdded += added;
        r = worstCase();
    }
    // Still standing on its head after eight passes: the layout itself is bad,
    // so the loads come down rather than shipping a network nobody could run.
    for (let pass = 0; pass < 6 && (!r.ok || r.vmin < 0.90); pass++) {
        for (const bus of net.bus) { bus.pd0 = Math.round(bus.pd0 * 0.88); bus.qd0 = Math.round(bus.qd0 * 0.88); }
        net.totalLoad = net.bus.reduce((a, b) => a + b.pd0, 0);
        r = worstCase();
    }
    net.planVmin = r.vmin;
    net.planOk = r.ok;
    return net;
}

// The planner's study cases. Between them they bracket the operating range the
// network will actually see: the peak hour with no wind, the light-load hour
// with all of it, a windy night, a sunny noon. A network rated on the average
// day is overloaded on every one of them, which is what the first version of
// this file did and why every tier looked like a storm.
function studyCases(net) {
    const nom = net.totalLoad;
    const cf = (wind, solar) => {
        const p = new Float64Array(net.nGen);
        for (const g of net.gen) if (g.renew) p[g.id] = g.pmax * (g.kind === 'wind' ? wind : solar);
        return p;
    };
    // The load multipliers bracket what an episode can actually produce: the
    // per-episode scale (0.94-1.08), the tier's own scale (up to 1.12) and the
    // normalised diurnal peak (about 1.33) multiply out to roughly 1.55 at the
    // very worst and 0.48 at four in the morning on a mild Sunday.
    const cases = [
        { name: 'nominal', load: nom, renew: cf(0.32, 0.22) },
        { name: 'peak, becalmed', load: nom * 1.55, renew: cf(0.05, 0.02) },
        { name: 'light, blowing', load: nom * 0.48, renew: cf(0.92, 0.10) },
        { name: 'windy night', load: nom * 0.85, renew: cf(0.92, 0.00) },
        { name: 'sunny noon', load: nom * 1.15, renew: cf(0.12, 0.88) },
        { name: 'peak, blowing', load: nom * 1.45, renew: cf(0.85, 0.55) }
    ];
    // Plus one CONNECTION case per renewable plant: that plant at full output
    // while the rest of the fleet is becalmed, at a load high enough that
    // nothing gets curtailed. The fleet-wide cases above all move every farm
    // together, and when they push the total past demand the dispatch curtails
    // and the individual connection never sees its own full output. Real
    // weather does not work like that - one farm sits in the wind while its
    // neighbour twenty kilometres away sits in the lee - and a connection sized
    // without this case is the line that ends up at 160% for a whole evening
    // with nobody able to do anything about it.
    const big = net.gen.filter(g => g.renew).sort((a, b) => b.pmax - a.pmax).slice(0, 6);
    for (const g of big) {
        const r = cf(0.12, 0.08);
        r[g.id] = g.pmax * 0.95;
        cases.push({ name: `${g.name} at full output`, load: nom * 1.05, renew: r });
    }
    return cases;
}

// For every branch, the largest flow it carries anywhere in the studied
// envelope: across every study case, and within each case across every single
// branch outage. Outages that would island the network are skipped - no rating
// protects against those.
// Returns two envelopes per branch: the worst flow with everything in service
// (n0) and the worst flow after any single outage (n1). A rating is set from
// both, because they say different things - n0 headroom is how much room the
// operator has on an ordinary evening, n1 headroom is whether the network
// survives losing something. A tier tightens them independently.
function stressEnvelope(net) {
    const topo = defaultTopo(net);
    const res = resolveTopology(net, topo);
    const status = new Uint8Array(net.nBranch).fill(1);
    const isl = findIslands(net, res, status);
    const dcs = [];
    for (let c = 0; c < isl.nComp; c++) {
        const nodes = [];
        for (let i = 0; i < res.nNode; i++) if (isl.comp[i] === c) nodes.push(i);
        if (nodes.length < 2) continue;
        const dc = buildDC(net, res, status, nodes[0], nodes);
        if (dc) dcs.push(dc);
    }
    const n0 = new Float64Array(net.nBranch);
    const envelope = new Float64Array(net.nBranch);
    let base = null;
    for (const cs of studyCases(net)) {
        const inj = new Float64Array(res.nNode);
        const scale = cs.load / Math.max(1, net.totalLoad);
        const disp = economicDispatch(net, cs.load, cs.renew, null);
        for (let g = 0; g < net.nGen; g++) inj[res.genNode[g]] += disp[g];
        for (let s = 0; s < net.nBus; s++) inj[res.loadNode[s]] -= net.bus[s].pd0 * scale;
        const flows = new Float64Array(net.nBranch);
        for (const dc of dcs) {
            for (let li = 0; li < dc.nl; li++) {
                let f = 0;
                for (let nd = 0; nd < res.nNode; nd++) {
                    const p = dc.ptdf[li * res.nNode + nd];
                    if (p && inj[nd]) f += p * inj[nd];
                }
                flows[dc.brOfLive[li]] = f;
            }
        }
        if (!base) base = flows.slice();
        for (let b = 0; b < net.nBranch; b++) {
            const a = Math.abs(flows[b]);
            if (a > n0[b]) n0[b] = a;
            if (a > envelope[b]) envelope[b] = a;
        }
        for (const dc of dcs) {
            for (let k = 0; k < dc.nl; k++) {
                if (dc.splits[k]) continue;
                const fk = flows[dc.brOfLive[k]];
                for (let l = 0; l < dc.nl; l++) {
                    if (l === k) continue;
                    const bl = dc.brOfLive[l];
                    const f = Math.abs(flows[bl] + dc.lodf[l * dc.nl + k] * fk);
                    if (f > envelope[bl]) envelope[bl] = f;
                }
            }
        }
    }
    return { n0, envelope, base: base || new Float64Array(net.nBranch) };
}

// --- tiers ------------------------------------------------------------------
// Each tier is a harder control room. The ladder has no gaps in it - a rung the
// population cannot reach traps the whole run, which is the mistake the chess
// sim spent a week on.
const GRID_TIERS = [
    {
        name: 'Sixmile, calm day', build: 'six', buses: 6,
        security: [1.30, 1.50], n0Factor: 1.55, rateJitter: 0.08,
        loadScale: 1.0, loadVol: 0.55, rampEvents: 0.15,
        forcedOutages: 0, genOutages: 0, cloudiness: 0.6, windMean: 1.0,
        steps: 108, blurb: 'six substations, mild weather, nothing breaks'
    },
    {
        name: 'IEEE 14, calm day', build: 'ieee14', buses: 14,
        security: [0.96, 1.08], n0Factor: 1.28, rateJitter: 0.10,
        loadScale: 1.0, loadVol: 0.7, rampEvents: 0.3,
        forcedOutages: 0.5, genOutages: 0, cloudiness: 0.6, windMean: 1.0,
        steps: 132, blurb: 'a small grid on a calm day, the odd fault'
    },
    {
        name: 'IEEE 14, windy', build: 'ieee14', buses: 14,
        security: [0.82, 0.92], n0Factor: 1.16, rateJitter: 0.12,
        loadScale: 1.05, loadVol: 1.0, rampEvents: 0.7,
        forcedOutages: 1.4, genOutages: 0.15, cloudiness: 1.15, windMean: 1.25,
        steps: 144, blurb: 'gusty wind, a line or two goes down'
    },
    {
        name: 'IEEE 14, storm', build: 'ieee14', buses: 14,
        security: [0.70, 0.80], n0Factor: 1.06, rateJitter: 0.14,
        loadScale: 1.12, loadVol: 1.3, rampEvents: 1.2,
        forcedOutages: 2.4, genOutages: 0.5, cloudiness: 1.4, windMean: 1.35,
        steps: 156, blurb: 'heavy demand, a storm, no spare capacity'
    },
    {
        name: 'Regional 22-bus', build: 'syn', buses: 22,
        security: [0.78, 0.88], n0Factor: 1.12, rateJitter: 0.12,
        loadScale: 1.05, loadVol: 1.0, rampEvents: 0.7,
        forcedOutages: 2.0, genOutages: 0.25, cloudiness: 1.1, windMean: 1.15,
        steps: 144, blurb: 'a shape the AI was never trained on'
    },
    {
        name: 'Regional 30-bus, storm', build: 'syn', buses: 30,
        security: [0.84, 0.94], n0Factor: 1.10, rateJitter: 0.14,
        loadScale: 1.06, loadVol: 1.35, rampEvents: 1.3,
        forcedOutages: 1.6, genOutages: 0.4, cloudiness: 1.45, windMean: 1.4,
        steps: 168, blurb: 'the big one — a storm and no room to spare'
    }
];

function makeNetwork(tier, seed) {
    const spec = GRID_TIERS[Math.max(0, Math.min(GRID_TIERS.length - 1, tier | 0))];
    const rng = mulberry32(seed >>> 0);
    let net;
    if (spec.build === 'six') net = sixBus(rng, spec);
    else if (spec.build === 'ieee14') net = ieee14(rng, spec);
    else net = syntheticNet(rng, spec, spec.buses);
    net.tier = tier;
    net.spec = spec;
    net.seed = seed >>> 0;
    net.label = spec.name;
    return net;
}

if (typeof module !== 'undefined') {
    module.exports = {
        GEN_KINDS, GRID_TIERS, LOAD_CLASS,
        REDISPATCH_PREMIUM_UP, REDISPATCH_PREMIUM_DOWN, CURTAIL_PREMIUM,
        makeNetwork, ieee14, sixBus, syntheticNet, finalizeNet, stressEnvelope, studyCases, acStudyCase, reactivePlanning,
        buildSubstations, defaultTopo, economicDispatch, dcBaseFlow, renewNominal
    };
}
