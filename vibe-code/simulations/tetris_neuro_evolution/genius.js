/* genius.js — evolution, one level up.
 *
 *   node genius.js --cells 14 --keep 7 --spawn 7 --era 45 --workers 4 \
 *                  --seed training/best_holdout.json --seed-from training/grid
 *
 * The hyperparameter grid answered one question — "which mutation regime polishes
 * this brain best" — and then it was finished. But the answer to that question
 * changes as the brain improves: the step size that helps at 150 skill is not the
 * one that helps at 200, and no fixed grid can follow that. Worse, half the grid
 * spends its whole life running settings that were already known to be losing.
 *
 * So make the *experiment* evolve too. Every era (45 minutes by default):
 *
 *   1. judge    every live cell's champion, plus the reigning best-ever brain, on
 *               one shared bank of games none of them has ever seen. The bank is
 *               new every era, so nothing can be fitted to it.
 *   2. cull     the worst `spawn` cells are stopped. A cell that is one era old
 *               and climbing fast can buy one more era (see PROTECT below),
 *               because a brain that just had surgery deserves to be judged on
 *               its trajectory rather than on the scar.
 *   3. promote  if a cell's champion beat the best-ever brain, it is replayed on
 *               a second, larger bank against the incumbent. Only if it wins
 *               there too does it become the new best-ever. Nothing else can
 *               displace it, so the record can only move forward.
 *   4. spawn    `spawn` new cells, all seeded from the best-ever brain, each
 *               trying something that has never been tried: a different mutation
 *               regime, population size, island structure, fitness sharing — or a
 *               different *body*, transplanted weight-for-weight from the champion
 *               by net_surgery.js so nothing that was learned is thrown away.
 *
 * And once in a while — every `--deep-every` generations of progress, no sooner
 * than `--deep-gap` minutes apart — the opposite move: a **deep dive**. Six cells
 * is six bets running at a sixth of the box each. A dive suspends all of them and
 * hands the *whole* machine to the one that is currently winning, running its own
 * hyperparameters on its own champion for `--deep-min` minutes. Same compute,
 * spent deep on one lineage instead of wide across six. What comes back is judged
 * like any other challenger — fresh bank, then confirmation against the record —
 * so a dive can only ever add; if it finds nothing, the cells thaw and the era
 * carries on as though it had not happened.
 *
 * Which *kind* of thing to try next is itself learned. Each family of variants
 * keeps a record of how often its cells survived their first cull, and the next
 * family is drawn by Thompson sampling from those records — so the search spends
 * its slots on the knobs that have actually been paying, while never quite
 * abandoning the ones that have not.
 *
 * Still a GA and nothing but a GA: every weight in every brain here got where it
 * is by mutation, crossover and selection. The meta-loop only decides which GA
 * runs next, and the surgery only ever copies weights that a GA produced.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "configs.js", "net_surgery.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const BASE_R = Object.assign({}, R);

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}

const DIR = path.resolve(__dirname, String(arg("dir", "training/genius")));
const CELLS = +arg("cells", 6);
const SPAWN = +arg("spawn", 2);
const WORKERS = +arg("workers", 5);
const ERA_MIN = +arg("era", 45);
const GATE = +arg("gate", 24);
const GATE_ROTATE = +arg("gate-rotate", 8);   // promotions between gate-bank redraws
const JUDGE_GAMES = +arg("judge-games", 24);
const CONFIRM_GAMES = +arg("confirm-games", 60);
const FINALISTS = +arg("finalists", 8);            // cap on the opening play-off
const FINALIST_MARGIN = +arg("finalist-margin", 25);   // skill points behind the leader
const PROTECT = +arg("protect", 2);        // newborn climbers spared from the cull
/* A cell younger than this cannot be retired, however badly it is scoring. It
 * only binds on an era forced from the dashboard: on the normal schedule every
 * cell is a full era old by the time it is judged, but a forced cull two minutes
 * after a scheduled one would otherwise execute the cells that were just born,
 * before they had run a single generation of their own. */
const MIN_AGE = +arg("min-age", 8) * 60e3;
const MAX_THREADS = +arg("max-threads", 64);
/* Threads kept free for whatever else shares the box — here, the dashboard's
 * prober. A deep dive takes everything except these. */
const RESERVE = +arg("reserve", 2);
/* The deep dive. `--deep-every 0` turns it off entirely.
 *   deep-every  generations of progress by the furthest-along cell between dives
 *   deep-gap    minutes that must pass after one dive before another can start;
 *               a floor, because at ~20 generations a minute per cell the
 *               generation counter alone would fire far more often than a dive
 *               this expensive is worth
 *   deep-min    how long a dive runs
 */
const DEEP_EVERY = +arg("deep-every", 200);
const DEEP_GAP = +arg("deep-gap", 40) * 60e3;
const DEEP_MIN = +arg("deep-min", 15) * 60e3;
const DEEP_WORKERS = +arg("deep-workers", Math.max(1, MAX_THREADS - RESERVE));
const CAN_FREEZE = process.platform !== "win32";   // see freeze()/thaw() below
const HOURS = +arg("hours", 48);
const FINAL_GAMES = +arg("final-games", 100);
/* How long before the deadline to stop evolving and start deciding. The finale
 * judges every cell and then ranks the finalists on a large fresh bank, and that
 * has to *finish* before the trainers hit their own wall clock. */
const FINALE_LEAD = +arg("finale-lead", 8) * 60e3;
const NICE = String(arg("nice", "19"));
const SEED_FILE = String(arg("seed", "training/best_holdout.json"));
const SEED_FROM = arg("seed-from", null);
const NODE = process.execPath;
const DEADLINE = +arg("until", 0) || Date.now() + HOURS * 3600e3;

if (CELLS * WORKERS > MAX_THREADS) {
    console.error(`refusing to start: ${CELLS} cells × ${WORKERS} workers = ` +
        `${CELLS * WORKERS} threads, cap ${MAX_THREADS}`);
    process.exit(1);
}
if (SPAWN >= CELLS) { console.error("--spawn must be smaller than --cells"); process.exit(1); }
if (DEEP_EVERY > 0 && DEEP_WORKERS > MAX_THREADS) {
    console.error(`refusing to start: a deep dive would take ${DEEP_WORKERS} threads, cap ${MAX_THREADS}`);
    process.exit(1);
}

fs.mkdirSync(DIR, { recursive: true });
const LOG = path.join(DIR, "genius.log");
function log(msg) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG, line + "\n"); } catch (e) { }
}

/* ---------------------------------------------------------------- judging ---
 * Four banks are already spoken for: the per-generation training seeds, the
 * in-run gate (2200001+), the final selection in pick_best.js (1300001+) and the
 * dashboard prober (3300001+). These are two more, and unlike all of those, they
 * *move*: era n uses a bank no era before it has seen. A fixed bank judged
 * thousands of times would eventually be a training set with extra steps. */
