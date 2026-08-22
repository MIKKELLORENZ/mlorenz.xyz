"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const W = require("./world.js");
const { BALL_AREA, BALL_R, BUCKET } = W;
const { ARM } = require("./arm.js");
const { solveIK } = require("./reference_policy.js");

// how many balls can the rejection sampler actually place without overlap?
function tryPlace(n, seed, area, sep) {
  const rng = mulberry32(seed);
  const balls = [];
  let fails = 0;
  for (let k = 0; k < n; k++) {
    let x = 0, z = 0, ok = false;
    for (let a = 0; a < 200 && !ok; a++) {
      x = area.x0 + rng() * (area.x1 - area.x0);
      z = area.z0 + rng() * (area.z1 - area.z0);
      ok = true;
      for (const b of balls) if (Math.hypot(b.x - x, b.z - z) < sep) { ok = false; break; }
      if (ok) for (const bx of BUCKET.xs) if (Math.hypot(bx - x, BUCKET.z - z) < BUCKET.r + 0.06) { ok = false; break; }
    }
    if (!ok) fails++;
    balls.push({ x, z });
  }
  let overlaps = 0;
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++)
    if (Math.hypot(balls[i].x - balls[j].x, balls[i].z - balls[j].z) < BALL_R * 2) overlaps++;
  return { fails, overlaps };
}

console.log(`BALL_AREA ${JSON.stringify(BALL_AREA)}  sep 0.085`);
for (const n of [6, 8, 10, 12, 14]) {
  let f = 0, o = 0;
  for (let s = 0; s < 300; s++) { const r = tryPlace(n, s + 1, BALL_AREA, 0.085); f += r.fails; o += r.overlaps; }
  console.log(`  ${String(n).padStart(2)} balls: placement failures ${(f/300).toFixed(2)}/scene, actual overlaps ${(o/300).toFixed(2)}/scene`);
}
const BIG = { x0: -0.40, x1: 0.40, z0: -0.13, z1: 0.28 };
console.log(`\nenlarged ${JSON.stringify(BIG)}`);
for (const n of [10, 12, 14]) {
  let f = 0, o = 0;
  for (let s = 0; s < 300; s++) { const r = tryPlace(n, s + 1, BIG, 0.085); f += r.fails; o += r.overlaps; }
  console.log(`  ${String(n).padStart(2)} balls: placement failures ${(f/300).toFixed(2)}/scene, actual overlaps ${(o/300).toFixed(2)}/scene`);
}
// reachability of the enlarged corners
console.log("\nreachability (IK residual at ball height, must be ~0):");
for (const [x, z] of [[BIG.x0, BIG.z0], [BIG.x1, BIG.z0], [BIG.x0, BIG.z1], [BIG.x1, BIG.z1], [BIG.x0, 0], [BIG.x1, 0]]) {
  const r = solveIK({ x, y: BALL_R, z });
  console.log(`  (${x.toFixed(2)}, ${z.toFixed(2)}) residual ${(r.err*1000).toFixed(1)} mm`);
}
