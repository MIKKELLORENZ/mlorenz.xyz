// What does the evolved controller actually DO?
//
//   node probe_champion.js [training/run1/champion.json] [tier]
//
// A score says a brain is better; it does not say why, and it hides everything
// that is obvious in the behaviour and invisible in the number. This reports the
// things a traffic engineer would look at: cycle lengths, how the green is
// split, what clearance intervals it chose, whether it ever runs the pedestrian
// phase, how often it hits the max-out timer, and whether neighbouring
// junctions actually coordinate. Each is printed next to the vehicle-actuated
// controller measured on the identical traffic.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSim } = require('./harness');
const S = loadSim(__dirname);

const src = process.argv[2] || 'training/run1/champion.json';
const TIER = process.argv[3] === undefined ? 4 : parseInt(process.argv[3], 10);
const SEEDS = [1, 2, 3];

let genome = null;
try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, src), 'utf8'));
    genome = S.repairGenome(Float64Array.from(raw.genome || raw.genome));
} catch (e) {
    console.log(`could not read ${src} (${e.message}) - probing the hand-written prior instead`);
    genome = S.createBootstrapGenome(S.mulberry32(3));
}

// Watch every phase change at every junction for a whole episode.
function probe(city, controller, seed) {
    const w = new S.World(city, { episodeLen: 240 });
    w.reset(seed, controller);
    const n = w.lights.length;
    const last = w.lights.map(l => ({ phase: l.phase, t: 0 }));
    const stat = {
        greens: [], amber: [], allRed: [], maxOuts: 0, pedPhases: 0, changes: 0,
        splitNS: 0, splitEW: 0, splitPed: 0, starve: 0
    };
    // Where each junction was in its cycle, sampled once a second, so a green
    // wave shows up as a stable offset between neighbours rather than noise.
    const trace = [];
    while (w.t < w.episodeLen) {
        const before = w.lights.map(l => l.phase + ':' + l.state);
        w.step(S.SIM.DT);
        for (let i = 0; i < n; i++) {
            const l = w.lights[i];
            const now = l.phase + ':' + l.state;
            if (now === before[i]) continue;
            if (l.state === S.ST.AMBER) {
                stat.changes++;
                stat.greens.push(w.t - last[i].t);
                last[i].t = w.t;
                stat.amber.push(l.amberDur);
                stat.allRed.push(l.allRedDur);
                if (l.tPhase >= S.SIG.MAX_GREEN - 0.3) stat.maxOuts++;
            }
            if (l.state === S.ST.GREEN && l.phase === S.PH.PED) stat.pedPhases++;
        }
        for (let i = 0; i < n; i++) {
            const l = w.lights[i];
            if (l.state !== S.ST.GREEN) continue;
            if (l.phase === S.PH.NS) stat.splitNS += S.SIM.DT;
            else if (l.phase === S.PH.EW) stat.splitEW += S.SIM.DT;
            else stat.splitPed += S.SIM.DT;
        }
        for (const l of w.lights) if (l.sinceGreenArm.some(v => v > 70)) stat.starve += S.SIM.DT / n;
        if (Math.abs(w.t % 1) < S.SIM.DT * 0.5) trace.push(w.lights.map(l => l.phase + 4 * l.state));
    }
    const m = w.finish();

    // Coordination: for every pair of junctions joined by a street, how much of
    // the time do they show the SAME phase? A brain that has learned nothing
    // about its neighbours lands near chance; a green wave pushes it away from
    // chance in one direction or the other.
    let pairs = 0, agree = 0;
    for (const li of w.lights) {
        for (const a of li.info.adj) {
            if (!a || a.sig <= li.sig) continue;
            pairs++;
            let same = 0;
            for (const row of trace) if ((row[li.sig] & 3) === (row[a.sig] & 3)) same++;
            agree += same / Math.max(1, trace.length);
        }
    }
    const mean = arr => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);
    return {
        m, score: S.episodeScore(m),
        cycle: mean(stat.greens), amber: mean(stat.amber), allRed: mean(stat.allRed),
        maxOutShare: stat.changes ? stat.maxOuts / stat.changes : 0,
        pedPhases: stat.pedPhases,
        nsShare: stat.splitNS / Math.max(1e-9, stat.splitNS + stat.splitEW + stat.splitPed),
        pedShare: stat.splitPed / Math.max(1e-9, stat.splitNS + stat.splitEW + stat.splitPed),
        starve: stat.starve,
        agree: pairs ? agree / pairs : 0,
        changes: stat.changes / Math.max(1, w.lights.length)
    };
}

