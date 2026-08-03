/* test_rise_trial.js — the rise-trial generation does what it claims.
 *
 *   node test_rise_trial.js
 *
 * Every failure this guards against is silent. A rise trial that never fires, one
 * that fires but ranks on the wrong field, one that quietly loses seats, or one
 * that leaks its metres-of-COM score into the history the stage gate reads would
 * all look exactly like "the curriculum did not help".
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const M = HUMANOID;

let fails = 0;
function ok(cond, what, detail) {
    console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? "   " + detail : ""}`);
    if (!cond) fails++;
}

const POP = 24;
const evo = new Evolution(POP, 1234, ["relu"], { riseEvery: 10, risePose: "prone" });

/* ---- 1. it fires on the right generations and nowhere else ---------------- */
const fired = [];
for (let g = 1; g <= 31; g++) {
    evo.gen = g;
    if (evo.isRiseTrial) fired.push(g);
}
evo.gen = 1;
ok(JSON.stringify(fired) === JSON.stringify([10, 20, 30]),
   "fires on generations 10, 20, 30 and no others", "[" + fired.join(",") + "]");

const off = new Evolution(POP, 1234, ["relu"], {});
off.gen = 10;
ok(!off.isRiseTrial, "off by default (riseEvery 0)");

/* ---- 2. a trial ranks on meanCom, NOT on fitness -------------------------- */
/* The two are deliberately anti-correlated here: the brain with the best ledger
 * has the worst COM. If the trial ranked on fitness the winner would be seat 0. */
evo.gen = 10;
const results = evo.brains.map((b, i) => ({
    brain: b,
    fitness: 1000 - i,            // seat 0 is the best walker
    meanCom: i / POP             // seat POP-1 is the best riser
}));
const wanted = results[POP - 1].brain;
const histBefore = evo.history.length;
const champBefore = evo.champion;
const rec = evo.evolve(results, MUT_DEFAULT.rate, MUT_DEFAULT.sigma, 3, {}, {});

ok(rec && rec.riseTrial === true, "returns a record marked riseTrial");
ok(evo.brains.length === POP, "population size is unchanged", `${evo.brains.length}/${POP}`);
ok(evo.brains[0] === wanted || sameWeights(evo.brains[0], wanted),
   "seat 0 of the next generation is the best RISER, not the best walker");
ok(evo.history.length === histBefore,
   "the trial does not enter history (the stage gate and plateau test read it)",
   `${histBefore} -> ${evo.history.length}`);
ok(evo.champion === champBefore, "the champion is untouched by a trial");
ok(evo.gen === 11, "the generation counter still advances", String(evo.gen));

function sameWeights(a, b) {
    for (let l = 0; l < a.weights.length; l++)
        for (let i = 0; i < a.weights[l].length; i++)
            if (a.weights[l][i] !== b.weights[l][i]) return false;
    return true;
}

/* ---- 3. THE ORDERING. The population entering a trial is already near-clones.
 *
 * This is the check that matters, because getting it backwards destroyed a live
 * run: fitness 21,653 -> 781 in one generation. The trial ranks on mean COM
 * height from a prone spawn, and that statistic mostly measures body
 * CONFIGURATION rather than skill — a brain that curls up sits higher than one
 * lying flat whether or not it can walk. Ranking the ORDINARY population on it
 * therefore crowns an arbitrary poor walker and clones it 192 times.
 *
 * Seeding BEFORE the trial removes the failure by construction: every candidate
 * is already a near-clone of a proven elite, so whoever rises best still walks.
 * "Minor variations" has to bound the choice of PARENT, not just the mutation. */
const seeded = new Evolution(POP, 77, ["relu"], { riseEvery: 10, risePose: "prone" });
seeded.gen = 9;                                   // the generation BEFORE a trial
const r9 = seeded.brains.map((b, i) => ({ brain: b, fitness: 1000 - i, arrivals: 0, meanCom: 0 }));
seeded.evolve(r9, MUT_DEFAULT.rate, MUT_DEFAULT.sigma, 3, {}, {});
ok(seeded.gen === 10 && seeded.isRiseTrial, "generation 10 is now the pending trial");

