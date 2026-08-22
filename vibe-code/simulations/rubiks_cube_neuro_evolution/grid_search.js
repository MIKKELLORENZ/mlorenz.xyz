/* grid_search.js — screen a grid, then confirm the leader properly.
 *
 *   node grid_search.js reward --gens 120 --seeds 1
 *   node grid_search.js arch --gens 120 --seeds 1 --confirm 3 --confirm-seeds 2
 *   node grid_search.js temporal --gens 100
 *   node grid_search.js rw-mixed,rw-descent,rw-stickers --gens 200
 *
 * Each cell is a real training run: this spawns train_headless.js as a child
 * process rather than reimplementing the loop, so a cell cannot differ from the
 * production trainer in any way. Champions land in training/grid/<cell>/ and are
 * then all scored by evaluate.js on the *same* held-out scrambles.
 *
 * ─── two stages, and why the second one is not optional ────────────────────
 *
 * Stage 1 screens every cell cheaply. Stage 2 re-runs the top few on fresh seeds
 * and reports the paired difference with its standard error.
 *
 * The reason is the winner's curse, and this project has paid for it in cash. A
 * grid of 12 cells run once each is 12 draws from a noisy distribution, and the
 * maximum of 12 noisy draws is biased upward by roughly the noise itself — so the
 * leader is, in expectation, partly lucky. The rocket-catch project measured bank
 * noise of 1.17 sd against breeding operators worth a tenth of that, and the
 * Tetris project killed three "improvements" in one day that were all stage-1
 * winners. Stage 1 tells you which cells are worth measuring. It does not tell you
 * which one is best.
 *
 * Stage 1 is therefore reported as a *shortlist*, never as a result, and the
 * output says so.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { load } = require("./load.js");
load();

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const num = (n, d) => { const v = arg(n, null); return v === null ? d : +v; };

const which = process.argv[2] || "reward";
const CELLS = GRIDS[which] ? GRIDS[which].slice() : String(which).split(",");
for (const c of CELLS) if (!CONFIGS[c]) { console.error(`unknown config "${c}"`); process.exit(1); }

/* Equal wall-clock per cell instead of equal generations.
 *
 * Equal generations is the cleaner comparison of *algorithms*, and it is what the
 * round-1 grids used. It is the wrong yardstick as soon as cells differ in what a
 * generation costs: a curriculum that trains at depth 7 runs episodes three times
 * as long as one capped at depth 2, and `pop 32 × 128 episodes` costs the same as
 * `pop 96 × 32` only by accident. Ranking those by score-after-N-generations
 * silently rewards whichever cell bought its generations cheapest.
 *
 * Since the question tonight is "what is the best brain obtainable by morning",
 * the budget every cell is actually competing for is time. `--minutes` gives each
 * cell the same slice of it, computed at spawn so that cells queued behind others
 * are not shortchanged. */
const MINUTES = num("minutes", 0);
/* Whichever limit is given binds. The generation cap has to step aside when a time
 * budget is set, or it silently wins: at the 120-generation default the first
 * attempt at this grid stopped every cell early, and — worse than merely being
 * short — it stopped them at *equal generations*, handing the expensive
 * deep-curriculum cells 50% more wall-clock than the cheap ones. That is the exact
 * comparison --minutes exists to prevent, and the log looked completely normal. */
const GENS = num("gens", MINUTES ? 1e9 : 120);
const SCREEN = num("screen", 0);
const FINALISTS = num("finalists", 0);
const SEEDS = num("seeds", 1);
const SEED_BASE = num("seed-base", 1234);
const CONFIRM = num("confirm", 3);
const CONFIRM_SEEDS = num("confirm-seeds", 2);
const POP = num("pop", 0);
const EPISODES = num("episodes", 0);
/* Worker count per cell, and how many cells run at once.
 *
 * Running cells concurrently is strictly better than giving one cell the whole
 * machine. A generation ends in a barrier — every worker has to finish its slice
 * of the population before breeding can start — so a single cell on N workers
 * leaves them idle at the end of every generation, and the tail gets worse as N
 * grows. Three cells on three workers each keeps nine cores busy far more of the
 * time than one cell on nine.
 *
 * It is only safe because worker count cannot change a result. `evaluate` splits
 * the population by brain and concatenates in population order; `evaluateOne`
 * splits a bank by episode and takes a count-weighted mean, which is exactly the
 * single-threaded number. The GA's own generator is untouched by either. So a cell
 * run on two workers and the same cell run on eight produce identical champions,
 * and cells in the same grid stay comparable however they were scheduled. */
