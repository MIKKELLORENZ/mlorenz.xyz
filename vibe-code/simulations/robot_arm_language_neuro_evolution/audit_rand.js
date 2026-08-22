"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const W = require("./world.js"); const { BUCKET, BALL_R, TABLE } = W;
const fs=require("fs");
const champ = JSON.parse(fs.readFileSync("training/champion.json","utf8"));
function run(makeBrain,label,n){
  let ticks=0,below=0,inWall=0,grasp=0,down=[],ap=[],sideGrasp=0;
  for(let k=0;k<n;k++){
    const task=TASKS[(k*29)%TASKS.length];
    const brain=makeBrain(k);
    const w=new World([brain],{task,embedding:Embedding.forTask(task),sceneSeed:500+k*7,noiseSeed:3,maxBalls:6});
    const s=w.stations[0]; let held=-1,g=0;
    while(!w.isOver()&&g++<60*120){ w.step(); const f=s.arm.fk(); ticks++;
      for(const nn of ["elbow","wrist","tip","grasp"]) if(f[nn].y<-0.005){below++;break;}
      for(const bx of BUCKET.xs) for(const nn of ["wrist","tip","grasp"]){
        const dr=Math.hypot(f[nn].x-bx,f[nn].z-BUCKET.z);
        if(dr<BUCKET.rim&&f[nn].y<BUCKET.rim-0.005&&f[nn].y>0) inWall++;
      }
      if(s.held>=0&&held<0){grasp++;const d=s.arm.downness();down.push(d);ap.push(s.arm.aperture());if(d<0.5)sideGrasp++;}
      held=s.held;
    }
  }
  const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
  console.log(` ${label}: ticks ${ticks}  belowTable ${(100*below/ticks).toFixed(2)}%  inBucketWall ${(100*inWall/ticks).toFixed(2)}%  grasps ${grasp}  meanDownness ${mean(down).toFixed(3)}  sideways-grasps ${sideGrasp}`);
}
console.log("== 4. constraint violations with UNTRAINED and EVOLVED brains ==");
run(k=>new Brain(Embedding.dim,mulberry32(1000+k)),"random brains  ",40);
const cb=champ.brain||champ;
run(()=>Brain.fromJSON(cb),"gen-224 champion",40);
