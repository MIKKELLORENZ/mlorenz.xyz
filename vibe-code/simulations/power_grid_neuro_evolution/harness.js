// Node-side loader for the browser sim.
//
// Every logic file is a plain <script> in the page - shared bare globals, no
// modules - so they cannot simply be require()d one at a time: separate
// vm.runInContext calls do NOT share top-level const/let bindings the way script
// tags do. The fix is to concatenate them into ONE script, run that in a single
// context, and assign the names onto the sandbox in an epilogue.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = ['rng.js', 'powerflow.js', 'grid.js', 'weather.js', 'nn.js',
    'world.js', 'operator.js', 'evolution.js'];

const EXPORTS = [
    // rng
    'mulberry32', 'gaussian', 'hash32', 'mixSeed', 'clamp', 'lerp',
    'betaDraw', 'betaInv', 'betaCdf', 'normCdf', 'normInv', 'weibullInv', 'gammaDraw', 'lgamma',
    // powerflow
    'PF', 'luFactor', 'luSolve', 'resolveTopology', 'topologyKey', 'buildYbus',
    'findIslands', 'newtonRaphson', 'buildFDMatrices', 'fastDecoupled',
    'branchFlows', 'buildDC', 'screenN1', 'injections',
    // grid
    'GEN_KINDS', 'GRID_TIERS', 'REDISPATCH_PREMIUM_UP', 'REDISPATCH_PREMIUM_DOWN',
    'CURTAIL_PREMIUM', 'makeNetwork', 'ieee14', 'sixBus', 'syntheticNet',
    'buildSubstations', 'defaultTopo', 'economicDispatch', 'dcBaseFlow', 'renewNominal',
    'stressEnvelope', 'studyCases', 'acStudyCase', 'reactivePlanning',
    // weather
    'WX', 'Weather', 'solarDeclination', 'equationOfTime', 'clearSkyGHI',
    'turbinePower', 'loadShape', 'weeklyFactor', 'betaInverseTable', 'lookupInverse',
    // nn
    'GLOBAL_CH', 'NODE_CH', 'EDGE_CH', 'GEN_CH', 'ELEM_CH',
    'GLOB_H', 'EDGE_H', 'NODE_H', 'CTX_H', 'GLB', 'ND', 'ED', 'GN', 'EL',
    'SECTIONS', 'S_GEN1', 'S_GEN2', 'S_LINE1', 'S_LINE2', 'S_NO2',
    'NN_GENOME_LEN', 'NN_VERSION', 'NN_ARCH_ID',
    'randomGenome', 'cloneGenome', 'validGenome', 'repairGenome',
    'weightIndex', 'biasIndex', 'crossoverGenomes', 'mutateGenomeK',
    'Embedding', 'encodeGraph', 'headGen', 'headLine', 'headSub', 'headElem', 'headNoop',
    'createBootstrapGenome', 'serializeGenome', 'deserializeGenome', 'S_EL1', 'S_CTX',
    // world
    'SIM', 'World', 'makeObs', 'poisson',
    // operator
    'doNothingController', 'redispatchController', 'expertController',
    'brainController', 'makeController', 'bindingConstraint', 'reliefRates',
    // evolution
    'GA_DEFAULTS', 'BASELINES', 'METRIC_KEYS', 'episodeScore', 'meanMetrics',
    'Evolution', 'evaluateController'
];

function loadSim(dir) {
    const root = dir || __dirname;
    let src = '';
    for (const f of FILES) src += fs.readFileSync(path.join(root, f), 'utf8') + '\n;\n';
    src += EXPORTS.map(n => `try { globalThis.${n} = ${n}; } catch (e) {}`).join('\n');
    const sandbox = { console, performance: { now: () => Date.now() }, Math, JSON, Date };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'power-grid-bundle.js' });
    return sandbox;
}

module.exports = { loadSim, FILES, EXPORTS };
