"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const W=require("./world.js"); const {BUCKET,TABLE}=W;
const {makeReferencePolicy}=require("./reference_policy.js");
const fs=require("fs");
const champ=JSON.parse(fs.readFileSync("training/champion.json","utf8"));
const RTOP=BUCKET.r, RBOT=BUCKET.r*0.82, H=BUCKET.rim;
const Rat=y=>RBOT+(RTOP-RBOT)*Math.max(0,Math.min(1,y/H));
// sample points along every link, not just the joints
function samples(f){
  const P=[],add=(a,b,n)=>{for(let i=1;i<=n;i++)P.push({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n,z:a.z+(b.z-a.z)*i/n});};
  add(f.shoulder,f.elbow,6);add(f.elbow,f.wrist,6);add(f.wrist,f.tip,3);add(f.tip,f.grasp,2);return P;
}
const inTable=p=>p.x>TABLE.x0&&p.x<TABLE.x1&&p.z>TABLE.z0&&p.z<TABLE.z1;
function run(mk,label,n,pol){
  let ticks=0,tableCross=0,wallCross=0,minY=1e9,deepTicks=0,bucketTicks=0;
  for(let k=0;k<n;k++){
    const task=TASKS[(k*29)%TASKS.length];
    const w=new World([mk(k)],{task,embedding:Embedding.forTask(task),sceneSeed:500+k*7,noiseSeed:3,maxBalls:6});
    const s=w.stations[0]; if(pol)s.policy=makeReferencePolicy();
    let prev=null,g=0;
    while(!w.isOver()&&g++<60*120){
      w.step(); ticks++;
      const P=samples(s.arm.fk());
      let deep=false,inB=false;
      P.forEach((p,i)=>{
        if(p.y<minY)minY=p.y;
        if(inTable(p)&&p.y<-0.002){deep=true; if(prev&&prev[i].y>=-0.002)tableCross++;}
        for(const bx of BUCKET.xs){
          const dr=Math.hypot(p.x-bx,p.z-BUCKET.z);
          const inside=p.y>0&&p.y<H&&dr<Rat(p.y);
          if(inside){inB=true;
            if(prev){const q=prev[i];const dq=Math.hypot(q.x-bx,q.z-BUCKET.z);
              // was outside the wall at a height below the rim -> it went THROUGH the wall
              if(q.y<H&&q.y>0&&dq>Rat(q.y))wallCross++;}
          }
        }
      });
      if(deep)deepTicks++; if(inB)bucketTicks++;
      prev=P;
    }
  }
  console.log(` ${label}`);
  console.log(`   ticks ${ticks}   lowest arm point ${(minY*1000).toFixed(0)} mm   ticks with arm inside the bench ${(100*deepTicks/ticks).toFixed(1)}%`);
  console.log(`   TABLE-TOP punch-throughs ${tableCross}      BUCKET-WALL punch-throughs ${wallCross}   (ticks inside a bucket ${(100*bucketTicks/ticks).toFixed(1)}%)`);
}
console.log("== 4. solid-body violations (links sampled, not just joints) ==");
run(k=>new Brain(Embedding.dim,mulberry32(1)),"scripted reference     ",28,true);
run(k=>new Brain(Embedding.dim,mulberry32(1000+k)),"random brains          ",40);
run(()=>Brain.fromJSON(champ.brain||champ),"gen-224 GA champion    ",40);
