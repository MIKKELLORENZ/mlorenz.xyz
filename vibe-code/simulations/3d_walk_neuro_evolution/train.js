/* train.js — headless trainer. Same code the browser runs, no rendering, one
 * worker thread per core.
 *
 *   node train.js --gens 400 --pop 48 --workers 8
 *   node train.js --resume training/champion.json --gens 200
 *   node train.js --gens 60 --stage-lock 3 --terrain stairs   (drill one stage)
 *
 * Splitting the population across workers is exactly equivalent to running it in
 * one process: the environment is a pure function of (missionSeed, noiseSeed) —
 * terrain, waypoints, gusts, shoves, sensor noise, the lot — and walkers never
 * interact, so a slice of the fleet in worker 3 experiences the identical
 * episode a slice in worker 0 does.
 *
 * Every generation is scored over several episodes with different mission seeds
 * and different weather. That is not a nicety: on a single episode the top of
 * the ranking is mostly luck about where the waypoints fell, and selection on
 * luck goes nowhere.
 *
 * The missions SLIDE rather than being redrawn. Generation g runs missions
 * g, g+1, g+2; generation g+1 runs g+1, g+2, g+3. Consecutive generations
 * therefore share two thirds of their exam, and the objective drifts slowly
 * instead of being replaced wholesale every generation.
 *
 * This matters more than it looks. Measured, one fixed brain scores anywhere
 * from 1,031 to 2,934 (sd 471) depending only on which mission it draws. When
 * every generation drew a fresh mission, a brain selected for winning
 * generation g's exam was re-examined on a completely different paper in g+1,
 * and the difference between two good brains — a few hundred points — was well
 * below the difference between two papers. Selection was measuring the exam,
 * not the candidate. Overlapping the papers makes the objective near-stationary
 * over the handful of generations a hill-climb needs to make a move, while the
 * slow drift still stops the population overfitting one lucky course.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const SIM_FILES = ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"];
function loadSim() {
    for (const f of SIM_FILES) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
}

/* ------------------------------------------------------------------- worker */
if (!isMainThread) {
    loadSim();
    parentPort.on("message", msg => {
        if (msg.type === "quit") { process.exit(0); }
        const { weights, sizes, acts, opts, episodes, first } = msg;
        /* This job's slice of the episode bank. Every accumulator below still
         * divides by the TOTAL `episodes`, so the partial sums from several
         * jobs add up to exactly the mean a single whole-brain job would have
         * produced — no reweighting on the main thread, and no dependence on
         * how the work happened to be split. */
        const epFrom = msg.epFrom | 0;
        const epTo = msg.epTo != null ? msg.epTo : episodes;
        setReward(opts.reward);          // workers load walker.js fresh; tell each one which ledger
        setTune({ cpgScale: opts.cpgScale, servoScale: opts.servoScale });
        /* Set per message, like the ledger above: a worker loads walker.js fresh
         * and its FIT starts at the file default of 0, so a weight sent only at
         * startup would be lost. Kept after setReward so it survives if
         * HEADING_W is ever added to the tiered table. */
        FIT.HEADING_W = opts.headingW || 0;
        // `acts` travels alongside the weights because the activation is part of
        // what a brain IS. Rebuilding every net as tanh here would score the
        // lrelu and relu demes under an activation they were not bred with, and
        // the A/B would compare three tanh populations.
        const nets = weights.map((w, i) => {
            const a = acts ? acts[i] : null;
            const n = new Net(sizes, null, a === "mixed" ? "relu" : a);
            for (let l = 0; l < n.weights.length; l++) n.weights[l].set(w[l]);
            // Per-neuron slopes travel too. Without them a "mixed" brain would
            // be evaluated as uniform ReLU, so the pool would be scored on a
            // network nobody bred.
            if (n.slopes && msg.slopes && msg.slopes[i]) {
                for (let l = 0; l < n.slopes.length; l++) n.slopes[l].set(msg.slopes[i][l]);
            }
            return n;
        });
        const acc = nets.map(() => ({ fitness: 0, arrivals: 0, stood: 0, balanced: 0, upright: 0, progress: 0, steps: 0, stride: 0, dist: 0, ground: 0, rose: 0, comPeak: 0, align: 0, perEp: new Array(episodes).fill(0) }));
        // Which surface each episode slot drew. Identical for every brain — the
        // bank is stratified, so slot e is the same surface for the whole
        // population — which is what makes a per-surface population statistic a
        // paired comparison rather than a mixture.
        const surfaces = new Array(episodes).fill(null);
        for (let e = epFrom; e < epTo; e++) {
            /* There used to be a sliding window here — episode e of generation g
             * was episode e-1 of generation g+1 — on the theory that sharing
             * missions between neighbours steadies the comparison. It steadies
             * NEIGHBOURS and nothing else: after `episodes` generations the bank
             * has turned over completely, and because each mission drew its own
             * surface, roughness and floor-start independently, the turnover
             * changed the exam's difficulty as much as its content. The bank is
             * stratified now (see world.js), which holds difficulty constant far
             * better than sharing missions did, so every generation gets its own
             * fresh block and nothing is scored twice. */
            const m = opts.missionBase + e;
            const w = new World(HUMANOID, nets, Object.assign({}, opts, {
                missionSeed: 1 + m * 37,
                noiseSeed: 5000 + m * 13,
                episodeSlot: e, episodeCount: episodes
            }));
            let guard = 0;
            while (!w.isOver() && guard++ < 140 * 500) w.step();
            surfaces[e] = w.terrain.kind || w.terrain.id || "?";
            w.walkers.forEach((x, i) => {
                acc[i].perEp[e] = x.fitness();
                acc[i].fitness += x.fitness() / episodes;
                acc[i].arrivals += x.arrivals / episodes;
                acc[i].stood += (x.stood ? 1 : 0) / episodes;
                acc[i].balanced += (x.balanced ? 1 : 0) / episodes;
                acc[i].upright += x.uprightTime / episodes;
                acc[i].progress += x.progressM / episodes;
                acc[i].steps += x.steps / episodes;
                acc[i].stride += x.strideSum / episodes;
                acc[i].dist += Math.hypot(x.mb.bp[0], x.mb.bp[2]) / episodes;
                acc[i].ground += (x.startedDown ? 1 : 0) / episodes;
                // "rose" only counts on episodes that actually started on the
                // floor, otherwise a walker that never fell would score 0 and
                // drag the mean down for doing nothing wrong.
                if (x.startedDown) acc[i].rose += (x.recoveries > 0 ? 1 : 0) / episodes;
                acc[i].comPeak += x.bestComY / episodes;
                acc[i].align += x.meanAlign() / episodes;
            });
        }
        parentPort.postMessage({ first, acc, surfaces, epFrom, epTo });
    });
    return;
}

