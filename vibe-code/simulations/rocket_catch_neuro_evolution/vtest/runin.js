/* runin.js — IS THE SEAWARD RUN-IN FLYABLE BY ANYTHING?
 *
 * reachable.js says 0/80, but it only jitters the GAINS of a controller whose
 * STRUCTURE is a settle: a position/velocity PD clamped at a couple of m/s^2
 * that accelerates toward the gate and has no concept of arriving at rest. Ask
 * it to fly 1.4 km in and it commands max lateral acceleration the whole way
 * and overshoots. A negative result from that probe says the controller is
 * wrong, not that the task is.
 *
 * So this flies proper terminal guidance instead. For arrival at a point with
 * zero velocity in time-to-go t, the minimum-effort acceleration is
 *
 *     a = -(6*dp/t^2 + 4*v/t)
 *
 * (the standard zero-effort-miss law, the same family as Apollo's E-guidance).
 * Time-to-go comes from the vertical channel, and the same law flies the
 * vertical. If THIS cannot catch, the geometry is genuinely infeasible.
 */
"use strict";
const M = require("../mathx.js");
const V = require("../vehicle.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const G = V.G0;

const N = Number(process.argv[2] || 60);
const STAGE = Number(process.argv[3] || 0);

function pilot() {
    const ax = new Float64Array(3), errB = new Float64Array(3), errW = new Float64Array(3);
    return function (w, o) {
        o.fill(0); o[9] = 1;
        const ty = w.type, LAD = ty.engineLadder, T1 = V.RAPTOR.thrust, m = w.mp.m, tel = w.tel;
        const aimZ = V.TOWER.armZ - ty.catchPinZ;
        const h = w.p[2] - aimZ, vz = w.v[2];

        /* Time-to-go: solve the vertical for arrival at ~1 m/s, floored so the
         * law does not blow up in the last instant. */
        const aAvail = Math.max(2, (LAD[LAD.length - 1] * T1) / m - G);
        let tgo = Math.max(1.2, (-vz + Math.sqrt(Math.max(0, vz * vz + 2 * aAvail * Math.max(0, h)))) / aAvail);
        if (h < 8) tgo = 1.2;

        const gx = V.TOWER.gateX - tel.pinX, gy = V.TOWER.gateY - tel.pinY;
        const alx = 6 * gx / (tgo * tgo) - 4 * w.v[0] / tgo;
        const aly = 6 * gy / (tgo * tgo) - 4 * w.v[1] / tgo;
        const az = G + (6 * h / (tgo * tgo) - 4 * vz / tgo) * -1 + (6 * -h / (tgo * tgo) + 4 * -vz / tgo) * 0
                 + (-6 * h / (tgo * tgo) - 4 * vz / tgo) * 0;
        /* vertical: want to arrive at h=0 with vz ~ -1 */
        const azReq = G + (-6 * (-h) / (tgo * tgo) - 4 * (vz + 1) / tgo);

        let ax2 = alx, ay2 = aly, az2 = Math.max(0.2 * G, azReq);
        const amag = Math.hypot(ax2, ay2, az2);
        const aCap = (LAD[LAD.length - 1] * T1) / m;
        if (amag > aCap) { const k = aCap / amag; ax2 *= k; ay2 *= k; az2 *= k; }
        void az;

        const nrm = Math.hypot(ax2, ay2, az2) || 1;
        const nx = ax2 / nrm, ny = ay2 / nrm, nz = az2 / nrm;

        // pick the smallest engine group that can supply it and can throttle to it
        const need = m * nrm;
        let cmd = 0;
        for (let k = 1; k < LAD.length; k++) {
            const hi = LAD[k] * T1, lo = hi * V.RAPTOR.minThrottle;
            if (need <= hi && need >= lo * 0.9) { cmd = k; break; }
            if (need <= hi) { cmd = k; break; }
        }
        if (w.act.everLit && cmd === 0) cmd = Math.max(1, w.act.stage);
        if (cmd > 0) {
            o[1] = (cmd + 0.5) / LAD.length * 2 - 1;
            o[0] = M.clamp(need / (LAD[cmd] * T1), V.RAPTOR.minThrottle, 1) * 2 - 1;
        } else { o[0] = -1; o[1] = -1; }

        w.axis(ax);
        errW[0] = ax[1] * nz - ax[2] * ny;
        errW[1] = ax[2] * nx - ax[0] * nz;
        errW[2] = ax[0] * ny - ax[1] * nx;
        M.qrotInv(errB, w.q, errW);
        const I = w.mp.Ixx, T = w.act.thrust();
        if (T > 1e3) {
            const rz = ty.engines[0].z - w.mp.com, gm = ty.engines[0].gimbal;
            const tauX = I * (0.55 * errB[0] - 1.30 * w.w[0]);
            const tauY = I * (0.55 * errB[1] - 1.30 * w.w[1]);
            o[2] = M.clamp(Math.asin(M.clamp(tauX / (rz * T), -1, 1)) / gm, -1, 1);
            o[3] = M.clamp(Math.asin(M.clamp(tauY / (rz * T), -1, 1)) / gm, -1, 1);
        }
        return o;
    };
}

let caught = 0, dry = 0; const tally = {}; const miss = [];
for (let i = 0; i < N; i++) {
    const sc = SC.makeScenario(STAGE, 9500000 + i * 7919);
    sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
    const w = new WM.World(sc);
    const r = w.runEpisode(pilot());
    const nm = WM.OUTCOME_NAME[r.outcome];
    tally[nm] = (tally[nm] || 0) + 1;
    if (nm === "caught") caught++;
    if (w.dry) dry++;
    if (w.acc.gate) miss.push(Math.hypot(w.acc.gate.dx, w.acc.gate.dy));
}
const md = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
console.log(`terminal-guidance reference on stage ${STAGE}, ${N} episodes`);
console.log(`  caught ${caught}/${N}   ran dry ${dry}/${N}   median gate miss ${md(miss).toFixed(1)} m`);
console.log(`  ` + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
