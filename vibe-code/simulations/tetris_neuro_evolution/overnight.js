/* overnight.js — the unattended pipeline: search, then train the winner, then
 * bake it into the page and prove it still works.
 *
 *   node overnight.js --train-until <epoch-ms>
 *
 * Four stages, each with a wall-clock budget so the whole thing lands before the
 * deadline whatever happens:
 *
 *   1. broad search   every config in configs.js, short runs, several processes
 *                     side by side, ranked on held-out skill
 *   2. runoff         the best few again, longer, from a different GA seed — a
 *                     config that only won stage 1 on seed luck loses here
 *   3. long run       the winner, big population, until the deadline
 *   4. deliver        bake into default_brain.js, run the test suite, take a
 *                     headless screenshot of the page actually playing it
 *
 * Everything it starts, it kills; the exit handler is the only reason this is
 * safe to leave running unattended. status.json is rewritten at every step so
 * progress is legible without reading logs.
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

const OUT = path.join(__dirname, "training", "overnight");
fs.mkdirSync(OUT, { recursive: true });

const TRAIN_UNTIL = +arg("train-until", Date.now() + 6 * 3600e3);   // long run's hard stop
const S1_MIN = +arg("s1-min", 70);                                  // stage 1 budget, minutes
const S2_MIN = +arg("s2-min", 55);                                  // stage 2 budget
const GENS1 = +arg("gens1", 110);
const GENS2 = +arg("gens2", 260);
const POP = +arg("pop", 44);
const LONG_POP = +arg("long-pop", 64);
const PROCS = +arg("procs", 3);
const WORKERS = +arg("workers", 4);
const LONG_WORKERS = +arg("long-workers", 10);
const TOP = +arg("top", 5);
const NODE = process.execPath;

const CONFIG_NAMES = Object.keys(
    // read the registry without pulling in the whole simulation
    (() => {
        const src = fs.readFileSync(path.join(__dirname, "configs.js"), "utf8");
        const m = src.match(/const CONFIGS = \{[\s\S]*?\n\};/);
        const names = {};
        for (const line of m[0].split("\n")) {
            const mm = line.match(/^\s{4}([A-Za-z0-9_]+):/);
            if (mm) names[mm[1]] = true;
        }
        return names;
    })()
);

/* ---------------------------------------------------------------- plumbing */
const children = new Set();

function killAll() {
    for (const c of children) { try { c.kill(); } catch (e) { /* already gone */ } }
    children.clear();
}
process.on("exit", killAll);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(sig, () => { log(`caught ${sig} — shutting down`); killAll(); process.exit(1); });
}
process.on("uncaughtException", err => {
    log("FATAL " + (err && err.stack || err));
    killAll();
    status({ stage: "failed", error: String(err && err.message || err) });
    process.exit(1);
});

const logFile = path.join(OUT, "overnight.log");
function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logFile, line + "\n");
}
const state = { started: new Date().toISOString(), stage: "starting", trainUntil: new Date(TRAIN_UNTIL).toISOString() };
function status(patch) {
    Object.assign(state, patch, { updated: new Date().toISOString() });
    fs.writeFileSync(path.join(OUT, "status.json"), JSON.stringify(state, null, 1));
}

function run(script, args, logName) {
    return new Promise((resolve) => {
        const out = fs.openSync(path.join(OUT, logName), "a");
        const c = spawn(NODE, [path.join(__dirname, script), ...args.map(String)], {
            cwd: __dirname, stdio: ["ignore", out, out],
        });
        children.add(c);
        c.on("exit", code => {
            children.delete(c);
            try { fs.closeSync(out); } catch (e) { /* fine */ }
            resolve(code);
        });
        c.on("error", err => { log(`spawn failed for ${script}: ${err.message}`); });
    });
}

/* Split a list of configs round-robin so each process gets a mix of cheap and
 * expensive ones — chunking in order would leave one process holding every big
 * network while the others idle. */
function shard(names, n) {
    const out = Array.from({ length: n }, () => []);
    names.forEach((x, i) => out[i % n].push(x));
    return out.filter(s => s.length);
}

function readRows(files) {
    const rows = [];
    for (const f of files) {
        if (!fs.existsSync(f)) continue;
        try { rows.push(...JSON.parse(fs.readFileSync(f, "utf8"))); }
        catch (e) { log(`could not read ${path.basename(f)}: ${e.message}`); }
    }
    return rows;
}