function eraBank(era, n) {
    const b = [];
    for (let i = 0; i < n; i++) b.push(4400001 + era * 104729 + i * 7919);
    return b;
}
function confirmBank(era, n) {
    const b = [];
    for (let i = 0; i < n; i++) b.push(5500001 + era * 1299709 + i * 7919);
    return b;
}
/* Two more for the deep dive, on their own offsets so a dive never reuses a bank
 * an era decided on. `which` is 0 to pick which cell to dive on, 1 to judge what
 * came back, 2 to confirm it against the record. */
function diveBank(n, k, which) {
    const b = [];
    const base = [8800001, 8810001, 9900001][which];
    for (let i = 0; i < k; i++) b.push(base + n * 1000003 + i * 7919);
    return b;
}

function play(net, bank) {
    let pieces = 0, lines = 0, fitness = 0, buried = 0, placements = 0, best = 0;
    const m = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
    for (const s of bank) {
        const ag = new Agent(net, s, DEFAULT_CFG);
        let prev = 0;
        while (ag.alive) {
            const ev = ag.step(400);
            if (ev && ev.locked) {
                const bm = boardMetrics(ag.game.grid, m);
                buried += Math.max(0, bm.totalHoles - prev); prev = bm.totalHoles; placements++;
            }
        }
        pieces += ag.pieces; lines += ag.lines; fitness += ag.fitness;
        if (ag.lines > best) best = ag.lines;
    }
    const n = bank.length;
    return {
        games: n,
        pieces: +(pieces / n).toFixed(2), lines: +(lines / n).toFixed(3),
        fitness: +(fitness / n).toFixed(1), buried: +(buried / Math.max(1, placements)).toFixed(3),
        bestGame: best, skill: +(pieces / n + 25 * (lines / n)).toFixed(2),
    };
}

/* Load a saved brain under its own config. Returns null if it cannot be read —
 * a champion file caught mid-write is normal and simply means "next time". */
function loadBrain(file) {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
    const cfg = saved.config || (saved.configName && CONFIGS[saved.configName]) || null;
    if (!cfg) return null;
    try {
        const desc = applyConfig(cfg, BASE_R);
        const net = netFromJSON(saved);
        if (net.contract() !== desc.contract) return null;
        return { saved, cfg, net, desc };
    } catch (e) { return null; }
}

function judge(file, bank) {
    const b = loadBrain(file);
    if (!b) return null;
    return Object.assign(play(b.net, bank), { gen: b.saved.gen || 0, file });
}

/* Hand the record over. The only place `hof` is ever reassigned and the only
 * place hall_of_fame.json is ever written, so an era promotion and a deep-dive
 * promotion cannot diverge in what they record or in what they forget. Every
 * caller has already won a confirmation on a bank it did not choose. */
function crown(brain, judgedR, confirmR, from, prov) {
    hof = {
        saved: brain.saved, cfg: brain.cfg, desc: brain.desc, net: brain.net,
        judged: Object.assign({}, judgedR), confirm: confirmR,
        from, era: state.era, surgery: prov.note,
    };
    fs.writeFileSync(path.join(DIR, "hall_of_fame.json"), JSON.stringify(
        Object.assign({}, brain.saved, {
            holdout: Object.assign({ era: state.era, bank: prov.bank }, confirmR),
            provenance: Object.assign({ era: state.era }, prov),
        })));
}

/* ------------------------------------------------------------- the variants ---
 * Five families. Every draw must be one nobody has drawn before — the whole point
 * of the system is that it never spends a slot re-running a known answer. */
const FAMILIES = ["ga", "pop", "island", "share", "arch"];
const ACT_CHOICES = ["relu", "lrelu", "elu", "tanh", "softsign"];

let rngState = (+arg("rng-seed", 91773)) >>> 0;
function rnd() {                       // xorshift; the meta-loop's own randomness
    rngState ^= rngState << 13; rngState >>>= 0;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5; rngState >>>= 0;
    return rngState / 4294967296;
}
const pick = a => a[(rnd() * a.length) | 0];

/* Beta(a,b) for integer a,b is the a-th smallest of a+b−1 uniforms. Exact, and
 * short enough not to need a library. */
function betaSample(a, b) {
    const u = [];
    for (let i = 0; i < a + b - 1; i++) u.push(rnd());
    u.sort((x, y) => x - y);
    return u[a - 1];
}

function sampleVariant(family, era, hofHidden, hofActs) {
    if (family === "ga") {
        const sigma = pick([0.03, 0.05, 0.08, 0.12, 0.18, 0.25, 0.35, 0.5]);
        const rate = pick([0.02, 0.04, 0.06, 0.09, 0.12, 0.18, 0.25]);
        const flags = ["--mut-sigma", sigma, "--mut-rate", rate];
        let tag = `s${sigma}r${rate}`;
        switch (pick(["none", "rank", "tau", "shake", "anneal", "hill", "flat"])) {
            case "rank": { const v = pick([1.4, 1.8, 2.8, 3.6]); flags.push("--rank-exp", v); tag += `_g${v}`; break; }
            case "tau": { const v = pick([0.10, 0.18, 0.40, 0.60]); flags.push("--tau", v); tag += `_t${v}`; break; }
            case "shake": { const v = pick([0, 4, 16, 30]); flags.push("--shake-after", v); tag += `_k${v}`; break; }
            case "anneal": { const v = pick([0.08, 0.4, 0.7, 1]); flags.push("--anneal-floor", v); tag += `_a${v}`; break; }
            case "hill": flags.push("--child-zero", 1); tag += "_hill"; break;
            case "flat": flags.push("--no-selfadapt"); tag += "_noadapt"; break;
        }
        return { family, tag: "ga_" + tag, flags, arch: null };
    }
    if (family === "pop") {
        /* Population size and trials are the two ways to spend the same CPU. More
         * brains is a wider search per generation; more trials is a quieter
         * measurement of each one — and with 99% of challengers failing the
         * held-out gate, the measurement is plainly the noisier half. */
        const p = pick([24, 32, 48, 96, 128, 192]);
        const t = pick([1, 2, 3, 4, 6]);
        return { family, tag: `pop${p}x${t}`, flags: ["--pop", p, "--trials", t], arch: null };
    }
    if (family === "island") {
        const k = pick([2, 3, 4, 6]);
        const m = pick([3, 8, 20, 50]);
        const p = Math.min(192, Math.max(64, k * pick([12, 16, 24, 32])));
        return {
            family, tag: `isl${k}m${m}p${p}`,
            flags: ["--islands", k, "--migrate", m, "--pop", p], arch: null,
        };
    }
    if (family === "share") {
        const l = pick([0.3, 0.8, 1.5, 3.0]);
        const r = pick([0.30, 0.45, 0.55, 0.75]);
        return { family, tag: `shr${l}r${r}`, flags: ["--share", l, "--share-radius", r], arch: null };
    }
    // ---- arch: the only family that changes the brain rather than the search
    const h = hofHidden.slice();
    const last = h.length - 1;
    const ops = ["widelast", "widefirst", "narrowlast", "addlayer", "act"];
    if (h.length >= 2) ops.push("droplayer", "narrowfirst");
    switch (pick(ops)) {
        case "widelast": { const d = pick([8, 16, 32]); h[last] += d; return archVariant(h, hofActs, `w+${d}`); }
        case "widefirst": { const d = pick([16, 32, 64]); h[0] += d; return archVariant(h, hofActs, `W+${d}`); }
        case "narrowlast": { const d = pick([8, 16]); h[last] = Math.max(8, h[last] - d); return archVariant(h, hofActs, `n-${d}`); }
        case "narrowfirst": { const d = pick([16, 32]); h[0] = Math.max(16, h[0] - d); return archVariant(h, hofActs, `N-${d}`); }
        case "addlayer": {
            // ≥ the layer it follows, so the identity insert is exactly
            // function-preserving under a ReLU-family activation
            const size = Math.max(h[last], pick([16, 24, 32, 48]));
            h.push(size); return archVariant(h, hofActs, `+L${size}`);
        }
        case "droplayer": { h.pop(); return archVariant(h, hofActs, `-L`); }
        default: {
            const a = pick(ACT_CHOICES.filter(x => x !== hofActs.hidden));
            return archVariant(h, { hidden: a, out: hofActs.out }, `act_${a}`);
        }
    }
}
function archVariant(hidden, acts, tag) {
    return { family: "arch", tag: `arch_${tag}`, flags: [], arch: { hidden, acts } };
}

