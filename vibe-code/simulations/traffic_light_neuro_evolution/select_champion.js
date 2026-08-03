// Re-crown the champion on street layouts it never trained on.
//
//   node select_champion.js [training/run1]
//
// The trainer crowns whichever genome scored best on the cities the population
// was just evaluated on. That is the only signal it has, and it turns out to be
// a poor predictor of the thing we actually ship: a mid-run champion reported
// zero collisions every generation and then caused 2.2 accidents per episode on
// unseen geometry, while the vehicle-actuated controller caused 1.0. A brain
// can learn clearance timings that are exactly safe enough for the junctions it
// was scored on and not safe anywhere else, and nothing in the training loop
// can see the difference.
//
// So the trainer's champion is treated as a nomination rather than a verdict.
// Every genome the run kept - each island's champion and its whole elite roster
// - is re-measured here on a city family no training run and no benchmark ever
// touches, and the best of them is what gets baked.
//
// Three seed families, kept strictly apart:
//   0xC17   the trainer's own cities          (training)
//   0x5A1D  the cities this script selects on (validation, below)
//   0x4E57  the cities bake_brain.js reports  (test - never selected on)
// Selecting on the same layouts the final number is quoted from would make that
// number meaningless, which is the whole failure this script exists to fix.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSim } = require('./harness');
const S = loadSim(__dirname);

const RUN = process.argv[2] || 'training/run1';
const RUN_DIR = path.join(__dirname, RUN);

const VALID_SEED = 0x5A1D;
const TEST_SEED = 0x4E57;
const SCREEN_TIERS = [1, 3, 5];
const SCREEN_SEEDS = [1, 2];
const FINAL_TIERS = [0, 1, 2, 3, 4, 5, 6];
const FINAL_SEEDS = [1, 2, 3];
const FINALISTS = 5;
const EPLEN = 240;

// --- candidates -------------------------------------------------------------
function loadCandidates() {
    const out = [];
    const seen = new Set();
    const add = (genome, label, gen, tier) => {
        const g = S.repairGenome(Float64Array.from(genome));
        if (!S.validGenome(g)) return;
        // Migration copies genomes between islands, so the same brain shows up
        // under several labels. Fingerprint on a spread of genes.
        let h = 0;
        for (let i = 0; i < g.length; i += 97) h = (h * 31 + Math.round(g[i] * 1e6)) | 0;
        if (seen.has(h)) return;
        seen.add(h);
        out.push({ label, g, gen, tier });
    };

    const state = JSON.parse(fs.readFileSync(path.join(RUN_DIR, 'state.json'), 'utf8'));
    state.islands.forEach((isl, i) => {
        if (isl.champion && isl.champion.genome) {
            const m = isl.champion.meta || {};
            add(isl.champion.genome, `i${i}-champion`, m.gen === undefined ? isl.gen : m.gen,
                m.tier === undefined ? isl.tier : m.tier);
        }
        (isl.roster || []).forEach((r, j) => {
            if (r && r.g) add(r.g, `i${i}-elite${j}`, r.gen === undefined ? isl.gen : r.gen, isl.tier);
        });
    });
    try {
        const crowned = JSON.parse(fs.readFileSync(path.join(RUN_DIR, 'champion.json'), 'utf8'));
        add(crowned.genome, 'trainer-champion', crowned.gen, crowned.tier);
    } catch (e) { console.log('no champion.json to include (' + e.message + ')'); }
    return out;
}

// --- measurement ------------------------------------------------------------
function episode(city, ctrl, seed) {
    const w = new S.World(city, { episodeLen: EPLEN });
    w.reset(seed, ctrl);
    const m = w.run();
    return { score: S.episodeScore(m), m };
}

// A brain that is excellent on four cities and catastrophic on the fifth is not
// the one to ship, so the worst episode carries weight of its own - the same
// aggregation the trainer uses to rank a generation.
function aggregate(scores) {
    const mean = scores.reduce((a, x) => a + x, 0) / scores.length;
    return 0.6 * mean + 0.4 * Math.min(...scores);
}