const WORKERS = num("workers", Math.max(2, Math.min(6, os.cpus().length - 2)));
const PARALLEL = Math.max(1, num("parallel", 1));
const EVAL_GAMES = num("eval-games", 120);
const EVAL_DEPTHS = String(arg("eval-depths", "1,2,3,4,5")).split(",").map(Number);
const OUTDIR = path.join(__dirname, "training", "grid", which.replace(/[^\w.-]/g, "_"));
fs.mkdirSync(OUTDIR, { recursive: true });

/* The reference Env only exists to build scrambles and to hold the oracle: every
 * cell's brain is then run inside its *own* Env, because the observation layout
 * is exactly what several of these cells are varying. A scramble is a cube, a
 * distance and a budget — none of that depends on how a brain sees. */
const refEnv = new Env(resolveConfig("default").env);
const banks = makeEvalBanks(refEnv, EVAL_DEPTHS, EVAL_GAMES);
const totalEpisodes = banks.reduce((s, b) => s + b.scrambles.length, 0);

function runCell(cell, seed) {
    const out = path.join(OUTDIR, `${cell}_s${seed}`);
    /* Reuse is keyed on final.json, not champion.json.
     *
     * champion.json is rewritten every time the champion improves, so a cell that
     * was interrupted at generation 30 of 180 leaves one behind and it looks exactly
     * like a finished cell. Reusing that would silently put a third-trained brain in
     * the table next to fully trained ones and rank the grid on how far each cell
     * happened to get. final.json is only written when the generation loop exits,
     * which makes it the completion marker. */
    if (fs.existsSync(path.join(out, "final.json")) && !arg("force", false)) {
        return Promise.resolve({ cell, seed, out, reused: true });
    }
    /* A leftover partial run would otherwise be resumed-from-nothing and its stale
     * log.csv appended to, so clear the directory before restarting the cell. */
    if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
    const args = ["train_headless.js", "--config", cell, "--gens", String(GENS),
        "--seed", String(seed), "--workers", String(WORKERS), "--out", path.relative(__dirname, out)];
    if (POP) args.push("--pop", String(POP));
    if (EPISODES) args.push("--episodes", String(EPISODES));
    if (SCREEN) args.push("--screen", String(SCREEN), "--finalists", String(FINALISTS || 8));
    /* Computed here, not once at startup: with --parallel P the later cells do not
     * begin until a slot frees, and a shared absolute deadline would give the last
     * batch a few seconds while the first got the full slice. */
    if (MINUTES) args.push("--until", String(Date.now() + MINUTES * 60000));
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const p = spawn(process.execPath, args, { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] });
        let tail = "";
        p.stdout.on("data", d => { tail = (tail + d).slice(-4000); });
        p.stderr.on("data", d => { tail = (tail + d).slice(-4000); });
        p.on("close", code => {
            if (code !== 0) return reject(new Error(`${cell} seed ${seed} exited ${code}\n${tail}`));
            resolve({ cell, seed, out, secs: (Date.now() - t0) / 1000, tail });
        });
    });
}

/* Score a finished cell on the common bank. The brain is rebuilt from its own
 * saved config, which is the only safe way: a champion is a set of weights
 * against one exact input layout. */
function scoreCell(out) {
    const saved = JSON.parse(fs.readFileSync(path.join(out, "champion.json"), "utf8"));
    const cfg = resolveConfig(saved.config);
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
    const net = netFromJSON(saved);
    if (net.contract() !== env.contractInfo(cfg.arch).contract) {
        throw new Error(`contract mismatch in ${out}: brain ${net.contract()}`);
    }
    /* Cells that change the action space cannot share the reference bank — a cube
     * scrambled with only U/D/L/R is a different puzzle from one scrambled with
     * six faces, and mixing them would compare a solver against someone else's
     * scrambles. Those cells get their own bank and are flagged. */
    const ownBank = cfg.env.moves !== refEnv.cfg.moves;
    const useBanks = ownBank ? makeEvalBanks(env, EVAL_DEPTHS, EVAL_GAMES) : banks;
    const r = evaluateBrain(env, net, useBanks);
    const info = env.contractInfo(cfg.arch);
    return Object.assign(r, {
        gen: saved.gen, frontier: saved.depth, params: info.params,
        contract: info.contract, inputs: info.inputs, ownBank,
        reward: cfg.env.reward, config: saved.config,
    });
}

const pct = x => (x * 100).toFixed(0).padStart(3) + "%";

/* Run a list of {cell, seed} jobs, at most PARALLEL at a time, scoring each as it
 * finishes. Output is written on completion rather than on start, because with
 * several cells in flight an interleaved "running… / score" pairing would be
 * unreadable. Order of the returned array follows completion, which does not matter
 * — everything downstream sorts. */
