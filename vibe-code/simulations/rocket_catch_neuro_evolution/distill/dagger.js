/* dagger.js — distil the golden pilot into a network, then DAgger it.
 *
 *   node distill/dagger.js [--rounds 5] [--eps 400] [--stages 0] [--arch std]
 *                          [--workers 24] [--epochs 12] [--out distill/run]
 *
 * WHY THIS EXISTS. The GA is signal-limited, measured: the per-episode sd of
 * the rung being selected on is 0.0334, so at 64 episodes the selector resolves
 * +/-0.0042, while 100 generations of real progress is worth 0.0024. Selection
 * is about twice as coarse as the thing it is trying to detect, and 250 control
 * decisions per episode are being graded by one scalar. More generations cannot
 * fix that. A per-decision signal can, and there is a teacher available: the
 * golden pilot, which catches 55% of stage 0.
 *
 * THE ROUND STRUCTURE, and the two rules that make it work:
 *
 *   round 0     the teacher drives everything (beta = 1). This is cloning.
 *   round k     the STUDENT drives, except that each control tick executes the
 *               teacher's action with probability beta, decaying to 0. The
 *               teacher labels every state either way.
 *   retrain     from SCRATCH on the union of all rounds, never continued from
 *               the previous weights. The aim is to fit every distribution
 *               seen so far, not to chase the newest one.
 *
 * beta-mixing matters early: a weak student left entirely to itself spends its
 * rollouts in states that are already lost, where every label is damage
 * limitation and none of them demonstrate a catch. The final round runs at
 * beta = 0 so that its measurement is honest on-policy performance.
 *
 * NOT SEEDED FROM THE EVOLVED CHAMPION. A long-converged GA lineage is a deep
 * narrow basin fitted to a different objective, and gradient descent spends its
 * budget escaping it. Fresh random initialisation unless measured otherwise —
 * and `--seedfrom` exists only so that claim can be re-measured here.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const SENS = require("../sensors.js");
const TEACH = require("./teacher.js");

const N_OUT = WM.N_OUT;

const { CHANNEL_W } = require("./dagger_w.js");

/* ------------------------------------------------------------------ worker */
if (!isMainThread) {
    const { lags, brainJSON, beta, specs, seed, winw } = workerData;
    const WINW = Math.max(1, Number(winw || 1));
    const rng = NN.mulberry32(seed >>> 0);
    const student = brainJSON ? NN.Brain.fromJSON(brainJSON) : null;

    /* ONE SENSOR INSTANCE, NOT TWO.
     *
     * The obvious build uses a BrainPolicy for the student and a separate
     * Sensors for recording. That is wrong under beta-mixing: BrainPolicy owns
     * its own sensor ring and records the STUDENT's output into it, but on a
     * teacher-executed tick the world advanced under the TEACHER's action. The
     * student's action history would then describe a flight that did not
     * happen, and the observation it acts on would differ from the observation
     * being recorded as the training input — silently, and in a way that gets
     * worse the more the two policies disagree.
     *
     * So the student's forward pass and its decision latch are run here against
     * the single shared sensor, and the one executed action is recorded once. */
    const sensors = new SENS.Sensors(lags);
    const nIn = sensors.nInput;
    const held = new Float64Array(N_OUT);
    let tick = 0;

    const X = [], Y = [];
    const why = {};
    let caught = 0, ticks = 0;
    const tally = {};

    const label = new Float64Array(N_OUT);
    const epX = [], epY = [];              // one episode, held until its outcome is known

    for (const s of specs) {
        const w = new WM.World(SC.makeScenario(s.stage, s.seed));
        sensors.reset(); held.fill(0); tick = 0;
        /* BETA IS CHOSEN ONCE PER EPISODE, NOT PER TICK.
         *
         * Per-tick mixing was the first implementation and it quietly defeats
         * the purpose: at beta = 0.5 the teacher takes over every other control
         * tick, so the student's error is corrected before it can accumulate and
         * the states collected are teacher-stabilised rather than on-policy.
         * Compounding error is the entire failure mode here — the student's
         * gimbal error is within the tolerance that random noise of the same
         * size costs nothing, so what hurts is that it PERSISTS — and per-tick
         * mixing is exactly the thing that hides it. Only the final beta = 0
         * round was collecting the states that matter.
         *
         * Per episode, the vehicle is flown all the way by one policy, so a
         * student-driven episode shows the drift in full and the teacher labels
         * the whole trajectory of it. */
        const studentDrives = student && rng() >= beta;
        const r = w.runEpisode((wo, out) => {
            const x = sensors.observe(wo);

            const kind = TEACH.advise(wo, label);
            why[kind] = (why[kind] || 0) + 1;

            const rec = new Float32Array(nIn); rec.set(x);
            const lab = new Float32Array(N_OUT); lab.set(label);
            epX.push(rec); epY.push(lab);
            ticks++;

            if (!studentDrives) {
                /* THE TEACHER FLIES THROUGH THE SAME LATCH THE STUDENT DOES.
                 *
                 * BrainPolicy holds the slow decisions — engine group, legs,
                 * commit — at 2 Hz, so a deployed student cannot change its
                 * engine count between decision ticks. An unlatched teacher can,
                 * and measured over 200 stage-0 episodes that freedom is worth 8
                 * points: 124 catches unlatched against 108 latched. Collecting
                 * unlatched demonstrations therefore shows the student
                 * trajectories it is structurally incapable of flying — the same
                 * error as labelling an unreachable goal, in a different place.
                 *
                 * The LABEL stays the raw continuous advice: the network should
                 * learn the underlying command, and the latch quantises it at
                 * deployment exactly as it does here. */
                for (let i = 0; i < N_OUT; i++) out[i] = label[i];
                if (tick % NN.DECIDE_EVERY === 0) {
                    for (const k of NN.DECISION_SLOTS) held[k] = out[k];
                } else {
                    for (const k of NN.DECISION_SLOTS) out[k] = held[k];
                }
            } else {
                const y = student.forward(x);
                for (let i = 0; i < N_OUT; i++) out[i] = y[i];
                // the same 2 Hz latch BrainPolicy applies, so on-policy states
                // are the ones the deployed policy would actually reach
                if (tick % NN.DECIDE_EVERY === 0) {
                    for (const k of NN.DECISION_SLOTS) held[k] = out[k];
                } else {
                    for (const k of NN.DECISION_SLOTS) out[k] = held[k];
                }
            }
            sensors.recordAction(out);
            tick++;
            return out;
        });
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
        if (nm === "caught") caught++;

        /* THE STUDENT IS IMITATING A POLICY THAT MOSTLY FAILS.
         *
         * The teacher catches about 20% of stage 0. Every tick of every episode
         * was going into the dataset with equal weight, so four fifths of what
         * the student is fitted to is a trajectory that ended in a miss. The
         * labels are individually right — DAgger's whole point is that correct
         * advice from a bad state is still correct — but the BEHAVIOUR being
         * demonstrated in bulk is the behaviour that misses, and the misses fail
         * on terminal precision, which is exactly what the student has to learn.
         * Measured across two full runs and thirteen rounds, the student caught
         * 0/200 every single time while its outcomes marched crash -> tower
         * strike -> missed catch: it learned to arrive and not to arrive well.
         *
         * So episodes that ended in a catch are weighted up. Not filtered TO —
         * the failures carry the recovery states that are DAgger's reason for
         * existing, and throwing them away trades one bias for another — but a
         * successful demonstration is worth more than an unsuccessful one when
         * what is being learned is how to finish.
         *
         * The weight is applied per EPISODE, after the outcome is known, which
         * is why the samples are buffered rather than pushed as they are made. */
        const rep = (nm === "caught") ? WINW : 1;
        for (let r2 = 0; r2 < rep; r2++) {
            for (let i = 0; i < epX.length; i++) { X.push(epX[i]); Y.push(epY[i]); }
        }
        epX.length = 0; epY.length = 0;
    }

    const flatX = new Float32Array(X.length * nIn);
    const flatY = new Float32Array(Y.length * N_OUT);
    for (let i = 0; i < X.length; i++) { flatX.set(X[i], i * nIn); flatY.set(Y[i], i * N_OUT); }
    parentPort.postMessage({ flatX, flatY, n: X.length, nIn, caught, tally, why, ticks },
        [flatX.buffer, flatY.buffer]);
    return;
}

require("./main.js").run(CHANNEL_W, __filename);
module.exports = { CHANNEL_W };
