/* libcheck.js — what do the PUBLISHED brains actually do, on a fresh bank?
 *
 * The library ranks on the canonical reward, which is the right thing to rank
 * on and a poor thing to describe a flight with: 0.34 does not say whether the
 * vehicle is caught, landed, or merely fails tidily. This re-flies each
 * published genome on a bank none of them was ranked against and prints the
 * outcomes, so what gets reported is what happens rather than what scores.
 *
 *   node vtest/libcheck.js [n]
 */
"use strict";
const fs = require("fs");
const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const SENS = require("../sensors.js");
const GOLD = require("../golden_test.js");

const N = Number(process.argv[2] || 120);
const BASE = Number(process.env.BASE || 920000);
const STAGES = (process.env.STAGES || "0").split(",").map(Number);

const src = fs.readFileSync("brain_library.js", "utf8");
const window = {};
eval(src);                                    // defines window.BRAIN_LIBRARY
const lib = window.BRAIN_LIBRARY || [];

function fly(policy, tag) {
    let caught = 0, sum = 0; const tally = {};
    for (const stage of STAGES) {
        for (let i = 0; i < N; i++) {
            const sc = SC.makeScenario(stage, BASE + stage * 100003 + i * 7919);
            sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
            const w = new WM.World(sc);
            const r = w.runEpisode(policy());
            const nm = WM.OUTCOME_NAME[r.outcome];
            tally[nm] = (tally[nm] || 0) + 1;
            if (nm === "caught") caught++;
            sum += r.total;
        }
    }
    const n = N * STAGES.length, p = caught / n, se = Math.sqrt(p * (1 - p) / n);
    console.log(`  ${tag.padEnd(26)} caught ${String(caught + "/" + n).padStart(7)} ` +
        `(${(100 * p).toFixed(1).padStart(4)}% +/- ${(100 * se).toFixed(1)})  mean ${(sum / n).toFixed(3).padStart(6)}  ` +
        Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", "));
}

console.log(`published brains re-flown on a fresh bank (base ${BASE}), stages ${STAGES.join(",")}, ${N} eps each\n`);
for (const e of lib) {
    /* Decoded exactly as main.js does it: the library stores weights as base64
     * Float32, not JSON arrays, so handing the raw entry to Brain.fromJSON
     * fails for the checker's own reasons and looks like a broken genome. */
    const brain = NN.Brain.fromJSON({
        spec: e.spec, act: e.act, sizes: e.sizes, scales: e.scales,
        weights: e.w.map(b64 => {
            const bin = Buffer.from(b64, "base64");
            return new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
        })
    });
    fly(() => {
        const pol = new NN.BrainPolicy(brain, { lags: e.lags });
        pol.reset();
        return (wo, out) => pol.act(wo, out);
    }, `#${e.rank} ${e.id} arm ${e.arm}`);
}
console.log();
fly(() => GOLD.makeReference(), "scripted reference");
