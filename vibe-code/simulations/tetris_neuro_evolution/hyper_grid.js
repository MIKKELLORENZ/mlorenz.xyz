/* hyper_grid.js — take one good brain and ask how it should be polished.
 *
 *   node hyper_grid.js --seed training/best_holdout.json --hours 4 \
 *                      --workers 4 --pop 64 --gate 24
 *
 * Every cell of the grid starts from the *same* brain and differs only in how
 * the GA treats it: mutation strength, mutation rate, selection greed, whether
 * each genome adapts its own step size. That is a different question from the
 * architecture search — not "what shape of brain" but "what regime improves a
 * brain that is already good" — and the answer is not guessable, because the
 * right step size depends on how close to a local optimum the seed already is.
 *
 * Two rules make the comparison trustworthy:
 *
 *   · every run keeps the seed brain as champion until something beats it both
 *     in-run and on a held-out gate bank (`--grace -1 --gate N`), so no cell can
 *     "win" by losing the brain it was given and reporting a lucky replacement
 *   · the ranking at the end is on a *third* bank of games, used by neither the
 *     training seeds nor the gate
 *
 * Each cell is one train_headless.js process; the grid is sized so that
 * cells × workers stays under the thread cap.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}

const SEED = String(arg("seed", "training/best_holdout.json"));
const HOURS = +arg("hours", 4);
const WORKERS = +arg("workers", 4);
const POP = +arg("pop", 64);
const GATE = +arg("gate", 24);
const MAX_THREADS = +arg("max-threads", 64);
const NICE = String(arg("nice", "19"));
const OUT = path.join(__dirname, "training", "grid");
const NODE = process.execPath;
const DEADLINE = Date.now() + HOURS * 3600e3;

fs.mkdirSync(OUT, { recursive: true });

const seedPath = path.isAbsolute(SEED) ? SEED : path.join(__dirname, SEED);
if (!fs.existsSync(seedPath)) { console.error("no seed brain at " + SEED); process.exit(1); }
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const CONFIG = seed.configName || "nogrid";

/* ---- the grid ------------------------------------------------------------
 * The spine is mutation strength × mutation rate, which is the question asked:
 * 0.50 is a shove, 0.10 is a polish, 0.25 is what every run so far used. The
 * rest vary one thing each against the middle of that spine, so any effect can
 * be attributed. */
const SIGMAS = [0.50, 0.25, 0.10];
const RATES = [0.20, 0.12, 0.06];
const cells = [];
for (const s of SIGMAS) {
    for (const r of RATES) {
        cells.push({ name: `s${s}_r${r}`, flags: ["--mut-sigma", s, "--mut-rate", r] });
    }
}
cells.push({ name: "s0.05_r0.06_fine", flags: ["--mut-sigma", 0.05, "--mut-rate", 0.06] });
cells.push({ name: "s0.25_r0.12_noadapt", flags: ["--mut-sigma", 0.25, "--mut-rate", 0.12, "--no-selfadapt"] });
cells.push({ name: "s0.25_r0.12_greedy", flags: ["--mut-sigma", 0.25, "--mut-rate", 0.12, "--rank-exp", 3.2] });
cells.push({ name: "s0.25_r0.12_noanneal", flags: ["--mut-sigma", 0.25, "--mut-rate", 0.12, "--anneal-floor", 1] });
cells.push({ name: "s0.25_r0.12_noshake", flags: ["--mut-sigma", 0.25, "--mut-rate", 0.12, "--shake-after", 0] });
cells.push({ name: "s0.35_r0.16_hillclimb", flags: ["--mut-sigma", 0.35, "--mut-rate", 0.16, "--child-zero", 1] });

if (cells.length * WORKERS > MAX_THREADS) {
    console.error(`refusing to start: ${cells.length} cells × ${WORKERS} workers = ` +
        `${cells.length * WORKERS} threads, cap ${MAX_THREADS}`);
    process.exit(1);
}

const children = new Set();
function killAll() { for (const c of children) { try { c.kill(); } catch (e) { } } children.clear(); }
process.on("exit", killAll);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => { killAll(); process.exit(1); });
}

function log(msg) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    console.log(line);
    fs.appendFileSync(path.join(OUT, "grid.log"), line + "\n");
}

function run(script, args, logName) {
    return new Promise(resolve => {
        const fd = fs.openSync(path.join(OUT, logName), "a");
        const c = spawn("nice", ["-n", NICE, NODE, path.join(__dirname, script),
            "--tag", "tetris_grid", ...args.map(String)], {
            cwd: __dirname, stdio: ["ignore", fd, fd],
        });
        children.add(c);
        c.on("exit", code => { children.delete(c); try { fs.closeSync(fd); } catch (e) { } resolve(code); });
        c.on("error", err => { log(`spawn failed: ${err.message}`); resolve(-1); });
    });
}

(async () => {
    log(`grid: ${cells.length} cells × ${WORKERS} workers from ${SEED} ` +
        `(${CONFIG}, gen ${seed.gen}), pop ${POP}, gate ${GATE} games, ` +
        `until ${new Date(DEADLINE).toISOString().slice(11, 16)} UTC`);
    fs.writeFileSync(path.join(OUT, "cells.json"), JSON.stringify(cells, null, 1));

    await Promise.all(cells.map(cell => run("train_headless.js", [
        "--config", CONFIG, "--resume", SEED, "--out", `training/grid/${cell.name}`,
        "--pop", POP, "--workers", WORKERS, "--gens", 10000000, "--until", DEADLINE,
        "--gate", GATE, "--grace", -1, "--seed", 31337, ...cell.flags,
    ], `${cell.name}.log`).then(code => log(`${cell.name} exited ${code}`))));

    // rank every survivor — plus the seed itself, which is the bar to beat
    const candidates = [SEED];
    for (const cell of cells) {
        for (const f of ["champion.json", "final.json"]) {
            const p = path.join(OUT, cell.name, f);
            if (fs.existsSync(p)) candidates.push(path.relative(__dirname, p));
        }
    }
    log(`ranking ${candidates.length} candidates (including the seed brain)`);
    await run("pick_best.js", ["--games", 100, "--out", "training/grid_best.json", ...candidates], "select.log");

    let best = null;
    try { best = JSON.parse(fs.readFileSync(path.join(__dirname, "training", "grid_best.json"), "utf8")).holdout; }
    catch (e) { log("could not read the winner: " + e.message); }
    fs.writeFileSync(path.join(OUT, "DONE.json"), JSON.stringify({ best, cells: cells.length }, null, 1));
    log(best ? `done — best ${best.file} skill ${best.skill.toFixed(1)} ` +
        `(${best.pieces.toFixed(1)} pieces, ${best.lines.toFixed(2)} lines)` : "done");
    killAll();
    process.exit(0);
})();
