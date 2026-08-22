/* forensic.js — what is the champion actually DOING, and how does it die?
 *
 *   node forensic.js training/ckpt_pilot.json
 *
 * A stalled GA reports one number, and one number cannot tell you whether the
 * population is tumbling on takeoff, hovering placidly until the clock runs
 * out, or flying beautifully into a wall. This flies the saved champion with
 * instrumentation and prints the cause of death, the attitude history and where
 * the time went. It is the difference between fixing the problem and tuning
 * mutation rates at random.
 */
"use strict";
require("./bootstrap.js");
const fs = require("fs");

const ckPath = process.argv[2] || "training/ckpt_pilot.json";
const ck = JSON.parse(fs.readFileSync(ckPath, "utf8"));
const brain = Net.fromJSON(ck.champion);
console.log(`champion from ${ckPath}, gen ${ck.gen}, recorded fitness ${ck.championFit.toFixed(0)}\n`);

const room = new Room4D();

function why(p) {
    const r = DRONE.RADIUS;
    const out = [];
    if (p[0] < room.lo[0] + r) out.push("-x wall");
    if (p[0] > room.hi[0] - r) out.push("+x wall");
    if (p[1] < room.lo[1] + r) out.push("FLOOR");
    if (p[1] > room.hi[1] - r) out.push("CEILING");
    if (p[2] < room.lo[2] + r) out.push("-z wall");
    if (p[2] > room.hi[2] - r) out.push("+z wall");
    if (p[3] < room.lo[3] + r) out.push("-w wall");
    if (p[3] > room.hi[3] - r) out.push("+w wall");
    return out.join(" & ") || "?";
}

const causes = {};
for (let e = 0; e < 5; e++) {
    const w = new World4D(room, [brain], {
        missionSeed: 1000 + e * 137, noiseSeed: 500 + e * 29,
        turbulence: 0.15, noise: true, hardCap: 120, maxArrivals: 30, minSep: 8
    });
    const d = w.drones[0];
    const trace = [];
    let peakUp = 1, minUp = 1, maxRate = 0, armTime = -1;
    while (!w.isOver()) {
        w.step();
        if (w.tick % 12 === 0) {
            const up = d.uprightness();
            minUp = Math.min(minUp, up);
            let wr = 0; for (let k = 0; k < 6; k++) wr = Math.max(wr, Math.abs(d.omega[k]));
            maxRate = Math.max(maxRate, wr);
            trace.push({ t: w.time, y: d.pos[1], up, thr: d.spin.reduce((a, b) => a + b, 0) / 8 });
        }
        if (d.armed && armTime < 0) armTime = w.time;
        if (d.done) break;
    }
    const cause = d.crashed ? why(d.pos) : (d.timeLeft <= 0 ? "clock ran out" : "finished");
    causes[cause] = (causes[cause] || 0) + 1;
    console.log(`ep ${e}  died: ${cause.padEnd(16)} t=${w.time.toFixed(1)}s  ` +
        `armed@${armTime < 0 ? "never" : armTime.toFixed(2) + "s"}  ` +
        `wp ${d.arrivals}  air ${d.airTime.toFixed(1)}s  ` +
        `minUp ${minUp.toFixed(2)}  maxω ${maxRate.toFixed(1)} rad/s  fit ${d.fitness().toFixed(0)}`);
    const rows = trace.filter((_, i) => i % 3 === 0).slice(0, 14);
    console.log("      t/y/up/thr: " + rows.map(r =>
        `${r.t.toFixed(1)}s ${r.y.toFixed(1)}m ${r.up.toFixed(2)} ${r.thr.toFixed(2)}`).join(" | "));
}
console.log("\ncauses of death: " + JSON.stringify(causes));

/* How does it compare to doing nothing, and to the hand-written pilot? */
const { Autopilot4D } = require("./autopilot.js");
let apArr = 0, chArr = 0, hoverFit = 0;
for (let e = 0; e < 5; e++) {
    const o = { missionSeed: 1000 + e * 137, noiseSeed: 500 + e * 29, turbulence: 0.15, noise: true, hardCap: 120, maxArrivals: 30, minSep: 8 };
    apArr += runEpisode(room, [null], Object.assign({ pilot: new Autopilot4D() }, o))[0].arrivals;
    chArr += runEpisode(room, [brain], o)[0].arrivals;
}
console.log(`\nwaypoints/episode — champion ${(chArr / 5).toFixed(2)}   hand-written autopilot ${(apArr / 5).toFixed(2)}`);
