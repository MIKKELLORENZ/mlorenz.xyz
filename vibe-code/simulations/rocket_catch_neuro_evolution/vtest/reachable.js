/* reachable.js — STEP 0: what fraction of episodes admits a catch AT ALL?
 *
 * Everything downstream is calibrated against the golden pilot, which catches
 * about 55% of stage 0. That number is being used as "what good looks like",
 * and it is only a fair target if the other 45% are winnable and the pilot is
 * merely imperfect. If a large share of episodes are unwinnable by anything,
 * then the ceiling is the environment and no controller — evolved, distilled or
 * hand-written — can pass it.
 *
 * The note's two rules for this probe are both obeyed:
 *
 *   DRIVE THE REAL SIMULATOR. Every trajectory here is flown by world.js, never
 *   by a reimplementation of its physics. A reimplementation measures the model,
 *   not the system, and this project has already been bitten by exactly that
 *   (a terminal-velocity constant taken from a non-converged drop).
 *
 *   BIAS TOWARD CLAIMING REACHABILITY. The search over controllers is coarse, so
 *   an episode this reports as unreachable might still be winnable by something
 *   cleverer — but an episode it reports as REACHABLE definitely is, because a
 *   concrete controller was found that caught it. A negative result is therefore
 *   a lower bound on difficulty and a positive result is a proof by example.
 *
 * Method: fly each episode with a spread of gain sets around the tuned pilot and
 * take the UNION of episodes caught by any of them. That union is a lower bound
 * on the reachable fraction.
 *
 *   node vtest/reachable.js [n] [variants] [stage]
 */
"use strict";

const WM = require("../world.js");
const SC = require("../scenarios.js");
const GOLD = require("../golden_test.js");

const N = Number(process.argv[2] || 120);
const NVAR = Number(process.argv[3] || 12);
const STAGE = Number(process.argv[4] || 0);
const DEG = Math.PI / 180;

let seed = 20260817;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const jitter = (v, f) => v * Math.exp((rnd() * 2 - 1) * f);

/* The tuned pilot first, then variants spread around it. Deliberately wide on
 * the two loops that decide a catch — the sink schedule and the lateral gains —
 * because the question is what the VEHICLE can do, not what one tuning does. */
const VARIANTS = [Object.assign({}, GOLD.GAINS)];
for (let i = 1; i < NVAR; i++) {
    VARIANTS.push(Object.assign({}, GOLD.GAINS, {
        kpPos: jitter(GOLD.GAINS.kpPos, 0.8), kdPos: jitter(GOLD.GAINS.kdPos, 0.8),
        aLatMax: jitter(GOLD.GAINS.aLatMax, 0.6),
        slope: jitter(GOLD.GAINS.slope, 0.5), kvz: jitter(GOLD.GAINS.kvz, 0.5),
        slotX: jitter(GOLD.GAINS.slotX, 0.7), slotH: jitter(GOLD.GAINS.slotH, 0.6),
        vTouch: jitter(GOLD.GAINS.vTouch, 0.6),
        kpAtt: jitter(GOLD.GAINS.kpAtt, 0.4), kdAtt: jitter(GOLD.GAINS.kdAtt, 0.4),
        aoaMax: jitter(GOLD.GAINS.aoaMax, 0.5), qLook: jitter(GOLD.GAINS.qLook, 0.5)
    }));
}

const caughtBy = new Array(N).fill(0);
const bestVariant = new Array(NVAR).fill(0);
const reasons = {};

for (let v = 0; v < VARIANTS.length; v++) {
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(STAGE, 9500000 + i * 7919);
        sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
        const w = new WM.World(sc);
        const r = w.runEpisode(GOLD.makePilot(VARIANTS[v]));
        const nm = WM.OUTCOME_NAME[r.outcome];
        if (nm === "caught") { caughtBy[i]++; bestVariant[v]++; }
        else if (v === 0) reasons[nm] = (reasons[nm] || 0) + 1;
    }
}

const reachable = caughtBy.filter(c => c > 0).length;
const tuned = bestVariant[0];
const bestSingle = Math.max(...bestVariant);

console.log(`stage ${STAGE} · ${N} episodes · ${NVAR} controller variants (seeds 9.5e6+, the duel bank)\n`);
console.log(`  the tuned pilot alone      ${tuned}/${N}  (${(100 * tuned / N).toFixed(0)}%)`);
console.log(`  best single variant        ${bestSingle}/${N}  (${(100 * bestSingle / N).toFixed(0)}%)`);
console.log(`  UNION over all variants    ${reachable}/${N}  (${(100 * reachable / N).toFixed(0)}%)  <- lower bound on reachable`);
console.log(`\n  episodes no variant caught ${N - reachable}/${N}`);
console.log(`  the tuned pilot's failures: ` + Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(`\n  Read: the gap between "tuned pilot" and "union" is headroom a BETTER CONTROLLER`);
console.log(`  could take. The gap between "union" and 100% is where this probe cannot tell the`);
console.log(`  difference between a hard episode and an impossible one.`);