function table(rows) {
    return rows.map((r, i) =>
        `  ${String(i + 1).padStart(2)}. ${r.name.padEnd(18)} skill ${r.skill.toFixed(1).padStart(6)}` +
        `  lines ${r.lines.toFixed(2)}  pieces ${r.pieces.toFixed(1)}` +
        `  ${String(r.inputs).padStart(3)} in / ${String(r.params).padStart(6)} params` +
        (r.halfSkill !== null && r.halfSkill !== undefined
            ? `  slope ${(r.skill - r.halfSkill >= 0 ? "+" : "") + (r.skill - r.halfSkill).toFixed(1)}` : "")
    ).join("\n");
}

/* ------------------------------------------------------------------ stages */
async function searchStage(tag, names, gens, budgetMin, seed) {
    const until = Date.now() + budgetMin * 60e3;
    const shards = shard(names, PROCS);
    log(`${tag}: ${names.length} configs in ${shards.length} processes × ${WORKERS} workers, ` +
        `${gens} gens, pop ${POP}, budget ${budgetMin} min`);
    const files = shards.map((_, i) => path.join(OUT, `${tag}_${i}.json`));
    await Promise.all(shards.map((s, i) => run("search.js", [
        "--only", s.join(","), "--gens", gens, "--pop", POP, "--workers", WORKERS,
        "--reps", 1, "--seed", seed, "--until", until,
        "--out", path.relative(__dirname, files[i]),
    ], `${tag}_${i}.log`)));
    const rows = readRows(files).sort((a, b) => b.skill - a.skill);
    fs.writeFileSync(path.join(OUT, `${tag}_ranked.json`), JSON.stringify(rows, null, 1));
    log(`${tag} results (ranked by held-out skill = pieces + 25 × lines):\n${table(rows)}`);
    return rows;
}

