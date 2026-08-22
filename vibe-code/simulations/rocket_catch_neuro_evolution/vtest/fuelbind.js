/* fuelbind.js — IS PROPELLANT ACTUALLY BINDING, OR IS IT JUST AVAILABLE?
 *
 * The observation already carries three propellant channels: the fraction left,
 * the remaining delta-v from the rocket equation, and the current mass. Adding a
 * fourth — the MARGIN, delta-v remaining minus delta-v still required — is only
 * worth the input if failures are actually caused by running out. If the brains
 * crash with the tanks half full, the network does not need a better fuel gauge,
 * it needs a better controller, and one more input is one more thing to learn.
 *
 * So: for each policy, of the episodes that ended badly, how many ran dry, and
 * how much was left in the ones that did not?
 *
 *   node vtest/fuelbind.js [n]
 */
"use strict";
const fs = require("fs");
const NN = require("../nn.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const GOLD = require("../golden_test.js");
const TEACH = require("../distill/teacher.js");

const N = Number(process.argv[2] || 120);
const STAGES = (process.env.STAGES || "0,1").split(",").map(Number);

const src = fs.readFileSync("brain_library.js", "utf8");
const window = {};
eval(src);
const lib = window.BRAIN_LIBRARY || [];

function assess(makePolicy, tag) {
    let bad = 0, dry = 0, caught = 0; const left = [];
    for (const stage of STAGES) {
        for (let i = 0; i < N; i++) {
            const sc = SC.makeScenario(stage, 980000 + stage * 100003 + i * 7919);
            sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
            const w = new WM.World(sc);
            const r = w.runEpisode(makePolicy());
            const nm = WM.OUTCOME_NAME[r.outcome];
            if (nm === "caught") { caught++; continue; }
            bad++;
            if (w.dry || w.prop < 1) dry++;
            else left.push(w.prop / sc.prop);
        }
    }
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
    console.log(`  ${tag.padEnd(28)} caught ${String(caught).padStart(3)}  failed ${String(bad).padStart(3)}  ` +
        `ran dry ${String(dry).padStart(3)} (${(100 * dry / Math.max(1, bad)).toFixed(0).padStart(3)}% of failures)  ` +
        `median propellant left in the rest ${(100 * med(left)).toFixed(0)}%`);
}

console.log(`stages ${STAGES.join(",")} · ${N} episodes each\n`);
for (const e of lib.slice(0, 3)) {
    const brain = NN.Brain.fromJSON({
        spec: e.spec, act: e.act, sizes: e.sizes, scales: e.scales,
        weights: e.w.map(b64 => {
            const bin = Buffer.from(b64, "base64");
            return new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
        })
    });
    assess(() => { const p = new NN.BrainPolicy(brain, { lags: e.lags }); p.reset(); return (wo, o) => p.act(wo, o); },
        `#${e.rank} ${e.id} arm ${e.arm}`);
}
assess(() => GOLD.makeReference(), "scripted reference");
assess(() => { const out = new Float64Array(WM.N_OUT); return (w, o) => { TEACH.advise(w, out); o.set(out); return o; }; },
    "DAgger teacher");