/* ------------------------------------------------------------------- state ---*/
const state = {
    started: new Date().toISOString(),
    deadline: new Date(DEADLINE).toISOString(),
    era: 0, eraMinutes: ERA_MIN, cells: CELLS, spawnPerEra: SPAWN,
    judgeGames: JUDGE_GAMES, confirmGames: CONFIRM_GAMES,
    hof: null, live: [], retired: [], history: [],
    bandit: Object.fromEntries(FAMILIES.map(f => [f, { spawned: 0, decided: 0, survived: 0 }])),
    deep: {
        every: DEEP_EVERY, gapMin: DEEP_GAP / 60e3, minutes: DEEP_MIN / 60e3,
        workers: DEEP_WORKERS, canFreeze: CAN_FREEZE,
        dives: 0, active: null, last: null, maxGen: null, nextAtGen: null, readyAt: null,
    },
};
const tried = new Set();
let hof = null;          // {saved, net, cfg, skill, judged, from, era}
let nextEraAt = 0;

function writeState() {
    state.nextEraAt = nextEraAt;
    state.now = Date.now();
    state.hof = hof ? {
        skill: hof.judged.skill, lines: hof.judged.lines, pieces: hof.judged.pieces,
        buried: hof.judged.buried, games: hof.judged.games,
        from: hof.from, gen: hof.saved.gen || 0, era: hof.era,
        hidden: hof.cfg.arch && hof.cfg.arch.hidden, params: hof.desc && hof.desc.params,
        contract: hof.desc && hof.desc.contract,
        acts: (hof.cfg.arch && hof.cfg.arch.acts) || { hidden: "tanh", out: "sigmoid" },
        surgery: hof.surgery || null,
    } : null;
    state.minAgeMin = MIN_AGE / 60e3;
    state.live = live.map(c => ({
        name: c.name, family: c.family, born: c.born, age: state.era - c.born,
        ageMin: c.bornAt ? +((Date.now() - c.bornAt) / 60e3).toFixed(1) : null,
        cullable: c.bornAt ? (Date.now() - c.bornAt) >= MIN_AGE : true,
        note: c.note, flags: c.flags.join(" "), hidden: c.hidden,
        birthSkill: c.birthSkill, lastSkill: c.lastSkill, dead: !!c.dead,
        frozen: !!c.frozen,
    }));
    /* A running dive is listed with the cells, because for as long as it lasts it
     * *is* the run: the prober picks its live set up from here, and a dive nobody
     * probes would be fifteen minutes with a flat dashboard. It is never a member
     * of `live`, so nothing can judge, cull or spawn from it by accident. */
    const d = state.deep.active;
    if (d) state.live.push({
        name: d.name, family: "deep", born: state.era, age: 0,
        ageMin: +((Date.now() - d.startedAt) / 60e3).toFixed(1), cullable: false,
        note: `dedicated search on ${d.from} — ${d.workers} threads, everything else paused`,
        flags: d.flags, hidden: d.hidden, birthSkill: d.seedSkill, lastSkill: null,
        dead: false, frozen: false, deep: true,
    });
    try { fs.writeFileSync(path.join(DIR, "genius.json"), JSON.stringify(state, null, 1)); }
    catch (e) { log("could not write genius.json: " + e.message); }
    try {
        fs.writeFileSync(path.join(DIR, "cells.json"),
            JSON.stringify(state.live.map(c => ({ name: c.name })), null, 1));
    } catch (e) { }
}

/* -------------------------------------------------------------- cell control */
const live = [];                       // [{name, proc, family, tag, flags, born, ...}]

function cellDir(name) { return path.join(DIR, name); }
function rel(p) { return path.relative(__dirname, p).split(path.sep).join("/"); }

/* Write the seed brain and config for a new cell, transplanting the champion into
 * a new body first if this variant asked for one. */
function prepareCell(name, variant) {
    const dir = cellDir(name);
    fs.mkdirSync(dir, { recursive: true });
    let cfg = JSON.parse(JSON.stringify(hof.cfg));
    let netJson = hof.saved.net || hof.saved;
    let surgery = null;

    if (variant.arch) {
        const rng = mulberry32((Date.now() ^ (name.length * 7919)) >>> 0);
        applyConfig(hof.cfg, BASE_R);                       // rebuild the old body first
        const old = netFromJSON(hof.saved);
        const t = transplant(old, variant.arch, rng);
        cfg.arch = Object.assign({}, cfg.arch, {
            hidden: variant.arch.hidden,
            acts: variant.arch.acts || (cfg.arch && cfg.arch.acts),
        });
        const desc = applyConfig(cfg, BASE_R);
        if (t.net.contract() !== desc.contract) {
            throw new Error(`transplant produced ${t.net.contract()}, config wants ${desc.contract}`);
        }
        netJson = t.net.toJSON();
        surgery = { note: t.note, exact: t.exact, params: desc.params, contract: desc.contract };
    }

    const desc = applyConfig(cfg, BASE_R);
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ name, config: cfg }, null, 1));
    fs.writeFileSync(path.join(dir, "seed.json"), JSON.stringify({
        gen: hof.saved.gen || 0, fitness: hof.saved.fitness || 0,
        configName: name, config: cfg, net: netJson,
        provenance: { from: hof.from, era: state.era, surgery },
    }));
    return { dir, cfg, desc, surgery };
}

