/* shot.js — render a single frame of a trained champion for the project
 * thumbnail. Run:  node shot.js  (then open shot.html in a browser, or point
 * headless Chrome at it with --screenshot).
 *
 * Writes shot.html: a bare page that loads the sim, flies the baked champion
 * for a set number of ticks, renders one frame, and stops. Nothing animates, so
 * a screenshot taken any time after load is the same deterministic picture —
 * which is what makes it reproducible rather than a lucky grab.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const TICKS = +(process.argv[2] || 900);        // physics ticks to fly first
const ROOM = process.argv[3] || "pillars";

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>champion</title>
<style>html,body{margin:0;background:#0b1420;overflow:hidden}
#view{width:100vw;height:100vh;display:block}</style></head><body>
<canvas id="view"></canvas>
<script src="three.min.js"></script>
<script src="nn.js"></script>
<script src="room.js"></script>
<script src="drone.js"></script>
<script src="world.js"></script>
<script src="evolution.js"></script>
<script src="default_brain.js"></script>
<script src="render.js"></script>
<script>
const r = new Renderer(document.getElementById("view"));
r.resize();
r.orbit.dist = 5.5; r.orbit.pitch = 0.22; r.orbit.yaw = 2.35;
const room = new Room(roomById(${JSON.stringify(ROOM)}));
const nets = [];
if (typeof DEFAULT_BRAIN !== "undefined" && DEFAULT_BRAIN) {
    const n = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
    for (let i = 0; i < 10; i++) nets.push(n.clone());
} else {
    const rng = mulberry32(4);
    for (let i = 0; i < 10; i++) nets.push(new Net(NET_SIZES, rng));
}
const w = new World(room, nets, { missionSeed: 41, noiseSeed: 41, noise: true, turbulence: 0.3 });
const cfg = { ghosts: 9, showRays: true, showWaypoints: true, showTrail: true, showDead: false };
for (let t = 0; t < ${TICKS} && !w.isOver(); t++) {
    w.step();
    if (t % 4 === 0) r.frame(w, cfg);      // keep the trail and camera lerp honest
}
r.frame(w, cfg);
document.title = "ready";
</script></body></html>
`;
fs.writeFileSync(path.join(__dirname, "shot.html"), html);
console.log(`wrote shot.html — ${ROOM}, ${TICKS} ticks ` +
    `(${(TICKS / 120).toFixed(1)} s of flight)`);
