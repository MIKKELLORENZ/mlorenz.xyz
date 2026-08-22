/* envelope.js — IS THE STRUCTURAL ENVELOPE REACHABLE ON THESE SCENARIOS AT ALL?
 *
 * The pilot breaks up on ~70% of stage-2 and stage-3 entries. Two very different
 * things produce that number and the fix for one is the opposite of the fix for
 * the other:
 *
 *   (a) the pilot flies a bad trajectory, or
 *   (b) NO trajectory survives, because the scenario drops the vehicle into air
 *       too dense for its limits with too little propellant to slow down.
 *
 * Tuning gains against (b) is how a project spends a week making a controller
 * better at an impossible task. So this asks the feasibility question directly:
 * fly the most aggressive legal deceleration there is — every engine the ladder
 * offers, full throttle, held dead upright so alpha stays near zero and the
 * q·alpha limit cannot bind — and see whether even THAT stays under qMax.
 *
 * If maximum braking still breaks up, the scenario is the bug. If it survives,
 * the pilot is, and the gap between them is the budget a controller has to work
 * inside.
 *
 * Reported alongside: free fall, which is the do-nothing reference and tells you
 * how much of the problem is the atmosphere rather than the entry state.
 */
"use strict";

const M = require("../mathx.js");
const V = require("../vehicle.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");

const N = Number(process.argv[2] || 24);
const STAGES = (process.argv[3] || "0,1,2,3").split(",").map(Number);
const med = (a) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const pctl = (a, p) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

/* Maximum braking: top of the engine ladder, full throttle, attitude held on
 * the airflow. No guidance at all — this is not a controller, it is an upper
 * bound on how hard the vehicle can possibly decelerate. */
function maxBrake(w, o) {
    o.fill(0);
    o[9] = 1;
    const LAD = w.type.engineLadder;
    o[1] = 1;                       // top rung
    o[0] = 1;                       // full throttle
    // hold upright: a booster falling tail-first is already near zero alpha, and
    // a PD on tilt keeps it there without ever commanding a manoeuvre.
    const ax = new Float64Array(3);
    w.axis(ax);
    const I = w.mp.Ixx, T = w.act.thrust();
    if (T > 1e3) {
        const rz = w.type.engines[0].z - w.mp.com, gmax = w.type.engines[0].gimbal;
        // error to vertical, body frame
        const errW = [ax[1] * 1 - ax[2] * 0, ax[2] * 0 - ax[0] * 1, 0];
        const errB = new Float64Array(3);
        M.qrotInv(errB, w.q, new Float64Array([-ax[1], ax[0], 0]));
        const tauX = I * (0.30 * errB[0] - 1.40 * w.w[0]);
        const tauY = I * (0.30 * errB[1] - 1.40 * w.w[1]);
        o[2] = M.clamp(Math.asin(M.clamp(tauX / (rz * T), -1, 1)) / gmax, -1, 1);
        o[3] = M.clamp(Math.asin(M.clamp(tauY / (rz * T), -1, 1)) / gmax, -1, 1);
    }
    void LAD;
    return o;
}
const freeFall = (w, o) => { o.fill(0); o[0] = -1; o[1] = -1; o[9] = 1; return o; };

console.log(`limits: qMax ${(V.BOOSTER.qMax / 1e3).toFixed(1)} kPa · ` +
    `q·alphaMax ${(V.BOOSTER.qAlphaMax / 1e3).toFixed(1)} kPa·rad\n`);
console.log(`stage                            policy      peak q (kPa)          peak q·a   breakup  prop used`);
console.log(`                                            med   p90   max          med`);

for (const stage of STAGES) {
    if (SC.STAGES[stage].vehicle !== "booster") continue;
    for (const [name, pol] of [["max brake", maxBrake], ["free fall", freeFall]]) {
        const qs = [], qas = [], props = [];
        let broke = 0;
        for (let i = 0; i < N; i++) {
            const sc = SC.makeScenario(stage, 90000 + i * 7919);
            sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
            const w = new WM.World(sc);
            const p0 = sc.prop;
            let mq = 0, mqa = 0;
            const r = w.runEpisode((wo, o) => {
                if (wo.tel.q > mq) mq = wo.tel.q;
                if (wo.tel.qAlpha > mqa) mqa = wo.tel.qAlpha;
                return pol(wo, o);
            });
            qs.push(mq); qas.push(mqa); props.push((p0 - w.prop) / 1e3);
            if (WM.OUTCOME_NAME[r.outcome] === "breakup") broke++;
        }
        console.log(`${stage} ${SC.STAGES[stage].label.padEnd(30).slice(0, 30)} ${name.padEnd(10)}` +
            `${(med(qs) / 1e3).toFixed(0).padStart(6)}${(pctl(qs, 0.9) / 1e3).toFixed(0).padStart(6)}` +
            `${(Math.max(...qs) / 1e3).toFixed(0).padStart(6)}` +
            `${(med(qas) / 1e3).toFixed(1).padStart(14)}` +
            `${(broke + "/" + N).padStart(10)}${med(props).toFixed(0).padStart(9)} t`);
    }
}
console.log(`\nA stage whose MAX BRAKE row still breaks up is not a control problem.`);
