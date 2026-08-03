/* train_headless.js — offline trainer. Runs the same GA the page runs, but
 * across every core and with no rendering, to produce the built-in champion.
 *
 *   node train_headless.js                       # fresh run, forever
 *   node train_headless.js --gens 400            # stop after 400 generations
 *   node train_headless.js --pop 64 --workers 8
 *   node train_headless.js --config conv3x8      # a named config from configs.js
 *   node train_headless.js --until 1780000000000 # stop at this epoch-ms, whatever
 *   node train_headless.js --resume training/champion.json
 *
 * Writes <out>/champion.json (best-ever brain) and <out>/log.csv every
 * generation, so a run can be killed and picked up later. The champion file
 * records which config produced it — sensor profile and architecture are part of
 * a brain's identity, not a global constant, and a brain reloaded under the
 * wrong profile is not merely worse, it is unusable.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort } = require("worker_threads");

const SRC = ["nn.js", "tetris.js", "sensors.js", "world.js", "evolution.js", "configs.js", "net_surgery.js"];
for (const f of SRC) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const BASE_R = Object.assign({}, R);

/* --------------------------------------------------------------- worker side */
if (!isMainThread) {
    let applied = false;
    parentPort.on("message", msg => {
        if (!applied || msg.config) {
            applyConfig(msg.config || { profile: "full" }, BASE_R);
            applied = true;
        }
        const out = [];
        for (const b of msg.brains) {
            const net = netFromJSON(b);
            const s = scoreBrain(net, msg.seeds, msg.cfg, msg.pieceCap);
            out.push({ fitness: s.fitness, mean: s.mean, worst: s.worst, lines: s.lines, pieces: s.pieces, sig: s.sig });
        }
        parentPort.postMessage({ tag: msg.tag, out });
    });
    return;
}

/* ----------------------------------------------------------------- main side */
function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}

const POP = +arg("pop", 64);
const GENS = +arg("gens", 100000);
const PIECE_CAP = +arg("pieces", 200);
const TRIALS = +arg("trials", 2);
const NWORK = Math.max(1, Math.min(+arg("workers", Math.max(1, os.cpus().length - 2)), POP));
const RESUME = arg("resume", null);
const UNTIL = +arg("until", 0);            // epoch ms — a hard wall-clock stop
const OUT = path.resolve(__dirname, String(arg("out", "training")));

/* Which brain shape and which reward. A name from configs.js, or a path to a
 * JSON file holding a config object (that is how overnight.js hands the search
 * winner over), or nothing for the shipped defaults. */
const CONFIG_ARG = arg("config", null);
let RUN_CFG = { profile: "full", arch: { kind: "mlp", hidden: [64, 32] } };
let RUN_CFG_NAME = "default";
if (CONFIG_ARG && typeof CONFIG_ARG === "string") {
    if (CONFIGS[CONFIG_ARG]) { RUN_CFG = CONFIGS[CONFIG_ARG]; RUN_CFG_NAME = CONFIG_ARG; }
    else {
        const f = path.resolve(__dirname, CONFIG_ARG);
        const loaded = JSON.parse(fs.readFileSync(f, "utf8"));
        RUN_CFG = loaded.config || loaded;
        RUN_CFG_NAME = loaded.name || path.basename(CONFIG_ARG);
    }
}
let DESC = applyConfig(RUN_CFG, BASE_R);   // let: --grow-after can change the body

/* ---- growing the body, but only on a real stall ---------------------------
 * Architecture search is expensive and mostly wasted while the current shape is
 * still improving — the shape is rarely the thing holding a brain back until it
 * actually stops getting better. So: leave the body alone, and only when the
 * champion has survived `--grow-after` consecutive generations unbeaten does the
 * net grow, one exact step at a time.
 *
 * "Exact" is what makes this safe to do mid-run. Widening gives the new units
 * random incoming weights and *zero* outgoing ones, and inserting a layer inserts
 * it as an identity map — under ReLU both leave the function the champion
 * computes bit-for-bit unchanged (test_headless.js asserts worst |Δ| = 0.0e+0).
 * The run therefore never pays to climb back to where it was; it simply continues
 * with more room, and if the extra room turns out to be useless the worst case is
 * a slightly slower generation. */
const GROW_AFTER = +arg("grow-after", 0);
const MAX_GROW = +arg("max-grow", 3);
const GROW_STEPS = String(arg("grow-steps", "wide16,layer,wide32")).split(",");

