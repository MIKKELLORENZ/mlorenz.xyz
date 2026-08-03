/* node_pipeline.js — search *and* train, unattended, on the compute node.
 *
 *   node node_pipeline.js --hours 6 --configs a,b,c --procs 6 --workers 8 --long 3
 *
 * Three stages, one thread budget:
 *
 *   1. search    every named config, long enough to be a real comparison rather
 *                than a sniff test (default 400 generations × 2 reps), sharded
 *                across processes and ranked on held-out skill
 *   2. train     the best few carry straight on from their own search champion
 *                until the wall-clock deadline — no generations are thrown away
 *   3. select    every candidate brain replayed on a fresh 80-game bank; the
 *                winner is written to training/best_holdout.json
 *
 * The point of stages 1 and 2 being one program is that the search *is* training:
 * the winner resumes from the weights the comparison produced.
 *
 * Thread budget: procs × workers during stage 1, long × longWorkers during
 * stage 2, and it refuses to start if either exceeds --max-threads (default 64)
 * because this box is shared with another agent's run.
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

const OUT = path.join(__dirname, "training", "pipeline");
fs.mkdirSync(OUT, { recursive: true });

const HOURS = +arg("hours", 6);
const GENS1 = +arg("gens1", 400);
const REPS1 = +arg("reps1", 2);
const POP = +arg("pop", 48);
const LONG_POP = +arg("long-pop", 96);
const PROCS = +arg("procs", 6);
const WORKERS = +arg("workers", 8);
const LONG = +arg("long", 3);
const LONG_WORKERS = +arg("long-workers", 16);
const MAX_THREADS = +arg("max-threads", 64);
const NICE = arg("nice", "19");
const CONFIG_LIST = String(arg("configs", "")).split(",").filter(Boolean);
// NB: not `CONFIGS` — that name belongs to the registry configs.js defines, and
// shadowing it here made CONFIG_DEFS below silently resolve to this array.
const NODE = process.execPath;
/* the config registry, read the same way search.js reads it, so a seed file can
 * carry the full config and not just its name */
const CONFIG_DEFS = (() => {
    try {
        const vm = require("vm");
        for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "configs.js"]) {
            vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
        }
        return typeof CONFIGS !== "undefined" ? CONFIGS : {};
    } catch (e) { return {}; }
})();
const DEADLINE = Date.now() + HOURS * 3600e3;

if (!CONFIG_LIST.length) { console.error("--configs is required"); process.exit(1); }
for (const [what, n] of [["search", PROCS * WORKERS], ["training", LONG * LONG_WORKERS]]) {
    if (n > MAX_THREADS) {
        console.error(`refusing to start: ${what} would use ${n} worker threads, cap is ${MAX_THREADS}`);
        process.exit(1);
    }
}

const children = new Set();
function killAll() { for (const c of children) { try { c.kill(); } catch (e) { } } children.clear(); }
process.on("exit", killAll);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => { log(`caught ${sig}`); killAll(); process.exit(1); });
}
process.on("uncaughtException", err => {
    log("FATAL " + (err && err.stack || err)); killAll();
    status({ stage: "failed", error: String(err && err.message || err) });
    process.exit(1);
});

function log(msg) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    console.log(line);
    fs.appendFileSync(path.join(OUT, "pipeline.log"), line + "\n");
}
const state = { started: new Date().toISOString(), deadline: new Date(DEADLINE).toISOString() };
function status(patch) {
    Object.assign(state, patch, { updated: new Date().toISOString() });
    fs.writeFileSync(path.join(OUT, "status.json"), JSON.stringify(state, null, 1));
}

/* Everything is launched with `nice` and a --tag so that (a) the neighbour's run
 * always wins CPU contention and (b) nothing of theirs can ever match a pattern
 * used to find mine. */
function run(script, args, logName) {
    return new Promise(resolve => {
        const fd = fs.openSync(path.join(OUT, logName), "a");
        const c = spawn("nice", ["-n", NICE, NODE, path.join(__dirname, script),
            "--tag", "tetris_ne", ...args.map(String)], {
            cwd: __dirname, stdio: ["ignore", fd, fd],
        });
        children.add(c);
        c.on("exit", code => {
            children.delete(c);
            try { fs.closeSync(fd); } catch (e) { }
            resolve(code);
        });
        c.on("error", err => { log(`spawn failed ${script}: ${err.message}`); resolve(-1); });
    });
}

function shard(names, n) {
    const out = Array.from({ length: n }, () => []);
    names.forEach((x, i) => out[i % n].push(x));
    return out.filter(s => s.length);
}