/* --------------------------------------------------------------------- main */
loadSim();

/* A four-hour run that dies silently costs four hours. The first long run
 * stopped at generation 28 with an exit code and an empty stderr, which told us
 * nothing; route every way a Node process can die into the same log the
 * generations are written to, so the next failure names itself. */
for (const sig of ["uncaughtException", "unhandledRejection"]) {
    process.on(sig, err => {
        console.log(`\n!! ${sig}: ${err && err.stack ? err.stack : err}`);
        process.exit(1);
    });
}
process.on("exit", code => { if (code !== 0) console.log(`\n!! exiting with code ${code}`); });

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith("--")) return true;
    return isNaN(+v) ? v : +v;
}

/* Training missions live here and the held-out exam lives at 900-990. Keeping
 * them in disjoint blocks is the only thing that makes "held out" true. */
const MISSION_BLOCK = 1000000;

const CFG = {
    gens: arg("gens", 300),
    pop: arg("pop", 48),
    episodes: arg("episodes", 3),
    // The cap used to be a hard 32, which silently swallowed --workers on any
    // bigger machine: a 128-core node asked for 120, got 32, and ran at 25%
    // utilisation while the log cheerfully reported the requested figure. Cap to
    // what the machine actually has, and say so when the request is trimmed
    // rather than ignoring it.
    workers: (() => {
        const want = arg("workers", Math.max(1, os.cpus().length - 2));
        const cap = Math.max(1, os.cpus().length);
        if (want > cap) console.log(`--workers ${want} exceeds ${cap} logical CPUs; using ${cap}`);
        return Math.max(1, Math.min(want, cap));
    })(),
    seed: arg("seed", 1234),
    mutRate: arg("mut-rate", MUT_DEFAULT.rate),    // see the measured table in
    mutSigma: arg("mut-sigma", MUT_DEFAULT.sigma), // evolution.js — 0.10/0.15
                                                   // destroyed 24 children of 24
    grace: arg("grace", 3),
    stageLock: arg("stage-lock", 0),
    terrain: arg("terrain", "rolling"),
    out: arg("out", "training"),
    resume: arg("resume", null),
    freshHistory: arg("fresh-history", 0),
    save: arg("save-every", 10),
    reward: arg("reward", "flat"),
    cpgScale: arg("cpg-scale", 1),
    servoScale: arg("servo-scale", 1),
    elites: arg("elites", 0),
    fresh: arg("fresh", 0),
    /* Stop cleanly at a wall-clock instant, given as unix seconds. A generation
     * count cannot express "until 22:00" because seconds-per-generation moves
     * with the stage, and overshooting means the run is killed mid-generation
     * and the champion save is whatever was last flushed. */
    deadline: arg("deadline", 0),
    // Plateau search tracks — see TRACK_RECIPES in evolution.js. 0 disables.
    plateauGens: arg("plateau-gens", 100),
    trackGens: arg("track-gens", 50),
    trackFrac: arg("track-frac", 0.36),
    /* Equalise each terrain surface's influence on selection. Off by default so
     * every earlier measurement in this project still reproduces. See
     * normaliseBySurface() in evolution.js for the numbers that motivated it. */
    surfaceNorm: !!arg("surface-norm", 0),
    // Brains per dispatched job. 1 balances best; see runGeneration for why the
    // finer granularity costs nothing measurable.
    chunk: arg("chunk", 1),
    /* Episodes per job. Defaults to the whole bank, which is the old behaviour.
     * Set it below `episodes` to raise job granularity — see runGeneration. */
    epChunk: arg("ep-chunk", 0),
    /* Heading-alignment weight on closure income. See FIT.HEADING_W in
     * walker.js. 0 = off, which every run before 2026-08-01 used. */
    headingW: arg("heading-w", 0),
    /* One-way island migration. A directory this run WATCHES for brains dropped
     * in by another run; each is taken in, the lowest-ranked seats are given
     * over to copies of it, and the file is moved to consumed/.
     *
     * One-way on purpose. The island sending migrants is a from-scratch run
     * under a different ledger; the island receiving them is a 600-generation
     * lineage. Gene flow the other way would just re-seed the fresh run with
     * the incumbent's habits and there would be no independent experiment left
     * to compare against — the two islands would converge and the A/B would
     * quietly become one run reported twice. */
    injectDir: arg("inject-dir", null),
    /* Where THIS island drops its own emigrants, and how often. Triggered on the
     * generation counter, not a wall clock: the two islands run at different
     * seconds-per-generation, and "every 20 minutes" would mean a different
     * number of generations on each of them and would drift further apart as
     * the fleets change speed. */
    /* This island's name. `--tag` is only a string for `ps` to match on and is
     * never parsed; this one is written into every emigrant file so the peer's
     * log says where a migrant came from. */
    island: arg("island", "isl"),
    exportDir: arg("export-dir", null),
    exportEvery: arg("export-every", 20),
    exportCount: arg("export-count", 2),
    /* How long a migrant stays in the breeding pool, and how many guaranteed
     * elite-crossings it gets per generation while it is there. Without these
     * a migrant is culled having never been a parent — see admitMigrant. */
    injectLife: arg("inject-life", 12),
    injectCross: arg("inject-cross", 8),
    trackCount: arg("track-count", 3),
    /* Activation A/B. The population splits evenly into one deme per name, each
     * bred entirely within itself on the identical mission bank, and at
     * generation --act-cull the whole population goes to whichever deme is
     * ahead on a smoothed paired margin. See the deme block in evolution.js for
     * why this is one decision rather than a per-generation bandit.
     *   --acts tanh                 the old behaviour exactly, no A/B
     *   --acts tanh,lrelu,relu      the three-way comparison
     *   --act-cull 0                never cull; run the demes to the end */
    acts: String(arg("acts", "tanh")).split(",").map(s => s.trim()).filter(Boolean),
    actCull: arg("act-cull", 250),
    /* --interbreed drops the isolation instead: one pool seeded across the
     * listed activations, crossing freely, children mixed neuron by neuron.
     * Only legal for the two rectifiers — ReLU and leaky ReLU are the same
     * function either side of zero, so a transplanted neuron keeps doing its
     * job, which is not true of tanh. */
    interbreed: !!arg("interbreed", 0),
    quiet: arg("quiet", false)
};
{
    const bad = CFG.acts.filter(a => ACT_NAMES.indexOf(a) < 0);
    if (bad.length) {
        console.log(`!! unknown activation(s) ${bad.join(", ")} — known: ${ACT_NAMES.join(", ")}`);
        process.exit(1);
    }
}
setReward(CFG.reward);
setTune({ cpgScale: CFG.cpgScale, servoScale: CFG.servoScale });

