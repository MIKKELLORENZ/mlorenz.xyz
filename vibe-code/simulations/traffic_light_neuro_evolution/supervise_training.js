// Keep a training run alive on a machine that keeps reaping it.
//
//   node supervise_training.js --target 80 --out training/run2 [trainer flags]
//
// Long runs on this box die silently: no stderr, no non-zero exit worth
// reading, just a process that is there one minute and gone the next, usually
// moments after a checkpoint write. Three separate launches went the same way -
// attached and detached, six workers and five - so the cause is outside this
// script's control and the useful response is to make progress survivable
// rather than to keep hunting it.
//
// The trainer already checkpoints every migration interval, so all that is
// missing is something to notice the death and resume. This is that: it reads
// how far the islands actually got from state.json, asks for the remaining
// generations, and restarts until the target is reached or the failures stop
// making progress.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
function flag(name, dflt) {
    const i = argv.indexOf('--' + name);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}
// Anything not consumed here is handed straight to the trainer.
function passthrough() {
    const drop = new Set(['--target', '--out', '--max-restarts']);
    const out = [];
    for (let i = 0; i < argv.length; i++) {
        if (drop.has(argv[i])) { i++; continue; }
        out.push(argv[i]);
    }
    return out;
}

const TARGET = parseInt(flag('target', 80), 10);
const OUT = String(flag('out', 'training/run2'));
const MAX_RESTARTS = parseInt(flag('max-restarts', 40), 10);
const OUT_DIR = path.join(__dirname, OUT);
const STATE = path.join(OUT_DIR, 'state.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

// How far the islands have actually got. The trainer's own `gens` field counts
// generations within one invocation, so it resets on resume and cannot be used
// as absolute progress. Each island carries its own generation counter, and the
// run as a whole is only as far along as its furthest-behind island.
function progress() {
    try {
        const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
        if (!s.islands || !s.islands.length) return 0;
        const gens = s.islands.map(i => (i && Number.isFinite(i.gen) ? i.gen : 1) - 1);
        return Math.max(0, Math.min(...gens));
    } catch (e) { return 0; }
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function say(msg) {
    const line = `[${stamp()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(path.join(OUT_DIR, 'supervisor.log'), line + '\n');
}

say(`supervising ${OUT} to generation ${TARGET}`);

let restarts = 0;
let stalled = 0;
for (;;) {
    const at = progress();
    if (at >= TARGET) { say(`reached generation ${at} - done`); break; }
    if (restarts >= MAX_RESTARTS) { say(`giving up after ${restarts} restarts at generation ${at}`); break; }

    const remaining = TARGET - at;
    const args = ['train_headless.js', '--gens', String(remaining), '--out', OUT, ...passthrough()];
    if (at > 0 && fs.existsSync(STATE)) args.push('--resume', STATE.replace(/\\/g, '/'));

    say(`start #${restarts + 1}: at generation ${at}, asking for ${remaining} more`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, args, {
        cwd: __dirname,
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true
    });
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    const after = progress();
    say(`exit code ${r.status === null ? 'killed(' + r.signal + ')' : r.status} ` +
        `after ${mins} min, generation ${at} -> ${after}`);

    if (after >= TARGET) { say('target reached'); break; }

    // A restart that buys nothing is a loop, not a recovery. Two in a row and
    // the problem is the run itself rather than whatever is killing it.
    if (after <= at) {
        stalled++;
        if (stalled >= 2) { say(`no progress across ${stalled} restarts - stopping`); break; }
    } else {
        stalled = 0;
    }
    restarts++;
}

say('supervisor finished');
