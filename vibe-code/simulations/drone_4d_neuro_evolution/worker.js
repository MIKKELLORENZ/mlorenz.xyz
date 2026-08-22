/* worker.js — evaluates a slice of the population on the whole episode bank.
 *
 * Drones are ghosts: they do not see or collide with each other, and the
 * waypoint chain is rolled from a seeded RNG that depends only on the mission
 * seed. So running a SUBSET of the population in a World produces bit-identical
 * results to running all of it, and the population can be split across workers
 * without changing a single score. test_math.js's determinism section is what
 * keeps that true.
 */
"use strict";
const { parentPort } = require("worker_threads");
require("./bootstrap.js");

parentPort.on("message", (msg) => {
    const { sizes, brains, indices, episodes, opts } = msg;
    // see train.js — this thread has its own DRONE/ROOM objects to patch
    if (opts.phys) Object.assign(DRONE, opts.phys);
    if (opts.wpFloor) ROOM.WP_FLOOR = opts.wpFloor;
    const nets = brains.map(layers => {
        const n = new Net(sizes, null);
        for (let l = 0; l < layers.length; l++) n.weights[l].set(new Float32Array(layers[l]));
        return n;
    });
    const room = new Room4D();
    const N = nets.length;
    const fit = new Float64Array(N), arr = new Float64Array(N);
    const crashed = new Float64Array(N), tookOff = new Float64Array(N), air = new Float64Array(N);

    for (const ep of episodes) {
        const res = runEpisode(room, nets, Object.assign({}, opts, {
            missionSeed: ep.missionSeed, noiseSeed: ep.noiseSeed, turbulence: ep.turbulence
        }));
        for (let i = 0; i < N; i++) {
            fit[i] += res[i].fitness;
            arr[i] += res[i].arrivals;
            crashed[i] += res[i].crashed;
            tookOff[i] += res[i].tookOff;
            air[i] += res[i].airTime;
        }
    }
    const k = episodes.length;
    for (let i = 0; i < N; i++) { fit[i] /= k; arr[i] /= k; crashed[i] /= k; tookOff[i] /= k; air[i] /= k; }
    parentPort.postMessage({ indices, fit, arr, crashed, tookOff, air });
});