function launch(cell) {
    const fd = fs.openSync(path.join(DIR, cell.name + ".log"), "a");
    const args = [
        "--tag", "tetris_genius",
        "--config", rel(path.join(cellDir(cell.name), "config.json")),
        "--resume", rel(path.join(cellDir(cell.name), "seed.json")),
        "--out", rel(cellDir(cell.name)),
        "--workers", WORKERS, "--gens", 10000000, "--until", DEADLINE,
        "--gate", GATE, "--gate-rotate", GATE_ROTATE, "--grace", -1,
        "--seed", 31337 + state.era * 101 + live.length,
        ...cell.flags,
    ];
    // --pop is a cell flag for some families; supply the default only if it is not
    if (!cell.flags.includes("--pop")) args.push("--pop", 64);
    /* Everything is niced on the compute node so the neighbour's run always wins
     * CPU contention. There is no `nice` on Windows, where this only ever runs as
     * a smoke test, so the wrapper is dropped there. */
    const trainer = [NODE, path.join(__dirname, "train_headless.js"), ...args];
    const cmd = NICE === "off" || process.platform === "win32"
        ? { exe: trainer[0], argv: trainer.slice(1) }
        : { exe: "nice", argv: ["-n", NICE, ...trainer] };
    const p = spawn(cmd.exe, cmd.argv.map(String), { cwd: __dirname, stdio: ["ignore", fd, fd] });
    cell.proc = p;
    cell.pid = p.pid;
    p.on("exit", code => {
        try { fs.closeSync(fd); } catch (e) { }
        if (!cell.stopping) { cell.dead = true; log(`${cell.name} exited on its own (code ${code})`); }
    });
    p.on("error", err => { cell.dead = true; log(`${cell.name} failed to start: ${err.message}`); });
}

/* ---- freeze and thaw --------------------------------------------------------
 * SIGSTOP takes a trainer off the CPU with its whole population still in memory;
 * SIGCONT puts it back on, mid-generation, as if nothing had happened. That is
 * the difference between a deep dive that costs the other five cells fifteen
 * minutes and one that costs them their pools — killing and restarting a cell
 * would reduce it to its champion and throw away exactly the diversity the wide
 * search exists to keep. Windows has no such signal; there the dive still runs,
 * the box is simply oversubscribed for its duration, which only matters on the
 * machine this is smoke-tested on. */
function freeze(cell) {
    if (!CAN_FREEZE || !cell.pid || cell.dead || cell.frozen) return false;
    try { process.kill(cell.pid, "SIGSTOP"); cell.frozen = true; return true; }
    catch (e) { return false; }
}
function thaw(cell) {
    if (!cell.frozen) return;
    cell.frozen = false;
    try { process.kill(cell.pid, "SIGCONT"); } catch (e) { }
}
function thawAll() { for (const c of live) thaw(c); }

function stopCell(cell) {
    cell.stopping = true;
    /* A stopped process cannot handle SIGTERM — it would sit there until the
     * SIGKILL timer fired and lose its final.json. Always thaw before killing. */
    thaw(cell);
    if (!cell.proc || cell.proc.exitCode !== null) return Promise.resolve();
    return new Promise(resolve => {
        const t = setTimeout(() => { try { cell.proc.kill("SIGKILL"); } catch (e) { } resolve(); }, 90e3);
        cell.proc.on("exit", () => { clearTimeout(t); resolve(); });
        try { cell.proc.kill("SIGTERM"); } catch (e) { clearTimeout(t); resolve(); }
    });
}

function spawnCells(n) {
    const made = [];
    for (let i = 0; i < n; i++) {
        // Thompson sampling over families: draw a plausible success rate for each
        // from what it has actually achieved, and take the best draw. Families
        // that have never been tried have the widest prior and get picked early.
        let family = FAMILIES[0], bestDraw = -1;
        for (const f of FAMILIES) {
            const b = state.bandit[f];
            const d = betaSample(b.survived + 1, Math.max(0, b.decided - b.survived) + 1);
            if (d > bestDraw) { bestDraw = d; family = f; }
        }
        const hofHidden = (hof.cfg.arch && hof.cfg.arch.hidden) || [64, 32];
        const hofActs = (hof.cfg.arch && hof.cfg.arch.acts) || { hidden: "tanh", out: "sigmoid" };
        let v = null;
        for (let k = 0; k < 60 && !v; k++) {
            const c = sampleVariant(k < 40 ? family : pick(FAMILIES), state.era, hofHidden, hofActs);
            if (!tried.has(c.tag)) v = c;
        }
        if (!v) { log("every variant in reach has been tried already — skipping a slot"); continue; }
        tried.add(v.tag);

        const name = `e${state.era}_${v.tag}`;
        let prep;
        try { prep = prepareCell(name, v); }
        catch (e) { log(`cannot build ${name}: ${e.message}`); continue; }

        const cell = {
            name, family: v.family, tag: v.tag, flags: v.flags.map(String),
            born: state.era, bornAt: Date.now(), birthSkill: hof.judged.skill, lastSkill: null,
            hidden: prep.cfg.arch && prep.cfg.arch.hidden,
            note: prep.surgery ? prep.surgery.note + (prep.surgery.exact ? " (exact)" : "")
                : v.flags.join(" ") || "—",
        };
        state.bandit[v.family].spawned++;
        live.push(cell);
        launch(cell);
        made.push(cell);
        log(`+ ${name}  [${v.family}] ${cell.note}` +
            (prep.surgery ? `  ${prep.surgery.contract}, ${prep.surgery.params.toLocaleString()} params` : ""));
    }
    return made;
}

/* --------------------------------------------------------------- the eras --- */
function championFile(cell) {
    const c = path.join(cellDir(cell.name), "champion.json");
    if (fs.existsSync(c)) return c;
    const f = path.join(cellDir(cell.name), "final.json");
    if (fs.existsSync(f)) return f;
    return path.join(cellDir(cell.name), "seed.json");   // nothing beat its seed yet
}

