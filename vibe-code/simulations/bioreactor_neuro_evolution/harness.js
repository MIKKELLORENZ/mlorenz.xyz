/* harness.js — load the browser sim into Node.
 *
 * Every logic file is a plain <script> in the page — shared bare globals, no
 * modules — so they are run in this context in page order, exactly as the
 * browser would. Anything that needs the sim (train.js, test_headless.js, the
 * probes) starts with `require("./harness.js")`.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* Order matters: lineages.js defines the cue-channel count and the medium
 * count that bioreactor.js sizes its action space from at load time, and
 * sensors.js sizes the observation from both. */
const SIM_FILES = ["nn.js", "lineages.js", "bioreactor.js", "scenarios.js", "sensors.js",
    "protocol.js", "evolution.js", "world.js"];

function loadSim() {
    for (const f of SIM_FILES) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
}
loadSim();

module.exports = { SIM_FILES, loadSim };