const outDir = path.isAbsolute(CFG.out) ? CFG.out : path.join(__dirname, CFG.out);
fs.mkdirSync(outDir, { recursive: true });

const evo = new Evolution(CFG.pop, CFG.seed, CFG.acts, { interbreed: CFG.interbreed });
if (CFG.interbreed && !evo.interbreed) {
    console.log(`!! --interbreed needs two or more activations and cannot include tanh; got ${CFG.acts.join(",")}`);
    process.exit(1);
}
if (evo.interbreed) {
    console.log(`activation: ${CFG.acts.join(" + ")} INTERBREEDING in one pool of ${CFG.pop} — ` +
        `crossover carries each neuron's slope, so children are mixed unit by unit`);
} else if (CFG.acts.length > 1) {
    console.log(`activation A/B: ${evo.demes.map(d => `${d.act} x${d.n}`).join(" | ")} — bred separately on identical missions` +
        (CFG.actCull > 0 ? `, culled to the winner at generation ${CFG.actCull}` : ", never culled"));
}
if (CFG.resume) {
    /* --resume takes a COMMA-SEPARATED list, and more than one is not a
     * convenience — it is diversity. Seeding an entire population from a single
     * brain hands generation 1 to one lineage, and if that lineage sits in a
     * local minimum the run starts inside it: mutation alone rarely walks a
     * population out of a basin it was born in. Two independently evolved
     * ancestors give crossover something structurally different to recombine,
     * which is the mechanism that actually escapes. */
    const files = String(CFG.resume).split(",").map(s => s.trim()).filter(Boolean);
    const loaded = files.map(f => {
        const p = path.isAbsolute(f) ? f : path.join(__dirname, f);
        const saved = JSON.parse(fs.readFileSync(p, "utf8"));
        return { file: f, saved, net: Net.fromJSON(saved.net || saved) };
    });
    // The champion slot belongs to the first file listed; put the strongest one
    // there. The others are ancestry, not incumbents.
    evo.champion = loaded[0].net;
    evo.championFit = loaded[0].saved.fitness || 0;
    /* Split the pool evenly, each block keeping a couple of pristine copies so a
     * seed cannot be lost to a bad mutation draw in its first generation. */
    const per = Math.floor(evo.brains.length / loaded.length);
    for (let i = 0; i < evo.brains.length; i++) {
        const k = Math.min(loaded.length - 1, Math.floor(i / per));
        const pristine = (i - k * per) < 2;
        evo.brains[i] = pristine ? loaded[k].net.clone()
            : loaded[k].net.clone().mutate(CFG.mutRate, CFG.mutSigma, evo.rng);
    }
    /* An interbreeding pool seeded from ONE brain inherits that brain's slopes,
     * so resuming from a pure leaky champion would start the run at 100% leaky
     * with no ReLU genes anywhere for crossover to recombine — the pool would be
     * uniform and the interbreeding would have nothing to do.
     *
     * Half the seats therefore get their slopes rewritten to the other
     * rectifier. This is cheap in a way it would not be for tanh: ReLU and leaky
     * ReLU agree exactly on every positive pre-activation, so a hard-rectified
     * copy of a leaky brain is a close relative that keeps all of the learned
     * weights, not a random restart. The founding pool is an even mix of two
     * near-identical variants of the champion, which is exactly what a
     * recombination experiment wants. */
    if (evo.interbreed) {
        for (let i = 0; i < evo.brains.length; i++) {
            const b = evo.brains[i];
            if (!b.slopes) continue;
            const v = SLOPE_VALUES[CFG.acts[i % CFG.acts.length]];
            for (const s of b.slopes) s.fill(v);
            b._relabel();
        }
        const leaky = evo.brains.filter(b => b.leakyShare() === 1).length;
        console.log(`  founding pool re-slope: ${evo.brains.length - leaky} ReLU / ${leaky} leaky ` +
            `— same learned weights, both rectifiers, so crossover has something to mix`);
    }

    /* History is restored only from a single-file resume, and only if it has
     * any. stageFor's anti-stall fallbacks are keyed on the generation number,
     * so a resume that left gen at 1 would silently re-arm every one of them.
     * A grafted seed deliberately carries no history: the world changed under
     * it, so it has to re-earn its promotions under the new rules. */
    /* --fresh-history is the same argument for a change the graft cannot see.
     * When the SCORING changes — a stratified mission bank, a new ledger — the
     * brain is untouched but its recorded fitness is in the old currency. The
     * plateau detector compares a smoothed window against one a hundred
     * generations back; fed both currencies it compares stratified scores with
     * i.i.d. ones and calls the difference a stall. */
    if (loaded.length === 1 && loaded[0].saved.history && !CFG.freshHistory) {
        evo.history = loaded[0].saved.history;
        evo.gen = evo.history.length + 1;
    } else if (CFG.freshHistory && loaded[0].saved.history) {
        console.log(`  dropped ${loaded[0].saved.history.length} gens of history — scoring changed, fitness is not comparable`);
    }
    for (const l of loaded) {
        console.log(`seeded from ${l.file} (fitness ${(l.saved.fitness || 0).toFixed(0)}` +
            `${l.saved.graftedFrom ? `, grafted from ${l.saved.graftedFrom} gen ${l.saved.graftedFromGen}` : ""})`);
    }
    console.log(`  population ${evo.brains.length} split across ${loaded.length} seed${loaded.length > 1 ? "s" : ""}` +
        `, ${evo.history.length} gens of history restored`);
}

