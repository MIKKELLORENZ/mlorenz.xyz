/* train_headless.js — offline trainer. Runs exactly the GA the page runs, but
 * on every core and with no rendering, to produce the built-in champion.
 *
 *   node train_headless.js                        # fresh run, forever
 *   node train_headless.js --gens 400             # stop after 400 generations
 *   node train_headless.js --pop 48 --workers 4
 *   node train_headless.js --epoch 8              # generations between migrations
 *   node train_headless.js --resume training/champion.json
 *   node train_headless.js --until 1785000000000  # stop at this epoch-ms
 *
 * Island model: each worker evolves its own independent population and, every
 * `epoch` generations, hands its champion to the main thread. The main thread
 * runs a round-robin between the island champions plus the reigning global
 * champion, crowns the winner, and seeds it back into every island. Islands
 * beat one big population here because a single population converges onto one
 * style of play and then has nothing left to learn from itself - and because
 * this way each worker runs the same evolution.js the browser runs, so the
 * offline trainer and the page can never drift apart.
 *
 * Writes <out>/champion.json and <out>/log.csv every epoch, so a run can be
 * killed and picked up later.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const SRC = ["chess.js", "features.js", "nn.js", "evolution.js"];
for (const f of SRC) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

/* --------------------------------------------------------------- worker side */
if (!isMainThread) {
    const { seed, pop } = workerData;
    let ev = new Evolution(pop, seed);
    ev.recordLeader = false;

    const runGens = n => {
        const target = ev.gen + n;
        while (ev.gen < target) ev.step(4000);
    };

    parentPort.on("message", msg => {
        if (msg.genome) {
            const g = Float64Array.from(msg.genome);
            ev.adoptChampion(g, msg.gen || 0);
            ev.inject([g, mutate(cloneGenome(g), 0.1, 0.15, 0.001, ev.rng)]);
        }
        if (msg.cmd !== "run") { parentPort.postMessage({ tag: msg.tag, ack: true }); return; }
        runGens(msg.gens);
        parentPort.postMessage({
            tag: msg.tag,
            gen: ev.gen,
            summary: ev.summary(),
            champion: ev.champion ? Array.from(ev.champion.genome) : null,
            championGen: ev.champion ? ev.champion.gen : 0
        });
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

const POP = +arg("pop", 48);
const GENS = +arg("gens", 1e9);
const EPOCH = +arg("epoch", 6);
// This machine is shared with other agents; more workers than this and runs
// start getting killed rather than finishing faster.
const WORKERS = Math.max(1, Math.min(+arg("workers", Math.min(4, Math.max(1, os.cpus().length - 2))), 12));
const OUT = String(arg("out", path.join(__dirname, "training")));
const UNTIL = +arg("until", 0);
const RESUME = arg("resume", null);
const BASE_SEED = +arg("seed", (Date.now() ^ 0x5f3759df) >>> 0);

fs.mkdirSync(OUT, { recursive: true });
const CHAMP_PATH = path.join(OUT, "champion.json");
const LOG_PATH = path.join(OUT, "log.csv");

let global_ = { genome: null, gen: 0, born: 0 };
if (RESUME) {
    const p = RESUME === true ? CHAMP_PATH : String(RESUME);
    const loaded = deserializeGenome(fs.readFileSync(p, "utf8"));
    if (!loaded) { console.error(`cannot read a ${NN_VERSION} genome from ${p}`); process.exit(1); }
    global_ = { genome: loaded.genome, gen: loaded.meta.gen || 0, born: loaded.meta.gen || 0 };
    console.log(`resumed champion from ${p} (generation ${global_.gen})`);
}

if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, ["epoch", "gen", "elapsed_s",
        ...LADDER.map(r => "vs_" + r.name),
        "ladder", "best", "median", "draws", "mates", "tier", "diversity"].join(",") + "\n");
}

// A neutral referee that owns no population - used only for its duel and
// benchmark helpers, so scoring never touches an island's RNG stream.
const referee = new Evolution(16, 0xC0FFEE);
referee.recordLeader = false;

const workers = [];
for (let i = 0; i < WORKERS; i++) {
    workers.push(new Worker(__filename, {
        workerData: { seed: (BASE_SEED + Math.imul(i + 1, 0x9E3779B1)) >>> 0, pop: POP }
    }));
}

function ask(w, msg) {
    return new Promise(resolve => {
        const tag = Math.random().toString(36).slice(2);
        const onMsg = m => { if (m.tag === tag) { w.off("message", onMsg); resolve(m); } };
        w.on("message", onMsg);
        w.postMessage(Object.assign({ tag }, msg));
    });
}

const t0 = Date.now();
let stopping = false;
process.on("SIGINT", () => { console.log("\nstopping after this epoch…"); stopping = true; });

(async function main() {
    if (global_.genome) {
        await Promise.all(workers.map(w =>
            ask(w, { cmd: "seed", genome: Array.from(global_.genome), gen: global_.gen })));
    }
    let epoch = 0;
    while (true) {
        epoch++;
        const results = await Promise.all(workers.map(w => ask(w, { cmd: "run", gens: EPOCH })));
        const gen = Math.max(...results.map(r => r.gen));

        // --- crown the global champion -------------------------------------
        // Two stages on purpose. A round robin picks the best of this epoch's
        // island champions; only that one then plays a long match against the
        // sitting champion, and only a clear win takes the crown. Picking the
        // winner of a single pooled round robin lets the title move on a game
        // or two of luck, which is how an archive ends up full of genomes that
        // were never actually better than their predecessor.
        const islands = results
            .filter(r => r.champion)
            .map(r => ({ genome: Float64Array.from(r.champion), gen: r.championGen }));

        let challenger = islands[0];
        if (islands.length > 1) {
            const score = islands.map(() => 0);
            for (let a = 0; a < islands.length; a++) {
                for (let b = a + 1; b < islands.length; b++) {
                    const s = referee.duel(islands[a].genome, islands[b].genome, 4,
                        (0xB16B00B5 ^ Math.imul(epoch * 31 + a * 7 + b, 0x9E3779B1)) >>> 0);
                    score[a] += s; score[b] += 1 - s;
                }
            }
            let best = -1;
            for (let i = 0; i < islands.length; i++) if (score[i] > best) { best = score[i]; challenger = islands[i]; }
        }

        let changed = false, verdict = 0;
        if (!global_.genome) {
            global_ = { genome: challenger.genome, gen, born: gen };
            changed = true;
        } else if (challenger) {
            verdict = referee.duel(challenger.genome, global_.genome, 12,
                (0x51ED5EED ^ Math.imul(epoch, 0x85EBCA6B)) >>> 0);
            if (verdict >= 0.58) {
                global_ = { genome: challenger.genome, gen, born: gen };
                changed = true;
            } else {
                global_ = { genome: global_.genome, gen, born: global_.born };
            }
        }

        // --- absolute yardsticks -------------------------------------------
        const seed = (0xFEEDFACE ^ Math.imul(epoch, 2654435761)) >>> 0;
        const bench = LADDER.map((rung, i) =>
            referee.scoreVsBot(global_.genome, rung, 20, (seed ^ Math.imul(i + 1, 0x2545F491)) >>> 0));
        const ladder = bench.reduce((s, v) => s + v, 0) / bench.length;
        const s0 = results[0].summary;
        const elapsed = (Date.now() - t0) / 1000;

        fs.writeFileSync(CHAMP_PATH, serializeGenome(global_.genome, {
            gen, born: global_.born, epoch,
            bench: bench.map(v => +v.toFixed(4)),
            rungs: LADDER.map(r => r.name),
            ladder: +ladder.toFixed(4), pop: POP, workers: WORKERS, seed: BASE_SEED
        }));
        fs.appendFileSync(LOG_PATH, [
            epoch, gen, elapsed.toFixed(1), ...bench.map(v => v.toFixed(4)),
            ladder.toFixed(4), s0.best.toFixed(1), s0.median.toFixed(1),
            s0.draws.toFixed(3), s0.mates.toFixed(3), s0.tier, s0.diversity.toFixed(3)
        ].join(",") + "\n");

        console.log(
            `epoch ${String(epoch).padStart(4)} | gen ${String(gen).padStart(5)} | ` +
            `${(elapsed / 60).toFixed(1)}m | ` +
            LADDER.map((r, i) => `${r.name} ${(bench[i] * 100).toFixed(0)}%`).join("  ") +
            ` | ladder ${(ladder * 100).toFixed(0)}% | tier ${s0.tier} | ` +
            `draws ${(s0.draws * 100).toFixed(0)}% | div ${s0.diversity.toFixed(2)}` +
            (changed ? (verdict ? `  <- new champion (duel ${(verdict * 100).toFixed(0)}%)`
                                : "  <- first champion") : ""));

        // --- migration ------------------------------------------------------
        await Promise.all(workers.map(w =>
            ask(w, { cmd: "seed", genome: Array.from(global_.genome), gen })));

        if (stopping || gen >= GENS || (UNTIL && Date.now() >= UNTIL)) break;
    }
    for (const w of workers) w.terminate();
    console.log(`\nchampion written to ${CHAMP_PATH}`);
})();