(async () => {
    log(`pipeline: ${CONFIG_LIST.length} configs, ${GENS1} gens × ${REPS1} reps, ` +
        `then ${LONG} long runs until ${new Date(DEADLINE).toISOString().slice(11, 16)} UTC`);
    log(`threads: search ${PROCS}×${WORKERS}=${PROCS * WORKERS}, ` +
        `training ${LONG}×${LONG_WORKERS}=${LONG * LONG_WORKERS}, cap ${MAX_THREADS}`);
    status({ stage: "search", configs: CONFIG_LIST });

    // ---- stage 1: the comparison, at a budget where the ranking means something
    const shards = shard(CONFIG_LIST, PROCS);
    const files = shards.map((_, i) => `training/pipeline/search_${i}.json`);
    await Promise.all(shards.map((s, i) => run("search.js", [
        "--only", s.join(","), "--gens", GENS1, "--reps", REPS1, "--pop", POP,
        "--workers", WORKERS, "--seed", 5150, "--out", files[i],
    ], `search_${i}.log`)));

    const rows = [];
    for (const f of files) {
        const p = path.join(__dirname, f);
        if (!fs.existsSync(p)) continue;
        try { rows.push(...JSON.parse(fs.readFileSync(p, "utf8"))); }
        catch (e) { log(`unreadable ${f}: ${e.message}`); }
    }
    if (!rows.length) throw new Error("the search produced no results");
    rows.sort((a, b) => b.skill - a.skill);
    fs.writeFileSync(path.join(OUT, "search_ranked.json"), JSON.stringify(rows, null, 1));
    log("search results:\n" + rows.map((r, i) =>
        `  ${String(i + 1).padStart(2)}. ${r.name.padEnd(24)} skill ${r.skill.toFixed(1).padStart(6)}` +
        `  lines ${r.lines.toFixed(2)}  pieces ${r.pieces.toFixed(1)}  ${r.contract}`).join("\n"));
    status({ stage: "train", ranked: rows.map(r => ({ name: r.name, skill: r.skill })) });

    // ---- stage 2: the winners keep the generations they already earned
    const winners = rows.slice(0, Math.min(LONG, rows.length));
    const minutes = Math.max(0, (DEADLINE - Date.now()) / 60e3);
    log(`training ${winners.map(w => w.name).join(", ")} for ${minutes.toFixed(0)} min`);
    const dirs = [];
    await Promise.all(winners.map(w => {
        const seed = path.join(OUT, `seed_${w.name}.json`);
        fs.writeFileSync(seed, JSON.stringify({
            gen: w.champion.gen, fitness: w.champion.fitness,
            // the config must travel with the brain, or pick_best.js cannot tell
            // what encoding these weights expect and drops the candidate
            configName: w.name, config: CONFIG_DEFS[w.name] || null, net: w.champion.net,
        }));
        const dir = `training/pipeline/long_${w.name}`;
        dirs.push(dir);
        return run("train_headless.js", [
            "--config", w.name, "--pop", LONG_POP, "--workers", LONG_WORKERS,
            "--gens", 10000000, "--until", DEADLINE, "--seed", 8080,
            "--resume", path.relative(__dirname, seed), "--out", dir,
        ], `long_${w.name}.log`).then(code => log(`long run ${w.name} exited ${code}`));
    }));

    // ---- stage 3: pick the winner on a bank nothing trained or ranked on
    const candidates = [];
    for (const d of dirs) {
        for (const f of ["final.json", "champion.json"]) {
            if (fs.existsSync(path.join(__dirname, d, f))) candidates.push(path.join(d, f));
        }
    }
    // the search champions are candidates too — a long run can end up worse than
    // the brain it started from, and there is no reason to ship the worse one
    for (const w of winners) candidates.push(path.relative(__dirname, path.join(OUT, `seed_${w.name}.json`)));
    log(`selecting among ${candidates.length} candidates`);
    status({ stage: "select", candidates });
    const code = await run("pick_best.js", ["--out", "training/best_holdout.json", ...candidates], "select.log");
    log(`selection exited ${code}`);

    let best = null;
    try { best = JSON.parse(fs.readFileSync(path.join(__dirname, "training", "best_holdout.json"), "utf8")).holdout; }
    catch (e) { log("could not read the winner: " + e.message); }
    status({ stage: "done", best });
    fs.writeFileSync(path.join(OUT, "DONE.json"), JSON.stringify(state, null, 1));
    log(best ? `done — best ${best.configName} gen ${best.gen}, skill ${best.skill.toFixed(1)} ` +
        `(${best.pieces.toFixed(1)} pieces, ${best.lines.toFixed(2)} lines)` : "done");
    killAll();
    process.exit(0);
})();