if (CFG.deadline > 0) {
    const mins = (CFG.deadline - Date.now() / 1000) / 60;
    console.log(`deadline ${new Date(CFG.deadline * 1000).toISOString()} — ${mins.toFixed(0)} min from now`);
}
console.log(CFG.plateauGens > 0
    ? `plateau tracks: if best fitness is flat over ${CFG.plateauGens} gens, split ${(CFG.trackFrac * 100).toFixed(0)}% of the pool ` +
      `into ${CFG.trackCount} independent tracks seeded from the leader, run them ${CFG.trackGens} gens, adopt any that overtakes it`
    : "plateau tracks: off");

const workers = [];
for (let i = 0; i < CFG.workers; i++) workers.push(new Worker(__filename));

/* DYNAMIC DISPATCH, not one static slice per worker.
 *
 * Episode length varies by an order of magnitude — a walker that falls at 5 s
 * and one that runs the full 130 s clock cost the same worker wildly different
 * time — so a static partition makes every generation wait for whichever worker
 * drew the longest-lived brains. Measured on the live 128-worker run, per-thread
 * CPU over 1583 s of wall clock:
 *
 *     min 1120   median 1155   max 1515 cpu-seconds
 *
 * The busiest worker was 96% busy and the median only 73%: about 30% of a
 * 128-core machine sat at the barrier. Perfectly balanced, the same 142,600
 * cpu-seconds of real work fits in 1114 s rather than 1583.
 *
 * So the population becomes a QUEUE and workers pull from it as they free up.
 * One brain per job by default, which costs nothing measurable: building a World
 * takes 0.34 ms against a ~1050 ms episode (0.03%), and a walker simulated alone
 * costs the same as one of three sharing a World (1048 ms vs 983 ms each) —
 * finished walkers are already skipped by `if (!w.done)`, so there was never
 * bulk-simulation savings to lose.
 *
 * Determinism is unaffected: the environment is a pure function of
 * (missionSeed, noiseSeed), both derived from the generation and episode index,
 * so which worker happens to run a brain cannot change its score. */