async function runJobs(jobs) {
    const done = [];
    let next = 0, started = 0;
    const total = jobs.length;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= jobs.length) return;
            const { cell, seed } = jobs[i];
            const n = ++started;
            try {
                const res = await runCell(cell, seed);
                const sc = scoreCell(res.out);
                done.push(Object.assign(sc, { cell, seed }));
                console.log(`  [${String(n).padStart(2)}/${total}] ${cell} s${seed}  ` +
                    `score ${sc.score.toFixed(3)}  solve ${pct(sc.solveRate).trim()}  ` +
                    `frontier d${sc.frontier}${res.reused ? "  (reused)" : `  ${res.secs.toFixed(0)}s`}`);
            } catch (e) {
                console.log(`  [${String(n).padStart(2)}/${total}] ${cell} s${seed}  ` +
                    `FAILED — ${e.message.split("\n")[0]}`);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
    return done;
}

function table(rows, title, note) {
    const depths = banks.map(b => b.depth);
    console.log(`\n${title}`);
    console.log("─".repeat(112));
    console.log("  cell".padEnd(22) + "score".padStart(7) + "  d@50%".padStart(7) +
        "  solve".padStart(7) + " descent".padStart(8) + " frontier".padStart(9) +
        "  params".padStart(8) + "   " + depths.map(d => ("d" + d).padStart(5)).join(""));
    console.log("─".repeat(112));
    for (const r of rows) {
        const per = depths.map(d => {
            const e = r.byDepth.find(x => x.depth === d);
            return (e ? pct(e.solveRate).trim() : "—").padStart(5);
        }).join("");
        console.log("  " + (r.cell + (r.ownBank ? "*" : "")).padEnd(20) +
            r.score.toFixed(3).padStart(7) + String(r.depthAt50).padStart(7) +
            pct(r.solveRate).padStart(7) + r.descent.toFixed(3).padStart(8) +
            String(r.frontier).padStart(9) + r.params.toLocaleString("en-US").padStart(8) +
            "   " + per);
    }
    console.log("─".repeat(112));
    if (rows.some(r => r.ownBank)) console.log("  * scored on its own scrambles (different action space) — not directly comparable");
    if (note) console.log(note);
}