function measure(g, family, tiers, seeds) {
    const scores = [];
    let acc = 0, thr = 0, delay = 0, n = 0;
    for (const tier of tiers) {
        for (const s of seeds) {
            const city = S.makeCity(tier, S.mixSeed(family, tier * 977 + s));
            const r = episode(city, S.brainController(g), S.mixSeed(0xBEEF, tier * 31 + s));
            scores.push(r.score);
            acc += r.m.crashes + r.m.pedHits;
            thr += r.m.carThroughput;
            delay += r.m.meanCarDelay;
            n++;
        }
    }
    return { agg: aggregate(scores), acc: acc / n, thr: thr / n, delay: delay / n, scores };
}

// --- run --------------------------------------------------------------------
const cands = loadCandidates();
console.log(`${cands.length} distinct candidates from ${RUN}\n`);

console.log(`screening on tiers ${SCREEN_TIERS.join(',')} x ${SCREEN_SEEDS.length} seeds (validation family)`);
for (const c of cands) {
    c.screen = measure(c.g, VALID_SEED, SCREEN_TIERS, SCREEN_SEEDS);
    process.stdout.write('.');
}
console.log('');
cands.sort((a, b) => b.screen.agg - a.screen.agg);
for (const c of cands.slice(0, 8)) {
    console.log(`  ${c.label.padEnd(16)} agg ${c.screen.agg.toFixed(0).padStart(7)}  ` +
        `${(c.screen.thr * 100).toFixed(0)}% arrived  ${c.screen.acc.toFixed(1)} accidents`);
}

const finalists = cands.slice(0, FINALISTS);
console.log(`\nfull validation of the top ${finalists.length} on tiers ${FINAL_TIERS.join(',')}`);
for (const c of finalists) {
    c.full = measure(c.g, VALID_SEED, FINAL_TIERS, FINAL_SEEDS);
    console.log(`  ${c.label.padEnd(16)} agg ${c.full.agg.toFixed(0).padStart(7)}  ` +
        `${(c.full.thr * 100).toFixed(0)}% arrived  ${c.full.delay.toFixed(0)}s delay  ` +
        `${c.full.acc.toFixed(1)} accidents`);
}
finalists.sort((a, b) => b.full.agg - a.full.agg);
const winner = finalists[0];

// The test family, reported but never selected on. This is the number
// bake_brain.js will independently reproduce.
console.log(`\nwinner: ${winner.label} - measured on the untouched test family`);
let wins = 0, total = 0;
let bAcc = 0, aAcc = 0;
for (const tier of FINAL_TIERS) {
    for (const s of FINAL_SEEDS) {
        const city = S.makeCity(tier, S.mixSeed(TEST_SEED, tier * 977 + s));
        const seed = S.mixSeed(0xBEEF, tier * 31 + s);
        const b = episode(city, S.brainController(winner.g), seed);
        const a = episode(city, S.actuatedController(), seed);
        bAcc += b.m.crashes + b.m.pedHits;
        aAcc += a.m.crashes + a.m.pedHits;
        total++;
        if (b.score > a.score) wins++;
    }
}
console.log(`  beat the actuated controller on ${wins}/${total} test cities`);
console.log(`  accidents per episode: brain ${(bAcc / total).toFixed(2)}, actuated ${(aAcc / total).toFixed(2)}`);

const crowned = cands.find(c => c.label === 'trainer-champion');
if (crowned && crowned !== winner) {
    console.log(`\nthe trainer had crowned ${crowned.label}: validation agg ` +
        `${(crowned.full || crowned.screen).agg.toFixed(0)} against the winner's ` +
        `${winner.full.agg.toFixed(0)}`);
}

// bake_brain.js reads gen/tier/fitness off the top level, the way the trainer's
// own champion.json carries them, so they are mirrored there as well as kept in
// the serialised metadata.
const payload = S.serializeGenome(winner.g, {
    selectedFrom: cands.length,
    label: winner.label,
    validationAgg: winner.full.agg,
    validationAccidents: winner.full.acc,
    testWins: wins, testTotal: total
});
payload.gen = winner.gen;
payload.tier = winner.tier;
payload.fitness = winner.full.agg;

const outPath = path.join(RUN_DIR, 'champion_selected.json');
fs.writeFileSync(outPath, JSON.stringify(payload, null, 1));
console.log(`\nwrote ${path.relative(__dirname, outPath)} - bake it with:`);
console.log(`  node bake_brain.js ${RUN}/champion_selected.json`);
