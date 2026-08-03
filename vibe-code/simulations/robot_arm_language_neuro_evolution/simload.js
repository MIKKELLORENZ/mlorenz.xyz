/* simload.js — load the browser sim files into a Node context.
 *
 * The sim files are plain <script> sources: they declare top-level consts and
 * classes and rely on the shared global lexical scope, exactly as the browser
 * provides. vm.runInThisContext gives Node the same arrangement, so the trainer
 * and the tests run THE CODE THE BROWSER RUNS rather than a parallel port of it
 * that can silently drift. */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CORE = ["tasks.js", "nn.js", "arm.js"];
const OPTIONAL = ["task_embeddings.js"];
const REST = ["embedding.js", "world.js", "evolution.js", "reference_policy.js"];

function loadSim(dir) {
    dir = dir || __dirname;
    const loaded = [];
    const run = (f, required) => {
        const p = path.join(dir, f);
        if (!fs.existsSync(p)) {
            if (required) throw new Error("missing sim file: " + f);
            return false;
        }
        vm.runInThisContext(fs.readFileSync(p, "utf8"), { filename: f });
        loaded.push(f);
        return true;
    };
    CORE.forEach(f => run(f, true));
    OPTIONAL.forEach(f => run(f, false));
    REST.forEach(f => run(f, true));
    return loaded;
}

module.exports = { loadSim, CORE, OPTIONAL, REST };
