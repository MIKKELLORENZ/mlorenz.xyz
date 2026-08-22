"use strict";
const TEACH = require("../distill/teacher.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const V = require("../vehicle.js");
const sc = SC.makeScenario(Number(process.argv[3] || 0), Number(process.argv[2] || 810000));
sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
const w = new WM.World(sc);
const out = new Float64Array(10);
let k = 0;
const r = w.runEpisode((wo, o) => {
    const kind = TEACH.advise(wo, out); o.set(out);
    if (k % 20 === 0) {
        const h = wo.p[2] - (V.TOWER.armZ - wo.type.catchPinZ);
        console.log(wo.t.toFixed(1), "h", h.toFixed(0), "v", (-wo.v[2]).toFixed(0),
            "st", wo.act.stage, "thr", wo.act.throttle.toFixed(2), "prop", (wo.prop / 1000).toFixed(1),
            "o0", o[0].toFixed(2), "o1", o[1].toFixed(2), "tilt", (wo.tel.tilt * 57.3).toFixed(0), kind);
    }
    k++; return o;
});
console.log("outcome", WM.OUTCOME_NAME[r.outcome]);