(async () => {
    log(`overnight run — long training stops at ${new Date(TRAIN_UNTIL).toLocaleString()}`);
    status({ stage: "search", configs: CONFIG_NAMES.length });

    // ---- stage 1: everything, briefly
    const r1 = await searchStage("stage1", CONFIG_NAMES, GENS1, S1_MIN, 9000);
    if (!r1.length) throw new Error("stage 1 produced no results");
    status({ stage: "runoff", stage1: r1.map(r => ({ name: r.name, skill: r.skill })) });

    // ---- stage 2: the shortlist, longer, different seed
    // A 110-generation win can be one lucky lineage. The runoff re-runs the
    // finalists from a different GA seed for more than twice as long, and only a
    // config that wins both is trusted with the night.
    const short = r1.slice(0, Math.min(TOP, r1.length)).map(r => r.name);
    const r2 = await searchStage("stage2", short, GENS2, S2_MIN, 4400);
    const ranked = (r2.length ? r2 : r1);
    status({ stage: "long", stage2: ranked.map(r => ({ name: r.name, skill: r.skill })) });

    // ---- pick the winner: best stage-2 skill, with stage-1 skill as tie-break
    const s1by = new Map(r1.map(r => [r.name, r.skill]));
    ranked.sort((a, b) => (b.skill - a.skill) || ((s1by.get(b.name) || 0) - (s1by.get(a.name) || 0)));
    const winner = ranked[0];
    log(`winner: ${winner.name} — ${winner.contract}, ${winner.inputs} inputs, ` +
        `${winner.params} params, held-out skill ${winner.skill.toFixed(1)}`);
    fs.writeFileSync(path.join(OUT, "winner.json"), JSON.stringify(winner, null, 1));

    /* ---- stage 3: two long runs, not one.
     *
     * The last overnight run on this project flatlined after ~150 generations and
     * spent 2,800 more going nowhere. Betting every remaining hour on one config
     * repeats that risk for no reason: the machine has cores for two, the runner-up
     * is a genuinely different encoding, and stage 4 bakes whichever brain
     * validates better. Hedging costs each run some cores; a wasted night costs
     * everything. */
    const runners = ranked.slice(0, 2);
    const shares = runners.length > 1
        ? [Math.ceil(LONG_WORKERS * 0.55), Math.max(2, LONG_WORKERS - Math.ceil(LONG_WORKERS * 0.55))]
        : [LONG_WORKERS];
    const minutes = Math.max(0, (TRAIN_UNTIL - Date.now()) / 60e3);
    log(`long runs: ${runners.map((r, i) => `${r.name} (${shares[i]} workers)`).join(" + ")} — ` +
        `${minutes.toFixed(0)} min until the deadline`);
    status({
        stage: "long", winner: winner.name,
        longRuns: runners.map(r => r.name), longMinutes: Math.round(minutes),
    });

    const longDirs = [];
    await Promise.all(runners.map((r, i) => {
        // Each long run starts from its own runoff champion rather than from
        // scratch: those generations are already paid for and the config matches.
        const seedBrain = path.join(OUT, `seed_${r.name}.json`);
        fs.writeFileSync(seedBrain, JSON.stringify({
            gen: r.champion.gen, fitness: r.champion.fitness,
            configName: r.name, config: null, net: r.champion.net,
        }));
        const dir = path.join(OUT, "long_" + r.name);
        longDirs.push(dir);
        return run("train_headless.js", [
            "--config", r.name, "--pop", LONG_POP, "--workers", shares[i],
            "--gens", 1000000, "--until", TRAIN_UNTIL,
            "--resume", path.relative(__dirname, seedBrain),
            "--out", path.relative(__dirname, dir), "--seed", 77 + i * 13,
        ], `long_${r.name}.log`).then(code => log(`long run ${r.name} exited with code ${code}`));
    }));

    // ---- stage 4: bake, validate, screenshot
    status({ stage: "deliver" });
    const cand = [];
    for (const dir of longDirs) {
        for (const f of ["final.json", "champion.json"]) {
            const p = path.join(dir, f);
            if (fs.existsSync(p)) cand.push(p);
        }
    }
    if (!cand.length) throw new Error("the long runs left no champion to bake");

    // Bake whichever of the two scores better on the held-out bank — final.json
    // is the last champion the run held, champion.json the best training score it
    // ever saw, and those are not always the same brain.
    const label = f => `${path.basename(path.dirname(f))}/${path.basename(f)}`;
    let best = null;
    for (const f of cand) {
        const bakeCode = await run("bake_brain.js", [path.relative(__dirname, f)], "bake.log");
        if (bakeCode !== 0) { log(`bake refused ${label(f)}`); continue; }
        const baked = fs.readFileSync(path.join(__dirname, "default_brain.js"), "utf8");
        const m = baked.match(/^ \*\s+evolved\s+([\d.]+)\s+([\d.]+)/m);
        const skill = m ? +m[1] + 25 * +m[2] : 0;
        log(`candidate ${label(f)} → held-out ${m ? m[1] + " pieces / " + m[2] + " lines" : "?"} ` +
            `(skill ${skill.toFixed(1)})`);
        if (!best || skill > best.skill) best = { file: f, skill };
    }
    if (!best) throw new Error("nothing could be baked");
    // Always re-bake the winner last, even if it was also the last one tried:
    // default_brain.js currently holds whichever candidate the loop happened to
    // finish on, and that is not necessarily the best one.
    await run("bake_brain.js", [path.relative(__dirname, best.file)], "bake.log");
    log(`final bake: ${label(best.file)} (held-out skill ${best.skill.toFixed(1)})`);

    const testCode = await run("test_headless.js", [], "tests.log");
    log(`test suite exited with code ${testCode}`);

    // Proof it plays in the browser, not just in Node: load the page straight
    // into showcase mode, run a few thousand ticks synchronously, screenshot.
    const chrome = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ].find(p => fs.existsSync(p));
    let shot = null;
    if (chrome) {
        shot = path.join(OUT, "gui_check.png");
        await new Promise(resolve => {
            const c = spawn(chrome, [
                "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--window-size=1400,900", "--virtual-time-budget=20000",
                `--screenshot=${shot}`,
                "file:///" + path.join(__dirname, "index.html").replace(/\\/g, "/") + "?bench=4000#watch",
            ], { stdio: "ignore" });
            children.add(c);
            c.on("exit", () => { children.delete(c); resolve(); });
            c.on("error", () => resolve());
        });
        log(`gui screenshot: ${fs.existsSync(shot) ? "written" : "FAILED"}`);
    }

    status({
        stage: "done", winner: winner.name, bakedFrom: label(best.file),
        heldOutSkill: best.skill, testsPassed: testCode === 0,
        screenshot: shot && fs.existsSync(shot) ? shot : null,
    });
    fs.writeFileSync(path.join(OUT, "DONE.json"), JSON.stringify(state, null, 1));
    log("done — nothing left running");
    killAll();
    process.exit(0);
})();
