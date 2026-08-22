/* dagger_w.js — the per-channel loss weights, in their own module.
 *
 * Separated from dagger.js because requiring dagger.js on the main thread
 * STARTS A DAgger RUN — it calls main.run() at load. Anything that just wants
 * the constants (the capacity probe, the evaluator) would have launched a
 * multi-hour job as a side effect of an import.
 */
"use strict";

/* Channels the booster actually flies with are worth more than the ones it does
 * not have. Flaps and legs are constants on this airframe, and a plain
 * unweighted mean is dominated by fitting those constants perfectly. */
/* GIMBAL WEIGHT IS OVERRIDABLE, because the measured failure mode of the cloned
 * policy is attitude, not thrust. Flown against the teacher on the same
 * episodes, the clone brakes respectably — 14 m/s at the rails against the
 * evolved champion's 34 — but arrives at 36 degrees of tilt and its across-arm
 * error GROWS by 17%, where the teacher's shrinks by 98%. Attitude error feeds
 * the lateral loop directly: point the thrust wrong and you accelerate away
 * from the gate. So the two gimbal channels are the ones whose small residual
 * error compounds fastest, and they are worth testing at a higher weight. */
const GW = Number(process.env.GIMBAL_W || 2.0);
const CHANNEL_W = Float64Array.from([
    3.0,  // 0 throttle
    3.0,  // 1 engine group
    GW,   // 2 gimbal x
    GW,   // 3 gimbal y
    0.5, 0.5, 0.5, 0.5,   // 4-7 aero surfaces
    0.3,  // 8 legs
    1.0   // 9 commit
]);

module.exports = { CHANNEL_W };