const GAME_CFG = DEFAULT_CFG;      // the page's game, unchanged — never a variant
const ISLANDS = +arg("islands", 1);
/* Every GA knob is overridable from the command line so hyper_grid.js can sweep
 * them without editing anything. `--grace -1` means the champion holds its seat
 * until something beats it both in-run and on the gate bank. */
const GA_CFG = Object.assign({}, DESC.ga, {
    selfAdapt: arg("no-selfadapt", false) ? false : DESC.ga.selfAdapt,
    migrateEvery: +arg("migrate", DESC.ga.migrateEvery || 0),
    share: +arg("share", DESC.ga.share || 0),
    shareRadius: +arg("share-radius", DESC.ga.shareRadius || 0.55),
    mutRate: +arg("mut-rate", DESC.ga.mutRate),
    mutSigma: +arg("mut-sigma", DESC.ga.mutSigma),
    tau: +arg("tau", DESC.ga.tau || 0.25),
    grace: +arg("grace", DESC.ga.grace),
    rankExp: +arg("rank-exp", DESC.ga.rankExp || 2.2),
    annealFit: +arg("anneal-fit", DESC.ga.annealFit),
    annealFloor: +arg("anneal-floor", DESC.ga.annealFloor),
    shakeAfter: +arg("shake-after", DESC.ga.shakeAfter),
    immZeroFit: +arg("imm-zero", DESC.ga.immZeroFit),
    childZeroFit: +arg("child-zero", DESC.ga.childZeroFit),
});

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const evo = new Evolution(POP, +arg("seed", 1234), ISLANDS);
if (RESUME && typeof RESUME === "string" && fs.existsSync(path.resolve(__dirname, RESUME))) {
    const saved = JSON.parse(fs.readFileSync(path.resolve(__dirname, RESUME), "utf8"));
    const seed = netFromJSON(saved);
    if (seed.contract() !== DESC.contract) {
        console.error(`refusing to resume: saved brain is ${seed.contract()}, ` +
            `this run is ${DESC.contract}`);
        process.exit(1);
    }
    evo.champion = seed;
    evo.championFit = saved.fitness || 0;
    evo.gen = (saved.gen || 0) + 1;
    // seed the pool: a quarter untouched, the rest mutated copies
    for (let i = 0; i < POP; i++) {
        evo.brains[i] = i < POP / 4 ? seed.clone()
            : seed.clone().mutate(GA_CFG.mutRate, GA_CFG.mutSigma, evo.rng);
    }
    console.log(`resumed from ${RESUME}: gen ${evo.gen}, fitness ${evo.championFit.toFixed(0)}`);
}

/* ---- the held-out gate ------------------------------------------------------
 * With --gate N the champion can only be dethroned by a challenger that also
 * beats it on N games nothing trains on. Those games are replayed on the main
 * thread, which is idle while the workers score the population, and only for
 * challengers that already won in-run — so it costs little and buys a champion
 * that cannot be lost to one lucky bag of pieces. The bank is offset far away
 * from the one pick_best.js uses, because a gate you have fitted is a gate that
 * no longer means anything. */
const GATE_GAMES = +arg("gate", 0);
/* …and the gate has to move, or it becomes the thing being optimised.
 *
 * With a fixed bank, `championSkill` is a high-water mark on those exact N games
 * and a promotion means "better on those N games than anything before it". A few
 * hundred promotions of that is not a filter, it is a training set of N sequences
 * with a very slow optimiser attached — and it was measurable: cells promoting
 * hard on a fixed gate drifted *down* on an independent bank, 5 of 5 that moved.
 *
 * So every `--gate-rotate` promotions the bank is redrawn and the sitting champion
 * is re-scored on the new games. It keeps its seat — nothing can take the title
 * without winning — but the bar it defends is fresh, so a lead that exists only on
 * one bag of sequences evaporates instead of compounding. One re-score costs a
 * single gate replay, perhaps once every few hundred generations. */
