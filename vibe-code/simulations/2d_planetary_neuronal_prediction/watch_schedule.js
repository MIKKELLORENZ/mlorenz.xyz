/* watch_schedule.js — does the search actually MOVE the integration schedule?
 *
 *   node watch_schedule.js [generations]
 *
 * The A/B measures the end score. This watches the mechanism: it evolves a small
 * population and prints the champion's eight schedule coefficients every few
 * generations, against the classical values. If the fix worked, the position
 * coefficients should walk toward roughly (-5/6, 1/4) and the velocity ones
 * toward (-4/3, 5/12) — and they should do it early, because that is the whole
 * claim. If they sit at zero, the schedule is still unreachable and the A/B will
 * come back negative again for the same reason as last time.
 *
 * Single-threaded on purpose: the box is shared, and this needs one core.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "model.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

const GENS = +(process.argv[2] || 120), POP = 48, LEVEL = 1, TRIALS = 4, BLOCK = 3;
const evo = new Evolution(POP, 4242, rng => new Predictor(rng));
const lags = MODEL_CFG.lags;

let cache = null, cacheKey = null;
const fmt = a => a.map(v => (v >= 0 ? " " : "") + v.toFixed(3)).join(" ");

console.log(`schedule watch — ${specLabel()}, pop ${POP}, rung L${LEVEL}, ${GENS} gens`);
console.log(`classical AB3 target:  position ${fmt(ADAMS_P[2])} …   velocity ${fmt(ADAMS_Q[2])} …\n`);
console.log(`  gen   digits   vs Newton   vs AB3    position schedule            velocity schedule`);

let newton = null, ab3 = null;
for (let g = 1; g <= GENS; g++) {
    const block = Math.floor((g - 1) / BLOCK);
    if (String(block) !== cacheKey) {
        cacheKey = String(block);
        cache = new TrialSet(seedsFor(block, TRIALS, 0), { level: LEVEL, tickFrac: 0.02 });
        newton = cache.evaluate(NEWTON_RUNNER).digits;
        ab3 = cache.evaluate(adamsRunner(3)).digits;
    }
    const results = evo.brains.map(brain => {
        const ev = cache.evaluate(predictorRunner(brain));
        return { brain, fitness: fitnessOf(ev), digits: ev.digits, worst: ev.worst, blew: ev.blew };
    });
    const rec = evo.evolve(results, 0.12, 0.4, 3, {});
    if (g % 10 === 0 || g === 1) {
        const s = evo.champion.sched;
        const P = [], Q = [];
        for (let k = 0; k < lags; k++) { P.push(MULTI_SCALE * s.coef(k)); Q.push(MULTI_SCALE * s.coef(lags + k)); }
        console.log(`  ${String(g).padStart(3)}   ${rec.bestDigits.toFixed(3)}     ` +
            `${(rec.bestDigits - newton >= 0 ? "+" : "") + (rec.bestDigits - newton).toFixed(3)}   ` +
            `${(rec.bestDigits - ab3 >= 0 ? "+" : "") + (rec.bestDigits - ab3).toFixed(3)}   ` +
            `${fmt(P)}   ${fmt(Q)}`);
    }
}
console.log(`\n  Newton ${newton.toFixed(3)} · Adams-Bashforth 3 ${ab3.toFixed(3)} on the final trial block.`);
