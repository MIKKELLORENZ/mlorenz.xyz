/* ingest.js — put a LOCAL distilled champion into the published library.
 *
 * autosync fetches champions over scp from the training box, so an entry like
 * `D@/local/path` makes it try to scp from the REMOTE at that path and silently
 * find nothing. A distilled policy is produced locally, so it needs its own way
 * in: judge it on the same bank autosync ranks with, write the archive record
 * autosync expects, and let `autosync --local` re-rank and republish.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const EV = require("../evolution.js");

const src = process.argv[2];
const arm = process.argv[3] || "D";
const raw = JSON.parse(fs.readFileSync(src, "utf8"));
const brain = NN.Brain.fromJSON(raw.brain);
const lags = raw.lags || null;

const bank = SC.examBank(60).filter(s => s.stage === 0).map(s => ({ stage: s.stage, seed: s.seed }));
const r = EV.Evolution.evaluate(brain, bank, { lags });
let sum = 0; const tally = {};
for (let i = 0; i < r.scores.length; i++) {
    sum += r.scores[i];
    const nm = WM.OUTCOME_NAME[r.outcomes[i]];
    tally[nm] = (tally[nm] || 0) + 1;
}
const score = sum / r.scores.length;
brain.calibrate();
const id = brain.hash();
const rec = {
    id, arm, gen: raw.gen || 0, lags: lags || undefined,
    exam: score, live: score, canonical: score,
    phase: 5, rung: score, ladder: raw.ladder || [0, 0, 0, 0],
    stages: [0], worst: null,
    caught: tally["caught"] || 0,
    safe: (tally["landed"] || 0) + (tally["soft divert"] || 0),
    tally, arch: raw.arch, act: brain.act,
    archived: new Date().toISOString(),
    distilled: true,
    brain: brain.toJSON()
};
fs.mkdirSync(path.join("training", "champions"), { recursive: true });
fs.writeFileSync(path.join("training", "champions", id + ".json"), JSON.stringify(rec));
console.log(`ingested ${src} as arm ${arm} · id ${id} · canonical ${score.toFixed(4)} · caught ${rec.caught}/${bank.length}`);
console.log(`  ` + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
