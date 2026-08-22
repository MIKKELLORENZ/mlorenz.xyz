"use strict";
const path=require("path");
const {Arm,ARM,HOME,DEG}=require("./arm.js");
const W=require("./world.js");
const {World,TABLE,BALL_R,BUCKET,GRASP_R,CLOSE_T,OPEN_T}=W;
const R=require("./reference_policy.js");
console.log("== constants ==");
console.log(" BALL_R",BALL_R,"GRASP_R",GRASP_R,"graspOffset",ARM.graspOffset,"jawHalf",ARM.jawHalf);
console.log(" tip collider r =",BALL_R+0.012, " wrist collider r =",BALL_R+0.020);
console.log(" graspOffset - tipCollider =",(ARM.graspOffset-(BALL_R+0.012)).toFixed(4),"m  (must be > 0)");

// --- 1. FK independent recomputation -------------------------------------
function fkRef(q){
  const yaw=q[0], rx=Math.sin(yaw), rz=-Math.cos(yaw);
  let p={x:ARM.base.x,y:ARM.base.y+ARM.pedestal,z:ARM.base.z};
  const a=[q[1],q[1]+q[2],q[1]+q[2]+q[3]];
  const L=[ARM.L1,ARM.L2,ARM.L3];
  const out=[Object.assign({},p)];
  for(let i=0;i<3;i++){ p={x:p.x+rx*Math.sin(a[i])*L[i], y:p.y+Math.cos(a[i])*L[i], z:p.z+rz*Math.sin(a[i])*L[i]}; out.push(Object.assign({},p)); }
  return out;
}
let fkErr=0;
const rngq=(()=>{let s=12345;return()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};})();
for(let t=0;t<2000;t++){
  const a=new Arm({});
  for(let j=0;j<5;j++){const[lo,hi]=ARM.limits[j];a.q[j]=lo+rngq()*(hi-lo);}
  a.updateFK(); const f=a.fk(); const r=fkRef(a.q);
  const names=["shoulder","elbow","wrist","tip"];
  names.forEach((n,i)=>{const d=Math.hypot(f[n].x-r[i].x,f[n].y-r[i].y,f[n].z-r[i].z); if(d>fkErr)fkErr=d;});
  // link lengths
  const d1=Math.hypot(f.elbow.x-f.shoulder.x,f.elbow.y-f.shoulder.y,f.elbow.z-f.shoulder.z);
  const d2=Math.hypot(f.wrist.x-f.elbow.x,f.wrist.y-f.elbow.y,f.wrist.z-f.elbow.z);
  const d3=Math.hypot(f.tip.x-f.wrist.x,f.tip.y-f.wrist.y,f.tip.z-f.wrist.z);
  if(Math.abs(d1-ARM.L1)>1e-9||Math.abs(d2-ARM.L2)>1e-9||Math.abs(d3-ARM.L3)>1e-9) throw new Error("link length drift");
  // approach unit
  const an=Math.hypot(f.approach.x,f.approach.y,f.approach.z);
  if(Math.abs(an-1)>1e-9) throw new Error("approach not unit: "+an);
  // grasp must lie on approach ray from tip
  const gx=f.tip.x+f.approach.x*ARM.graspOffset, gy=f.tip.y+f.approach.y*ARM.graspOffset, gz=f.tip.z+f.approach.z*ARM.graspOffset;
  if(Math.hypot(f.grasp.x-gx,f.grasp.y-gy,f.grasp.z-gz)>1e-12) throw new Error("grasp off approach ray");
}
console.log("\n== 1. forward kinematics ==");
console.log(" max |FK - independent recomputation| over 2000 random poses:",fkErr.toExponential(2),"m");
console.log(" link lengths constant, approach unit-length, grasp on approach ray: OK");

// --- 2. workspace ---------------------------------------------------------
console.log("\n== 2. workspace ==");
let minY=1e9,maxY=-1e9, below=0, N=0;
const pts=[];
for(let i=0;i<60000;i++){
  const a=new Arm({});
  for(let j=0;j<5;j++){const[lo,hi]=ARM.limits[j];a.q[j]=lo+rngq()*(hi-lo);}
  a.updateFK(); const f=a.fk(); const g=f.grasp;
  N++; if(g.y<minY)minY=g.y; if(g.y>maxY)maxY=g.y;
  if(f.elbow.y<0||f.wrist.y<0||f.tip.y<0||g.y<0) below++;
  pts.push([g.x,g.y,g.z,f]);
}
console.log(" grasp-point Y range over random poses: "+minY.toFixed(3)+" .. "+maxY.toFixed(3)+" m");
console.log(" poses with some joint BELOW the table plane: "+(100*below/N).toFixed(1)+"%   <-- no arm/table collision exists");
// can it reach each bucket interior and the ball area?
function reachable(tx,ty,tz,tol){
  let best=1e9;
  for(const[px,py,pz] of pts){const d=Math.hypot(px-tx,py-ty,pz-tz); if(d<best)best=d;}
  return best;
}
for(let i=0;i<BUCKET.xs.length;i++){
  const d=reachable(BUCKET.xs[i],BUCKET.rim+0.02,BUCKET.z);
  console.log("  bucket "+i+" (x="+BUCKET.xs[i]+") release point: nearest sampled grasp point "+(d*1000).toFixed(0)+" mm");
}
const BA=W.BALL_AREA;
console.log("  BALL_AREA:",JSON.stringify(BA));
for(const[bx,bz] of [[BA.x0,BA.z0],[BA.x1,BA.z0],[BA.x0,BA.z1],[BA.x1,BA.z1],[0,(BA.z0+BA.z1)/2]]){
  const d=reachable(bx,BALL_R,bz);
  console.log("  ball corner ("+bx.toFixed(2)+","+bz.toFixed(2)+"): nearest grasp point "+(d*1000).toFixed(0)+" mm");
}