/* Job granularity, and why it is split two ways.
 *
 * Chunking by BRAIN alone gives `pop / chunk` jobs. At pop 192 and chunk 1 that
 * is 192 jobs for 96 workers — two each — and a queue with two items per worker
 * cannot smooth anything: one worker drawing two long-lived brains sets the
 * length of the whole generation while others sit idle. Measured on a box with
 * nothing else running, 96 requested workers drew only 77.6 cores. Raising the
 * worker count makes it worse, not better: 192 jobs over 128 workers is 1.5
 * each, so half the box would idle through a second round it has no work for.
 *
 * Splitting the EPISODE bank as well multiplies the job count by
 * `episodes / epChunk` without changing what is computed. Each job still
 * divides by the total episode count, so partial results sum to the same means,
 * and mission seeds come from the absolute episode index — so the split cannot
 * change a single score. Verified bit-identical against whole-brain jobs. */
function runGeneration(opts) {
    const n = evo.brains.length;
    const chunk = Math.max(1, Math.min(CFG.chunk | 0 || 1, n));
    const E = CFG.episodes;
    const ep = Math.max(1, Math.min(CFG.epChunk | 0 || E, E));
    const starts = [];
    for (let i = 0; i < n; i += chunk) {
        for (let e = 0; e < E; e += ep) starts.push([i, e]);
    }

    return new Promise((resolve, reject) => {
        const out = [];
        let next = 0, finished = 0, failed = false;
        const feed = w => {
            if (failed || next >= starts.length) return;      // queue drained; this worker idles
            const [a, e0] = starts[next++];
            const b = Math.min(n, a + chunk);
            const e1 = Math.min(E, e0 + ep);
            const onMsg = m => {
                w.off("message", onMsg); w.off("error", onErr);
                out.push(m);
                if (++finished === starts.length) resolve(out);
                else feed(w);                                  // straight back to the queue
            };
            const onErr = e => {
                w.off("message", onMsg); w.off("error", onErr);
                if (!failed) { failed = true; reject(e); }
            };
            w.on("message", onMsg);
            w.on("error", onErr);
            w.postMessage({
                weights: evo.brains.slice(a, b).map(net => net.weights.map(x => Float32Array.from(x))),
                acts: evo.brains.slice(a, b).map(net => net.act),
                slopes: evo.brains.slice(a, b).map(net => net.slopes ? net.slopes.map(s => Float32Array.from(s)) : null),
                sizes: NET_SIZES, opts, episodes: CFG.episodes, first: a,
                epFrom: e0, epTo: e1
            });
        };
        for (const w of workers) feed(w);
    });
}

/* Seeded from the restored history, not started empty. runlog.json is what the
 * dashboard and every after-the-fact plot read, and its array index IS the
 * generation number; a resumed run that began logging at zero would write a file
 * claiming the run started at generation 1 with whatever it was doing at
 * generation 91, so every curve would be shifted and every annotation would sit
 * in the wrong place. */
const runLog = evo.history.slice();

/* ------------------------------------------------------- island immigration
 * Take in any brains another run has dropped into --inject-dir.
 *
 * Migrants land in the LOWEST-ranked seats, never the champion slot. A migrant
 * from a young island will usually be far worse than this island's incumbents,
 * and it has to earn its place in one generation like everything else — the
 * point is to offer crossover some genuinely foreign structure, not to hand a
 * 600-generation lineage over to a newcomer. Several copies go in because a
 * single seat is one bad mission draw away from being deleted before any
 * crossover partner ever meets it.
 *
 * The shape check is not a formality. The two islands can drift apart — a
 * sensor change on one side and not the other — and Net.fromJSON would happily
 * build a net whose weight matrices no longer describe this body. Refuse and
 * say so, rather than train on a brain nobody bred. */
