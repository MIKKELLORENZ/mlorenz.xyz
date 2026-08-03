// Offline trainer. The browser can only afford a small population on a short
// episode; this runs the SAME evolution.js the page runs, several independent
// islands at once, and migrates the best genome between them.
//
// Islands rather than one shared population on purpose: each worker runs the
// unmodified engine, so the trainer and the page can never drift apart. What
// crosses between islands is a genome, nothing else.
//
//   node train_headless.js --gens 400 --workers 6 --pop 40 --out training/run1
//   node train_headless.js --resume training/run1/state.json --gens 200
//
// Options
//   --gens N        generations per island            (default 300)
//   --workers N     islands                           (default cpus-2, max 8)
//   --pop N         population per island             (default 40)
//   --eplen N       episode seconds (before the per-tier scaling)  (default 240)
//   --episodes N    episodes per generation           (default 2)
//   --migrate N     generations between migrations    (default 12)
//   --tier N        starting tier                     (default 0)
//   --lock          stay on the starting tier
//   --seed N        base run seed
//   --out DIR       where to write state/champion/log (default training/latest)
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { loadSim } = require('./harness');

// --- worker -----------------------------------------------------------------
if (!isMainThread) {
    const S = loadSim(__dirname);
    const cfg = workerData;
    let ev = null;

    const boot = (state) => {
        if (state) {
            ev = S.Evolution.fromJSON(state, cfg.seed);
            if (ev) return;
        }
        ev = new S.Evolution(cfg.settings, cfg.seed);
    };
    boot(cfg.state);

    parentPort.on('message', msg => {
        if (msg.cmd === 'run') {
            const rows = [];
            for (let i = 0; i < msg.gens; i++) rows.push(ev.runGeneration());
            const last = rows[rows.length - 1];
            parentPort.postMessage({
                island: cfg.island,
                gen: ev.gen,
                tier: ev.tier,
                rows,
                champion: ev.champion ? {
                    genome: Array.from(ev.champion.genome),
                    fitness: ev.champion.fitness,
                    gen: ev.champion.gen,
                    tier: ev.champion.tier,
                    metrics: ev.champion.metrics
                } : null,
                state: ev.toJSON()
            });
        } else if (msg.cmd === 'immigrate') {
            // A migrant lands in the population and has to earn its keep from
            // there; it is never installed as champion by decree.
            const g = S.repairGenome(Float64Array.from(msg.genome));
            const slot = ev.genomes.length - 1;
            ev.genomes[slot] = g;
            parentPort.postMessage({ island: cfg.island, ack: true });
        } else if (msg.cmd === 'evaluate') {
            // Score a genome on a bank of unseen cities: the only number worth
            // quoting, since training layouts can always be over-fitted.
            const out = benchGenome(S, Float64Array.from(msg.genome), msg.tiers, msg.seeds, msg.eplen);
            parentPort.postMessage({ island: cfg.island, bench: out });
        }
    });
    parentPort.postMessage({ island: cfg.island, ready: true });
}

// --- shared benchmark -------------------------------------------------------
// Held-out cities: a layout seed no training run ever uses, so this measures
// what the brain does with a street plan it has never seen.
function benchGenome(S, genome, tiers, seeds, eplen) {
    const rows = [];
    for (const tier of tiers) {
        for (const s of seeds) {
            // 0x4E57 is deliberately outside the 0xC17-based family evolution.js
            // draws training layouts from, so these are streets no run has seen.
            const city = S.makeCity(tier, S.mixSeed(0x4E57, tier * 977 + s));
            const opts = { episodeLen: eplen, incidents: true };
            const run = (ctrl) => {
                const w = new S.World(city, opts);
                w.reset(S.mixSeed(0xBEEF, tier * 31 + s), ctrl);
                const m = w.run();
                return { score: S.episodeScore(m), m };
            };
            const brain = run(S.brainController(genome));
            const act = run(S.actuatedController());
            const fix = run(S.fixedTimeController());
            rows.push({
                tier, seed: s,
                brain: brain.score, actuated: act.score, fixed: fix.score,
                thr: brain.m.carThroughput, pthr: brain.m.pedThroughput,
                delay: brain.m.meanCarDelay, crashes: brain.m.crashes, hits: brain.m.pedHits,
                actThr: act.m.carThroughput, actDelay: act.m.meanCarDelay, actCrashes: act.m.crashes
            });
        }
    }
    return rows;
}

