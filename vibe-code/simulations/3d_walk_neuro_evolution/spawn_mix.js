/* spawn_mix.js — what share of episodes actually starts in each posture?
 *
 *   node spawn_mix.js              every stage, from the STAGES table
 *   node spawn_mix.js 0.21 0.30 0.215    try ground / seat / pose without editing
 *
 * This exists because the three spawn fractions do not mean what they look like.
 * `ground`, `seat` and `pose` are three SEQUENTIAL draws — seat is nested inside
 * ground, pose is absolute but runs second, crouch takes what is left — so the
 * mix is a composition that no single row of the table states. Setting
 * `pose: 0.40` to give the floor pool 40% of episodes instead left only 28% of
 * spawns standing, against a request for 60%, and the resulting collapse in
 * stoodFrac (0.89 -> 0.53 in three generations) read like the fleet forgetting
 * how to stand when nothing about the fleet had changed at all.
 *
 * The lesson is narrow and worth keeping: do not reason about the product, print
 * it. Any change to ground/seat/pose gets re-run through here before it goes
 * near a training node.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const M = HUMANOID;
const POOL = new Set(M.startPoses.map(p => p.name));

/* Episodes are dealt in stratified slots, so the mix has to be sampled the way
 * the trainer deals them — whole banks of E slots — and not as E i.i.d. draws.
 * With quota() the two are different distributions, which is the entire reason
 * stratification was added. */
const E = +(process.env.EPISODES || 16);
const N = +(process.env.N || 6000);

function mix(stage, over) {
    const c = { standing: 0, pose: 0, crouch: 0, rise: 0 };
    for (let e = 0; e < N; e++) {
        const opts = { stage, terrainDifficulty: 1, missionSeed: 9000 + e * 7, noiseSeed: 11 + e * 3,
                       noise: true, fleetSize: 1, episodeSlot: e % E, episodes: E };
        Object.assign(opts, over);
        const p = new World(M, [null], opts).startPose;
        if (!p) c.standing++;
        else if (POOL.has(p.name)) c.pose++;
        else if (p.name.startsWith("rise")) c.rise++;
        else c.crouch++;
    }
    for (const k in c) c[k] /= N;
    return c;
}

const [g, s, po] = process.argv.slice(2).map(Number);
const over = Number.isFinite(g) ? { groundFrac: g, seatFrac: s, poseFrac: po } : {};
if (Number.isFinite(g)) console.log(`override: ground ${g}  seat ${s}  pose ${po}`);
console.log(`${N} episodes per stage, dealt in banks of ${E}\n`);
console.log("  stage           standing      pose    crouch      rise     alternative");
for (const st of [1, 2, 3, 4, 5]) {
    const c = mix(st, over);
    const alt = c.pose + c.crouch + c.rise;
    console.log(`  ${st} ${String(STAGES[st - 1].name).padEnd(10)} ` +
        [c.standing, c.pose, c.crouch, c.rise].map(v => (100 * v).toFixed(1).padStart(8) + "%").join("") +
        `   ${(100 * alt).toFixed(1).padStart(8)}%`);
}
console.log(`
"standing" is the ordinary upright spawn; everything else begins lower. The
request this table is set against is 60% standing / 40% alternative, and the
granularity is one slot in ${E} (${(100 / E).toFixed(1)} points), so landing within a few
points of 60 is as close as stratified dealing can get.`);
