"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const { makeOracleDriver } = require("./oracle_policy.js");
const fs = require("fs");
function run(brainFile, label, pol) {
  const brain = brainFile ? Brain.fromJSON(JSON.parse(fs.readFileSync(brainFile, "utf8")).brain)
                          : new Brain(Embedding.dim, mulberry32(1));
  let eps=0, balls=0, lost=0, shoved=0, del=0, tgt=0, comp=0, left=0;
  for (let i = 0; i < 400; i++) {
    const t = TASKS[(i * 29) % TASKS.length];
    const r = (Math.imul(i + 1, 2654435761)) >>> 0;
    const w = new World([brain], { task: t, embedding: Embedding.forTask(t),
      sceneSeed: 55000 + (r % 90000), noiseSeed: 3, maxBalls: MAX_BALLS, fill: 2.0, noise: 0.3 });
    const s = w.stations[0];
    if (pol) s.policy = pol();
    const start = s.balls.map(b => ({ x: b.x, z: b.z }));
    let g = 0; while (!w.isOver() && g++ < 60 * 240) w.step();
    eps++; balls += s.balls.length; del += s.delivered; tgt += s.evalr.target; comp += s.completed?1:0;
    lost += s.balls.filter(b => b.lost).length;
    left += s.balls.filter(b => !b.lost && b.inBucket < 0).length;
    s.balls.forEach((b,k) => { if (!b.lost && b.inBucket<0 && Math.hypot(b.x-start[k].x, b.z-start[k].z) > 0.03) shoved++; });
  }
  console.log(`${label.padEnd(22)} balls/ep ${(balls/eps).toFixed(1)}  delivered ${(100*del/tgt).toFixed(0)}%  tasks ${(100*comp/eps).toFixed(0)}%  ` +
    `KNOCKED OFF ${(lost/eps).toFixed(3)}/ep (${lost} in ${eps})  shoved>3cm ${(shoved/eps).toFixed(2)}/ep  left ${(left/eps).toFixed(1)}`);
}
console.log("full bench (fill 2.0), 400 episodes each:\n");
run(null, "untrained brain");
run("training/distilled_fullbench.json", "trained arm");
run(null, "scripted oracle", makeOracleDriver);
