/* probe_holdout.js — replay every running cell's champion on one fixed bank of
 * unseen games, often enough to watch a trend form.
 *
 *   node probe_holdout.js --dir training/genius --games 100 --interval 120 --workers 3
 *
 * Why this exists: every number a trainer prints per generation is a *population*
 * statistic, and most of a population at any moment is fresh mutants — garbage by
 * construction. Averaging them produces a noisy line that mostly measures how
 * violently the cell is mutating, not how good its brain is. What is actually
 * wanted is "how well does the best brain in this cell play right now", which is
 * a held-out question and has to be answered by playing games.
 *
 * THE BANK NEVER MOVES, AND NOTHING IS ALLOWED TO SELECT ON IT.
 *
 * That is the whole design. Every other bank in this project rotates — the in-run
 * gate, the era judgement, the record confirmation — because anything used to
 * *decide* must be fresh or it gets fitted. This one is the opposite: it decides
 * nothing, so it can stay frozen, and because it is frozen a score from this hour
 * is comparable with one from eight hours ago. A bank that rotated would make a
 * running best creep upward for free, since every new draw is another chance at an
 * easy set; a bank that was selected on would stop measuring skill and start
 * measuring memorisation. It is a ruler, not a target.
 *
 * Cost is why there is a worker pool: 100 games across a dozen cells is minutes of
 * one core, which is far too slow to draw a curve from. Splitting each cell's bank
 * across a few threads turns a point every seven minutes into a point every two,
 * without changing a single sequence that gets played.
 *
 * Append-only JSONL, one line per cell per cycle, each stamped with the sample
 * size behind it — a 40-game score and a 100-game score are not the same
 * measurement and must never be silently compared.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { Worker, isMainThread, parentPort } = require("worker_threads");

for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "configs.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const BASE_R = Object.assign({}, R);

/* Raw sums, not averages: the caller stitches the slices together and only then
 * divides, so splitting a bank across threads gives exactly what playing it on one
 * thread would. */
function playRaw(net, seeds) {
    let pieces = 0, lines = 0, fitness = 0, score = 0, best = 0, buried = 0, placements = 0;
    const m = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
    for (const s of seeds) {
        const ag = new Agent(net, s, DEFAULT_CFG);
        let prev = 0;
        while (ag.alive) {
            const ev = ag.step(400);
            if (ev && ev.locked) {
                const bm = boardMetrics(ag.game.grid, m);
                buried += Math.max(0, bm.totalHoles - prev); prev = bm.totalHoles; placements++;
            }
        }
        pieces += ag.pieces; lines += ag.lines; fitness += ag.fitness; score += ag.game.score;
        if (ag.lines > best) best = ag.lines;
    }
    return { pieces, lines, fitness, score, best, buried, placements, n: seeds.length };
}

