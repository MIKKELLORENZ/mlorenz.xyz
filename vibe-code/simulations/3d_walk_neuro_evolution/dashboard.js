/* dashboard.js — a live view of the training run, served from the node itself.
 *
 *   node dashboard.js --port 8911 --dir ~/walk3d
 *
 * No dependencies and no build step: one file reads what the run already writes
 * to disk and serves it as JSON, and one HTML file draws it. Nothing here talks
 * to the trainer, so it cannot slow it down or take it out, and it can be
 * restarted at any time without touching the run.
 *
 * Four sources, each of which already existed:
 *   training/runlog.json            per-generation fleet statistics (flushed every --save-every)
 *   training/run.log                the live line, plus stage and plateau events
 *   training/autoselect.log         every held-out exam ever scored
 *   training/best_holdout_score.json the current incumbent
 *
 * The live line is parsed out of run.log rather than taken from runlog.json,
 * because runlog.json is only flushed every few generations and a dashboard that
 * is five generations stale looks broken.
 */
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const arg = (n, d) => {
    const i = process.argv.indexOf("--" + n);
    if (i < 0) return d;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : (isNaN(+v) ? v : +v);
};
const PORT = arg("port", 8911);
const DIR = String(arg("dir", __dirname));
/* Island identity. Two runs on one box means two of these pages open at once,
 * and a chart is worthless if you cannot tell at a glance which run it is —
 * "old vs new" has to be readable from the tab, not inferred from the port.
 * --peer is the other island's URL so the two pages link to each other. */
const LABEL = String(arg("label", ""));
const PEER = String(arg("peer", ""));
const PEER_LABEL = String(arg("peer-label", "the other island"));
const TRAIN = path.join(DIR, "training");

const readText = f => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };

/* Brain identity for the transfer table, borrowed from nn.js rather than
 * reimplemented here. A second copy of the hash is a second source of truth, and
 * the entire point of the id is that the dashboard, the baker and the browser
 * agree on it — a drifted copy would produce confident, wrong agreement. The
 * dashboard may be running next to the sim (laptop) or beside a synced reference
 * copy (training node), so both are tried and neither is required. */
const brainIdCandidates = [path.join(DIR, "nn.js"), path.join(__dirname, "nn.js"),
                           path.join(process.env.HOME || "", "walk3d_ref", "nn.js")];
const brainIdFn = (() => {
    for (const f of brainIdCandidates) {
        try {
            const m = require(f);
            if (m && typeof m.brainId === "function") return m.brainId;
        } catch (e) { /* try the next */ }
    }
    return null;
})();
const brainInfoCache = new Map();
function brainIdOf(raw) {
    if (!brainIdFn) return null;
    try {
        const j = JSON.parse(raw);
        const net = j.net || j;
        return net && net.weights ? brainIdFn(net) : null;
    } catch (e) { return null; }
}
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };

/* The generation line, e.g.
 *   gen  117 st2   best 2466 avg 371 | stood 81% bal 41% upright 3.6/17.1s | ...
 * Only the fields the dashboard shows are pulled out; anything missing simply
 * comes back undefined rather than throwing, because the line's shape varies —
 * the floor-start block is omitted entirely in generations that had none. */
