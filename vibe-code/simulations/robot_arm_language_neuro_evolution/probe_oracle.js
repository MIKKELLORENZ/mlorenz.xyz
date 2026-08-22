/* probe_oracle.js — does the MEMORYLESS teacher clear the bench too?
 *
 * This is the gate on the whole distillation route. A student that is a pure
 * function of the current observation cannot be better than the best teacher
 * that is also a pure function of the current observation, so if this probe
 * comes back materially below the latched reference controller, the answer is
 * to fix the teacher, not to train longer.
 *
 *   node probe_oracle.js [runsPerKind]
 */
"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const { makeOracleDriver } = require("./oracle_policy.js");
const { makeReferencePolicy } = require("./reference_policy.js");

const KINDS = ["SORT", "ALTERNATE", "LEAVE_ONE", "COUNT", "ORDER", "EXCLUDE", "ALL_TO_ONE"];
const runs = parseInt(process.argv[2] || "4", 10);

for (const [name, mk] of [["latched reference", makeReferencePolicy], ["memoryless oracle", makeOracleDriver]]) {
    let del = 0, tgt = 0, comp = 0, n = 0, tsum = 0;
    const perKind = {};
    for (const kind of KINDS) {
        const pool = TASKS.filter(t => t.kind === kind && t.split === "train");
        let kd = 0, kt = 0, kc = 0;
        for (let k = 0; k < runs; k++) {
            const task = pool[(k * 37) % pool.length];
            const brain = new Brain(Embedding.dim, mulberry32(1));
            const w = new World([brain], {
                task, embedding: Embedding.forTask(task),
                sceneSeed: 100 + k * 13, noiseSeed: 11, maxBalls: 6
            });
            const s = w.stations[0];
            s.policy = mk();
            let guard = 0;
            while (!w.isOver() && guard++ < 60 * 120) w.step();
            del += s.delivered; tgt += s.evalr.target; comp += s.completed ? 1 : 0; n++; tsum += s.t;
            kd += s.delivered; kt += s.evalr.target; kc += s.completed ? 1 : 0;
        }
        perKind[kind] = `${kd}/${kt} balls, ${kc}/${runs} tasks`;
    }
    console.log(`\n${name}: ${del}/${tgt} balls (${(100 * del / tgt).toFixed(0)}%), ${comp}/${n} tasks complete, mean ${(tsum / n).toFixed(1)}s`);
    for (const k of KINDS) console.log(`   ${k.padEnd(11)} ${perKind[k]}`);
}