async function runEra(final) {
    state.era++;
    const era = state.era;
    const bank = eraBank(era, JUDGE_GAMES);
    log(`── era ${era}: judging ${live.length} cells + the record holder on ` +
        `${JUDGE_GAMES} games from bank ${bank[0]}`);

    // ---- 1. judge everything on the same fresh bank
    const judged = [];
    for (const cell of live) {
        const r = judge(championFile(cell), bank);
        if (!r) { log(`  ${cell.name}: unreadable champion, treated as last`); }
        cell.lastSkill = r ? r.skill : null;
        cell.judged = r;
        judged.push({ cell, r });
    }
    const hofNow = play(hof.net, bank);
    hof.judged = Object.assign({}, hofNow);       // the record is re-earned every era
    log(`  record holder (${hof.from}) scores ${hofNow.skill} here ` +
        `(${hofNow.lines} lines, ${hofNow.pieces} pieces)`);
    for (const { cell, r } of judged.slice().sort((a, b) => (b.r ? b.r.skill : -1) - (a.r ? a.r.skill : -1))) {
        log(`  ${(r ? r.skill.toFixed(1) : "  n/a").padStart(7)}  ${cell.name}` +
            (r ? `  (${r.lines.toFixed(2)} lines, ${r.pieces.toFixed(1)} pieces)` : ""));
    }

    // ---- 2. does anything deserve the record?
    const ranked = judged.slice().sort((a, b) => (b.r ? b.r.skill : -1) - (a.r ? a.r.skill : -1));
    const top = ranked[0];
    let promoted = null;
    if (top && top.r && top.r.skill > hofNow.skill) {
        const cb = confirmBank(era, CONFIRM_GAMES);
        log(`  ${top.cell.name} leads by ${(top.r.skill - hofNow.skill).toFixed(1)} — ` +
            `confirming on ${CONFIRM_GAMES} more unseen games`);
        const chal = loadBrain(championFile(top.cell));
        if (chal) {
            const a = play(chal.net, cb);
            applyConfig(hof.cfg, BASE_R);
            const hofNet = netFromJSON(hof.saved);
            const b = play(hofNet, cb);
            log(`  confirmation: challenger ${a.skill} vs record ${b.skill}`);
            if (a.skill > b.skill) {
                crown(chal, top.r, a, top.cell.name, {
                    cell: top.cell.name, family: top.cell.family,
                    note: top.cell.note, bank: "genius era " + era,
                });
                promoted = { cell: top.cell.name, skill: a.skill, was: b.skill };
                log(`  ★ new record: ${top.cell.name} — ${a.skill} skill ` +
                    `(${a.lines} lines, ${a.pieces} pieces) on ${CONFIRM_GAMES} games`);
            } else {
                log(`  challenge failed on confirmation — the record stands`);
            }
        }
    }

    /* ---- 3. cull
     * …unless there is no longer enough time for a replacement to be judged
     * fairly. Retiring seven cells with twenty minutes left would idle half the
     * box to make room for cells nobody will ever measure. */
    const leftAfter = DEADLINE - FINALE_LEAD - Date.now();
    if (final || leftAfter < 0.6 * ERA_MIN * 60e3) {
        log(`  ${final ? "final judgement" : "too little time left for a fair replacement"} — ` +
            `nothing retired, the survivors run to the end`);
        const rec0 = {
            era, at: new Date().toISOString(),
            judged: judged.map(({ cell, r }) => ({
                cell: cell.name, family: cell.family, age: era - cell.born,
                skill: r ? r.skill : null, lines: r ? r.lines : null, pieces: r ? r.pieces : null,
                gen: r ? r.gen : null,
            })),
            record: { skill: hofNow.skill, from: hof.from, era: hof.era },
            promoted, culled: [], spawned: [],
        };
        state.history.push(rec0);
        try { fs.appendFileSync(path.join(DIR, "eras.jsonl"), JSON.stringify(rec0) + "\n"); } catch (e) { }
        writeState();
        return ranked;
    }

    // Dead cells go first whatever they scored; then the worst by held-out skill.
    // A first-era cell that gained more than the median is spared once: surgery
    // and big population changes both cost something up front and pay later.
    const gains = ranked.filter(x => x.r && x.cell.birthSkill != null)
        .map(x => x.r.skill - x.cell.birthSkill).sort((a, b) => a - b);
    const medianGain = gains.length ? gains[gains.length >> 1] : 0;
    const dead = live.filter(c => c.dead);
    const order = ranked.filter(x => !x.cell.dead).map(x => x.cell);   // best first
    const doomed = [];
    for (const c of dead) doomed.push(c);
    let protectedLeft = PROTECT;
    for (let i = order.length - 1; i >= 0 && doomed.length < SPAWN; i--) {
        const c = order[i];
        const ageMs = Date.now() - (c.bornAt || 0);
        if (ageMs < MIN_AGE) {
            log(`  keeping ${c.name}: only ${(ageMs / 60e3).toFixed(1)} min old, ` +
                `nothing to judge it on yet`);
            continue;
        }
        const newborn = era - c.born <= 1;
        const gain = c.judged && c.birthSkill != null ? c.judged.skill - c.birthSkill : -Infinity;
        if (newborn && protectedLeft > 0 && gain > medianGain && gain > 0) {
            protectedLeft--;
            c.spared = era;
            log(`  sparing ${c.name}: one era old and up ${gain.toFixed(1)} — worth another`);
            continue;
        }
        doomed.push(c);
    }

    /* The bandit learns from each cell exactly once: the first cull it actually
     * faced. Crediting a survivor every era would let a single long-lived cell
     * push its family's success rate past 100%, and crediting a cell that the
     * newborn protection spared would score the protection rule rather than the
     * variant. */
    for (const { cell } of judged) {
        if (cell.decided || cell.spared === era) continue;
        cell.decided = true;
        const b = state.bandit[cell.family];
        b.decided++;
        if (!doomed.includes(cell)) b.survived++;
    }

    for (const c of doomed) {
        log(`− ${c.name}  [${c.family}] ${c.judged ? c.judged.skill.toFixed(1) : "n/a"}` +
            (c.dead ? " (already gone)" : ""));
        state.retired.push({
            name: c.name, family: c.family, born: c.born, died: era,
            lastSkill: c.judged ? c.judged.skill : null, note: c.note,
        });
    }
    await Promise.all(doomed.map(stopCell));
    for (const c of doomed) { const i = live.indexOf(c); if (i >= 0) live.splice(i, 1); }

    // ---- 4. repopulate from the record holder
    const room = Math.max(0, CELLS - live.length);
    const born = spawnCells(room);

    const rec = {
        era, at: new Date().toISOString(),
        judged: judged.map(({ cell, r }) => ({
            cell: cell.name, family: cell.family, age: era - cell.born,
            skill: r ? r.skill : null, lines: r ? r.lines : null, pieces: r ? r.pieces : null,
            gen: r ? r.gen : null,
        })),
        record: { skill: hofNow.skill, from: hof.from, era: hof.era },
        promoted, culled: doomed.map(c => c.name), spawned: born.map(c => c.name),
    };
    state.history.push(rec);
    if (state.history.length > 40) state.history.shift();
    try { fs.appendFileSync(path.join(DIR, "eras.jsonl"), JSON.stringify(rec) + "\n"); } catch (e) { }
    writeState();
    log(`── era ${era} done: ${doomed.length} retired, ${born.length} started, ` +
        `record ${hof.judged.skill} held by ${hof.from}`);
    return ranked;
}

