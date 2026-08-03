/* analyze_incident.js — read a dump from the browser's "Save incident" button.
 *
 *   node analyze_incident.js walk3d_incident_1234.json
 *
 * Two passes. First the recorded series, which answers WHICH walker and WHEN.
 * Then a headless replay of the same episode from the seeds in the dump's meta,
 * which answers WHY — the replay can be instrumented to any depth, and the
 * recording never has to carry more than it does.
 *
 * The replay is only trustworthy if it lands on the same event, so it is checked
 * rather than assumed: the replayed walker's peak speed and the time it occurs
 * are compared against the recording, and a mismatch is reported as one.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const M = HUMANOID;

const file = process.argv[2];
if (!file) { console.error("usage: node analyze_incident.js <incident.json>"); process.exit(1); }
const D = JSON.parse(fs.readFileSync(file, "utf8"));
const N = D.walkers, rows = D.rows;
/* v1 dumps carried one meta for the whole file and no per-sample episode id.
 * Ten seconds spans two or three episodes, so v1 events are only labelled
 * correctly when they fall in the last one — the file says so rather than
 * pretending otherwise. */
const V2 = D.version >= 2;
const OFF = V2 ? 2 : 1;                       // where the per-walker block starts
const metas = V2 ? D.metas : [D.meta || {}];
console.log(`${rows.length} samples at ${D.hz} Hz, ${N} walkers, format v${V2 ? 2 : 1}`);

/* Episodes restart the clock at zero, so a falling time is an episode boundary.
 * v2 states the boundary outright; for v1 it has to be inferred. */
const bound = [0];
for (let k = 1; k < rows.length; k++) {
    if (V2 ? rows[k][1] !== rows[k - 1][1] : rows[k][0] < rows[k - 1][0]) bound.push(k);
}
console.log(`${bound.length} episode segment(s) in this window:`);
bound.forEach((b, s) => {
    const end = (s + 1 < bound.length ? bound[s + 1] : rows.length) - 1;
    const m = V2 ? metas.find(x => x.seq === rows[b][1]) : (s === bound.length - 1 ? metas[0] : null);
    console.log(`   [${s}] samples ${b}..${end}  t ${rows[b][0].toFixed(2)}..${rows[end][0].toFixed(2)} s  ` +
        (m ? `gen ${m.gen} ep ${m.episode} · ${m.terrainId} · seeds ${m.missionSeed}/${m.noiseSeed} · ${(m.startPoses || [])[0] || "?"}`
           : "seeds unknown (v1 dump, not the final segment)"));
});
console.log();

/* ---- pass 1: find the worst single-sample acceleration in the fleet ------ */
let worst = { dv: 0 };
for (let k = 1; k < rows.length; k++) {
    if (bound.includes(k)) continue;               // never difference across a boundary
    for (let i = 0; i < N; i++) {
        const dv = rows[k][OFF + i * 4] - rows[k - 1][OFF + i * 4];
        if (dv > worst.dv) worst = { dv, k, i, t: rows[k][0], spd: rows[k][OFF + i * 4],
                                     spin: rows[k][OFF + 1 + i * 4], f: rows[k][OFF + 2 + i * 4],
                                     y: rows[k][OFF + 3 + i * 4] };
    }
}
if (worst.k != null) {
    let s = 0; while (s + 1 < bound.length && bound[s + 1] <= worst.k) s++;
    worst.seg = s;
    worst.meta = V2 ? metas.find(x => x.seq === rows[worst.k][1])
                    : (s === bound.length - 1 ? metas[0] : null);
    console.log(`the worst event is in segment [${s}]` +
        (worst.meta ? "" : " — a v1 dump cannot say which seeds that segment used, so no replay"));
}
const meta = (worst.meta || {});
if (!worst.k) { console.log("no acceleration event in this window."); process.exit(0); }
console.log(`worst event: walker #${worst.i} at t=${worst.t.toFixed(3)} s — ` +
    `+${worst.dv.toFixed(2)} m/s in one sample, to ${worst.spd.toFixed(1)} m/s, ` +
    `spin ${worst.spin.toFixed(1)} rad/s, peak point force ${(worst.f / M.weight).toFixed(0)}x body weight\n`);
console.log("     time    speed    spin   peak force   pelvis y");
for (let k = Math.max(0, worst.k - 10); k < Math.min(rows.length, worst.k + 6); k++) {
    const r = rows[k], mark = k === worst.k ? " <-" : "";
    console.log(`  ${r[0].toFixed(3).padStart(7)}s ${r[OFF + worst.i * 4].toFixed(2).padStart(7)} ` +
        `${r[OFF + 1 + worst.i * 4].toFixed(1).padStart(7)} ${(r[OFF + 2 + worst.i * 4] / M.weight).toFixed(0).padStart(9)}x ` +
        `${r[OFF + 3 + worst.i * 4].toFixed(2).padStart(9)}${mark}`);
}