function avg(rows, key) { return rows.reduce((a, r) => a + r[key], 0) / rows.length; }

const city = S.makeCity(TIER, S.mixSeed(0x4E57, TIER * 977 + 1));
console.log(`tier ${TIER} - ${city.spec.name}: ${city.signals.length} signalised junctions, ` +
    `${city.nodes.filter(n => n.round).length} roundabouts, ` +
    `${city.edges.filter(e => e.hw).length} ring-road sections\n`);

const runs = {
    brain: SEEDS.map(s => probe(city, S.brainController(genome), S.mixSeed(0xBEEF, s))),
    actuated: SEEDS.map(s => probe(city, S.actuatedController(), S.mixSeed(0xBEEF, s))),
    fixed: SEEDS.map(s => probe(city, S.fixedTimeController(), S.mixSeed(0xBEEF, s)))
};

const row = (label, fmt, get) => {
    const cells = ['brain', 'actuated', 'fixed'].map(k => fmt(get(runs[k])).padStart(12));
    console.log('  ' + label.padEnd(30) + cells.join(''));
};
console.log('  ' + ''.padEnd(30) + 'brain'.padStart(12) + 'actuated'.padStart(12) + 'fixed'.padStart(12));
console.log('  ' + '-'.repeat(66));
row('score', v => v.toFixed(0), r => avg(r, 'score'));
row('vehicles arrived', v => (v * 100).toFixed(0) + '%', r => r.reduce((a, x) => a + x.m.carThroughput, 0) / r.length);
row('people arrived', v => (v * 100).toFixed(0) + '%', r => r.reduce((a, x) => a + x.m.pedThroughput, 0) / r.length);
row('delay per driver', v => v.toFixed(0) + 's', r => r.reduce((a, x) => a + x.m.meanCarDelay, 0) / r.length);
row('delay per pedestrian', v => v.toFixed(0) + 's', r => r.reduce((a, x) => a + x.m.meanPedDelay, 0) / r.length);
row('collisions', v => v.toFixed(1), r => r.reduce((a, x) => a + x.m.crashes, 0) / r.length);
row('people struck', v => v.toFixed(1), r => r.reduce((a, x) => a + x.m.pedHits, 0) / r.length);
console.log('');
row('mean green length', v => v.toFixed(1) + 's', r => avg(r, 'cycle'));
row('phase changes per junction', v => v.toFixed(0), r => avg(r, 'changes'));
row('amber it chose', v => v.toFixed(2) + 's', r => avg(r, 'amber'));
row('all-red it chose', v => v.toFixed(2) + 's', r => avg(r, 'allRed'));
row('changes forced by max-out', v => (v * 100).toFixed(0) + '%', r => avg(r, 'maxOutShare'));
row('north-south share of green', v => (v * 100).toFixed(0) + '%', r => avg(r, 'nsShare'));
row('all-pedestrian phase share', v => (v * 100).toFixed(1) + '%', r => avg(r, 'pedShare'));
row('pedestrian phases run', v => v.toFixed(0), r => avg(r, 'pedPhases'));
row('arm starved over 70s', v => v.toFixed(1) + 's', r => avg(r, 'starve'));
row('neighbours in step', v => (v * 100).toFixed(0) + '%', r => avg(r, 'agree'));

console.log(`
Reading it: an amber near ${S.SIG.AMBER_MIN.toFixed(1)}s and an all-red near 0 means the brain
traded safety for capacity - check the collision row before believing the score.
"Neighbours in step" near 50% means it is not coordinating with the junction up
the street at all; a green wave pulls it well above or well below that. A high
max-out share means the hardware timer is doing the controller's job for it.`);
