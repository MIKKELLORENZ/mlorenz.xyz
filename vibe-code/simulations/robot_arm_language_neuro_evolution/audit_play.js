"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const { ARM } = require("./arm.js");
const { makeReferencePolicy } = require("./reference_policy.js");
const W = require("./world.js");
const { BUCKET, BALL_R, TABLE, CLOSE_T } = W;

const KINDS = ["SORT","ALTERNATE","LEAVE_ONE","COUNT","ORDER","EXCLUDE","ALL_TO_ONE"];
let ticks=0, belowTable=0, insideBucketWall=0, graspEvents=0, downAtGrasp=[], apAtGrasp=[];
let ballThroughTable=0, maxSpeed=0, teleport=0;
for (const kind of KINDS) {
  const pool = TASKS.filter(t=>t.kind===kind && t.split==="train");
  for (let k=0;k<4;k++){
    const task = pool[(k*37)%pool.length];
    const brain = new Brain(Embedding.dim, mulberry32(1));
    const w = new World([brain], {task, embedding:Embedding.forTask(task), sceneSeed:100+k*13, noiseSeed:11, maxBalls:6});
    const s = w.stations[0];
    s.policy = makeReferencePolicy();
    let held=-1, prevG=null;
    let guard=0;
    while(!w.isOver() && guard++ < 60*120){
      w.step();
      const f=s.arm.fk(); ticks++;
      // joints below the table surface (inside the bench)
      for (const n of ["elbow","wrist","tip","grasp"]) if (f[n].y < -0.005) { belowTable++; break; }
      // arm inside a bucket wall volume (between inner and outer radius, below rim)
      for (const bx of BUCKET.xs){
        for (const n of ["wrist","tip","grasp"]){
          const dr=Math.hypot(f[n].x-bx, f[n].z-BUCKET.z);
          if (dr < BUCKET.rim && f[n].y < BUCKET.rim - 0.005 && f[n].y > 0) { insideBucketWall++; }
        }
      }
      if (s.held>=0 && held<0){ graspEvents++; downAtGrasp.push(s.arm.downness()); apAtGrasp.push(s.arm.aperture()); }
      held=s.held;
      const g=f.grasp;
      if (prevG){ const sp=Math.hypot(g.x-prevG.x,g.y-prevG.y,g.z-prevG.z)/(1/60); if(sp>maxSpeed)maxSpeed=sp; }
      prevG={x:g.x,y:g.y,z:g.z};
      for(const b of s.balls){ if(!b.held && b.inBucket<0 && !b.lost && b.y < BALL_R-0.004 && b.x>TABLE.x0&&b.x<TABLE.x1&&b.z>TABLE.z0&&b.z<TABLE.z1) ballThroughTable++; }
    }
  }
}
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
console.log("== 3. what actually happens during 28 reference episodes ==");
console.log(" control+physics ticks:", ticks);
console.log(" ticks with a joint BELOW the table top:", belowTable, "("+(100*belowTable/ticks).toFixed(2)+"%)");
console.log(" ticks with a joint INSIDE a bucket's wall volume:", insideBucketWall, "("+(100*insideBucketWall/ticks).toFixed(2)+"%)");
console.log(" ticks with a free ball sunk through the table:", ballThroughTable);
console.log(" grasp events:", graspEvents);
console.log("  downness at grasp (1 = straight down): mean "+mean(downAtGrasp).toFixed(3)+"  min "+Math.min(...downAtGrasp).toFixed(3));
console.log("  aperture at grasp: mean "+mean(apAtGrasp).toFixed(3)+"  max "+Math.max(...apAtGrasp).toFixed(3)+"  (gate "+CLOSE_T+")");
console.log(" max grasp-point speed: "+maxSpeed.toFixed(2)+" m/s");