/* ---- the deep dive ----------------------------------------------------------
 * The wide search and the deep search want the same cores, so they take turns.
 * For `--deep-min` minutes the whole box runs one lineage: the cell that is
 * leading right now, on its own hyperparameters, from its own champion, with
 * every thread the cells were sharing between them.
 *
 * Note what the dive does *not* get to do. It cannot become the record by being
 * the only thing that ran; it wins the seat the same way an era challenger does,
 * on a bank drawn after it finished and then on a second, larger one. It cannot
 * quietly overwrite the cell it came from — that cell is thawed exactly as it was
 * left, and if the dive won, its brain arrives the ordinary way, as the record
 * that the next spawn wave is seeded from. And it cannot cost anything but time:
 * the losing case ends with a `SIGCONT` and nothing else changed.
 */
let dives = 0;
let lastDeepEnd = Date.now();
let lastDeepGen = null;

function genOf(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")).gen || 0; } catch (e) { return 0; }
}
/* The furthest-along live cell. Cells inherit the record's generation number when
 * they are seeded, so this counter carries across culls instead of resetting to
 * zero every time a cell is replaced. */
function maxLiveGen() {
    let g = 0;
    for (const c of live) { const v = genOf(championFile(c)); if (v > g) g = v; }
    return g;
}

async function deepDive(reason) {
    const t0 = Date.now();
    const n = dives + 1;

    // ---- 1. which cell? A short bank may nominate; it decides nothing.
    const pickBank = diveBank(n, JUDGE_GAMES, 0);
    log(`══ deep dive ${n} (${reason}): judging ${live.length} cells on ${JUDGE_GAMES} ` +
        `fresh games to choose one`);
    let best = null;
    for (const cell of live) {
        const r = judge(championFile(cell), pickBank);
        if (!r) continue;
        log(`  ${r.skill.toFixed(1).padStart(7)}  ${cell.name}`);
        if (!best || r.skill > best.r.skill) best = { cell, r };
    }
    if (!best) { log("  nothing loadable — dive cancelled"); return; }

    // ---- 2. its own body, its own settings, its own champion, copied out
    dives++;
    const name = `deep${n}_${best.cell.tag}`;
    const dir = path.join(DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    let cfg;
    try {
        cfg = JSON.parse(fs.readFileSync(path.join(cellDir(best.cell.name), "config.json"), "utf8")).config;
        fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ name, config: cfg }, null, 1));
        fs.copyFileSync(championFile(best.cell), path.join(dir, "seed.json"));
    } catch (e) { log(`  cannot set the dive up: ${e.message}`); return; }

    // ---- 3. stop the world
    const frozen = [];
    for (const c of live) if (freeze(c)) frozen.push(c.name);
    const workers = CAN_FREEZE ? DEEP_WORKERS : WORKERS;
    if (!CAN_FREEZE) {
        log(`  this platform cannot suspend processes — the cells keep running and the ` +
            `box is oversubscribed for ${(DEEP_MIN / 60e3).toFixed(0)} min`);
    }
    const endsAt = Math.min(Date.now() + DEEP_MIN, DEADLINE - FINALE_LEAD);
    state.deep.active = {
        name, from: best.cell.name, startedAt: t0, endsAt, workers,
        seedSkill: best.r.skill, reason, frozen,
        flags: best.cell.flags.join(" "), hidden: best.cell.hidden,
    };
    writeState();
    log(`  diving on ${best.cell.name} (${best.r.skill.toFixed(1)} on the pick bank) — ` +
        `${workers} threads for ${((endsAt - Date.now()) / 60e3).toFixed(0)} min, ` +
        `${frozen.length} cells frozen mid-generation`);

    // ---- 4. run it
    let proc = null;
    try {
        const fd = fs.openSync(path.join(DIR, name + ".log"), "a");
        const args = [
            "--tag", "tetris_genius",
            "--config", rel(path.join(dir, "config.json")),
            "--resume", rel(path.join(dir, "seed.json")),
            "--out", rel(dir),
            "--workers", workers, "--gens", 10000000, "--until", endsAt,
            "--gate", GATE, "--gate-rotate", GATE_ROTATE, "--grace", -1,
            "--seed", 777000 + n * 13,
            ...best.cell.flags,
        ];
        if (!best.cell.flags.includes("--pop")) args.push("--pop", 64);
        const trainer = [NODE, path.join(__dirname, "train_headless.js"), ...args];
        const cmd = NICE === "off" || process.platform === "win32"
            ? { exe: trainer[0], argv: trainer.slice(1) }
            : { exe: "nice", argv: ["-n", NICE, ...trainer] };
        proc = spawn(cmd.exe, cmd.argv.map(String), { cwd: __dirname, stdio: ["ignore", fd, fd] });
        state.deep.active.pid = proc.pid;
        await new Promise(resolve => {
            let done = false;
            const finish = () => { if (!done) { done = true; try { fs.closeSync(fd); } catch (e) { } resolve(); } };
            proc.on("exit", finish);
            proc.on("error", err => { log(`  dive failed to start: ${err.message}`); finish(); });
            /* It stops itself at --until; this is only the backstop for a trainer
             * that wedges, and it must fire before the cells have been frozen for
             * appreciably longer than advertised. */
            const t = setInterval(() => {
                if (done) return clearInterval(t);
                if (shuttingDown || Date.now() > endsAt + 90e3) {
                    clearInterval(t);
                    try { proc.kill("SIGTERM"); } catch (e) { }
                    setTimeout(() => { try { proc.kill("SIGKILL"); } catch (e) { } }, 30e3);
                }
            }, 5e3);
        });
    } finally {
        // ---- 5. start the world again, whatever happened above
        thawAll();
        state.deep.active = null;
    }

    const gens = genOf(path.join(dir, "champion.json")) || genOf(path.join(dir, "final.json"));
    const minutes = (Date.now() - t0) / 60e3;
    log(`  dive ${n} ran ${minutes.toFixed(1)} min, reaching gen ${gens.toLocaleString()}; cells thawed`);

    // ---- 6. did it find anything? Judged like any other challenger.
    const outFile = championFile({ name });
    const jb = diveBank(n, JUDGE_GAMES, 1);
    const chal = loadBrain(outFile);
    let promoted = false, chalR = null, recR = null;
    if (!chal) {
        log(`  the dive produced nothing readable — the record stands`);
    } else {
        chalR = play(chal.net, jb);
        applyConfig(hof.cfg, BASE_R);
        recR = play(netFromJSON(hof.saved), jb);
        log(`  dive ${chalR.skill} vs record ${recR.skill} on ${JUDGE_GAMES} fresh games`);
        if (chalR.skill > recR.skill) {
            const cb = diveBank(n, CONFIRM_GAMES, 2);
            const a = play(chal.net, cb);
            applyConfig(hof.cfg, BASE_R);
            const b = play(netFromJSON(hof.saved), cb);
            log(`  confirmation on ${CONFIRM_GAMES} more: dive ${a.skill} vs record ${b.skill}`);
            if (a.skill > b.skill) {
                crown(chal, chalR, a, name, {
                    cell: name, family: "deep", note: `deep dive ${n} on ${best.cell.name} ` +
                        `(${best.cell.note})`, bank: "genius deep dive " + n,
                });
                promoted = true;
                log(`  ★ new record from the dive: ${a.skill} skill ` +
                    `(${a.lines} lines, ${a.pieces} pieces) on ${CONFIRM_GAMES} games`);
            } else {
                log(`  the dive lost the confirmation — the record stands, nothing changed`);
            }
        } else {
            log(`  the dive did not beat the record — nothing changed`);
        }
    }

    state.deep.dives = dives;
    state.deep.last = {
        n, name, from: best.cell.name, at: Date.now(), minutes: +minutes.toFixed(1),
        gen: gens, skill: chalR ? chalR.skill : null, record: recR ? recR.skill : null,
        promoted, frozen: frozen.length, workers,
    };
    lastDeepEnd = Date.now();
    lastDeepGen = maxLiveGen();
    state.deep.nextAtGen = lastDeepGen + DEEP_EVERY;
    state.deep.readyAt = lastDeepEnd + DEEP_GAP;
    /* The frozen cells did no work for the length of the dive, so judging them on
     * the original schedule would judge them on less training than the era
     * promises. Push the boundary out by exactly what was taken. */
    nextEraAt += Date.now() - t0;
    writeState();
    log(`══ deep dive ${n} done — ${promoted ? "record replaced" : "back to the wide search"}; ` +
        `next era in ${((nextEraAt - Date.now()) / 60e3).toFixed(0)} min`);
}

