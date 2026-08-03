/* bake_brain.js — turn a trained champion into the page's built-in brain.
 *
 *   node bake_brain.js                          # bakes training/champion.json
 *   node bake_brain.js --in some/champion.json
 *   node bake_brain.js --games 40               # bigger validation sample
 *
 * Writes default_brain.js. Before writing it re-measures the champion against
 * every rung of the ladder AND against untrained genomes, on seeds it never
 * trained on, and puts those numbers in the file header. A baked brain that
 * nobody re-measured is just a large number of digits.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["chess.js", "features.js", "nn.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}

const IN = String(arg("in", path.join(__dirname, "training", "champion.json")));
const GAMES = +arg("games", 40);
const OUT = path.join(__dirname, "default_brain.js");

const loaded = deserializeGenome(fs.readFileSync(IN, "utf8"));
if (!loaded) { console.error(`not a ${NN_VERSION} champion: ${IN}`); process.exit(1); }

const referee = new Evolution(16, 0xBEEF);
referee.recordLeader = false;

// Held-out seeds: the offset keeps these away from anything the trainer used.
const SEED = 0x7A11FEED;
const rows = [];
for (const rung of LADDER) {
    const evolved = referee.scoreVsBot(loaded.genome, rung, GAMES, SEED);
    const rng = makeRng(0x1234 + rung.name.length);
    let untrained = 0;
    const samples = 5;
    for (let i = 0; i < samples; i++) {
        untrained += referee.scoreVsBot(randomGenome(rng), rung, Math.max(8, GAMES / 4), SEED);
    }
    rows.push({ name: rung.label, evolved, untrained: untrained / samples });
}

// Head to head against untrained genomes, which is the cleanest statement of
// "the evolution did something".
const rng = makeRng(0x99);
let hh = 0;
const duels = 8;
for (let i = 0; i < duels; i++) {
    hh += referee.duel(loaded.genome, randomGenome(rng), 4, (SEED ^ (i * 7919)) >>> 0);
}
hh /= duels;

const pad = s => String(s).padEnd(18);
const num = v => `${(v * 100).toFixed(1)}%`.padStart(8);
const table = rows.map(r => ` *   ${pad(r.name)}${num(r.evolved)}${num(r.untrained)}`).join("\n");

const header = `/* default_brain.js — the built-in champion.
 *
 * Written by \`node bake_brain.js\`; do not hand-edit.
 * Contract: ${NN_ARCH_ID} (${NN_GENOME_LEN} evolved numbers, no gradients).
 * Evolved to generation ${loaded.meta.gen || "?"} by train_headless.js.
 *
 * Re-measured over ${GAMES} games per rung on seeds it never trained on,
 * against untrained genomes of the identical architecture:
 *
 *   opponent            evolved untrained
${table}
 *
 * Head to head against untrained genomes: ${(hh * 100).toFixed(1)}%.
 */`;

const payload = serializeGenome(loaded.genome, {
    gen: loaded.meta.gen || 0,
    ladder: rows.map(r => +r.evolved.toFixed(4)),
    vsUntrained: +hh.toFixed(4)
});

fs.writeFileSync(OUT, `${header}\n'use strict';\nconst DEFAULT_BRAIN = ${payload};\n` +
    `if (typeof module !== 'undefined') module.exports = { DEFAULT_BRAIN };\n`);

console.log(header);
console.log(`\nwrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
