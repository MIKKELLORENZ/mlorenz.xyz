// Offline trainer. The browser can only afford a small population on a short
// day; this runs the SAME evolution.js the page runs, several independent
// islands at once, and migrates the best genome between them.
//
// Islands rather than one shared population on purpose: each worker runs the
// unmodified engine, so the trainer and the page can never drift apart. What
// crosses between islands is a genome, nothing else.
//
//   node train_headless.js --gens 400 --workers 5 --pop 40 --out training/run1
//   node train_headless.js --resume training/run1/state.json --gens 200
//
// Options
//   --gens N        generations per island            (default 300)
//   --workers N     islands                           (default cpus-2, max 6)
//   --pop N         population per island             (default 36)
//   --episodes N    days per generation               (default 3)
//   --eplen F       episode length multiplier         (default 1.0)
//   --migrate N     generations between migrations    (default 12)
//   --tier N        starting tier                     (default 0)
//   --lock          stay on the starting tier
//   --n1            charge for N-1 insecurity as well (a different experiment)
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
            parentPort.postMessage({
                island: cfg.island,
                gen: ev.gen,
                tier: ev.tier,
                rows,
                champion: ev.champion ? {
                    genome: Array.from(ev.champion.genome),
                    fitness: ev.champion.fitness,
                    adv: ev.champion.adv,
                    advEur: ev.champion.advEur,
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
            ev.genomes[ev.genomes.length - 1] = g;
            parentPort.postMessage({ island: cfg.island, ack: true });
        } else if (msg.cmd === 'evaluate') {
            const out = benchGenome(S, Float64Array.from(msg.genome), msg.tiers, msg.seeds, msg.eplen);
            parentPort.postMessage({ island: cfg.island, bench: out });
        } else if (msg.cmd === 'validate') {
            parentPort.postMessage({
                island: cfg.island,
                val: validateGenome(S, Float64Array.from(msg.genome), msg.eplen, msg.epoch | 0)
            });
        }
    });
    parentPort.postMessage({ island: cfg.island, ready: true });
}

