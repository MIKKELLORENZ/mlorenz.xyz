/* Is a generation's score about the BRAIN or about the MISSION BANK?
 *
 * Training scores every brain on episodes `missionBase … missionBase+E-1`,
 * with missionBase = generation. Consecutive generations therefore share E-1
 * missions, but E generations apart the bank has turned over completely. If
 * single missions differ wildly in difficulty, a fixed brain's *generation
 * score* drifts by that much on its own, and the champion can be dethroned by
 * the calendar rather than by a better challenger.
 *
 * This measures exactly that: one unchanged brain, scored on each mission
 * separately, then on the sliding bank each generation actually uses. Nothing
 * here is a model of the trainer — it calls the same World with the same seed
 * formula, so the numbers are the trainer's own.
 *
 *   node mission_variance.js <brain.json> [stage] [firstGen] [lastGen] [episodes]
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
// Defaults to the current directory; set WALK3D_DIR to point at a run elsewhere.
const DIR = process.env.WALK3D_DIR || ".";
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(DIR, f), "utf8"), { filename: f });
}
const M = HUMANOID;

const file = process.argv[2] || path.join(DIR, "training/best_holdout.json");
const STAGE = +(process.argv[3] || 2);
const G0 = +(process.argv[4] || 88);
const G1 = +(process.argv[5] || 108);
const EPISODES = +(process.argv[6] || 7);

const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const sizes = (saved.net || saved).sizes;
if (!sizes || sizes.length !== NET_SIZES.length || sizes.some((v, i) => v !== NET_SIZES[i])) {
    console.error(`cannot probe ${path.basename(file)}: ${(sizes || []).join("-")} brain vs build ${NET_SIZES.join("-")}`);
    process.exit(3);
}
const net = Net.fromJSON(saved.net || saved);

/* The trainer's own seed formula, lifted verbatim from the worker. */
function mission(m) {
    const w = new World(M, [net], {
        stage: STAGE, terrainId: "varied", noise: true,
        missionSeed: 1 + m * 37, noiseSeed: 5000 + m * 13
    });
    let guard = 0;
    while (!w.isOver() && guard++ < 140 * 500) w.step();
    const x = w.walkers[0];
    return {
        fit: x.fitness(), up: x.uprightTime, m: x.progressM, arr: x.arrivals,
        terr: w.terrain ? w.terrain.kind || w.terrain.id || "?" : "flat",
        diff: w.terrain ? w.terrain.difficulty : 0
    };
}

console.log(`mission-variance probe of ${path.basename(file)} — stage ${STAGE}, ` +
    `missions ${G0}..${G1 + EPISODES - 1}, bank of ${EPISODES}\n`);

const per = new Map();
for (let m = G0; m <= G1 + EPISODES - 1; m++) per.set(m, mission(m));

console.log("per-mission (one unchanged brain):");
let lo = Infinity, hi = -Infinity;
for (const [m, r] of per) {
    lo = Math.min(lo, r.fit); hi = Math.max(hi, r.fit);
    console.log(`  m ${String(m).padStart(3)}  ${r.terr.padEnd(8)} d=${r.diff.toFixed(2)}  ` +
        `fit ${r.fit.toFixed(0).padStart(6)}  upright ${r.up.toFixed(1).padStart(5)}s  ` +
        `walked ${r.m.toFixed(2).padStart(5)} m  wp ${r.arr}`);
}
console.log(`  ---- single-mission spread: ${lo.toFixed(0)} … ${hi.toFixed(0)}  (${(hi / Math.max(1, lo)).toFixed(1)}x)\n`);

console.log(`generation score of the SAME brain (mean over its ${EPISODES}-mission bank):`);
const gens = [];
for (let g = G0; g <= G1; g++) {
    let f = 0, up = 0, mm = 0;
    for (let e = 0; e < EPISODES; e++) { const r = per.get(g + e); f += r.fit / EPISODES; up += r.up / EPISODES; mm += r.m / EPISODES; }
    gens.push({ g, f, up, mm });
    console.log(`  gen ${String(g).padStart(3)}  fit ${f.toFixed(0).padStart(6)}  upright ${up.toFixed(1).padStart(5)}s  walked ${mm.toFixed(2)} m`);
}
const fs_ = gens.map(x => x.f);
const gLo = Math.min(...fs_), gHi = Math.max(...fs_);
console.log(`  ---- bank spread for an UNCHANGED brain: ${gLo.toFixed(0)} … ${gHi.toFixed(0)}  (${(gHi / Math.max(1, gLo)).toFixed(1)}x)`);
console.log(`\nIf that last ratio is large, a generation's "best fitness" curve is partly`);
console.log(`a picture of the mission calendar, and the champion can be unseated by it.`);

/* ---- the same measurement against the stratified bank ----
 * Fresh missions every generation (no sharing at all, so this is the HARDER
 * test — nothing is held constant except the composition), each episode slot
 * pinned to its own surface, roughness band and floor-start quota. If the
 * spread here is small while the spread above is large, the swing was the
 * calendar and not the brain, and stratifying is what removes it. */
const BLOCK = 1000000;
function bank(g) {
    let f = 0, up = 0, mm = 0;
    const comp = [];
    for (let e = 0; e < EPISODES; e++) {
        const m = BLOCK + g * EPISODES + e;
        const w = new World(M, [net], {
            stage: STAGE, terrainId: "varied", noise: true,
            missionSeed: 1 + m * 37, noiseSeed: 5000 + m * 13,
            episodeSlot: e, episodeCount: EPISODES
        });
        let guard = 0;
        while (!w.isOver() && guard++ < 140 * 500) w.step();
        const x = w.walkers[0];
        f += x.fitness() / EPISODES; up += x.uprightTime / EPISODES; mm += x.progressM / EPISODES;
        comp.push(`${w.terrain.id[0]}${w.terrain.difficulty.toFixed(2).slice(1)}${w.startPose ? "*" : " "}`);
    }
    return { f, up, mm, comp: comp.join(" ") };
}

console.log(`\nSTRATIFIED bank (fresh missions each generation, fixed composition):`);
const sg = [];
for (let g = G0; g <= G1; g++) {
    const b = bank(g);
    sg.push(b.f);
    console.log(`  gen ${String(g).padStart(3)}  fit ${b.f.toFixed(0).padStart(6)}  upright ${b.up.toFixed(1).padStart(5)}s  ` +
        `walked ${b.mm.toFixed(2)} m   [${b.comp}]`);
}
const sLo = Math.min(...sg), sHi = Math.max(...sg);
console.log(`  ---- bank spread for the SAME unchanged brain: ${sLo.toFixed(0)} … ${sHi.toFixed(0)}  (${(sHi / Math.max(1, sLo)).toFixed(1)}x)`);
console.log(`\n  i.i.d. bank  ${(gHi / Math.max(1, gLo)).toFixed(1)}x   ->   stratified bank  ${(sHi / Math.max(1, sLo)).toFixed(1)}x`);