function takeMigrants() {
    let dir = CFG.injectDir;
    if (!path.isAbsolute(dir)) dir = path.join(__dirname, dir);
    let files;
    try { files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort(); }
    catch { return; }                       // directory not created yet — normal
    if (!files.length) return;
    const done = path.join(dir, "consumed");
    fs.mkdirSync(done, { recursive: true });
    for (const f of files) {
        const src = path.join(dir, f);
        try {
            const saved = JSON.parse(fs.readFileSync(src, "utf8"));
            const raw = saved.net || saved;
            if (raw.sizes.join() !== NET_SIZES.join()) {
                console.log(`  migrant ${f} REFUSED: ${raw.sizes.join("-")} against this island's ${NET_SIZES.join("-")}`);
            } else {
                const net = Net.fromJSON(raw);
                evo.admitMigrant(net, CFG.injectLife);
                console.log(`  migrant ${f} taken in as breeding stock ONLY — it gets no seat ` +
                    `(its island's generation ${saved.gen || "?"}, its own fitness ${(saved.fitness || 0).toFixed(0)}, ` +
                    `in that island's ledger). It crosses with our elites for ${CFG.injectLife} generations ` +
                    `at ${CFG.injectCross} children each; only those children compete, and only by ` +
                    `out-scoring the incumbents on our own missions.`);
            }
        } catch (e) {
            console.log(`  migrant ${f} unreadable (${e.message})`);
        }
        try { fs.renameSync(src, path.join(done, f)); } catch { try { fs.unlinkSync(src); } catch {} }
    }
}

/* Send this island's best few to the peer's inject directory.
 *
 * Written under a dot-name and then renamed, because the peer scans that
 * directory between its own generations and a half-written file would be
 * parsed as a corrupt brain. rename is atomic within a filesystem; copy is not.
 *
 * evo.brains is in rank order immediately after evolve() — the elites occupy
 * the first seats — so the top `count` are the best of the generation that just
 * ran. */
function exportEmigrants() {
    let dir = CFG.exportDir;
    if (!path.isAbsolute(dir)) dir = path.join(__dirname, dir);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { return; }
    const count = Math.max(1, Math.min(CFG.exportCount | 0 || 1, evo.brains.length));
    const stamp = `${CFG.island}_g${evo.gen}`;
    let sent = 0;
    for (let i = 0; i < count; i++) {
        const tmp = path.join(dir, `.${stamp}_${i}.json`);
        try {
            fs.writeFileSync(tmp, JSON.stringify({
                net: evo.brains[i].toJSON(),
                fitness: i === 0 ? evo.championFit : 0,
                gen: evo.gen, rank: i, from: CFG.island
            }));
            fs.renameSync(tmp, path.join(dir, `${stamp}_${i}.json`));
            sent++;
        } catch (e) { try { fs.unlinkSync(tmp); } catch {} }
    }
    if (sent) console.log(`  sent ${sent} emigrant${sent > 1 ? "s" : ""} (ranks 0-${sent - 1}) to the peer island`);
}

function saveChampion(tag) {
    if (!evo.champion) return;
    const file = path.join(outDir, `champion${tag || ""}.json`);
    fs.writeFileSync(file, JSON.stringify({
        net: evo.champion.toJSON(), fitness: evo.championFit, gen: evo.gen,
        netSizes: NET_SIZES, savedAt: new Date().toISOString(), history: evo.history
    }));
    return file;
}