const W = seeded.brains[0].weights.reduce((s, w) => s + w.length, 0);
let maxChanged = 0;
for (let i = 1; i < seeded.brains.length; i++) {
    let d = 0;
    for (let l = 0; l < seeded.brains[0].weights.length; l++)
        for (let j = 0; j < seeded.brains[0].weights[l].length; j++)
            if (seeded.brains[0].weights[l][j] !== seeded.brains[i].weights[l][j]) d++;
    maxChanged = Math.max(maxChanged, d);
}
ok(maxChanged > 0 && maxChanged <= 320,
   "every brain ENTERING the trial is within a few hundred weights of the elite",
   `worst ${maxChanged} of ${W}`);

/* ---- 3b. and the trial hands back a NORMALLY bred population -------------- */
/* Leaving it as near-clones would make one generation in ten a permanent
 * diversity bottleneck. */
const r10 = seeded.brains.map((b, i) => ({ brain: b, fitness: 0, arrivals: 0, meanCom: i / POP }));
seeded.evolve(r10, MUT_DEFAULT.rate, MUT_DEFAULT.sigma, 3, {}, {});
let spread = 0;
for (let i = 1; i < seeded.brains.length; i++) {
    let d = 0;
    for (let l = 0; l < seeded.brains[0].weights.length; l++)
        for (let j = 0; j < seeded.brains[0].weights[l].length; j++)
            if (seeded.brains[0].weights[l][j] !== seeded.brains[i].weights[l][j]) d++;
    spread = Math.max(spread, d);
}
ok(spread > 320, "after the trial the population is bred normally again, not clones",
   `worst ${spread} of ${W}`);

/* ---- 4. a rise-trial world pins the pose and switches the scaffold OFF ----- */
const inert = { sizes: NET_SIZES.slice(), forward: () => new Float32Array(NOUT).fill(0.5) };
const wTrial = new World(M, [inert], {
    stage: 5, terrainId: "varied", missionSeed: 3997, noiseSeed: 6404,
    noise: true, episodeSlot: 18, episodeCount: 30, riseTrial: "prone"
});
ok(wTrial.startPose && wTrial.startPose.name === "prone",
   "every walker spawns prone", String(wTrial.startPose && wTrial.startPose.name));
ok(!wTrial.scaffoldGene,
   "the scaffold is OFF — a trial must measure the brain unaided, not the reference");

/* The same mission WITHOUT the trial flag is the one that scaffolds (it is the
 * episode the parity harness uses), so this also proves the flag is what did it. */
const wNorm = new World(M, [inert], {
    stage: 5, terrainId: "varied", missionSeed: 3997, noiseSeed: 6404,
    noise: true, episodeSlot: 18, episodeCount: 30
});
ok(!!wNorm.scaffoldGene, "the same mission without the flag still scaffolds");

/* ---- 5. mean COM is a MEAN, so a spike cannot win ------------------------- */
/* Two synthetic walkers: one holds 0.5 m for a second, one sits at 0.2 m and
 * spikes to 1.2 m for a single control tick. The spike has the higher maximum;
 * the mean must still prefer the one that stayed up. */
const hold = { comSum: 0, comTime: 0, meanCom: Walker.prototype.meanCom };
const spike = { comSum: 0, comTime: 0, meanCom: Walker.prototype.meanCom };
for (let i = 0; i < 50; i++) { hold.comSum += 0.5 * 0.02; hold.comTime += 0.02; }
for (let i = 0; i < 50; i++) {
    const h = i === 25 ? 1.2 : 0.2;
    spike.comSum += h * 0.02; spike.comTime += 0.02;
}
ok(hold.meanCom() > spike.meanCom(),
   "sustained height beats a spike", `${hold.meanCom().toFixed(3)} vs ${spike.meanCom().toFixed(3)}`);

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
