// Forensic probe. Runs one genome through one day, interval by interval, and
// prints what it actually did and what it cost.
//
//   node probe_champion.js training/run1/champion.json --tier 5 --seed 7
//   node probe_champion.js --baseline expert --tier 3
//
// The fitness curve tells you whether a controller is winning. It never tells
// you HOW, and on this problem "how" has several very different answers that all
// look the same from the outside: an operator that redispatches constantly, one
// that waits for the relay, and one that has quietly learned to do nothing all
// score similarly on a calm network. Every earlier sim on this site needed a
// tool like this before the fitness curve meant anything.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSim } = require('./harness');
const S = loadSim(__dirname);

const argv = process.argv.slice(2);
const flag = (name, def) => {
    const i = argv.indexOf('--' + name);
    if (i < 0) return def;
    const v = argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
};
const numFlag = (name, def) => {
    const v = flag(name, undefined);
    return v === undefined || v === true ? def : Number(v);
};

const TIER = numFlag('tier', 3);
const SEED = numFlag('seed', 7);
const NET = numFlag('net', 0);
const BASE = flag('baseline', null);
const EVERY = numFlag('every', 6);
const file = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--tier'
    && argv[argv.indexOf(a) - 1] !== '--seed' && argv[argv.indexOf(a) - 1] !== '--net'
    && argv[argv.indexOf(a) - 1] !== '--baseline' && argv[argv.indexOf(a) - 1] !== '--every');

const net = S.makeNetwork(TIER, S.mixSeed(0x671D, TIER * 31 + NET));
let controller, label;
if (BASE) {
    controller = S.makeController(String(BASE));
    label = String(BASE);
} else {
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file || 'training/latest/champion.json'), 'utf8'));
    const genome = Float64Array.from(raw.genome);
    if (genome.length !== S.NN_GENOME_LEN) {
        console.error(`genome is ${genome.length} genes, this architecture wants ${S.NN_GENOME_LEN}`);
        process.exit(1);
    }
    controller = S.brainController(genome, { record: true });
    label = `champion (gen ${raw.gen}, tier ${(raw.tier | 0) + 1})`;
}

console.log(`${label} on ${net.label} (${net.nBus} buses, ${net.nBranch} branches, ` +
    `${net.nGen} units, ${net.totalLoad.toFixed(0)} MW nominal), day seed ${SEED}\n`);

const w = new S.World(net, { steps: net.spec.steps });
w.reset(SEED, controller);

const pad = (s, n) => String(s).padStart(n);
console.log('  time   load   renew   worst  N-1    redisp  curtail  V-lo   margin   action');
console.log('  ' + '-'.repeat(94));

let lastScore = 0;
while (!w.done) {
    w.step();
    const hour = (w.wx.startHour + w.t * S.SIM.DT_H) % 24;
    const hh = String(Math.floor(hour)).padStart(2, '0') + ':' +
        String(Math.round((hour % 1) * 60)).padStart(2, '0');
    let renew = 0, tot = 0, redisp = 0, curtail = 0;
    for (let g = 0; g < net.nGen; g++) {
        tot += w.st.pg[g];
        if (net.gen[g].renew) { renew += w.st.pg[g]; curtail += w.st.curtail[g] * w.st.renewAvail[g]; }
        else redisp += Math.abs(w.st.redisp[g]);
    }
    let vlo = 2;
    for (let s = 0; s < net.nBus; s++) if (w.st.vm[s] > 0.05 && w.st.vm[s] < vlo) vlo = w.st.vm[s];
    const score = w.m.revenue - w.m.fuelCost - w.m.premiumCost - w.m.curtailCost
        - w.m.switchCost - w.m.riskCost - w.m.lostLoadCost - w.m.blackoutCost;
    const a = w.lastAction;
    let act = '';
    if (a && a.topo) {
        act = a.topo.kind === 'line'
            ? (w.st.status[a.topo.ref] ? 'closed ' : 'opened ') + net.branch[a.topo.ref].name
            : 'reconfigured ' + net.bus[a.topo.ref].name;
    }
    const evs = w.events.slice();
    w.events.length = 0;

    const interesting = evs.length || act || w.maxLoading > 0.98 || w.t % EVERY === 0;
    if (interesting) {
        console.log('  ' + hh +
            pad(w.demandNow.toFixed(0), 7) +
            pad((tot > 0 ? (renew / tot * 100).toFixed(0) : '0') + '%', 7) +
            pad((w.maxLoading * 100).toFixed(0) + '%', 8) +
            pad((w.n1.worst * 100).toFixed(0) + '%', 6) +
            pad(redisp.toFixed(0), 9) +
            pad(curtail.toFixed(0), 8) +
            pad(vlo > 1.9 ? '–' : vlo.toFixed(3), 8) +
            pad((score / 1000).toFixed(0) + 'k', 9) +
            '   ' + act);
    }
    for (const e of evs) console.log('         ! ' + e.text);
    lastScore = score;
}

const m = w.finish();
void lastScore;
console.log('\n  ' + '-'.repeat(94));
const eur = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : (v / 1000).toFixed(1) + 'k');
console.log(`  margin            ${eur(m.score)} EUR`);
console.log(`    revenue         ${eur(m.revenue)}   (${m.servedMWh.toFixed(0)} MWh delivered)`);
console.log(`    fuel            ${eur(-m.fuelCost)}`);
console.log(`    redispatch      ${eur(-m.premiumCost)}   (${m.redispatchMWh.toFixed(0)} MWh ordered)`);
console.log(`    curtailment     ${eur(-m.curtailCost)}   (${m.curtailedMWh.toFixed(0)} MWh)`);
console.log(`    switching       ${eur(-m.switchCost)}   (${m.switchActions + m.reconnects + m.subActions} breaker operations)`);
console.log(`    overload risk   ${eur(-m.riskCost)}`);
console.log(`    lost load       ${eur(-m.lostLoadCost)}   (${m.unservedMWh.toFixed(1)} MWh)`);
console.log(`    blackout        ${eur(-m.blackoutCost)}`);
console.log('\n  reported separately, never in the reward:');
console.log(`    N-1 secure      ${(m.n1SecureFrac * 100).toFixed(1)}% of intervals ` +
    `(worst contingency reached ${(m.n1Worst * 100).toFixed(0)}%)`);
console.log(`    overloaded      ${(m.overloadFrac * 100).toFixed(1)}% of intervals ` +
    `(worst actual loading ${(m.maxLoading * 100).toFixed(0)}%)`);
console.log(`    voltage         ${m.vViolSteps} intervals outside the statutory band ` +
    `(range ${m.vMin.toFixed(3)}-${m.vMax.toFixed(3)} pu)`);
console.log(`    protection      ${m.lineTrips} line trips, ${m.emergencyShed} emergency shed blocks`);
console.log(`    actions         ${m.switchActions} lines opened, ${m.reconnects} reconnected, ` +
    `${m.subActions} substations reconfigured`);
console.log(`    solver          ${m.solverFallbacks} Newton fallbacks, ${m.solverFailures} failures, ` +
    `${m.qLimitPasses} reactive-limit passes`);