/* ---- the finale ------------------------------------------------------------
 * A run that ends on a timer ends with an opinion. This ends with a measurement:
 * one last judgement of everything alive, then the finalists and the record
 * ranked head to head on a bank of `--final-games` sequences that nothing in this
 * run has ever touched — not the training seeds, not the in-run gates, not the
 * era banks, not the confirmations. The winner of *that* is the brain to ship. */
async function finale() {
    log(`══ finale: last judgement, then the finalists on ${FINAL_GAMES} fresh games`);
    const ranked = await runEra(true);
    const finalists = [];
    for (const { cell, r } of (ranked || []).slice(0, 3)) {
        if (r) finalists.push({ label: cell.name, file: championFile(cell), note: cell.note });
    }
    finalists.push({ label: "record (" + hof.from + ")", file: path.join(DIR, "hall_of_fame.json"), note: "incumbent" });

    const bank = [];
    for (let i = 0; i < FINAL_GAMES; i++) bank.push(6600001 + i * 7919);
    const rows = [];
    for (const f of finalists) {
        const b = loadBrain(f.file);
        if (!b) { log(`  ${f.label}: unreadable, dropped from the final`); continue; }
        const r = play(b.net, bank);
        rows.push({ ...f, ...r, gen: b.saved.gen || 0, contract: b.desc.contract, params: b.desc.params });
        log(`  ${r.skill.toFixed(1).padStart(7)}  ${f.label}  (${r.lines.toFixed(2)} lines, ` +
            `${r.pieces.toFixed(1)} pieces, best game ${r.bestGame})`);
    }
    if (!rows.length) { log("  nothing loadable in the final — hall_of_fame.json stands"); return; }
    rows.sort((a, b) => b.skill - a.skill);
    const win = rows[0];

    const src = loadBrain(win.file);
    const out = Object.assign({}, src.saved, {
        holdout: {
            games: FINAL_GAMES, bank: "genius final", skill: win.skill, lines: win.lines,
            pieces: win.pieces, buried: win.buried, bestGame: win.bestGame, fitness: win.fitness,
        },
        provenance: { cell: win.label, note: win.note, era: state.era, decidedAt: new Date().toISOString() },
    });
    fs.writeFileSync(path.join(__dirname, "training", "genius_best.json"), JSON.stringify(out));
    fs.writeFileSync(path.join(__dirname, "training", "genius_best_ranking.json"), JSON.stringify(rows, null, 1));
    state.final = { winner: win.label, skill: win.skill, lines: win.lines, pieces: win.pieces, games: FINAL_GAMES };
    writeState();
    log(`══ winner: ${win.label} — ${win.skill.toFixed(1)} skill ` +
        `(${win.pieces.toFixed(1)} pieces, ${win.lines.toFixed(2)} lines) on ${FINAL_GAMES} unseen games`);
    log(`══ wrote training/genius_best.json (${win.contract}, ${win.params.toLocaleString()} params)`);
}

