// Held-out benchmark for a saved genome, runnable at any time against a run
// that is still going. The trainer prints this once at the end; this prints it
// on demand, so a five-hour run can be checked at the first migration instead of
// at the finish.
//
//   node bench_champion.js training/run3/champion.json
//   node bench_champion.js training/run3/champion.json --tiers 2,3,4,5 --days 6
//
// The layout family (0x4E57) and the day family (0xBEEF) are both outside the
// ones evolution.js draws from, so nothing here has been trained on. Training
// advantage is not a result; this is.
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

const TIERS = String(flag('tiers', '0,1,2,3,4,5')).split(',').map(Number);
const DAYS = numFlag('days', 3);
const EPLEN = numFlag('eplen', 1.0);
const file = argv.find((a, i) => !a.startsWith('--') && (i === 0 || !argv[i - 1].startsWith('--')))
    || 'training/latest/champion.json';

const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf8'));
const genome = Float64Array.from(raw.genome);
if (genome.length !== S.NN_GENOME_LEN) {
    console.error(`genome is ${genome.length} genes, this architecture wants ${S.NN_GENOME_LEN}`);
    process.exit(1);
}
console.log(`${file}: gen ${raw.gen}, tier ${(raw.tier | 0) + 1}, training advantage ` +
    `${Number(raw.adv).toFixed(2)} (${((raw.advEur || 0) / 1000).toFixed(0)}k)\n`);

const k = v => (v / 1000).toFixed(0) + 'k';
const rows = [];
for (const tier of TIERS) {
    for (let sd = 1; sd <= DAYS; sd++) {
        const net = S.makeNetwork(tier, S.mixSeed(0x4E57, tier * 977 + sd));
        const opts = { steps: Math.max(24, Math.round((net.spec.steps || 144) * EPLEN)) };
        const run = ctrl => {
            const w = new S.World(net, opts);
            w.reset(S.mixSeed(0xBEEF, tier * 31 + sd), ctrl);
            return w.run();
        };
        const b = run(S.brainController(genome));
        const d = run(S.makeController('donothing'));
        const r = run(S.makeController('redispatch'));
        const e = run(S.makeController('expert'));
        rows.push({ tier, sd, b, d, r, e });
        const bestC = Math.max(d.score, r.score, e.score);
        const mark = b.score >= bestC ? '**' : (b.score > d.score ? ' *' : '  ');
        console.log(`${mark} t${tier} d${sd}  brain ${k(b.score)}  (don ${k(d.score)} red ${k(r.score)} ` +
            `exp ${k(e.score)})  | brain: ${b.redispatchMWh.toFixed(0)} MWh, ` +
            `${b.curtailedMWh.toFixed(0)} MWh curt, ${b.switchActions + b.subActions} switches, ` +
            `${b.lineTrips} trips, ${(b.servedFrac * 100).toFixed(1)}% served, ` +
            `N-1 ${(b.n1SecureFrac * 100).toFixed(0)}%  | don: ${d.lineTrips} trips, ` +
            `${(d.servedFrac * 100).toFixed(1)}% served`);
    }
}

// The overall number is honest and it is also nearly uninformative, for the same
// reason the trainer had to start auditioning its days: most days are quiet, and
// on a quiet day the only thing this measures is whether the operator had the
// sense to stay out of the way. So the report is split. A control room has two
// jobs and they pull in opposite directions - do not churn when nothing is
// wrong, and do act when something is. A single average hides which one failed.
const HEAD = 6000;
const headroom = x => (x.d.riskCost || 0) + Math.min(x.d.lostLoadCost || 0, 600000) +
    (x.d.blackoutCost || 0) + (x.d.lineTrips || 0) * 2500 + (x.d.overloadIntegral || 0) * 4000;
const quiet = rows.filter(x => headroom(x) < HEAD);
const eventful = rows.filter(x => headroom(x) >= HEAD);

function report(label, set) {
    if (!set.length) { console.log(`\n  ${label}: none in this sample`); return; }
    const n = set.length;
    const mean = f => set.reduce((a, x) => a + f(x), 0) / n;
    const winDo = set.filter(x => x.b.score > x.d.score).length;
    const winAll = set.filter(x => x.b.score >= Math.max(x.d.score, x.r.score, x.e.score)).length;
    const diffs = set.map(x => x.b.score - x.d.score).sort((a, b) => a - b);
    console.log(`\n  ${label} — ${n} days`);
    console.log(`    beat do-nothing on ${winDo}/${n}, matched or beat the best classical on ${winAll}/${n}`);
    // Per-day differences, and the MEDIAN as well as the mean: one collapsed day
    // otherwise decides the whole number in either direction.
    console.log(`    vs do-nothing per day   mean ${k(mean(x => x.b.score - x.d.score))}  ` +
        `median ${k(diffs[Math.floor(n / 2)])}  worst ${k(diffs[0])}  best ${k(diffs[n - 1])}`);
    console.log(`    mean margin             brain ${k(mean(x => x.b.score))}  ` +
        `do-nothing ${k(mean(x => x.d.score))}  redispatch ${k(mean(x => x.r.score))}  ` +
        `expert ${k(mean(x => x.e.score))}`);
    console.log(`    trips                   brain ${mean(x => x.b.lineTrips).toFixed(2)}  ` +
        `do-nothing ${mean(x => x.d.lineTrips).toFixed(2)}  expert ${mean(x => x.e.lineTrips).toFixed(2)}`);
    console.log(`    served                  brain ${(mean(x => x.b.servedFrac) * 100).toFixed(2)}%  ` +
        `do-nothing ${(mean(x => x.d.servedFrac) * 100).toFixed(2)}%`);
    console.log(`    N-1 secure              brain ${(mean(x => x.b.n1SecureFrac) * 100).toFixed(0)}%  ` +
        `do-nothing ${(mean(x => x.d.n1SecureFrac) * 100).toFixed(0)}%  ` +
        `expert ${(mean(x => x.e.n1SecureFrac) * 100).toFixed(0)}%   (reported, never rewarded)`);
    console.log(`    activity                ${mean(x => x.b.redispatchMWh).toFixed(0)} MWh redispatch, ` +
        `${mean(x => x.b.curtailedMWh).toFixed(0)} MWh curtailed, ` +
        `${mean(x => x.b.switchActions + x.b.subActions).toFixed(1)} switching actions/day`);
}

report('QUIET DAYS (do-nothing loses nothing — the job is to stay out of the way)', quiet);
report('EVENTFUL DAYS (do-nothing bleeds — the job is to act)', eventful);
report('ALL DAYS (the honest overall number)', rows);