const GATE_ROTATE = +arg("gate-rotate", 0);
if (GATE_GAMES > 0) {
    let epoch = 0, bank = [];
    const drawBank = () => {
        bank = [];
        for (let i = 0; i < GATE_GAMES; i++) bank.push(2200001 + epoch * 1000003 + i * 7919);
    };
    drawBank();
    evo.championSkill = null;
    evo.gateFn = net => {
        let pieces = 0, lines = 0;
        for (const s of bank) {
            const a = new Agent(net, s, GAME_CFG);
            while (a.alive) a.step(PIECE_CAP);
            pieces += a.pieces; lines += a.lines;
        }
        return (pieces + 25 * lines) / bank.length;    // reward-independent skill
    };
    evo.rotateGate = () => {
        epoch++;
        drawBank();
        evo.championSkill = evo.champion ? evo.gateFn(evo.champion) : null;
        evo.gateEpoch = epoch;
        return evo.championSkill;
    };
}

const workers = [];
for (let i = 0; i < NWORK; i++) workers.push(new Worker(__filename));
console.log(`config ${RUN_CFG_NAME} · ${DESC.profile} profile · ${DESC.inputs} inputs · ` +
    `${DESC.contract} · ${DESC.params.toLocaleString()} params`);
console.log(`pop ${POP} · ${evo.islands} islands (migrate every ${GA_CFG.migrateEvery}) · ` +
    `self-adaptive σ ${GA_CFG.selfAdapt ? "on" : "off"} · ${TRIALS} trials · ` +
    `${PIECE_CAP}-piece cap · ${NWORK} workers` +
    (UNTIL ? ` · stopping at ${new Date(UNTIL).toLocaleTimeString()}` : ""));

const logPath = path.join(OUT, "log.csv");
if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, "gen,best,avg,bestLines,avgLines,avgPieces,sigma,secs\n");

/* Hand each worker a contiguous slice of the population and wait for them all. */
function evaluate(brains, seeds) {
    const per = Math.ceil(brains.length / NWORK);
    return Promise.all(workers.map((w, i) => new Promise((resolve, reject) => {
        const lo = i * per, hi = Math.min(brains.length, lo + per);
        if (lo >= hi) return resolve([]);
        const done = () => { w.off("message", onMsg); w.off("error", onErr); };
        const onMsg = m => { done(); resolve(m.out); };
        const onErr = e => { done(); reject(e); };
        w.on("message", onMsg);
        w.on("error", onErr);
        w.postMessage({
            tag: i, seeds, cfg: GAME_CFG, pieceCap: PIECE_CAP, config: RUN_CFG,
            brains: brains.slice(lo, hi).map(b => b.toJSON()),
        });
    }))).then(chunks => chunks.flat());
}

let stop = false;
process.on("SIGINT", () => { console.log("\nstopping after this generation…"); stop = true; });
process.on("SIGTERM", () => { stop = true; });

let grown = 0;
function growNet(gen) {
    const cur = (RUN_CFG.arch && RUN_CFG.arch.hidden) || [64, 32];
    const hidden = cur.slice();
    const step = GROW_STEPS[grown % GROW_STEPS.length];
    if (step === "layer") hidden.push(Math.max(hidden[hidden.length - 1], 32));
    else hidden[hidden.length - 1] += (+step.replace(/\D/g, "") || 16);
    const rng = mulberry32((0x9e3779b9 ^ (gen * 7919)) >>> 0);
    let t;
    try { t = transplant(evo.champion, { hidden, acts: RUN_CFG.arch && RUN_CFG.arch.acts }, rng); }
    catch (e) { console.log(`  cannot grow: ${e.message}`); return false; }

    const cfg = JSON.parse(JSON.stringify(RUN_CFG));
    cfg.arch = Object.assign({}, cfg.arch, { hidden });
    const desc = applyConfig(cfg, BASE_R);
    if (t.net.contract() !== desc.contract) {
        applyConfig(RUN_CFG, BASE_R);                        // put the old body back
        console.log(`  cannot grow: transplant gave ${t.net.contract()}, config wants ${desc.contract}`);
        return false;
    }
    RUN_CFG = cfg; DESC = desc; grown++;
    /* The transplant is the same function, so the champion keeps its seat, its
     * fitness and its gate score — there is nothing to re-measure. The pool is
     * rebuilt from it because every other brain in it is the wrong shape now. */
    evo.champion = t.net;
    for (let i = 0; i < POP; i++) {
        evo.brains[i] = i < POP / 4 ? t.net.clone()
            : t.net.clone().mutate(GA_CFG.mutRate, GA_CFG.mutSigma, evo.rng);
    }
    evo.injected = null;
    evo.stagnant = 0;
    console.log(`▲ grew the body (${grown}/${MAX_GROW}): ${cur.join("-")} → ${hidden.join("-")} ` +
        `— ${t.note}${t.exact ? " (exact, nothing relearned)" : ""}; ` +
        `${desc.contract}, ${desc.params.toLocaleString()} params`);
    save("champion.json", gen);
    return true;
}

