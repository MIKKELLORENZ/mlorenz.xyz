"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const { makeOracleDriver } = require("./oracle_policy.js");
const fs = require("fs");
const saved = JSON.parse(fs.readFileSync("training/distilled_final.json", "utf8"));
const brain = Brain.fromJSON(saved.brain);

for (const cap of [6, 8, 10, 12]) {
  for (const [who, mk] of [["brain", null], ["oracle", makeOracleDriver]]) {
    let nb = 0, eps = 0, lost = 0, del = 0, tgt = 0, comp = 0, leftover = 0, clockOut = 0;
    for (let i = 0; i < 160; i++) {
      const t = TASKS[(i * 29) % TASKS.length];
      const r = (Math.imul(i + 1, 2654435761)) >>> 0;
      const w = new World([brain], { task: t, embedding: Embedding.forTask(t),
        sceneSeed: 4000 + (r % 90000), noiseSeed: 7, maxBalls: cap });
      const s = w.stations[0];
      if (mk) s.policy = mk();
      let g = 0; while (!w.isOver() && g++ < 60 * 200) w.step();
      nb += s.balls.length; eps++;
      lost += s.balls.filter(b => b.lost).length;
      del += s.delivered; tgt += s.evalr.target; comp += s.completed ? 1 : 0;
      leftover += s.balls.filter(b => !b.lost && b.inBucket < 0).length;
      if (!s.completed && s.clock <= 0.001) clockOut++;
    }
    console.log(`cap ${String(cap).padStart(2)} ${who.padEnd(6)}: balls/ep ${(nb/eps).toFixed(1)}  delivered ${(100*del/tgt).toFixed(0)}%  tasks ${(100*comp/eps).toFixed(0)}%  KNOCKED OFF ${lost} (${(lost/eps).toFixed(2)}/ep)  left on table ${(leftover/eps).toFixed(1)}  ran out of clock ${clockOut}`);
  }
}