function identicalArr(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// --- validation bank --------------------------------------------------------
// A THIRD family of layouts and days, used for nothing but deciding which genome
// wears the crown. Training draws its layouts from 0x671D and its days from
// 0xBE7; the final benchmark uses 0x4E57 / 0xBEEF; this uses 0x5A11 / 0xC0DE and
// is touched by nothing else.
//
// It exists because training advantage turned out not to track skill. The
// generation-174 champion posted a training advantage of 1.12 — the best any
// island had managed, comfortably ahead of the 0.66 from generation 85 — and on
// forty held-out days it was worse than the generation-85 genome on every
// measure that matters. A generation is three days. Three days is not enough to
// tell a better operator from a luckier one, and the crown is permanent, so
// every lucky generation is a chance to install something that cannot be
// removed. Every other sim on this site arrived at the same rule from its own
// direction: rank on an unseen bank, because the last champion is not the best
// champion.
//
// Sixteen days is still not many. It is enough to catch the failure that
// actually happens, which is not subtle — a genome that won one storm by
// accident is usually worse than doing nothing on most ordinary days.
//
// The bank is STRATIFIED, and that is not a detail. Drawn at random it would
// look like every other sample of days on this problem - three quarters of it
// uneventful - and a metric built on such a sample has its optimum at doing
// nothing at all, because on a quiet day doing nothing is exactly optimal and a
// perfect crisis response is worth no more than staying home. Crowning on it
// would have selected steadily back towards the do-nothing controller the whole
// exercise is trying to beat. So the bank is screened once and built half and
// half: the two most eventful days on each network and the two quietest. Then
// the score answers both halves of the job - do not churn, and do act - in a
// fixed, known proportion.
//
// ...and the bank ROTATES, which is the other half of the same lesson. Held
// fixed, sixteen days is not a test, it is a target. The crown is contested
// every migration and each contest is scored on the same sixteen days, so after
// a few dozen comparisons the genome that wins is the one that happens to suit
// those particular days — the multiple-comparisons trap, arrived at honestly.
// It showed up exactly as you would predict: a champion validating at +240k a
// day on the bank's eventful days and −46k a day on the independent held-out
// benchmark's. So the bank is rebuilt from fresh layouts and fresh days every
// few contests, and the sitting champion is re-measured on the new bank before
// the next challenger is compared against it. A genome that has quietly learned
// the bank loses the crown the moment the bank changes.
const VAL_QUIET_FLOOR = -30000;

const VAL_TIERS = [2, 3, 4, 5];
const VAL_PROBE = 9;          // days screened per network
const VAL_KEEP = 2;           // eventful kept, and the same number of quiet ones
const VAL_EPOCH_EVERY = 6;    // crown contests before the bank is replaced

// A HARD FLOOR ON THE QUIET HALF, which is the rule a real control room actually
// works under: whatever else you do, do not make an ordinary day worse. Ranking
// on a single weighted score does not express that, and the omission was
// promptly exploited — a champion arrived posting +1.14M a day on the bank's
// eventful days and MINUS 260 THOUSAND a day on its quiet ones, and won, because
// the crisis number paid for the damage. That is a gambler, not an operator, and
// no re-weighting fixes it: the bank's eventful days are the two worst out of
// nine, so they are far more extreme than a typical bad day, and a gain measured
// on them buys more than it is worth.
//
// So a genome that costs more than this when nothing is wrong is not a candidate
// for the crown at all, whatever it does in a crisis. Among the genomes that
// clear the floor, the re-weighted score decides. Thirty thousand is about
// thirteen percent of a quiet day's operating margin - a real premium to pay for
// insurance, and nowhere near enough to hide a cascade in.

let VAL_BANK = null;
let VAL_EPOCH = -1;

function buildValBank(S, eplen, epoch) {
    const bank = [];
    let screened = 0, eventfulSeen = 0;
    for (const tier of VAL_TIERS) {
        const net = S.makeNetwork(tier, S.mixSeed(0x5A11, tier * 613 + epoch * 8191 + 1));
        const opts = { steps: Math.max(24, Math.round((net.spec.steps || 144) * eplen)) };
        const rows = [];
        for (let sd = 1; sd <= VAL_PROBE; sd++) {
            const seed = S.mixSeed(0xC0DE, tier * 47 + epoch * 104729 + sd);
            const w = new S.World(net, opts);
            w.reset(seed, S.makeController('donothing'));
            const m = w.run();
            const head = (m.riskCost || 0) + Math.min(m.lostLoadCost || 0, 600000) +
                (m.blackoutCost || 0) + (m.lineTrips || 0) * 2500 +
                (m.overloadIntegral || 0) * 4000;
            rows.push({ net, opts, seed, head, don: m.score });
        }
        rows.sort((a, b) => b.head - a.head);
        for (let i = 0; i < VAL_KEEP && i < rows.length; i++) {
            bank.push(Object.assign({ eventful: true }, rows[i]));
        }
        for (let i = 0; i < VAL_KEEP && i < rows.length; i++) {
            bank.push(Object.assign({ eventful: false }, rows[rows.length - 1 - i]));
        }
        // How often an eventful day actually happens on this network, measured
        // on the very screen that built the bank. The score below needs it.
        screened += rows.length;
        eventfulSeen += rows.filter(r => r.head >= 6000).length;
    }
    bank.rate = screened ? eventfulSeen / screened : 0.25;
    return bank;
}

function validateGenome(S, genome, eplen, epoch) {
    // The do-nothing side of a bank is the same for every genome measured on it,
    // so it is screened once per epoch and kept. A validation then costs sixteen
    // brain episodes and nothing else, which is why it can afford to run at
    // every migration.
    if (!VAL_BANK || epoch !== VAL_EPOCH) {
        VAL_EPOCH = epoch;
        VAL_BANK = buildValBank(S, eplen, epoch);
    }
    const diffs = [], evDiffs = [], qDiffs = [];
    let soft = 0;
    for (const d of VAL_BANK) {
        const w = new S.World(d.net, d.opts);
        w.reset(d.seed, S.brainController(genome));
        const a = w.run().score - d.don;
        diffs.push(a);
        (d.eventful ? evDiffs : qDiffs).push(a);
        // Same symlog shaping the fitness uses, and for the same reason: one
        // freak day must not decide a sixteen-day verdict.
        soft += Math.sign(a) * Math.log1p(Math.abs(a) / 60000);
    }
    const n = diffs.length;
    const sorted = diffs.slice().sort((x, y) => x - y);
    const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    // THE SCORE RE-WEIGHTS THE STRATIFICATION BACK TO REALITY.
    //
    // The bank is half eventful because measuring a rare thing from three noisy
    // samples is hopeless. But eventful days are not half of the year — the
    // screen that built this bank counted the true rate, and it is closer to a
    // quarter. Scoring the stratified bank as a flat mean quietly announces that
    // storms are four times as common as they are, and something promptly
    // exploited it: a champion validating at +1.14M a day on the eventful half
    // and MINUS 260k a day on the quiet half, which is not an operator, it is a
    // gambler. Re-weighted at the measured rate it scores below doing nothing,
    // which is the correct verdict.
    //
    // This is what stratification is for: stratify to measure precisely,
    // re-weight to decide honestly.
    const rate = Math.min(0.5, Math.max(0.05, VAL_BANK.rate || 0.25));
    const softOf = a => mean(a.map(v => Math.sign(v) * Math.log1p(Math.abs(v) / 60000)));
    return {
        score: (1 - rate) * softOf(qDiffs) + rate * softOf(evDiffs),
        rate,
        flatScore: soft / n,
        wins: diffs.filter(v => v > 0).length,
        n,
        meanEur: mean(diffs),
        medianEur: sorted[Math.floor(n / 2)],
        eventfulEur: mean(evDiffs),
        quietEur: mean(qDiffs)
    };
}

// --- shared benchmark -------------------------------------------------------
// Held-out networks: a layout seed no training run ever uses, and days no
// training run ever sees. This is the only number worth quoting, because a
// shared-weight graph net can still overfit the three layouts it was shown.
function benchGenome(S, genome, tiers, seeds, eplen) {
    const rows = [];
    for (const tier of tiers) {
        for (const sd of seeds) {
            // 0x4E57 is deliberately outside the 0x671D family evolution.js draws
            // its training layouts from, so these are networks no run has seen.
            const net = S.makeNetwork(tier, S.mixSeed(0x4E57, tier * 977 + sd));
            const opts = { steps: Math.max(24, Math.round((net.spec.steps || 144) * eplen)) };
            const run = (ctrl) => {
                const w = new S.World(net, opts);
                w.reset(S.mixSeed(0xBEEF, tier * 31 + sd), ctrl);
                return w.run();
            };
            const brain = run(S.brainController(genome));
            const don = run(S.makeController('donothing'));
            const red = run(S.makeController('redispatch'));
            const exp = run(S.makeController('expert'));
            rows.push({
                tier, seed: sd,
                brain: brain.score, donothing: don.score, redispatch: red.score, expert: exp.score,
                bServed: brain.servedFrac, bN1: brain.n1SecureFrac, bOvl: brain.overloadFrac,
                bTrips: brain.lineTrips, bBlack: brain.blackout,
                bRedisp: brain.redispatchMWh, bCurtail: brain.curtailedMWh,
                bSwitch: brain.switchActions, bSub: brain.subActions,
                eServed: exp.servedFrac, eN1: exp.n1SecureFrac, eOvl: exp.overloadFrac,
                eTrips: exp.lineTrips, eBlack: exp.blackout, eRedisp: exp.redispatchMWh,
                dServed: don.servedFrac, dN1: don.n1SecureFrac, dBlack: don.blackout
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
    const POP = numFlag('pop', 36);
    const EPISODES = numFlag('episodes', 3);
    const EPLEN = numFlag('eplen', 1.0);
    const MIGRATE = numFlag('migrate', 12);
    const TIER = numFlag('tier', 0);
    const LOCK = flag('lock', false) === true;
    const N1 = flag('n1', false) === true;
    const BASE_SEED = numFlag('seed', 20260801);
    const OUT = String(flag('out', 'training/latest'));
    const RESUME = flag('resume', null);
    // Capped at six: this machine is shared with other agents, and a trainer
    // that takes every core gets its whole run killed.
    const WORKERS = Math.max(1, Math.min(6, numFlag('workers', Math.max(1, os.cpus().length - 2))));

    fs.mkdirSync(path.join(__dirname, OUT), { recursive: true });
    const outPath = f => path.join(__dirname, OUT, f);

    let resumeState = null;
    if (RESUME && RESUME !== true) {
        try { resumeState = JSON.parse(fs.readFileSync(String(RESUME), 'utf8')); }
        catch (e) { console.log('could not read resume file: ' + e.message); }
    }

    const settings = {
        population: POP, episodesPerGen: EPISODES, episodeScale: EPLEN,
        tier: TIER, lockTier: LOCK, n1Weight: N1 ? 1 : 0
    };

    console.log(`islands=${WORKERS} pop=${POP} days/gen=${EPISODES} eplen=${EPLEN} ` +
        `gens=${GENS} migrate every ${MIGRATE} n1charge=${N1} -> ${OUT}`);

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
    let contests = 0;

    (async () => {
        await Promise.all(ready);
        const t0 = Date.now();
        let done = 0;
        while (done < GENS) {
            const chunk = Math.min(MIGRATE, GENS - done);
            const results = await Promise.all(workers.map(w => ask(w, { cmd: 'run', gens: chunk })));
            done += chunk;

            // Migration and the global champion go by ADVANTAGE over the
            // classical control rooms, and by nothing else. Not by tier: a tier
            // is a measure of how far up the ladder an island happened to climb,
            // not of how good its operator is, and preferring the higher tier
            // hands the crown to an island that got promoted early and is now
            // half a million euros WORSE than the control room it is standing
            // in for. Advantage is the whole reason it is comparable at all.
            // The strongest challenger by TRAINING advantage earns an audition
            // on the validation bank; the crown is decided there and only there.
            // The best island champion that is NOT the reigning one. Taking the
            // best full stop looks equivalent and is not: once a champion has
            // migrated into every island it becomes every island's champion too,
            // every contest nominates the incumbent against itself, the guard
            // below skips it, and the crown can never change again. That is not
            // a hypothetical either — twenty minutes of run time went by with
            // zero challengers auditioned before the log made it obvious.
            let challenger = null;
            for (const r of results) {
                if (!r.champion || !Number.isFinite(r.champion.adv)) continue;
                if (best && identicalArr(r.champion.genome, best.genome)) continue;
                if (!challenger || r.champion.adv > challenger.adv) {
                    challenger = Object.assign({}, r.champion, { island: r.island, tier: r.tier });
                }
            }
            if (challenger) {
                const epoch = Math.floor(contests / VAL_EPOCH_EVERY);
                contests++;
                // When the bank turns over, the incumbent is re-measured on the
                // new one first. Comparing a challenger's score on this bank
                // against a champion's score on the last one is not a comparison.
                if (best && best.val.epoch !== epoch) {
                    best.val = (await ask(workers[0], {
                        cmd: 'validate', genome: best.genome, eplen: EPLEN, epoch
                    })).val;
                    best.val.epoch = epoch;
                    console.log(`    validation bank ${epoch}: champion re-measured at ` +
                        `${best.val.score.toFixed(3)} (eventful ` +
                        `${(best.val.eventfulEur / 1000).toFixed(0)}k, quiet ` +
                        `${(best.val.quietEur / 1000).toFixed(0)}k)`);
                }
                const v = (await ask(workers[0], {
                    cmd: 'validate', genome: challenger.genome, eplen: EPLEN, epoch
                })).val;
                v.epoch = epoch;
                challenger.val = v;
                // Clearing the floor beats any score that does not; among those
                // that clear it (or, if none do, among those that do not), the
                // re-weighted score decides.
                const qualifies = x => x.quietEur >= VAL_QUIET_FLOOR;
                const beats = (a, b) =>
                    qualifies(a) !== qualifies(b) ? qualifies(a) : a.score > b.score;
                if (!best || beats(v, best.val)) {
                    const from = best ? best.val.score.toFixed(3) : 'none';
                    best = challenger;
                    console.log(`    crown -> island ${best.island} gen ${best.gen} ` +
                        `(train adv ${best.adv.toFixed(2)}, validation ${v.score.toFixed(3)} ` +
                        `from ${from}, rate ${(v.rate * 100).toFixed(0)}%, ` +
                        `beat do-nothing on ${v.wins}/${v.n}, median ` +
                        `${(v.medianEur / 1000).toFixed(0)}k | eventful ` +
                        `${(v.eventfulEur / 1000).toFixed(0)}k, quiet ` +
                        `${(v.quietEur / 1000).toFixed(0)}k` +
                        `${v.quietEur >= VAL_QUIET_FLOOR ? '' : ' BELOW FLOOR'})`);
                } else {
                    console.log(`    challenger island ${challenger.island} gen ${challenger.gen} ` +
                        `(train adv ${challenger.adv.toFixed(2)}) rejected: validation ` +
                        `${v.score.toFixed(3)} vs ${best.val.score.toFixed(3)}`);
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
                const k = v => (v / 1000).toFixed(0);
                return `i${r.island} t${r.tier} adv ${last.advN.toFixed(2)} (${k(last.adv)}k)  best ${k(last.best)}k ` +
                    `med ${k(last.median)}k | don ${k(last.donothing)}k red ${k(last.redispatch)}k exp ${k(last.expert)}k ` +
                    `| head ${k(last.head)}k/${k(last.headBest)}k flat ${last.flat} ` +
                    `| act ${last.redisp.toFixed(0)}MWh ${last.switches.toFixed(1)}sw trip ${last.trips.toFixed(1)} ` +
                    `| srv ${(last.served * 100).toFixed(1)}% n1 ${(last.n1 * 100).toFixed(0)}% ovl ${(last.overload * 100).toFixed(0)}%`;
            });
            const line = `gen ${done}/${GENS}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n    ` + rows.join('\n    ');
            console.log(line);
            logLines.push(line);

            fs.writeFileSync(outPath('state.json'), JSON.stringify({
                gens: done, islands: results.map(r => r.state)
            }));
            if (best) {
                fs.writeFileSync(outPath('champion.json'), JSON.stringify({
                    version: 'power-grid-ne-v1',
                    fitness: best.fitness, adv: best.adv, advEur: best.advEur, gen: best.gen, tier: best.tier,
                    validation: best.val, metrics: best.metrics, genome: best.genome
                }));
            }
            fs.writeFileSync(outPath('log.txt'), logLines.join('\n'));
        }

        if (best) {
            console.log('\nheld-out benchmark — networks and days nobody trained on');
            const bench = await ask(workers[0], {
                cmd: 'evaluate', genome: best.genome,
                tiers: [0, 1, 2, 3, 4, 5], seeds: [1, 2, 3], eplen: EPLEN
            });
            const rows = bench.bench;
            let winDo = 0, winExp = 0;
            for (const r of rows) {
                const bestClassical = Math.max(r.donothing, r.redispatch, r.expert);
                if (r.brain > r.donothing) winDo++;
                if (r.brain >= bestClassical) winExp++;
                const k = v => (v / 1000).toFixed(0) + 'k';
                console.log(`  tier ${r.tier} seed ${r.seed}: brain ${k(r.brain)} ` +
                    `(served ${(r.bServed * 100).toFixed(1)}%, N-1 ${(r.bN1 * 100).toFixed(0)}%, ` +
                    `${r.bTrips} trips, ${r.bRedisp.toFixed(0)} MWh redispatch, ${r.bSwitch}+${r.bSub} switches) ` +
                    `vs do-nothing ${k(r.donothing)} / redispatch ${k(r.redispatch)} / expert ${k(r.expert)} ` +
                    `(expert N-1 ${(r.eN1 * 100).toFixed(0)}%)`);
            }
            console.log(`  beat do-nothing on ${winDo}/${rows.length}, ` +
                `matched or beat the best classical on ${winExp}/${rows.length}`);
            const mean = k => rows.reduce((a, r) => a + r[k], 0) / rows.length;
            console.log(`  mean N-1 secure: brain ${(mean('bN1') * 100).toFixed(0)}%, ` +
                `expert ${(mean('eN1') * 100).toFixed(0)}%, do-nothing ${(mean('dN1') * 100).toFixed(0)}%`);
            console.log(`  mean blackout rate: brain ${(mean('bBlack') * 100).toFixed(0)}%, ` +
                `expert ${(mean('eBlack') * 100).toFixed(0)}%, do-nothing ${(mean('dBlack') * 100).toFixed(0)}%`);
            fs.writeFileSync(outPath('bench.json'), JSON.stringify(rows, null, 1));
        }
        for (const w of workers) w.terminate();
    })().catch(e => { console.error(e); process.exit(1); });
}
