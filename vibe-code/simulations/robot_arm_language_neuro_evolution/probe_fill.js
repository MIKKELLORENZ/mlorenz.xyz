"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const { makeOracleDriver } = require("./oracle_policy.js");
const W = require("./world.js");
for (const fill of [1, 1.6, 2.0, 2.4]) {
  let nb = 0, eps = 0, lost = 0, del = 0, tgt = 0, comp = 0, clockOut = 0, tsum = 0, shoved = 0;
  for (let i = 0; i < 180; i++) {
    const t = TASKS[(i * 29) % TASKS.length];
    const r = (Math.imul(i + 1, 2654435761)) >>> 0;
    const w = new World([new Brain(Embedding.dim, mulberry32(1))], {
      task: t, embedding: Embedding.forTask(t),
      sceneSeed: 4000 + (r % 90000), noiseSeed: 7, maxBalls: 12, fill });
    const s = w.stations[0];
    const start = s.balls.map(b => ({ x: b.x, z: b.z }));
    s.policy = makeOracleDriver();
    let g = 0; while (!w.isOver() && g++ < 60 * 240) w.step();
    nb += s.balls.length; eps++;
    lost += s.balls.filter(b => b.lost).length;
    del += s.delivered; tgt += s.evalr.target; comp += s.completed ? 1 : 0; tsum += s.t;
    if (!s.completed && s.clock <= 0.001) clockOut++;
    s.balls.forEach((b, k) => { if (!b.lost && b.inBucket < 0 && Math.hypot(b.x - start[k].x, b.z - start[k].z) > 0.03) shoved++; });
  }
  console.log(`fill ${fill.toFixed(1)}: balls/ep ${(nb/eps).toFixed(1)}  target ${(tgt/eps).toFixed(1)}  delivered ${(100*del/tgt).toFixed(0)}%  tasks ${(100*comp/eps).toFixed(0)}%  ` +
    `KNOCKED OFF ${(lost/eps).toFixed(2)}/ep  shoved>3cm ${(shoved/eps).toFixed(2)}/ep  out-of-clock ${clockOut}  mean ${(tsum/eps).toFixed(1)}s`);
}