/* ---- pass 2: replay the episode and instrument the contact ------------- */
if (meta.missionSeed == null) { console.log("\nno seeds in the dump — cannot replay."); process.exit(0); }
const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
/* Identity, not just shape. The first real capture was replayed against a
 * champion baked after it was recorded and reported MISMATCH for a reason that
 * had nothing to do with the incident. */
if (meta.brainFP) {
    let h = 2166136261;
    for (const w of net.weights) for (let i = 0; i < w.length; i += 97) { h ^= Math.round(w[i] * 1e6) | 0; h = Math.imul(h, 16777619); }
    const fp = (h >>> 0).toString(16);
    if (fp !== meta.brainFP) {
        console.log(`\nthis dump was recorded with brain ${meta.brainFP}, but default_brain.js is ${fp}.`);
        console.log("Replaying would drive a DIFFERENT walker over the same ground. Bake the matching");
        console.log("champion first, or the trace below would describe an unrelated episode.");
        process.exit(0);
    }
    console.log(`brain fingerprint ${fp} matches the dump`);
}
if (meta.netSizes && meta.netSizes.join() !== net.sizes.join()) {
    console.log(`\nthe dump was made with a ${meta.netSizes.join("-")} brain but default_brain.js is ` +
        `${net.sizes.join("-")} — the replay would be a different walker. Bake the matching brain first.`);
    process.exit(0);
}
const brains = [];
for (let i = 0; i < (meta.fleet || N); i++) brains.push(net);
const opts = {
    stage: meta.stage, terrainDifficulty: meta.terrainDifficulty, terrainId: meta.terrainId,
    missionSeed: meta.missionSeed, noiseSeed: meta.noiseSeed, noise: meta.noise !== false
};
for (const k of ["groundFrac", "seatFrac", "poseFrac"]) if (meta[k] != null) opts[k] = meta[k];
const world = new World(M, brains, opts);
const w = world.walkers[worst.i];
console.log(`\nreplay: start pose ${w.startPose}` +
    (meta.startPoses && meta.startPoses[worst.i] && meta.startPoses[worst.i] !== w.startPose
        ? `  MISMATCH — recording said ${meta.startPoses[worst.i]}` : "  (matches the recording)"));

const scratch = new Float64Array(3), s4 = new Float64Array(4);
const trace = [];
let peak = { spd: 0 };
while (!world.isOver()) {
    world.step();
    const spd = Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]);
    let bi = -1, bd = -1e9;
    for (let i = 0; i < M.contacts.length; i++) {
        const c = M.contacts[i];
        w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], scratch, 0);
        world.terrain.sample(scratch[0], scratch[2], s4);
        const d = (s4[0] - scratch[1]) * s4[2];
        if (d > bd) { bd = d; bi = i; }
    }
    const row = { t: world.time, spd, depth: bd, f: bi >= 0 ? w.ptForce[bi] : 0, ny: s4[2],
                  part: bi >= 0 ? M.bodies[M.contacts[bi].body].name.replace(/Link$/, "") : "-" };
    trace.push(row);
    if (spd > peak.spd) peak = Object.assign({ k: trace.length - 1 }, row);
}
/* Match on the RECORDED MOMENT, not on the replay's global peak. The ring holds
 * ten seconds; the episode usually runs longer, so the replay routinely contains
 * a larger event after the recording window closed. Comparing peaks called a
 * correct replay a failure the first time this was run. */
let at = 0;
for (let k = 1; k < trace.length; k++) {
    if (Math.abs(trace[k].t - worst.t) < Math.abs(trace[at].t - worst.t)) at = k;
}
const hit = trace[at];
console.log(`replay at t=${hit.t.toFixed(3)} s: ${hit.spd.toFixed(1)} m/s` +
    `  (recording said ${worst.spd.toFixed(1)} m/s at t=${worst.t.toFixed(3)} s)` +
    `  ${Math.abs(hit.spd - worst.spd) < 1.5 ? "— same event" : "— MISMATCH, treat what follows with suspicion"}`);
console.log(`replay's own worst moment, which may fall outside the recorded window: ` +
    `${peak.spd.toFixed(1)} m/s at t=${peak.t.toFixed(3)} s`);
console.log("\n      time    part        penetration      contact force        KN*depth   ratio   body speed");
for (let k = Math.max(0, at - 22); k <= Math.min(trace.length - 1, at + 3); k++) {
    const e = trace[k], lin = CONTACT.KN * Math.max(0, e.depth);
    console.log(`   ${e.t.toFixed(3).padStart(7)}s  ${e.part.padEnd(10)}` +
        `  ${(e.depth * 1000).toFixed(2).padStart(9)} mm  ${e.f.toFixed(0).padStart(13)} N` +
        `  ${lin.toFixed(0).padStart(11)} N  ${(e.f / Math.max(1, lin)).toFixed(1).padStart(6)}x` +
        `  ${e.spd.toFixed(2).padStart(8)} m/s`);
}
console.log("\nThe `ratio` column is the Hunt-Crossley multiplier (1 - HC*vn) the force law applied.");
console.log("It has no upper bound in the shipped law; anything far above ~3 is the runaway.");
