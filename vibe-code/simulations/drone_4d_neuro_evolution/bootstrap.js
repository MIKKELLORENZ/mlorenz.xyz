/* bootstrap.js — Node-side loader.
 *
 * The simulation files are plain <script> sources: they define bare globals and
 * export the same names for Node. That keeps the browser free of a module
 * bundler and keeps one copy of the physics shared between the trainer, the
 * tests and the viewer. Order matters — drone4d.js evaluates PLANE_I from
 * math4d's PLANES at load time. */
"use strict";
const path = require("path");
const FILES = ["nn.js", "math4d.js", "drone4d.js", "room4d.js", "world4d.js", "evolution.js"];
for (const f of FILES) Object.assign(global, require(path.join(__dirname, f)));
module.exports = {};
