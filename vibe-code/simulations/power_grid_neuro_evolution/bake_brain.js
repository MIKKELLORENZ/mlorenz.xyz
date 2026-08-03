// Bake a trained champion into default_brain.js so the page ships with an
// operator that already knows what it is doing.
//
//   node bake_brain.js training/run1/champion.json
//
// The genome is validated against the current architecture id before it is
// written: a champion from an older layout is refused rather than silently
// producing a page whose "evolved operator" is noise.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSim } = require('./harness');

const S = loadSim(__dirname);
const src = process.argv[2] || 'training/latest/champion.json';
const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, src), 'utf8'));
const genome = Float64Array.from(raw.genome);

if (genome.length !== S.NN_GENOME_LEN) {
    console.error(`refusing: genome is ${genome.length} genes, this architecture wants ${S.NN_GENOME_LEN}`);
    process.exit(1);
}
if (!S.validGenome(genome)) {
    console.error('refusing: genome contains non-finite values');
    process.exit(1);
}

const payload = S.serializeGenome(genome, {
    fitness: raw.fitness, adv: raw.adv, gen: raw.gen, tier: raw.tier,
    metrics: raw.metrics, bakedFrom: src
});

// Round-trip through the page's own loader before writing it, so a broken bake
// fails here rather than in a browser.
if (!S.deserializeGenome(payload)) {
    console.error('refusing: the page loader would reject this genome');
    process.exit(1);
}

const out = '// Champion baked from ' + src + '\n'
    + '// gen ' + raw.gen + ', network tier ' + ((raw.tier | 0) + 1)
    + ', advantage over the best classical control room: '
    + (Number.isFinite(raw.adv) ? (raw.adv / 1000).toFixed(1) + 'k EUR' : 'n/a') + '\n'
    + '// Architecture: ' + S.NN_ARCH_ID + '\n'
    + 'const DEFAULT_BRAIN = ' + JSON.stringify(payload) + ';\n';

fs.writeFileSync(path.join(__dirname, 'default_brain.js'), out);
console.log(`baked ${genome.length} genes from generation ${raw.gen} into default_brain.js`);