function parseGenLine(line) {
    const m = /^gen\s+(\d+)\s+st(\d+)/.exec(line);
    if (!m) return null;
    const num = re => { const x = re.exec(line); return x ? +x[1] : null; };
    return {
        gen: +m[1],
        stage: +m[2],
        best: num(/best\s+(-?[\d.]+)/),
        avg: num(/avg\s+(-?[\d.]+)/),
        stood: num(/stood\s+(\d+)%/),
        balanced: num(/bal\s+(\d+)%/),
        walked: num(/walked\s+([\d.]+)\//),
        bestWalked: num(/walked\s+[\d.]+\/([\d.]+)/),
        ground: num(/floor\s+(\d+)%/),
        rose: num(/rose\s+(\d+)%/),
        wp: num(/wp\s+([\d.]+)\//),
        bestWp: num(/wp\s+[\d.]+\/([\d.]+)/),
        secPerGen: num(/([\d.]+)s\/gen/),
        mutRate: num(/mut\s+([\d.]+)\//),
        mutSigma: num(/mut\s+[\d.]+\/([\d.]+)/),
        roundGens: num(/TRACKS\s+(\d+)\//),
        roundOf: num(/TRACKS\s+\d+\/(\d+)/),
        tracks: (() => {
            const t = /TRACKS\s+\d+\/\d+\s+\[([^\]]*)\]/.exec(line);
            if (!t) return null;
            return t[1].trim().split(/\s+/).reduce((a, v, i, arr) => {
                if (i % 2 === 0) a.push({ name: v, best: arr[i + 1] === "-" ? null : +arr[i + 1] });
                return a;
            }, []);
        })(),
        // " leaky 72%/73%" — fleet mean and champion, while the two rectifiers
        // interbreed and the activation is a proportion rather than a label.
        leaky: num(/leaky\s+(\d+)%/),
        bestLeaky: num(/leaky\s+\d+%\/(\d+)%/),
        // " ACTS [tanh 4455 lrelu 3102 relu 2890]" — the live activation A/B.
        // Absent once the cull has run and there is only one deme left.
        acts: (() => {
            const t = /ACTS\s+\[([^\]]*)\]/.exec(line);
            if (!t) return null;
            return t[1].trim().split(/\s+/).reduce((a, v, i, arr) => {
                if (i % 2 === 0) a.push({ act: v, best: arr[i + 1] === "-" ? null : +arr[i + 1] });
                return a;
            }, []);
        })()
    };
}

/* Held-out exams. Both shapes the selector writes:
 *   [ts] NEW BEST gen 41: 0.42 wp / 1.08 m, >=2 on 0/12 (was ...)
 *   [ts] gen 101: 0.17 wp / 0.77 m — not better than 0.58 wp / 1.48 m       */
function parseHeldOut(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
        const m = /^\[(.+?)\]\s+(NEW BEST\s+)?gen\s+(\d+):\s+([\d.]+)\s+wp\s+\/\s+([\d.]+)\s+m/.exec(line);
        if (!m) continue;
        const two = /:\s*>=2 on (\d+)\//.exec(line) || />=2 on (\d+)\//.exec(line);
        out.push({ t: m[1], gen: +m[3], wp: +m[4], m: +m[5], two: two ? +two[1] : null, isBest: !!m[2] });
    }
    return out;
}

/* WHICH log the run is actually writing to.
 *
 * This read `run.log` unconditionally, and the launch script it was written for
 * used that name. Every relaunch script since — the transitions, the from-scratch
 * launcher, the continuous switch — appends to `new.log` instead, so the
 * dashboard has been parsing a file nothing writes: the live dot showed dark and
 * the live line showed whatever the last run to use run.log had left there.
 *
 * Picking the newest of the candidates fixes it for whichever script launched the
 * run, rather than requiring every launcher to agree on a name — which they
 * demonstrably do not. */
function liveLogPath() {
    let best = null, bestT = -1;
    for (const n of ["new.log", "run.log", "nohup.log"]) {
        const p = path.join(TRAIN, n);
        try {
            const t = fs.statSync(p).mtimeMs;
            if (t > bestT) { bestT = t; best = p; }
        } catch (e) { /* not there */ }
    }
    return best || path.join(TRAIN, "run.log");
}

function snapshot() {
    const runLog = readText(liveLogPath());
    const lines = runLog.split(/\r?\n/);

    // Live status: the last parseable generation line.
    let live = null;
    for (let i = lines.length - 1; i >= 0 && !live; i--) live = parseGenLine(lines[i]);

    /* Where THIS run began.
     *
     * A resumed run restores the seed's history into runlog.json, so the charts
     * carried 115 generations bred under a scheme that no longer exists —
     * different population structure, different activations, an isolation
     * experiment that has since been abandoned. Drawn on the same axes as the
     * current run they read as continuous, which is exactly the misreading this
     * project has already paid for once with the mission-bank curve.
     *
     * run.log is rotated on every relaunch, so its FIRST generation line is the
     * boundary, derived from the data rather than configured. The older points
     * are not deleted anywhere — they stay in runlog.json and in the rotated
     * logs beside it. */
    let runStart = null;
    for (const line of lines) { const g = parseGenLine(line); if (g) { runStart = g.gen; break; } }

    /* …unless a launch script has said otherwise. Rotation is the right boundary
     * for a relaunch that starts a NEW lineage, and the wrong one for a relaunch
     * that CONTINUES an existing one — grafting the LiDAR on kills and restarts
     * the trainer, but the brain, its history and its curriculum stage all carry
     * across, so the charts should span the change rather than begin at it. The
     * scripts know which of the two they are doing, so they write it down
     * instead of leaving the dashboard to guess. */
    const from = readJSON(path.join(TRAIN, "chart_from.json"));
    /* The lineage boundary as wall clock. Declared here because both the
     * milestone markers and the exam log need it, and they are read far apart. */
    const sinceMs = from && from.since ? Date.parse(from.since) : NaN;
    if (from && from.gen > 0) runStart = from.gen;

    /* Milestones: moments the operator needs to see ON the curves, because they
     * change what the numbers mean. A sensor arriving mid-run is exactly that —
     * without a marker, a step in the fitness curve at the graft looks like the
     * search finding something. */
    const milestones = (() => {
        const raw = readText(path.join(TRAIN, "milestones.jsonl")).trim();
        if (!raw) return [];
        return raw.split(/\r?\n/).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
                  .filter(m => m && m.gen > 0)
                  /* Same trap as the exam log: this file outlives a relaunch and
                   * its `gen` belongs to whichever lineage wrote it. A marker
                   * with a `t` is checked against the chart boundary; one
                   * without is from before timestamps existed and is kept, since
                   * dropping real history is the worse error. Launch scripts
                   * should archive this file when they start a new lineage. */
                  .filter(m => !m.t || !isFinite(sinceMs) || Date.parse(m.t) >= sinceMs);
    })();

    /* Events worth drawing on the charts: stage promotions and everything the
     * plateau machinery decided. Kept in order and tagged with the generation
     * they happened at, which is the generation of the nearest preceding line. */
    const events = [];
    let atGen = 0;
    for (const line of lines) {
        const g = parseGenLine(line);
        if (g) { atGen = g.gen; continue; }
        const t = line.trim();
        if (!t) continue;
        if (/^stage \d+ -> \d+/.test(t)) events.push({ gen: atGen, kind: "stage", text: t });
        else if (/^plateau:/.test(t)) events.push({ gen: atGen, kind: "plateau", text: t });
        else if (/OVERTOOK/.test(t)) events.push({ gen: atGen, kind: "adopt", text: t });
        else if (/^no track beat/.test(t)) events.push({ gen: atGen, kind: "dissolve", text: t });
        else if (/^activation cull/.test(t)) events.push({ gen: atGen, kind: "actcull", text: t });
        else if (/^deadline reached/.test(t)) events.push({ gen: atGen, kind: "stop", text: t });
    }

    const allSeries = (readJSON(path.join(TRAIN, "runlog.json")) || []).map((r, i) => ({
        gen: i + 1,
        best: r.best, avg: r.avg, stage: r.stage,
        stood: r.stoodFrac != null ? r.stoodFrac * 100 : null,
        balanced: r.balancedFrac != null ? r.balancedFrac * 100 : null,
        rose: r.roseFrac != null ? r.roseFrac * 100 : null,
        walked: r.avgProg, bestWalked: r.bestProg,
        wp: r.avgArr, bestWp: r.bestArr,
        // [{act, n, best, avg}] while the activation A/B is running.
        demes: r.demes || null,
        // Percent of hidden units that leak, once the rectifiers interbreed.
        leaky: r.leakyShare != null ? r.leakyShare * 100 : null,
        bestLeaky: r.bestLeaky != null ? r.bestLeaky * 100 : null
    }));

    /* NO OFFSET CORRECTION. There used to be one here, aligning runlog.json
     * against the live line with `offset = live.gen - series.length`, on the
     * theory that a resumed run's log started at zero while run.log continued
     * from the seed's generation number.
     *
     * It was wrong, and it silently mis-dated every point on every chart.
     * train.js seeds `runLog` from the restored history (`evo.history.slice()`),
     * so index + 1 has ALWAYS been the true generation. Meanwhile runlog.json is
     * only flushed every --save-every generations, so between flushes it is
     * shorter than the live generation number — and the correction read that lag
     * as a resume offset and shifted the whole array forward by it.
     *
     * How it showed: three generations after a save, every point moved three
     * generations to the right, which dragged the last records of the previous
     * training scheme into the window belonging to the current one. The chart
     * drew tanh lineages inside a run that has no tanh in it. The data on disk
     * was correct throughout — tanh ends at generation 115 and the interbreeding
     * pool starts at 116 — and only the dashboard was lying. */
    // Clip AFTER aligning — the alignment is computed from the full array's
    // length, so filtering first would shift every remaining point.
    const series = runStart == null ? allSeries : allSeries.filter(s => s.gen >= runStart);

    // Same file the live line is parsed from, or "alive" and "the last generation"
    // would be describing two different runs.
    const mtime = (() => { try { return fs.statSync(liveLogPath()).mtimeMs; } catch (e) { return 0; } })();

    /* The exam log outlives a relaunch, so it gets clipped too — but clipping it
     * by GENERATION is only sound while generation numbers keep increasing.
     *
     * They do not. A relaunch that starts a new lineage restarts numbering at 1,
     * and then every entry from the previous run satisfies `gen >= runStart` and
     * is drawn as if it belonged to this one. That is exactly what happened
     * across the LiDAR-to-foot-sensing change: 33 exams spanning generations
     * 6-191 of a dead run appeared on a chart whose run was ten generations old,
     * complete with an x-axis running to 191. The clue was that the axis
     * outran the run.
     *
     * So the boundary is a TIMESTAMP when a launch script provides one. Wall
     * clock is monotonic across relaunches in a way generation numbers are not,
     * and every exam line already carries one. Generation clipping stays as the
     * fallback for logs written before `since` existed. */
    const allHeld = parseHeldOut(readText(path.join(TRAIN, "autoselect.log")));
    const keep = h => isFinite(sinceMs)
        ? Date.parse(h.t.replace(" ", "T") + "Z") >= sinceMs
        : (runStart == null || h.gen >= runStart);
    const kept = allHeld.filter(keep);
    /* Second boundary, and it is not redundant with the first.
     *
     * `since` only works if the launch script stamps chart_from.json. Three
     * scripts written on 2026-08-01 did not, so the boundary still pointed at
     * the PREVIOUS lineage's start and the chart drew two runs at once: the
     * dead run's generations 16-536 and the live run's 1-154, on one axis, with
     * the line running up to 536 and then falling back. The training charts,
     * which read runlog.json and are rewritten per run, correctly showed 153 —
     * so the two halves of the dashboard disagreed about how old the run was.
     *
     * Relying on a human to stamp a file is not a mechanism. Generation numbers
     * inside one lineage never decrease, so a DECREASE is a relaunch, full stop.
     * Cut at the last one and keep only what follows. */
    let cut = 0;
    for (let i = 1; i < kept.length; i++) if (kept[i].gen < kept[i - 1].gen) cut = i;
    const heldout = cut ? kept.slice(cut) : kept;
    const dropped = cut ? kept.slice(0, cut) : [];
    /* The incumbent bar comes from whatever was best BEFORE this lineage —
     * including anything the cut just removed, which is still a real result the
     * run has to beat. */
    let priorBest = [...allHeld.filter(h => !keep(h)), ...dropped].filter(h => h.isBest).pop() || null;
    /* When a relaunch restarts generation numbering, no surviving log entry sits
     * BEFORE the new run, so the bar the run has to clear would vanish from the
     * chart even though the ratchet still enforces it. Fall back to the score
     * file, which is the ratchet itself. */
    const score = readJSON(path.join(TRAIN, "best_holdout_score.json"));
    if (!priorBest && score && score.waypoints != null && !heldout.some(h => h.isBest)) {
        priorBest = { gen: runStart || 1, wp: score.waypoints, m: score.metres, carried: true };
    }

    return {
        now: Date.now(),
        alive: Date.now() - mtime < 5 * 60 * 1000,
        lastWrite: mtime,
        live,
        runStart, milestones,
        priorGens: allSeries.length - series.length,
        series,
        events: events.slice(-60),
        heldout, priorBest,
        best: readJSON(path.join(TRAIN, "best_holdout_score.json")),
        /* Two different facts, and the button needs both. `stopRequested` is
         * whether the sentinel is on disk; `stopped` is whether the trainer has
         * actually noticed and exited. Between them is up to one generation of
         * lag, and showing "stopped" during that window would be a lie the user
         * would act on. */
        stopRequested: fs.existsSync(path.join(TRAIN, "STOP")),
        /* Only THIS launch's deadline.
         *
         * The log is appended across relaunches, so scanning it whole and taking
         * the first match returns a deadline that expired two runs ago — and a
         * run with no deadline at all then displays a countdown to a moment in
         * the past. The trainer prints a banner line naming the network shape and
         * thread count every time it starts, so the current launch is everything
         * after the last one of those. */
        deadline: (() => {
            const starts = [...runLog.matchAll(/brain \d+-\d+-\d+-\d+, \d+ threads/g)];
            const tail = starts.length ? runLog.slice(starts[starts.length - 1].index) : runLog;
            const m = /deadline (\S+) —/.exec(tail);
            return m ? Date.parse(m[1]) : null;
        })()
    };
}

const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    try {
        if (url === "/api") {
            const body = JSON.stringify(snapshot());
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
            return res.end(body);
        }
        /* The champion genome itself, for the "send to browser" button.
         *
         * CORS is wide open on purpose and it is safe to be: this serves one
         * read-only file of neural-network weights on a box reached through an
         * SSH tunnel. The button needs it because the dashboard page and the
         * local bake bridge are different origins — the page is served from the
         * training node through the tunnel, and the bridge listens on the
         * laptop. Without the header the browser refuses the hop and the button
         * fails with a console error nobody reads. */
        /* The saved-brain list behind the dashboard's transfer table.
         *
         * Scoped to the training directory and to *.json, and the filename is
         * re-derived with path.basename before it is ever joined — a dashboard
         * that will hand back any file it is asked for is a file server, and this
         * one is reachable from a browser. */
        /* Stop / resume the run by writing or clearing a sentinel the trainer
         * checks once per generation.
         *
         * The trainer is launched detached and the dashboard is a separate
         * process, possibly reached through a tunnel; neither holds the other's
         * pid, so a file is the only channel they already share. It is also the
         * only way to stop CLEANLY — killing the process discards whatever the
         * current generation has scored and leaves champion.json describing a
         * population that never finished being measured.
         *
         * DELETE clears the flag. That matters because the file outlives the run
         * on purpose: a stopped run that tidied up after itself would be
         * indistinguishable from one that was never stopped. */
        if (url === "/api/stop") {
            const stopFile = path.join(TRAIN, "STOP");
            if (req.method === "POST") {
                try {
                    fs.mkdirSync(TRAIN, { recursive: true });
                    fs.writeFileSync(stopFile, new Date().toISOString() + " requested from the dashboard\n");
                } catch (e) {
                    res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
                    return res.end(JSON.stringify({ ok: false, error: e.message }));
                }
                res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
                return res.end(JSON.stringify({ ok: true, stopping: true }));
            }
            if (req.method === "DELETE") {
                try { fs.unlinkSync(stopFile); } catch (e) { /* already gone is success */ }
                res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
                return res.end(JSON.stringify({ ok: true, stopping: false }));
            }
            res.writeHead(405, { "content-type": "text/plain", "access-control-allow-origin": "*" });
            return res.end("POST to stop, DELETE to cancel");
        }
        if (url === "/api/brains") {
            let names = [];
            try { names = fs.readdirSync(TRAIN).filter(n => /\.json$/.test(n)); } catch (e) { /* no dir yet */ }
            const rows = [];
            for (const n of names) {
                if (/^(chart_from|runlog|best_holdout_score|delta_gains)\.json$/.test(n)) continue;
                const p = path.join(TRAIN, n);
                let st; try { st = fs.statSync(p); } catch (e) { continue; }
                if (st.size < 1000) continue;                 // not a genome
                /* Read once per file, then cache on (mtime, size).
                 *
                 * Sampling the first 4 KB was the obvious cheap thing and it does
                 * not work: the trainer writes the weight block first, so "gen"
                 * lands around byte 414,000 of a 709,000-byte file and both the
                 * head and the tail miss it. There is no header to sample, so the
                 * file is scanned whole — and cached, because the list is polled
                 * and a snapshot never changes once written. */
                const key = n + ":" + st.mtimeMs + ":" + st.size;
                let info = brainInfoCache.get(key);
                if (!info) {
                    let raw = "";
                    try { raw = fs.readFileSync(p, "utf8"); } catch (e) { continue; }
                    const gen = /"gen"\s*:\s*(-?\d+)/.exec(raw);
                    const fit = /"fitness"\s*:\s*(-?[\d.eE+]+)/.exec(raw);
                    const sizes = /"sizes"\s*:\s*\[([^\]]*)\]/.exec(raw);
                    info = {
                        gen: gen ? +gen[1] : null,
                        fitness: fit ? +fit[1] : null,
                        sizes: sizes ? sizes[1].replace(/\s/g, "").split(",").join("-") : null,
                        id: brainIdOf(raw)
                    };
                    /* Unbounded growth would be a slow leak on a box that runs for
                     * days. Snapshots accumulate; the cache does not need to. */
                    if (brainInfoCache.size > 400) brainInfoCache.clear();
                    brainInfoCache.set(key, info);
                }
                rows.push({ file: n, ...info, mtime: st.mtimeMs, bytes: st.size, live: n === "champion.json" });
            }
            // newest first: the one you want is almost always the one just written
            rows.sort((a, b) => b.mtime - a.mtime);
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store",
                                 "access-control-allow-origin": "*" });
            return res.end(JSON.stringify(rows));
        }
        if (url === "/api/brain") {
            const q = new URL(req.url, "http://x").searchParams.get("f") || "";
            const safe = path.basename(q);               // no traversal, ever
            if (!/\.json$/.test(safe)) {
                res.writeHead(400, { "content-type": "text/plain", "access-control-allow-origin": "*" });
                return res.end("not a .json");
            }
            const raw = readText(path.join(TRAIN, safe));
            if (!raw) {
                res.writeHead(404, { "content-type": "text/plain", "access-control-allow-origin": "*" });
                return res.end("no such brain");
            }
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store",
                                 "access-control-allow-origin": "*" });
            return res.end(raw);
        }
        if (url === "/api/champion") {
            const raw = readText(path.join(TRAIN, "champion.json"));
            if (!raw) {
                res.writeHead(404, { "content-type": "text/plain", "access-control-allow-origin": "*" });
                return res.end("no champion.json yet");
            }
            res.writeHead(200, {
                "content-type": "application/json",
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
                // so a plain browser download lands with a sensible name
                "content-disposition": 'inline; filename="champion.json"'
            });
            return res.end(raw);
        }
        if (url === "/" || url === "/index.html") {
            // Read per request so the page can be edited without a restart.
            const html = readText(path.join(__dirname, "dashboard.html"));
            const inject = `<script>window.ISLAND=${JSON.stringify({ label: LABEL, peer: PEER, peerLabel: PEER_LABEL })};</script>`;
            res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            return res.end(html ? html.replace("</head>", inject + "\n</head>") : "<h1>dashboard.html is missing</h1>");
        }
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
    } catch (e) {
        // A dashboard must never be the thing that pages someone at 3am.
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("error: " + (e && e.message));
    }
});
server.listen(PORT, "0.0.0.0", () => {
    console.log(`dashboard on http://0.0.0.0:${PORT} reading ${TRAIN}`);
});