// --- main -------------------------------------------------------------------
if (isMainThread) {
    const argv = process.argv.slice(2);
    const flag = (name, def) => {
        const i = argv.indexOf('--' + name);
        if (i < 0) return def;
        const v = argv[i + 1];
        return v === undefined || v.startsWith('--') ? true : v;
    };
    const numFlag = (name, def) => {
        const v = flag(name, undefined);
        return v === undefined || v === true ? def : Number(v);
    };

    const GENS = numFlag('gens', 300);
    const POP = numFlag('pop', 40);
    const EPLEN = numFlag('eplen', 240);
    const EPISODES = numFlag('episodes', 2);
    const MIGRATE = numFlag('migrate', 12);
    const TIER = numFlag('tier', 0);
    const LOCK = flag('lock', false) === true;
    const BASE_SEED = numFlag('seed', 20260731);
    const OUT = String(flag('out', 'training/latest'));
    const RESUME = flag('resume', null);
    const WORKERS = Math.max(1, Math.min(8, numFlag('workers', Math.max(1, os.cpus().length - 2))));

    fs.mkdirSync(path.join(__dirname, OUT), { recursive: true });
    const outPath = f => path.join(__dirname, OUT, f);

    let resumeState = null;
    if (RESUME && RESUME !== true) {
        try { resumeState = JSON.parse(fs.readFileSync(String(RESUME), 'utf8')); }
        catch (e) { console.log('could not read resume file: ' + e.message); }
    }

    const settings = {
        population: POP, episodeLen: EPLEN, episodesPerGen: EPISODES,
        tier: TIER, lockTier: LOCK
    };

    console.log(`islands=${WORKERS} pop=${POP} episodes=${EPISODES} episodeLen=${EPLEN}s ` +
        `gens=${GENS} migrate every ${MIGRATE} -> ${OUT}`);

    const workers = [];
    const ready = [];
    for (let i = 0; i < WORKERS; i++) {
        const w = new Worker(__filename, {
            workerData: {
                island: i,
                seed: (BASE_SEED + i * 7919) >>> 0,
                settings,
                state: resumeState && resumeState.islands ? resumeState.islands[i] : null
            }
        });
        workers.push(w);
        ready.push(new Promise(res => w.once('message', res)));
    }

    const ask = (w, msg) => new Promise(res => {
        const on = m => { if (m.ready === undefined) { w.off('message', on); res(m); } };
        w.on('message', on);
        w.postMessage(msg);
    });

    const logLines = [];
    let best = null;

    (async () => {
        await Promise.all(ready);
        const t0 = Date.now();
        let done = 0;
        while (done < GENS) {
            const chunk = Math.min(MIGRATE, GENS - done);
            const results = await Promise.all(workers.map(w => ask(w, { cmd: 'run', gens: chunk })));
            done += chunk;

            // Pick the strongest champion across islands and send it everywhere
            // else. Fitness is only comparable inside a tier, so migration is
            // restricted to islands sitting on the same tier.
            for (const r of results) {
                if (r.champion && (!best || r.tier > best.tier ||
                    (r.tier === best.tier && r.champion.fitness > best.fitness))) {
                    best = { ...r.champion, island: r.island, tier: r.tier };
                }
            }
            if (best) {
                await Promise.all(results.map((r, i) =>
                    r.island === best.island || r.tier !== best.tier
                        ? Promise.resolve()
                        : ask(workers[i], { cmd: 'immigrate', genome: best.genome })));
            }

            const rows = results.map(r => {
                const last = r.rows[r.rows.length - 1];
                return `i${r.island} t${r.tier} best ${last.best.toFixed(0)} med ${last.median.toFixed(0)} ` +
                    `act ${last.actuated.toFixed(0)} thr ${(last.thr * 100).toFixed(0)}% ` +
                    `d ${last.delay.toFixed(0)}s cr ${last.crashes.toFixed(1)}`;
            });
            const line = `gen ${done}/${GENS}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n    ` + rows.join('\n    ');
            console.log(line);
            logLines.push(line);

            fs.writeFileSync(outPath('state.json'), JSON.stringify({
                gens: done, islands: results.map(r => r.state)
            }));
            if (best) {
                fs.writeFileSync(outPath('champion.json'), JSON.stringify({
                    version: 'traffic-light-ne-v1',
                    fitness: best.fitness, gen: best.gen, tier: best.tier,
                    metrics: best.metrics, genome: best.genome
                }));
            }
            fs.writeFileSync(outPath('log.txt'), logLines.join('\n'));
        }

        // Final report on cities nobody trained on.
        if (best) {
            console.log('\nheld-out benchmark (layouts never trained on)');
            const bench = await ask(workers[0], {
                cmd: 'evaluate', genome: best.genome,
                tiers: [0, 1, 2, 3, 4, 5, 6], seeds: [1, 2], eplen: EPLEN
            });
            const rows = bench.bench;
            let wins = 0;
            for (const r of rows) {
                if (r.brain > r.actuated) wins++;
                console.log(`  tier ${r.tier} seed ${r.seed}: brain ${r.brain.toFixed(0)} ` +
                    `(thr ${(r.thr * 100).toFixed(0)}%, ${r.delay.toFixed(0)}s, ${r.crashes} crashes) ` +
                    `vs actuated ${r.actuated.toFixed(0)} (thr ${(r.actThr * 100).toFixed(0)}%, ` +
                    `${r.actDelay.toFixed(0)}s, ${r.actCrashes} crashes)`);
            }
            console.log(`  beat the actuated controller on ${wins}/${rows.length} held-out cities`);
            fs.writeFileSync(outPath('bench.json'), JSON.stringify(rows, null, 1));
        }
        for (const w of workers) w.terminate();
    })().catch(e => { console.error(e); process.exit(1); });
}
