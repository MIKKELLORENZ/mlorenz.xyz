// Node-side loader for the browser sim.
//
// Every logic file is a plain <script> in the page - shared bare globals, no
// modules - so they cannot simply be require()d one at a time: separate
// vm.runInContext calls do NOT share top-level const/let bindings the way
// script tags do. The fix is to concatenate them into ONE script, run that in a
// single context, and assign the names onto the sandbox in an epilogue.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = ['rng.js', 'city.js', 'nn.js', 'signals.js', 'traffic.js', 'evolution.js'];

const EXPORTS = [
    // rng
    'mulberry32', 'gaussian', 'hash32', 'mixSeed', 'clamp', 'lerp', 'expDraw',
    // city
    'ROAD', 'DIRV', 'OPP', 'CITY_TIERS', 'makeCity', 'nextLinkTo', 'cornerPos', 'egoCrop', 'polyAt', 'hasBridge', 'cornerSpeed',
    // nn
    'LAGS', 'NSAMP', 'HIST_LEN', 'N_ARMS', 'N_ADJ', 'N_FAR', 'ARM_CH', 'ADJ_CH', 'FAR_CH',
    'OWNH_CH', 'NETH_CH', 'CORE_CH', 'MAP_OUT', 'TRUNK_IN', 'N_OUT', 'SECTIONS',
    'S_ARM', 'S_ADJ', 'S_T1', 'S_OUT', 'CORE', 'ARM',
    'NN_GENOME_LEN', 'NN_VERSION', 'NN_ARCH_ID', 'randomGenome', 'cloneGenome', 'validGenome',
    'repairGenome', 'weightIndex', 'biasIndex', 'crossoverGenomes', 'mutateGenomeK',
    'encodeMaps', 'nnForward', 'createBootstrapGenome', 'serializeGenome', 'deserializeGenome',
    // signals
    'PH', 'ST', 'SIG', 'armServed', 'crossOpen', 'createLight', 'resetLight', 'armSignal',
    'pedSignal', 'requestPhase', 'stepLight', 'packState', 'readDetectors', 'makeContext',
    'buildContext', 'brainController', 'fixedTimeController', 'actuatedController', 'randomController',
    // traffic
    'SIM', 'idmAccel', 'World',
    // evolution
    'GA_DEFAULTS', 'FIT', 'episodeScore', 'Evolution', 'evaluateController'
];

function loadSim(dir) {
    const root = dir || __dirname;
    let src = '';
    for (const f of FILES) src += fs.readFileSync(path.join(root, f), 'utf8') + '\n;\n';
    src += EXPORTS.map(n => `try { globalThis.${n} = ${n}; } catch (e) {}`).join('\n');
    const sandbox = { console, performance: { now: () => Date.now() }, Math, JSON, Date };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'traffic-sim-bundle.js' });
    return sandbox;
}

module.exports = { loadSim, FILES, EXPORTS };
