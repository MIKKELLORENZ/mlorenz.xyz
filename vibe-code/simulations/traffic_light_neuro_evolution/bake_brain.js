// Bake a trained champion into default_brain.js, which the page loads as
// "Mikkel's evolved brain".
//
//   node bake_brain.js training/run1/champion.json
//
// Also re-measures the genome on the held-out layouts, so the numbers quoted on
// the page and in the README come from the file that actually shipped rather
// than from whatever the trainer said at the time.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSim } = require('./harness');

const src = process.argv[2] || 'training/run1/champion.json';
const S = loadSim(__dirname);

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, src), 'utf8'));
const genome = S.repairGenome(Float64Array.from(raw.genome));
if (!S.validGenome(genome)) {
    console.error('champion is not a valid genome for this architecture');
    process.exit(1);
}

const TIERS = [0, 1, 2, 3, 4, 5, 6];
const SEEDS = [1, 2, 3];
const EPLEN = 240;

function run(city, ctrl, seed) {
    const w = new S.World(city, { episodeLen: EPLEN });
    w.reset(seed, ctrl);
    const m = w.run();
    return { score: S.episodeScore(m), m };
}

console.log('held-out benchmark (street layouts no training run ever saw)\n');
const summary = [];
let wins = 0, total = 0;
for (const tier of TIERS) {
    let bt = 0, bd = 0, bc = 0, bs = 0, at = 0, ad = 0, ac = 0, as = 0, ft = 0, fs_ = 0, n = 0;
    for (const s of SEEDS) {
        const city = S.makeCity(tier, S.mixSeed(0x4E57, tier * 977 + s));
        const seed = S.mixSeed(0xBEEF, tier * 31 + s);
        const b = run(city, S.brainController(genome), seed);
        const a = run(city, S.actuatedController(), seed);
        const f = run(city, S.fixedTimeController(), seed);
        bt += b.m.carThroughput; bd += b.m.meanCarDelay; bc += b.m.crashes + b.m.pedHits; bs += b.score;
        at += a.m.carThroughput; ad += a.m.meanCarDelay; ac += a.m.crashes + a.m.pedHits; as += a.score;
        ft += f.m.carThroughput; fs_ += f.score;
        n++; total++;
        if (b.score > a.score) wins++;
    }
    const row = {
        tier, name: S.CITY_TIERS[tier].name,
        brainThr: bt / n, brainDelay: bd / n, brainAcc: bc / n, brainScore: bs / n,
        actThr: at / n, actDelay: ad / n, actAcc: ac / n, actScore: as / n,
        fixedThr: ft / n, fixedScore: fs_ / n
    };
    summary.push(row);
    console.log(`tier ${tier} ${row.name}`);
    console.log(`   brain     ${(row.brainThr * 100).toFixed(0)}% arrived, ${row.brainDelay.toFixed(0)}s delay, ` +
        `${row.brainAcc.toFixed(1)} accidents, score ${row.brainScore.toFixed(0)}`);
    console.log(`   actuated  ${(row.actThr * 100).toFixed(0)}% arrived, ${row.actDelay.toFixed(0)}s delay, ` +
        `${row.actAcc.toFixed(1)} accidents, score ${row.actScore.toFixed(0)}`);
    console.log(`   fixed     ${(row.fixedThr * 100).toFixed(0)}% arrived, score ${row.fixedScore.toFixed(0)}`);
}
console.log(`\nbeat the actuated controller on ${wins}/${total} held-out cities`);

const payload = S.serializeGenome(genome, {
    gen: raw.gen, tier: raw.tier, fitness: raw.fitness,
    trainedOn: raw.tier !== undefined ? S.CITY_TIERS[raw.tier].name : undefined,
    heldOut: summary.map(r => ({
        tier: r.tier,
        thr: +r.brainThr.toFixed(3), delay: +r.brainDelay.toFixed(1), acc: +r.brainAcc.toFixed(2),
        actThr: +r.actThr.toFixed(3), actDelay: +r.actDelay.toFixed(1), actAcc: +r.actAcc.toFixed(2)
    })),
    wins, total
});

const out = `// The brain the page ships with: evolved offline by train_headless.js,
// generation ${raw.gen}, and re-measured here on street layouts no training run
// ever saw. It beat the vehicle-actuated controller on ${wins} of ${total} of them.
//
// Regenerate with:  node bake_brain.js training/<run>/champion.json
const DEFAULT_BRAIN = ${JSON.stringify(payload)};
if (typeof module !== 'undefined') module.exports = { DEFAULT_BRAIN };
`;
fs.writeFileSync(path.join(__dirname, 'default_brain.js'), out);
fs.writeFileSync(path.join(__dirname, 'training', 'heldout.json'), JSON.stringify(summary, null, 1));
console.log(`\nwrote default_brain.js (${(out.length / 1024).toFixed(0)} kB)`);
