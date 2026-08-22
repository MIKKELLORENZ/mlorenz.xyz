/* load.js — one loading discipline for the whole project.
 *
 * The logic files are written to be plain <script> tags in a browser: no
 * modules, no imports, one shared scope. That is how the rest of this folder
 * works and it is what lets the page and the trainer run *literally the same*
 * episode code rather than two implementations that drift apart.
 *
 * Node gets the same scope by concatenating them into the global vm context, so
 * `Env`, `Runner`, `Evolution` and friends resolve as bare identifiers in every
 * entry point after calling load(). Requiring env.js directly does not work and
 * says so.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* Order matters: each file may reference top-level names from the ones before
 * it. cube.js is first because everything is downstream of the geometry. */
const SRC = ["cube.js", "vision.js", "nn.js", "rewards.js", "env.js", "evaluate.js",
    "evolution.js", "configs.js"];

let loaded = false;
function load() {
    if (loaded) return;          // const bindings are not redeclarable
    for (const f of SRC) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
    loaded = true;
}

module.exports = { load, SRC, dir: __dirname };