/* --------------------------------------------------------------- worker side */
if (!isMainThread) {
    parentPort.on("message", msg => {
        try {
            applyConfig(msg.config, BASE_R);
            const net = netFromJSON(msg.saved);
            parentPort.postMessage({ ok: true, out: playRaw(net, msg.seeds) });
        } catch (e) {
            parentPort.postMessage({ ok: false, error: String(e && e.message || e) });
        }
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
const DIR = path.resolve(__dirname, String(arg("dir", "training/grid")));
const INTERVAL = +arg("interval", 120) * 1000;
const GAMES = +arg("games", 100);
const NWORK = Math.max(1, +arg("workers", 3));
/* An epoch-ms stop, so the prober dies with the run it is watching instead of
 * quietly replaying a finished experiment forever on a shared box. */
const UNTIL = +arg("until", 0);
const OUT = path.join(DIR, "holdout.jsonl");

const BANK = [];
for (let i = 0; i < GAMES; i++) BANK.push(3300001 + i * 7919);   // frozen; selected on by nothing

/* ---- the progression track --------------------------------------------------
 * Per-cell curves show noise; they do not answer "is the system as a whole
 * getting anywhere". That needs one number over time, and the naive version of it
 * — "the best cell's score" — is a maximum over a dozen noisy measurements and so
 * drifts upward on luck alone. It would show progress on a frozen population.
 *
 * So the same nominate/decide split used everywhere else: the 100-game ruler picks
 * *which* brain currently leads, and a second, independent bank measures that one
 * brain. A maximum picked on bank A is unbiased when scored on bank B. The record
 * is measured on the same bank each time as a baseline, so the question becomes
 * visual: has the leader's line crossed the record's line and stayed there? */
const VGAMES = +arg("verify-games", 200);
const VERIFY = [];
for (let i = 0; i < VGAMES; i++) VERIFY.push(7700001 + i * 7919);
const LEADER_OUT = path.join(DIR, "leader.jsonl");
const lastResult = new Map();          // cell -> its latest ruler probe
let recordCache = null;                // {key, r} — the record only moves on promotion

const workers = [];
for (let i = 0; i < NWORK; i++) workers.push(new Worker(__filename));

function chunk(arr, k) {
    const per = Math.ceil(arr.length / k), out = [];
    for (let i = 0; i < k; i++) {
        const s = arr.slice(i * per, Math.min(arr.length, (i + 1) * per));
        if (s.length) out.push(s);
    }
    return out;
}

function playParallel(config, saved, bank) {
    const parts = chunk(bank || BANK, NWORK);
    return Promise.all(parts.map((seeds, i) => new Promise((resolve, reject) => {
        const w = workers[i];
        const finish = () => { w.off("message", onMsg); w.off("error", onErr); };
        const onMsg = m => { finish(); m.ok ? resolve(m.out) : reject(new Error(m.error)); };
        const onErr = e => { finish(); reject(e); };
        w.on("message", onMsg);
        w.on("error", onErr);
        w.postMessage({ config, saved, seeds });
    }))).then(chunks => {
        const t = { pieces: 0, lines: 0, fitness: 0, score: 0, best: 0, buried: 0, placements: 0, n: 0 };
        for (const c of chunks) {
            t.pieces += c.pieces; t.lines += c.lines; t.fitness += c.fitness; t.score += c.score;
            t.buried += c.buried; t.placements += c.placements; t.n += c.n;
            if (c.best > t.best) t.best = c.best;
        }
        return {
            pieces: +(t.pieces / t.n).toFixed(2), lines: +(t.lines / t.n).toFixed(3),
            fitness: +(t.fitness / t.n).toFixed(1), score: +(t.score / t.n).toFixed(0),
            buried: +(t.buried / Math.max(1, t.placements)).toFixed(3), bestGame: t.best,
            skill: +(t.pieces / t.n + 25 * (t.lines / t.n)).toFixed(2),
        };
    });
}

const lastSeen = new Map();     // cell -> generation already probed

/* ---- the vault -------------------------------------------------------------
 * A cell's champion.json is a high-water mark on that cell's *own* gate bank and
 * on nothing else. It is therefore free to move down on any other measure — and
 * it does, because a gate of fixed games can be fitted, and a few hundred
 * promotions is plenty of opportunity. When that happens the previous, better
 * brain is simply overwritten and gone.
 *
 * So every time a champion sets a personal best *on the ruler*, it is copied out.
 * The vault only ever moves up. Nothing that has been measured well can be lost by
 * a cell later wandering, by a cull, or by the run ending. */
const VAULT = path.join(DIR, "vault");
const vaultBest = new Map();
function loadVault() {
    try {
        fs.mkdirSync(VAULT, { recursive: true });
        for (const f of fs.readdirSync(VAULT)) {
            if (!f.endsWith(".json") || f.startsWith("_")) continue;
            try {
                const v = JSON.parse(fs.readFileSync(path.join(VAULT, f), "utf8"));
                // a peak recorded at a different sample size is not comparable
                if (v.vault && typeof v.vault.skill === "number" && v.vault.games === GAMES) {
                    vaultBest.set(f.slice(0, -5), v.vault.skill);
                }
            } catch (e) { }
        }
    } catch (e) { }
}
function vaultIfBest(cell, saved, r) {
    const prev = vaultBest.has(cell) ? vaultBest.get(cell) : -Infinity;
    if (r.skill <= prev) return false;
    vaultBest.set(cell, r.skill);
    fs.writeFileSync(path.join(VAULT, cell + ".json"), JSON.stringify(Object.assign({}, saved, {
        vault: {
            cell, skill: r.skill, lines: r.lines, pieces: r.pieces, buried: r.buried,
            games: GAMES, gen: saved.gen || 0, probedAt: Date.now(),
        },
    })));
    let best = null;
    for (const [c, s] of vaultBest) if (!best || s > best.skill) best = { cell: c, skill: s };
    fs.writeFileSync(path.join(VAULT, "_index.json"), JSON.stringify({
        best, games: GAMES, cells: Object.fromEntries(vaultBest), updated: Date.now(),
    }, null, 1));
    return true;
}

/* Which cells are alive right now — a retired directory keeps its last champion
 * on disk forever and would otherwise stay "leader" long after it was stopped. */
function liveCells() {
    try {
        const g = JSON.parse(fs.readFileSync(path.join(DIR, "genius.json"), "utf8"));
        if (g && Array.isArray(g.live) && g.live.length) return new Set(g.live.map(c => c.name));
    } catch (e) { }
    return null;
}

async function trackLeader() {
    const live = liveCells();
    let best = null;
    for (const [cell, v] of lastResult) {
        if (live && !live.has(cell)) continue;
        if (!best || v.r.skill > best.v.r.skill) best = { cell, v };
    }
    if (!best) return;
    let leader;
    try { leader = await playParallel(best.v.cfg, best.v.saved, VERIFY); }
    catch (e) { return; }

    let record = null;
    try {
        const f = path.join(DIR, "hall_of_fame.json");
        const st = fs.statSync(f);
        const key = st.mtimeMs + ":" + st.size;
        if (recordCache && recordCache.key === key) record = recordCache.r;
        else {
            const saved = JSON.parse(fs.readFileSync(f, "utf8"));
            const cfg = saved.config || (saved.configName && CONFIGS[saved.configName]);
            if (cfg) {
                record = await playParallel(cfg, saved, VERIFY);
                recordCache = { key, r: record };
            }
        }
    } catch (e) { /* no record file yet */ }

    fs.appendFileSync(LEADER_OUT, JSON.stringify({
        t: Date.now(), cell: best.cell, gen: best.v.saved.gen || 0,
        nominatedOn: GAMES, verifiedOn: VGAMES,
        nominated: best.v.r.skill,
        leader: leader.skill, leaderLines: leader.lines, leaderPieces: leader.pieces,
        record: record ? record.skill : null,
        recordLines: record ? record.lines : null,
    }) + "\n");
    console.log(`leader ${best.cell}: ${best.v.r.skill} on ${GAMES} → ${leader.skill} on ${VGAMES}` +
        (record ? `  (record ${record.skill})` : ""));
}

let busy = false;
async function cycle() {
    if (busy) return;                       // a slow cycle must never overlap itself
    if (UNTIL && Date.now() >= UNTIL) {
        console.log("reached the wall-clock deadline — stopping");
        for (const w of workers) { try { await w.terminate(); } catch (e) { } }
        process.exit(0);
    }
    busy = true;
    const t0 = Date.now();
    let done = 0;
    try {
        let dirs;
        try { dirs = fs.readdirSync(DIR, { withFileTypes: true }).filter(d => d.isDirectory()); }
        catch (e) { return; }
        for (const d of dirs) {
            if (d.name === "vault" || d.name.startsWith("vault_")) continue;
            const file = path.join(DIR, d.name, "champion.json");
            if (!fs.existsSync(file)) continue;
            let saved;
            try { saved = JSON.parse(fs.readFileSync(file, "utf8")); }
            catch (e) { continue; }          // being rewritten right now; next cycle
            if (lastSeen.get(d.name) === saved.gen) continue;   // champion has not moved
            const cfg = saved.config || (saved.configName && CONFIGS[saved.configName]) || null;
            if (!cfg) continue;
            let r;
            try {
                const desc = applyConfig(cfg, BASE_R);
                if (netFromJSON(saved).contract() !== desc.contract) continue;
                r = await playParallel(cfg, saved);
            } catch (e) { continue; }
            lastSeen.set(d.name, saved.gen);
            const kept = vaultIfBest(d.name, saved, r);
            fs.appendFileSync(OUT, JSON.stringify({
                t: Date.now(), cell: d.name, gen: saved.gen, games: GAMES, ...r,
                vaulted: kept || undefined,
            }) + "\n");
            done++;
            lastResult.set(d.name, { r, saved, cfg });
            if (kept) console.log(`vault: ${d.name} gen ${saved.gen} → ${r.skill}`);
        }
        await trackLeader();
    } finally {
        busy = false;
        if (done) console.log(`probed ${done} cells in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
}

loadVault();
console.log(`probing ${DIR} every ${INTERVAL / 1000}s on ${GAMES} FIXED held-out games ` +
    `across ${NWORK} threads → ${OUT}`);
console.log(`progression track: the ruler nominates, ${VGAMES} independent games verify → ${LEADER_OUT}`);
console.log(`vault: ${VAULT} (${vaultBest.size} personal bests already held at this sample size)`);
cycle();
setInterval(cycle, INTERVAL);