(async () => {
    const t0 = Date.now();
    let prevStage = null;
    for (let g = 0; g < CFG.gens; g++) {
        const st = stageFor(evo.gen, evo.history, { stageLock: CFG.stageLock });
        // The champion is the best brain of the CURRENT stage, and fitness is
        // not comparable across stages, so a promotion silently retires the
        // outgoing stage's best. One run peaked at 3,920 on stage 2 and that
        // brain is simply gone — overwritten ten generations later by a stage-3
        // champion worth 1,161. Bank the outgoing champion before the ground
        // moves; these files are the only record of what each rung achieved.
        if (prevStage !== null && st.stage !== prevStage) {
            const f = saveChampion(`_st${prevStage}_gen${evo.gen}`);
            console.log(`stage ${prevStage} -> ${st.stage}; banked the outgoing champion to ${path.basename(f)}`);
        }
        prevStage = st.stage;
        const opts = {
            stage: st.stage, terrainDifficulty: st.terrainDifficulty, terrainId: CFG.terrain,
            /* A fresh block of `episodes` missions per generation, offset clear
             * of the held-out exam. The old numbering was `missionBase = gen`,
             * which walks straight into the exam's 900-990 block around
             * generation 900 and silently turns held-out missions into training
             * ones — the exam would still print a number, and the number would
             * be a lie. Long runs reach generation 900. */
            missionBase: MISSION_BLOCK + evo.gen * CFG.episodes, noise: true, reward: CFG.reward,
            cpgScale: CFG.cpgScale, servoScale: CFG.servoScale, headingW: CFG.headingW
        };
        if (CFG.injectDir) { evo.migrantCross = CFG.injectCross; takeMigrants(); }
        const parts = await runGeneration(opts);
        const acc = new Array(evo.brains.length);
        /* Partial jobs are SUMMED, not assigned. A brain's episodes may have
         * been split across several workers; each partial already divided by
         * the total episode count, so adding them reconstructs the mean exactly.
         * `perEp` needs a max rather than a sum only because slots outside a
         * partial's range are left at 0 by that partial. */
        for (const p of parts) p.acc.forEach((a, i) => {
            const k = p.first + i;
            const cur = acc[k];
            if (!cur) { acc[k] = a; return; }
            for (const f of Object.keys(a)) {
                if (f === "perEp") { for (let e = p.epFrom; e < p.epTo; e++) cur.perEp[e] = a.perEp[e]; }
                else cur[f] += a[f];
            }
        });

        /* Fitness the selector actually ranks on. With --surface-norm this is
         * the per-surface-equalised score rather than the plain bank mean; the
         * raw mean stays in `acc` for the log so both remain visible. */
        /* Merged across partials: each job only knows the surfaces of the
         * episodes it ran, and normaliseBySurface needs the whole bank. */
        const surfaces = new Array(CFG.episodes).fill("?");
        for (const p of parts) {
            if (!p.surfaces) continue;
            for (let e = 0; e < p.surfaces.length; e++) if (p.surfaces[e]) surfaces[e] = p.surfaces[e];
        }
        const ranked = CFG.surfaceNorm
            ? normaliseBySurface(acc.map(a => a.perEp || []), surfaces)
            : acc.map(a => a.fitness);
        const results = evo.brains.map((b, i) => ({ brain: b, fitness: ranked[i], arrivals: acc[i].arrivals }));
        /* Curriculum statistics describe the MAIN line only. While a plateau
         * round is running, part of the population is deliberately breeding at
         * up to five times the usual mutation rate and mostly falling over; that
         * belongs in the experiment, not in the numbers the stage ratchet reads.
         * Folded in, a search for a way forward would look like the fleet
         * getting worse and could hold back a promotion it had already earned. */
        const mainAcc = acc.slice(0, evo.mainCount);
        const N = mainAcc.length;
        const stats = ((acc) => ({
            stage: st.stage,
            terrainDifficulty: st.terrainDifficulty,
            stoodFrac: acc.reduce((s, a) => s + a.stood, 0) / N,
            balancedFrac: acc.reduce((s, a) => s + a.balanced, 0) / N,
            avgArr: acc.reduce((s, a) => s + a.arrivals, 0) / N,
            bestArr: Math.max(...acc.map(a => a.arrivals)),
            avgUpright: acc.reduce((s, a) => s + a.upright, 0) / N,
            maxUpright: Math.max(...acc.map(a => a.upright)),
            avgProg: acc.reduce((s, a) => s + a.progress, 0) / N,
            bestProg: Math.max(...acc.map(a => a.progress)),
            avgSteps: acc.reduce((s, a) => s + a.steps, 0) / N,
            bestSteps: Math.max(...acc.map(a => a.steps)),
            avgStride: acc.reduce((s, a) => s + a.stride, 0) / N,
            bestStride: Math.max(...acc.map(a => a.stride)),
            groundFrac: acc.reduce((s, a) => s + a.ground, 0) / N,
            roseFrac: acc.reduce((s, a) => s + a.rose, 0) / N,
            bestCom: Math.max(...acc.map(a => a.comPeak)),
            /* Fleet mean heading alignment, and the alignment of whoever walked
             * furthest — not the best alignment in the fleet, which a walker
             * that never moved would win with a vacuous 1.0. */
            avgAlign: acc.reduce((s, a) => s + a.align, 0) / N,
            leadAlign: (acc.reduce((b, a) => (a.progress > b.progress ? a : b), acc[0]) || {}).align || 0
        }))(mainAcc);
        const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.grace, {
            plateauGens: CFG.plateauGens, trackGens: CFG.trackGens,
            trackFrac: CFG.trackFrac, trackCount: CFG.trackCount,
            actCull: CFG.actCull
        }, stats);
        runLog.push(rec);
        if (evo.demeEvent) console.log(`  ${evo.demeEvent}`);
        if (evo.probeEvent) console.log(`  ${evo.probeEvent}`);
        if (evo.migrantEvent) { console.log(`  ${evo.migrantEvent}`); evo.migrantEvent = null; }
        // After evolve, so `gen` is the generation that just finished and the
        // ranks being exported are the ones it produced.
        if (CFG.exportDir && CFG.exportEvery > 0 && evo.gen % CFG.exportEvery === 0) exportEmigrants();
        if (!CFG.quiet) {
            const el = (Date.now() - t0) / 1000;
            console.log(
                `gen ${String(evo.gen - 1).padStart(4)} ` +
                `st${st.stage}${st.stage >= 4 ? "/" + st.terrainDifficulty.toFixed(2) : "  "} ` +
                `best ${rec.best.toFixed(0).padStart(7)} avg ${rec.avg.toFixed(0).padStart(7)} ` +
                `| stood ${(stats.stoodFrac * 100).toFixed(0).padStart(3)}% ` +
                `bal ${(stats.balancedFrac * 100).toFixed(0).padStart(3)}% ` +
                `upright ${stats.avgUpright.toFixed(1)}/${stats.maxUpright.toFixed(1)}s ` +
                `| steps ${stats.avgSteps.toFixed(1)}/${stats.bestSteps.toFixed(0)} ` +
                `stride ${stats.avgStride.toFixed(2)}/${stats.bestStride.toFixed(2)} m ` +
                `walked ${stats.avgProg.toFixed(2)}/${stats.bestProg.toFixed(2)} m ` +
                `align ${stats.avgAlign.toFixed(2)}/${stats.leadAlign.toFixed(2)} ` +
                // floor starts and how many of them ended with the walker back
                // on its feet — the get-up rung, which is invisible otherwise
                (stats.groundFrac > 0
                    ? `| floor ${(stats.groundFrac * 100).toFixed(0)}% rose ${(stats.roseFrac * 100).toFixed(0)}% com ${stats.bestCom.toFixed(2)}m `
                    : "") +
                // bestArr is a MEAN over the generation's episodes, so it is
                // fractional: 0.33 means the best walker reached a waypoint in
                // one of three episodes. Printed with toFixed(0) it rounded to
                // "0" and the log claimed nobody had ever arrived, for thirty
                // generations after the first walker actually did.
                `wp ${stats.avgArr.toFixed(2)}/${stats.bestArr.toFixed(2)} ` +
                `| ${(el / (g + 1)).toFixed(1)}s/gen` +
                // Only shown while it differs from what was asked for on the
                // command line, so the log makes it obvious that a probe round
                // changed the operator rather than burying it in the scrollback.
                (evo.tuned ? ` mut ${evo.tuned.rate.toFixed(3)}/${evo.tuned.sigma.toFixed(3)}` : "") +
                (evo.round ? ` TRACKS ${evo.round.gens}/${CFG.trackGens} [` +
                    evo.tracks.map((t, i) => {
                        const h = t.hist[t.hist.length - 1];
                        return `${t.recipe.split(" ")[0]} ${h ? h.best.toFixed(0) : "-"}`;
                    }).join(" ") + `]` : "") +
                // Per-deme best, so the activation A/B is legible in the raw log
                // and not only after the fact in runlog.json. Dropped once the
                // cull has happened and there is only one activation left.
                (evo.demes.length > 1 ? ` ACTS [` + evo.demes.map(d => {
                    const h = d.hist[d.hist.length - 1];
                    return `${d.act} ${h ? h.best.toFixed(0) : "-"}`;
                }).join(" ") + `]` : "") +
                // With one interbreeding pool the activation is a proportion,
                // not a label: what share of hidden units leak, in the fleet and
                // in its best individual.
                (rec.leakyShare != null
                    ? ` leaky ${(rec.leakyShare * 100).toFixed(0)}%/${(rec.bestLeaky * 100).toFixed(0)}%` : "") +
                (evo.graceEvent ? "  " + evo.graceEvent : "")
            );
        }
        // The run log used to be written once, at the end. A long run that died
        // at generation 28 therefore left no curves at all, and the watcher had
        // nothing to render. Flush it alongside every champion save instead.
        if (CFG.save && (g + 1) % CFG.save === 0) {
            saveChampion();
            fs.writeFileSync(path.join(outDir, "runlog.json"), JSON.stringify(runLog));
        }
        /* Checked AFTER the generation completes, never in the middle of one:
         * a half-scored generation is not a generation, and stopping inside one
         * would leave the champion file describing a population that never
         * finished being measured. */
        if (CFG.deadline > 0 && Date.now() / 1000 >= CFG.deadline) {
            console.log(`\ndeadline reached at generation ${evo.gen - 1} — stopping cleanly`);
            break;
        }
    }
    const f = saveChampion();
    fs.writeFileSync(path.join(outDir, "runlog.json"), JSON.stringify(runLog));
    console.log(`\ndone in ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min — champion ${evo.championFit.toFixed(0)} saved to ${f}`);
    for (const w of workers) w.postMessage({ type: "quit" });
    setTimeout(() => process.exit(0), 200);
})();