(async () => {
    console.log(`grid "${which}": ${CELLS.length} cells × ${SEEDS} seed(s) × ` +
        (MINUTES ? `${MINUTES} min` : `${GENS} generations`) + `, ` +
        `${WORKERS} workers per cell, ${PARALLEL} cells at a time`);
    console.log(`evaluated on ${totalEpisodes} held-out scrambles (depths ${banks.map(b => b.depth).join(",")}, ` +
        `${EVAL_GAMES} each), identical for every cell`);

    // ---- untrained control, so every number below has something to be better than
    const ctrl = controlScore(refEnv, resolveConfig("default").arch, banks, 8);
    console.log(`untrained control: score ${ctrl.score.toFixed(3)}, ` +
        `solve ${pct(ctrl.solveRate).trim()}, descent ${ctrl.descent.toFixed(3)}\n`);

    // ---- stage 1: screen
    /* The seed base is settable so a later grid can *replicate* an earlier cell
     * rather than recompute it. A run is deterministic in its seed, so re-listing a
     * winning config under a new name at the same seed reproduces the same champion
     * exactly — which looks like a confirmation and is not one. Confirming a leader
     * means running it again somewhere else in seed space. */
    const jobs = [];
    for (const cell of CELLS) {
        for (let s = 0; s < SEEDS; s++) jobs.push({ cell, seed: SEED_BASE + s * 977 });
    }
    const stage1 = await runJobs(jobs);
    if (!stage1.length) { console.log("nothing completed"); return; }

    /* Average the seeds per cell before ranking. */
    const byCell = new Map();
    for (const r of stage1) {
        if (!byCell.has(r.cell)) byCell.set(r.cell, []);
        byCell.get(r.cell).push(r);
    }
    const merged = [...byCell.entries()].map(([cell, rs]) => {
        const m = Object.assign({}, rs[0], { cell, seeds: rs.length });
        m.score = rs.reduce((s, r) => s + r.score, 0) / rs.length;
        m.solveRate = rs.reduce((s, r) => s + r.solveRate, 0) / rs.length;
        m.descent = rs.reduce((s, r) => s + r.descent, 0) / rs.length;
        m.frontier = Math.max(...rs.map(r => r.frontier));
        m.byDepth = rs[0].byDepth.map((_, j) => ({
            depth: rs[0].byDepth[j].depth,
            solveRate: rs.reduce((s, r) => s + r.byDepth[j].solveRate, 0) / rs.length,
            descent: rs.reduce((s, r) => s + r.byDepth[j].descent, 0) / rs.length,
        }));
        m.depthAt50 = m.byDepth.reduce((b, r) => (r.solveRate >= 0.5 ? r.depth : b), 0);
        m.runs = rs;
        return m;
    }).sort((a, b) => b.score - a.score);

    table(merged, `STAGE 1 — shortlist, not a result (${GENS} generations, ${SEEDS} seed(s) each)`,
        "  Ranking a grid on one run each is a maximum over noisy draws and is biased upward.\n" +
        "  Read this as 'which cells deserve measuring', and take the verdict from stage 2.");

    fs.writeFileSync(path.join(OUTDIR, "stage1.json"), JSON.stringify(merged, null, 1));

    // ---- stage 2: confirm the shortlist on fresh seeds
    const short = merged.slice(0, Math.max(2, Math.min(CONFIRM, merged.length)));
    if (CONFIRM_SEEDS <= 0 || short.length < 2) {
        console.log("\n(stage 2 skipped)");
        return;
    }
    console.log(`\nSTAGE 2 — re-running the top ${short.length} on ${CONFIRM_SEEDS} fresh seed(s) each`);
    const confirmJobs = [];
    for (const cand of short) {
        for (let s = 0; s < CONFIRM_SEEDS; s++) confirmJobs.push({ cell: cand.cell, seed: 60013 + s * 7919 });
    }
    const extra = await runJobs(confirmJobs);
    const stage2 = [];
    for (const cand of short) {
        const runs = cand.runs.concat(extra.filter(r => r.cell === cand.cell));
        const scores = runs.map(r => r.score);
        const n = scores.length;
        const mean = scores.reduce((a, b) => a + b, 0) / n;
        const sd = n > 1
            ? Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
        stage2.push({
            cell: cand.cell, n, mean, sd, se: n > 1 ? sd / Math.sqrt(n) : 0,
            best: Math.max(...scores), scores, runs,
        });
    }
    stage2.sort((a, b) => b.mean - a.mean);

    console.log("\n" + "─".repeat(80));
    console.log("  cell".padEnd(22) + "runs".padStart(6) + "  mean score ± SE".padStart(20) +
        "   sd".padStart(8) + "  best".padStart(8));
    console.log("─".repeat(80));
    for (const r of stage2) {
        console.log("  " + r.cell.padEnd(20) + String(r.n).padStart(6) +
            `   ${r.mean.toFixed(3)} ± ${r.se.toFixed(3)}`.padStart(20) +
            r.sd.toFixed(3).padStart(8) + r.best.toFixed(3).padStart(8));
    }
    console.log("─".repeat(80));

    /* The honest verdict. Two cells whose intervals overlap have not been
     * separated by this experiment, and saying so is more useful than naming a
     * winner that the next seed would overturn. */
    const [a, b] = stage2;
    if (b) {
        const sep = (a.mean - b.mean) / Math.max(1e-9, Math.hypot(a.se, b.se));
        console.log(`\nverdict: ${a.cell} leads ${b.cell} by ${(a.mean - b.mean).toFixed(3)} ` +
            `(${sep.toFixed(1)} combined SE).`);
        if (sep < 2) {
            console.log(`  That is inside the noise. This grid has NOT separated them — ` +
                `both are reasonable, and picking one is a coin toss dressed as a result.`);
        } else {
            console.log(`  Separated. ${a.cell} is the pick.`);
        }
    }
    /* Paired head-to-head between the top two champions, when they share an
     * observation layout so the same brain-shaped comparison is meaningful. */
    try {
        const A = a.runs.slice().sort((x, y) => y.score - x.score)[0];
        const B = b && b.runs.slice().sort((x, y) => y.score - x.score)[0];
        if (B && A.contract === B.contract && !A.ownBank && !B.ownBank) {
            const envA = new Env(Object.assign({}, resolveConfig(A.config).env, { forceOracle: true }));
            const netA = netFromJSON(JSON.parse(fs.readFileSync(
                path.join(OUTDIR, `${A.cell}_s${A.seed}`, "champion.json"), "utf8")));
            const netB = netFromJSON(JSON.parse(fs.readFileSync(
                path.join(OUTDIR, `${B.cell}_s${B.seed}`, "champion.json"), "utf8")));
            const pd = pairedDelta(envA, netA, netB, banks);
            console.log(`  best-of-each, paired on the same ${pd.n} scrambles: ` +
                `Δ = ${pd.delta.toFixed(3)} ± ${pd.se.toFixed(3)}`);
        }
    } catch (e) { /* the paired check is a bonus, not a requirement */ }

    fs.writeFileSync(path.join(OUTDIR, "stage2.json"), JSON.stringify(stage2, null, 1));
    console.log(`\nwritten to ${path.relative(__dirname, OUTDIR)}/{stage1,stage2}.json`);
})();