function save(name, gen) {
    fs.writeFileSync(path.join(OUT, name), JSON.stringify({
        gen, fitness: evo.championFit, lines: evo.championLines,
        gateSkill: evo.championSkill || null, gateGames: GATE_GAMES || 0,
        pop: POP, trials: TRIALS, pieceCap: PIECE_CAP,
        gameCfg: GAME_CFG, gaCfg: GA_CFG,
        configName: RUN_CFG_NAME, config: RUN_CFG, desc: DESC,
        net: evo.champion.toJSON(),
    }));
}

(async () => {
    const t00 = Date.now();
    let gensRun = 0, promotions = 0;
    for (let g = 0; g < GENS && !stop; g++) {
        if (UNTIL && Date.now() > UNTIL) { console.log("reached the wall-clock deadline"); break; }
        const t0 = Date.now();
        /* A fresh bag of seeds every generation. Re-using seeds lets the
         * population overfit one piece sequence and look far better than it is.
         * The stride between generations has to clear the width of one
         * generation's own draw, or a large --trials would make consecutive
         * generations interleave over the same range. 977 for the two- and
         * three-trial runs this was written for, so those are unchanged. */
        const base = evo.gen * Math.max(977, TRIALS * 31 + 1);
        const seeds = [];
        for (let t = 0; t < TRIALS; t++) seeds.push(base + t * 31 + 1);

        const scored = await evaluate(evo.brains, seeds);
        const results = evo.brains.map((b, i) => ({
            brain: b, fitness: scored[i].fitness, lines: scored[i].lines,
            pieces: scored[i].pieces, sig: scored[i].sig,
        }));
        const gen = evo.gen;
        const prevChamp = evo.championFit;
        const r = evo.evolve(results, GA_CFG);
        const secs = (Date.now() - t0) / 1000;
        gensRun++;

        const eff = evo.eff;
        const flag = evo.championFit > prevChamp ? " ★" : (eff.shaken ? " ~shake" : "");
        const gate = GATE_GAMES > 0
            ? `  gate ${(evo.championSkill || 0).toFixed(1)} (${evo.gateRejects || 0}/${evo.gateChecks || 0} rejected)` : "";
        console.log(
            `gen ${String(gen).padStart(4)}  best ${r.best.toFixed(0).padStart(6)}  ` +
            `avg ${r.avg.toFixed(0).padStart(5)}  lines ${r.bestLines.toFixed(0).padStart(3)}/${r.avgLines.toFixed(1)}  ` +
            `pieces ${r.avgPieces.toFixed(0).padStart(3)}  σ ${eff.sigma.toFixed(3)}` +
            `×${(evo.meanSigma || 1).toFixed(2)}  ${secs.toFixed(1)}s${flag}${gate}`
        );
        fs.appendFileSync(logPath, [
            gen, r.best.toFixed(2), r.avg.toFixed(2), r.bestLines.toFixed(1),
            r.avgLines.toFixed(2), r.avgPieces.toFixed(1), eff.sigma.toFixed(4), secs.toFixed(1),
        ].join(",") + "\n");

        if (evo.championFit > prevChamp) {
            save("champion.json", gen);
            promotions++;
            if (GATE_ROTATE > 0 && evo.rotateGate && promotions % GATE_ROTATE === 0) {
                const s = evo.rotateGate();
                console.log(`  gate bank rotated (epoch ${evo.gateEpoch}) — champion re-scored at ` +
                    `${s === null ? "n/a" : s.toFixed(1)} on ${GATE_GAMES} fresh games`);
            }
        }

        // A champion that has held its seat this long is not being limited by the
        // search any more. Give it somewhere to go.
        if (GROW_AFTER > 0 && grown < MAX_GROW && (evo.stagnant || 0) >= GROW_AFTER) {
            growNet(evo.gen - 1);
        }
    }
    if (evo.champion) save("final.json", evo.gen - 1);
    console.log(`\ndone — ${gensRun} generations in ${((Date.now() - t00) / 60000).toFixed(1)} min, ` +
        `best ${evo.championFit.toFixed(0)}`);
    for (const w of workers) await w.terminate();
})();
