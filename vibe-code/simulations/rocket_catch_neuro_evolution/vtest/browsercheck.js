/* Load the page's scripts in the page's ORDER, through the window branch rather
 * than the require branch, and exercise the code that just changed. The
 * manifold sampler calls ATM.airAt, and scenarios.js captures ATM at module
 * scope — so if atmosphere.js ever loaded after it, the browser would get a
 * silent undefined that Node's require path would never reveal. */
"use strict";
const fs = require("fs"), vm = require("vm");
const order = fs.readFileSync("index.html", "utf8")
    .split("\n").map(l => (l.match(/<script src="([^"]+)"><\/script>/) || [])[1])
    .filter(Boolean)
    .filter(f => !f.startsWith("..") && f !== "three.min.js" && f !== "render.js" && f !== "main.js");

const win = {};
const ctx = vm.createContext({ window: win, console, Math, JSON, Date, Float32Array, Float64Array,
    Buffer, Uint8Array, Array, Object, Number, String, isFinite, isNaN, parseInt, parseFloat, Error });
ctx.globalThis = ctx;
for (const f of order) {
    try { vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f }); }
    catch (e) { console.log(`FAIL loading ${f}: ${e.message}`); process.exit(1); }
}
console.log("loaded in page order: " + order.join(", "));
console.log("window keys: " + Object.keys(win).join(", "));

const SC = win.Scenarios, WM = win.World || win.WorldMod, NN = win.NN;
const rows = [];
for (let i = 0; i < 60; i++) { const s = SC.makeScenario(2, 900000 + i * 7919); rows.push([s.p0[2], -s.v0[2]]); }
rows.sort((a, b) => a[0] - b[0]);
console.log(`stage 2 in the browser path: alt ${rows[0][0].toFixed(0)}-${rows[rows.length-1][0].toFixed(0)} m, ` +
    `sink ${rows[0][1].toFixed(0)} m/s at the bottom -> ${rows[rows.length-1][1].toFixed(0)} m/s at the top`);
console.log(`booster limits seen by the page: qAlphaMax ${win.Vehicle.BOOSTER.qAlphaMax} Pa*rad, qMax ${win.Vehicle.BOOSTER.qMax} Pa`);
console.log(`library entries: ${win.BRAIN_LIBRARY.length}, best ${win.BRAIN_LIBRARY[0].live} (arm ${win.BRAIN_LIBRARY[0].arm} gen ${win.BRAIN_LIBRARY[0].gen})`);

/* ---------------------------------------------------------------------------
 * THE PART THAT ACTUALLY CHANGED: can the page FLY what it publishes?
 *
 * The library now mixes 139-input and 209-input genomes, which is only possible
 * because the lag set became per-sensor instead of per-process. None of that is
 * exercised by the Node test suite — it all lives on the window branch — so it
 * is checked here, by building each entry exactly the way main.js does and
 * flying it. A champion that loads but cannot be flown is the failure mode this
 * whole change was meant to remove, so "it loaded" is not the assertion. */
let bad = 0;
const AP = win.AutopilotMod, GP = win.GoldenPilot;
for (const e of win.BRAIN_LIBRARY) {
    try {
        /* Decoded exactly as main.js does it. The first version of this check
         * handed the raw library entry to Brain.fromJSON and every genome
         * "failed" identically — the weights are base64 Float32, not JSON
         * arrays, so the test was broken rather than the page. Worth the note:
         * a check that fails for its own reasons is only one bit better than
         * one that passes for its own reasons. */
        const brain = NN.Brain.fromJSON({
            spec: e.spec, act: e.act, sizes: e.sizes, scales: e.scales,
            weights: e.w.map(b64 => {
                const bin = Buffer.from(b64, "base64");
                return new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
            })
        });
        const pol = new NN.BrainPolicy(brain, { lags: e.lags });
        if (pol.sensors.nInput !== e.sizes[0]) throw new Error(
            `sensors give ${pol.sensors.nInput}, genome wants ${e.sizes[0]}`);
        pol.reset();
        const sc = SC.makeScenario(0, 90000);
        const r = new WM.World(sc).runEpisode((w, o) => pol.act(w, o));
        console.log(`  ${e.id} arm ${e.arm} ${e.sizes[0]} inputs lags [${(e.lags || []).join(",")}] ` +
            `-> flew, ${WM.OUTCOME_NAME[r.outcome]}, score ${r.total.toFixed(3)}`);
    } catch (err) {
        console.log(`  ${e.id} arm ${e.arm} ${e.sizes[0]} inputs -> FAILED: ${err.message}`);
        bad++;
    }
}

/* And the Scripted option, through the window branch, where autopilot.js has to
 * find window.GoldenPilot rather than a require(). */
let caught = 0, n = 16;
for (let i = 0; i < n; i++) {
    const sc = SC.makeScenario(0, 90000 + i * 7919);
    sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
    const ap = new AP.Autopilot(); ap.reset();
    const r = new WM.World(sc).runEpisode((w, o) => ap.act(w, o));
    if (WM.OUTCOME_NAME[r.outcome] === "caught") caught++;
}
console.log(`  Scripted (window branch, GoldenPilot ${GP ? "found" : "MISSING"}): ${caught}/${n} caught`);
if (bad || !GP || caught === 0) { console.log("BROWSER CHECK FAILED"); process.exit(1); }
console.log("BROWSER CHECK PASSED");