/* ------------------------------------------------------------------- start --- */
let shuttingDown = false;
async function shutdown(why) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${why}) — stopping ${live.length} cells`);
    thawAll();          // a suspended trainer would never see the SIGTERM
    await Promise.all(live.map(stopCell));
    writeState();
    log("all cells stopped");
    process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { shutdown(sig); });
process.on("uncaughtException", err => {
    log("FATAL " + (err && err.stack || err));
    shutdown("crash");
});

(async () => {
    // ---- who starts as the record holder?
    const bank = eraBank(0, JUDGE_GAMES);
    const candidates = [];
    const sp = path.resolve(__dirname, SEED_FILE);
    if (fs.existsSync(sp)) candidates.push(sp);
    if (SEED_FROM && typeof SEED_FROM === "string") {
        const root = path.resolve(__dirname, SEED_FROM);
        try {
            for (const d of fs.readdirSync(root, { withFileTypes: true })) {
                if (d.isDirectory()) {
                    for (const f of ["champion.json", "final.json"]) {
                        const p = path.join(root, d.name, f);
                        if (fs.existsSync(p)) { candidates.push(p); break; }
                    }
                } else if (d.name.endsWith(".json") && !d.name.startsWith("_")) {
                    // a flat directory of saved brains — the prober's vault is one
                    candidates.push(path.join(root, d.name));
                }
            }
        } catch (e) { log(`--seed-from ${SEED_FROM}: ${e.message}`); }
    }
    if (!candidates.length) { console.error("no seed brain to start from"); process.exit(1); }

    log(`opening: ${candidates.length} candidate brains judged on ${JUDGE_GAMES} unseen games`);
    const shortlist = [];
    for (const f of candidates) {
        const r = judge(f, bank);
        if (!r) { log(`  unreadable: ${rel(f)}`); continue; }
        log(`  ${r.skill.toFixed(1).padStart(7)}  ${rel(f)}  gen ${r.gen}`);
        shortlist.push({ file: f, r });
    }
    if (!shortlist.length) { console.error("nothing loadable among the seed candidates"); process.exit(1); }

    /* Taking the winner of that list would be taking a maximum over fifteen noisy
     * twenty-four-game measurements, which is how a lucky draw becomes a record
     * that everything else then has to beat. The same rule as everywhere else in
     * this file applies to the opening too: a short bank may nominate, only a long
     * one may decide. So the top few are replayed on the confirmation bank and the
     * seat goes to whoever wins *there*. */
    /* How many get a real test matters as much as having one. A screen of 32
     * games is itself noisy, so a narrow shortlist can eliminate the actual best
     * brain before the reliable measurement ever sees it — which is exactly what
     * happened here once: a brain worth 158 on 100 games drew 145 on the screen,
     * missed a top-4 cut, and the seat went to one worth 146. Take everything
     * within a plausible noise margin of the leader, up to a cap. */
    shortlist.sort((a, b2) => b2.r.skill - a.r.skill);
    const cut = shortlist[0].r.skill - FINALIST_MARGIN;
    const finalists = shortlist.filter(x => x.r.skill >= cut).slice(0, FINALISTS);
    const cbank = confirmBank(0, CONFIRM_GAMES);
    log(`  → ${finalists.length} finalists replayed on ${CONFIRM_GAMES} confirmation games:`);
    let bestFile = null, bestR = null, bestConfirm = null;
    for (const c of finalists) {
        const lb = loadBrain(c.file);
        if (!lb) continue;
        const cr = play(lb.net, cbank);
        log(`    ${cr.skill.toFixed(1).padStart(7)}  ${rel(c.file)}  ` +
            `(era bank said ${c.r.skill.toFixed(1)})`);
        if (!bestConfirm || cr.skill > bestConfirm.skill) {
            bestConfirm = cr; bestFile = c.file; bestR = c.r;
        }
    }
    if (!bestFile) { console.error("nothing loadable among the finalists"); process.exit(1); }

    const b = loadBrain(bestFile);
    hof = {
        saved: b.saved, cfg: b.cfg, desc: b.desc, net: b.net,
        judged: bestR, from: rel(bestFile), era: 0,
    };
    hof.confirm = bestConfirm;
    fs.writeFileSync(path.join(DIR, "hall_of_fame.json"), JSON.stringify(
        Object.assign({}, b.saved, {
            holdout: Object.assign({ era: 0, bank: "genius era 0" }, hof.confirm),
            provenance: { cell: hof.from, era: 0, note: "opening champion" },
        })));
    log(`record holder: ${hof.from} (${b.desc.contract}, ${b.desc.params.toLocaleString()} params) — ` +
        `${bestR.skill} on the era bank, ${hof.confirm.skill} on ${CONFIRM_GAMES} confirmation games`);

    log(`${CELLS} cells × ${WORKERS} workers = ${CELLS * WORKERS} threads (cap ${MAX_THREADS}); ` +
        `era ${ERA_MIN} min; ${SPAWN} retired and ${SPAWN} started each era; ` +
        `until ${new Date(DEADLINE).toISOString().slice(0, 16)}Z`);
    log(DEEP_EVERY > 0
        ? `deep dive: every ${DEEP_EVERY} generations and at most one per ` +
        `${(DEEP_GAP / 60e3).toFixed(0)} min — ${(DEEP_MIN / 60e3).toFixed(0)} min on ` +
        `${DEEP_WORKERS} threads with every other cell suspended`
        : "deep dive: off");
    spawnCells(CELLS);
    nextEraAt = Date.now() + ERA_MIN * 60e3;
    writeState();

    /* An era can also be demanded from the dashboard. The dashboard never runs
     * anything — it writes this one fixed filename and nothing else — and every
     * decision still happens here, under exactly the rules a scheduled era uses:
     * the same fresh judging bank, the same confirmation before the record moves,
     * the same protections. The only difference is the clock. */
    const CULL_FILE = path.join(DIR, "CULL_NOW");
    const DEEP_FILE = path.join(DIR, "DEEP_NOW");
    for (const f of [CULL_FILE, DEEP_FILE]) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { }
    }
    const finaleAt = DEADLINE - FINALE_LEAD;
    lastDeepGen = maxLiveGen();
    state.deep.maxGen = lastDeepGen;
    state.deep.nextAtGen = lastDeepGen + DEEP_EVERY;
    state.deep.readyAt = lastDeepEnd + DEEP_GAP;
    let lastGenCheck = 0;
    while (Date.now() < finaleAt && !shuttingDown) {
        const wake = Math.min(nextEraAt, finaleAt) - Date.now();
        await new Promise(r => setTimeout(r, Math.min(8e3, Math.max(1e3, wake))));
        if (shuttingDown) break;
        let forced = false, forcedDeep = false;
        try {
            if (fs.existsSync(CULL_FILE)) { fs.unlinkSync(CULL_FILE); forced = true; }
            if (fs.existsSync(DEEP_FILE)) { fs.unlinkSync(DEEP_FILE); forcedDeep = true; }
        } catch (e) { }
        if (forced && Date.now() >= finaleAt) {
            log("cull requested, but the run is already in its final minutes — ignored");
            forced = false;
        }
        if (forced) log(`── cull requested from the dashboard`);
        if ((forced || Date.now() >= nextEraAt) && Date.now() < finaleAt) {
            state.lastForced = forced ? Date.now() : state.lastForced;
            await runEra(false);
            nextEraAt = Date.now() + ERA_MIN * 60e3;    // measured boundary to boundary
            continue;
        }

        /* Is a dive due? Counting generations means reading six champion files, so
         * it is done once a minute rather than on every eight-second tick. Both
         * conditions have to hold: enough progress since the last dive, and enough
         * clock. At roughly twenty generations a minute per cell the generation
         * counter on its own would fire every ten minutes, and a fifteen-minute
         * dive every ten minutes is not an occasional deep search, it is the whole
         * schedule. */
        let due = false;
        if (DEEP_EVERY > 0 && Date.now() - lastGenCheck >= 60e3) {
            lastGenCheck = Date.now();
            const g = maxLiveGen();
            state.deep.maxGen = g;
            due = g >= lastDeepGen + DEEP_EVERY && Date.now() - lastDeepEnd >= DEEP_GAP;
        }
        if (forcedDeep && DEEP_EVERY <= 0) {
            log("deep dive requested, but this controller was started with --deep-every 0 — ignored");
            forcedDeep = false;
        }
        if (forcedDeep || due) {
            /* Never start one that cannot finish: a dive interrupted by the finale
             * would leave five cells frozen through the only measurement that
             * ships a brain. */
            if (Date.now() + DEEP_MIN + 3 * 60e3 >= finaleAt) {
                if (forcedDeep) log("deep dive requested, but there is no longer room for one before the finale — ignored");
                lastDeepGen = Infinity;                 // and stop asking
            } else if (!live.length) {
                log("deep dive skipped: no live cells to dive on");
            } else {
                await deepDive(forcedDeep ? "requested from the dashboard"
                    : `${DEEP_EVERY} generations since the last one`);
                continue;
            }
        }
        writeState();
    }
    if (!shuttingDown) await finale();
    await shutdown("deadline");
})();
