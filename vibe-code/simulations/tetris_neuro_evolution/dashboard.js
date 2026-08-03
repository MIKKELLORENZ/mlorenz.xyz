/* dashboard.js — a live view of whatever this box is currently evolving.
 *
 *   node dashboard.js --port 8899 [--dir training/grid]
 *
 * No dependencies and no build step: one file, an HTTP server, and the training
 * logs as the only source of truth. It reads the same files a human would `tail`,
 * so it cannot drift from reality or claim progress that did not happen.
 *
 * Three routes:
 *   /            the page (self-contained HTML, polls the API every 10s)
 *   /api/status  everything it knows, as JSON
 *   /api/cull    POST — asks the meta-controller to run an era early
 *
 * It never executes anything from the request, and it never decides anything.
 * /api/cull takes no body, no parameters and no path: it writes one fixed
 * filename inside the directory it is already watching, and genius.js does the
 * rest, under exactly the rules a scheduled era uses. That indirection is the
 * point — a dashboard that could retire cells directly would be a second place
 * where the rules live, and the two would drift.
 *
 * On the chart: fifteen experiments are shown as fifteen small multiples, not as
 * fifteen lines in one frame. Beyond about eight series a single frame is
 * unreadable, and there are not fifteen colours that stay distinguishable to a
 * colourblind reader. Every panel shares one y-scale per metric, so panels are
 * comparable by height, and every panel is drawn in the same hue — colour here
 * carries no meaning, because if it tracked *rank* the colours would swap
 * between experiments every time one overtook another.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const PORT = +arg("port", 8899);
const DIR = path.resolve(__dirname, String(arg("dir", "training/grid")));
const TRAINING = path.resolve(__dirname, "training");

/* ---- log parsing -------------------------------------------------------- */
// gen 14021  best 589  avg 310  lines 5/2.0  pieces 40  σ 0.798×0.28  4.8s ~shake  gate 170.7 (69/73 rejected)
const LINE = /gen\s+(\d+)\s+best\s+(-?[\d.]+)\s+avg\s+(-?[\d.]+)\s+lines\s+([\d.]+)\/([\d.]+)\s+pieces\s+(\d+)\s+\u03c3\s+([\d.]+)\u00d7([\d.]+)\s+([\d.]+)s/;
const GATE = /gate\s+([\d.]+)\s+\((\d+)\/(\d+)\s+rejected\)/;

function readTail(file, maxBytes) {
    const fd = fs.openSync(file, "r");
    try {
        const size = fs.fstatSync(fd).size;
        const len = Math.min(size, maxBytes);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        return buf.toString("utf8");
    } finally { fs.closeSync(fd); }
}

function parseCell(name, file) {
    let text;
    try { text = readTail(file, 900 * 1024); } catch (e) { return null; }
    const lines = text.split("\n").filter(l => LINE.test(l));
    if (!lines.length) return { name, gen: 0, waiting: true, series: [] };
    const last = lines[lines.length - 1];
    const m = last.match(LINE);
    const g = last.match(GATE);

    /* A downsampled series for the charts — at most 140 points per cell. Each
     * point averages its bucket rather than sampling one line out of it, because
     * generation-to-generation fitness is noisy and a lone sample would draw a
     * hairy line that hides the trend the chart exists to show. */
    const series = [];
    const step = Math.max(1, Math.ceil(lines.length / 140));
    for (let i = 0; i < lines.length; i += step) {
        let n = 0, avg = 0, pieces = 0, avgLines = 0, bestLines = 0, gen = 0, gate = null;
        for (let j = i; j < Math.min(i + step, lines.length); j++) {
            const mm = lines[j].match(LINE);
            if (!mm) continue;
            gen = +mm[1]; avg += +mm[3]; bestLines = Math.max(bestLines, +mm[4]);
            avgLines += +mm[5]; pieces += +mm[6];
            const gg = lines[j].match(GATE);
            if (gg) gate = +gg[1];
            n++;
        }
        if (n) series.push({
            gen, avg: avg / n, lines: avgLines / n, pieces: pieces / n, bestLines, gate,
        });
    }

    const head = (() => {
        try { return fs.readFileSync(file, "utf8").split("\n").slice(0, 3).join(" | "); }
        catch (e) { return ""; }
    })();
    return {
        name,
        gen: +m[1], best: +m[2], avg: +m[3],
        bestLines: +m[4], avgLines: +m[5], pieces: +m[6],
        sigma: +m[7], sigmaMul: +m[8], secs: +m[9],
        gateSkill: g ? +g[1] : null, gateRejects: g ? +g[2] : 0, gateChecks: g ? +g[3] : 0,
        // the size of the gate bank is only ever stated on a rotation line
        gateGames: +((text.match(/on (\d+) fresh games/) || [])[1]) || null,
        promotions: (text.match(/\u2605/g) || []).length,
        finished: /done \u2014/.test(text),
        resumedFrom: (head.match(/resumed from ([^\s:]+): gen (\d+)/) || []).slice(1).join(" gen "),
        series,
    };
}

function collect() {
    const out = {
        now: Date.now(), host: os.hostname(),
        load: os.loadavg().map(x => +x.toFixed(1)), cores: os.cpus().length,
        cells: [], header: null, seed: null, done: null, ranking: null, kind: path.basename(DIR),
    };
    for (const name of ["genius.log", "grid.log"]) {
        try {
            const gl = path.join(DIR, name);
            if (!fs.existsSync(gl)) continue;
            const t = fs.readFileSync(gl, "utf8").split("\n").filter(Boolean);
            out.header = t[0] || null;
            out.events = t.slice(-30);
            const m = (out.header || "").match(/until (\d\d:\d\d) UTC/);
            if (m) out.deadlineUTC = m[1];
            break;
        } catch (e) { /* the log may not exist yet */ }
    }
    /* When genius.js is driving, the cells are not a fixed grid: they are born,
     * judged and retired every era, and which variant a cell *is* matters more
     * than its name. */
    try { out.genius = JSON.parse(fs.readFileSync(path.join(DIR, "genius.json"), "utf8")); }
    catch (e) { out.genius = null; }
    // the sentinel is still on disk = the controller has not picked it up yet
    out.cullPending = fs.existsSync(path.join(DIR, "CULL_NOW"));
    out.deepPending = fs.existsSync(path.join(DIR, "DEEP_NOW"));
    /* The progression track: one line for the current leader, one for the record,
     * both on the same independent bank. This is the only chart that answers
     * "is the system as a whole getting better". */
    try {
        const rows = fs.readFileSync(path.join(DIR, "leader.jsonl"), "utf8").split(/\r?\n/)
            .filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
            .filter(Boolean);
        const step = Math.max(1, Math.ceil(rows.length / 240));
        out.leader = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    } catch (e) { out.leader = null; }
    try {
        const s = JSON.parse(fs.readFileSync(path.join(TRAINING, "best_holdout.json"), "utf8"));
        out.seed = {
            config: s.configName, gen: s.gen,
            profile: s.config && s.config.profile,
            hidden: s.config && s.config.arch && s.config.arch.hidden,
            act: s.config && s.config.arch && s.config.arch.acts && s.config.arch.acts.hidden,
            holdout: s.holdout || null,
        };
    } catch (e) { /* no seed yet */ }
    try { out.done = JSON.parse(fs.readFileSync(path.join(DIR, "DONE.json"), "utf8")); } catch (e) { }
    for (const f of ["grid_best_ranking.json", "best_holdout_ranking.json"]) {
        try {
            out.ranking = JSON.parse(fs.readFileSync(path.join(TRAINING, f), "utf8")).slice(0, 12);
            out.rankingFrom = f;
            break;
        } catch (e) { }
    }

    /* the held-out probe log is the source for the charts: population averages
     * are dominated by fresh mutants and mostly measure mutation strength */
    const probes = new Map();
    /* …but only this run's rows. holdout.jsonl is append-only across controller
     * restarts, and a restart re-uses cell names: the variant tags are drawn from
     * the same list, so a new `e0_arch_-L` lands on top of a retired one's history.
     * Its generation counter restarts at the record's, far below where the old cell
     * finished — one cell's line ran to gen 17,264 and then continued at 15,480 —
     * which plots as a line looping back on itself and a "best" belonging to a
     * brain that no longer exists. Nothing is deleted; the old rows are simply not
     * this run's. */
    const runFrom = out.genius && out.genius.started ? Date.parse(out.genius.started) : null;
    try {
        const raw = fs.readFileSync(path.join(DIR, "holdout.jsonl"), "utf8").split("\n");
        for (const line of raw) {
            if (!line) continue;
            let pr;
            try { pr = JSON.parse(line); } catch (e) { continue; }
            if (runFrom && pr.t && pr.t < runFrom) continue;
            if (!probes.has(pr.cell)) probes.set(pr.cell, []);
            probes.get(pr.cell).push(pr);
        }
    } catch (e) { /* no probes yet */ }
    out.runFrom = runFrom;
    out.probed = probes.size;
    /* The sample size behind every held-out number, taken from the data rather
     * than assumed. Comparing a 40-game score with a 100-game one as if they were
     * the same measurement is how a lucky draw becomes a "record", so the page
     * states the count on every column it shows. */
    {
        const sizes = new Set();
        for (const rows of probes.values()) {
            const last = rows[rows.length - 1];
            if (last && last.games) sizes.add(last.games);
        }
        out.probeGames = sizes.size === 1 ? [...sizes][0] : (sizes.size ? [...sizes].sort((x, y) => y - x) : null);
    }

    let names = [];
    try {
        names = JSON.parse(fs.readFileSync(path.join(DIR, "cells.json"), "utf8")).map(c => c.name);
    } catch (e) {
        try { names = fs.readdirSync(DIR).filter(f => f.endsWith(".log") && f !== "grid.log").map(f => f.slice(0, -4)); }
        catch (e2) { names = []; }
    }
    for (const n of names) {
        const f = path.join(DIR, n + ".log");
        if (!fs.existsSync(f)) continue;
        const c = parseCell(n, f);
        if (!c) continue;
        const pr = probes.get(n) || [];
        const step = Math.max(1, Math.ceil(pr.length / 160));
        c.series = pr.filter((_, i) => i % step === 0 || i === pr.length - 1);
        c.holdout = pr.length ? pr[pr.length - 1] : null;
        c.bestSkill = pr.length ? Math.max(...pr.map(x => x.skill)) : null;
        const g = out.genius && (out.genius.live || []).find(x => x.name === n);
        if (g) {
            c.family = g.family; c.age = g.age; c.born = g.born;
            c.ageMin = g.ageMin; c.cullable = g.cullable;
            c.variant = g.note; c.hidden = g.hidden;
            c.birthSkill = g.birthSkill; c.eraSkill = g.lastSkill;
            c.frozen = !!g.frozen; c.deep = !!g.deep;
        }
        out.cells.push(c);
    }
    out.cells.sort((a, b) =>
        ((b.bestSkill == null ? -1 : b.bestSkill) - (a.bestSkill == null ? -1 : a.bestSkill)) ||
        ((b.gateSkill || -1) - (a.gateSkill || -1)) || ((b.gen || 0) - (a.gen || 0)));
    return out;
}

/* ---- the page ------------------------------------------------------------ */
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tetris neuroevolution — live</title>
<style>
/* Two modes, each with its own steps rather than one flipped programmatically.
   Both series pairs are validated against their own surface for the lightness
   band, chroma floor, CVD separation and contrast (dark ΔE 26.6, light 27.7). */
:root{
  color-scheme:light dark;
  --bg:#f5f5f7;--panel:#ffffff;--line:#e6e6e9;--sunk:#f2f2f4;
  --ink:#1d1d1f;--dim:#6e6e73;--faint:#a1a1a6;
  --series:#0071e3;--series2:#248a3d;
  --good:#248a3d;--warn:#b25000;--bad:#c1121f;
  --shadow:0 1px 2px rgba(0,0,0,.05),0 8px 28px rgba(0,0,0,.05);
  --r:18px;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#000;--panel:#1c1c1e;--line:#2c2c2e;--sunk:#262629;
    --ink:#f5f5f7;--dim:#a1a1a6;--faint:#6e6e73;
    --series:#0a84ff;--series2:#2ba75f;
    --good:#2ba75f;--warn:#ff9f0a;--bad:#ff453a;
    --shadow:none;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;
  letter-spacing:-.01em}
header{position:sticky;top:0;z-index:5;padding:14px 24px;
  background:color-mix(in srgb,var(--bg) 82%,transparent);
  backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
  border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:14px;align-items:center}
h1{font-size:16px;margin:0;font-weight:600;letter-spacing:-.02em}
h2{font-size:19px;margin:0 0 4px;font-weight:600;letter-spacing:-.02em}
.sub{color:var(--dim);font-size:13px}
main{padding:28px 24px 64px;max-width:1080px;margin:0 auto}
section{margin-bottom:34px}
.card,.hero,.mini,table{background:var(--panel);border:1px solid var(--line);
  border-radius:var(--r);box-shadow:var(--shadow)}
/* the hero: one number, its meaning, and the chart that justifies it */
.hero{padding:26px 28px 18px;margin-bottom:14px}
.eyebrow{color:var(--dim);font-size:13px;font-weight:500}
.big{font-size:clamp(44px,7vw,68px);line-height:1.02;font-weight:600;letter-spacing:-.035em;margin:2px 0 0}
.big .d{font-size:.32em;font-weight:500;letter-spacing:-.01em;margin-left:.35em;vertical-align:.55em}
.heroSub{color:var(--dim);font-size:14px;margin-top:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.card{padding:15px 17px}
.card .k{color:var(--dim);font-size:12px;font-weight:500}
.card .v{font-size:25px;font-weight:600;letter-spacing:-.025em;margin-top:3px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card .sub{font-size:12px;color:var(--faint);margin-top:2px}
/* segmented controls, the way iOS does them */
.tabs{display:inline-flex;gap:2px;padding:2px;background:var(--sunk);
  border-radius:10px;margin:0 8px 12px 0;vertical-align:middle}
.tab{background:transparent;border:0;color:var(--dim);border-radius:8px;
  padding:5px 12px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;letter-spacing:-.01em}
.tab[aria-pressed="true"]{color:var(--ink);background:var(--panel);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.mini{padding:12px 14px 8px}
.mini .t{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.mini .n{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mini .cur{font-size:15px;font-weight:600;letter-spacing:-.02em}
.mini .d{font-size:11px;color:var(--faint);margin-bottom:2px}
svg{display:block;width:100%;height:auto;overflow:visible}
/* the long explanations live here now: present, never shouting */
details{margin-top:14px;font-size:13px;color:var(--dim)}
summary{cursor:pointer;color:var(--series);font-weight:500;list-style:none;width:fit-content}
summary::-webkit-details-marker{display:none}
summary::after{content:" ›";display:inline-block;transition:transform .15s}
details[open] summary::after{transform:rotate(90deg) translateX(1px)}
details p{margin:10px 0 0;max-width:66ch}
.tableWrap{overflow-x:auto;border-radius:var(--r)}
table{width:100%;border-collapse:collapse;overflow:hidden;font-size:14px}
th,td{padding:12px 16px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--dim);font-weight:500;font-size:12px}
th:first-child,td:first-child{text-align:left}
td:first-child{font-weight:500}
td .sub{font-size:12px;color:var(--faint);font-weight:400;white-space:normal;max-width:30ch}
tr:last-child td{border-bottom:none}
.good{color:var(--good)}.warn{color:var(--warn)}.dim{color:var(--dim)}.ink{color:var(--ink)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--good);margin-right:8px;vertical-align:middle}
.dot.off{background:var(--bad)}
.hrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.hrow h2{margin:0}
.act{background:var(--panel);border:1px solid var(--line);color:var(--series);border-radius:980px;
     padding:7px 16px;font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.act:hover:not(:disabled){background:var(--sunk)}
.act:disabled{color:var(--faint);cursor:default}
.act.pending{color:var(--warn)}
/* The deep-dive banner. Status, not a series — it wears --warn, which is reserved
   for state and never handed out as a chart hue. */
.deep{background:var(--panel);border:1px solid var(--warn);border-radius:var(--r);
  padding:16px 20px;margin-bottom:22px;font-size:13px;color:var(--dim)}
.deep .t{color:var(--ink);font-size:15px;font-weight:600;margin-bottom:6px;letter-spacing:-.02em}
.deep .prog{height:5px;background:var(--sunk);border-radius:3px;overflow:hidden;margin:11px 0 9px}
.deep .prog i{display:block;height:100%;background:var(--warn);border-radius:3px}
.deep.done{border-color:var(--line)}
@media(max-width:700px){
  main{padding:20px 16px 48px}
  .hero{padding:20px}
  th,td{padding:10px 12px}
}
</style></head><body>
<header>
  <h1><span class="dot" id="dot"></span>Tetris neuroevolution — live</h1>
  <div class="sub" id="sub">connecting…</div>
  <div class="sub" id="clock" style="margin-left:auto"></div>
</header>
<main>
  <div id="deepBanner" style="display:none"></div>

  <section class="hero">
    <div class="eyebrow" id="heroLabel">Skill</div>
    <div class="big" id="heroVal">&mdash;</div>
    <div class="heroSub" id="heroSub"></div>
    <div id="progChart" style="margin-top:18px"></div>
    <div class="heroSub" id="progNote" style="font-size:13px"></div>
    <details id="heroWhat">
      <summary>How this is measured</summary>
      <p id="progWhat"></p>
      <p><b>Skill</b> is pieces placed + 25 &times; lines cleared, averaged over the games. A
      &ldquo;game&rdquo; is one complete game played from a fixed seed, and the seed fixes the whole piece
      sequence &mdash; so the same seed is always literally the same game, and every brain faces identical
      pieces. Nothing trains or selects on these particular seeds, which is what lets the line be read as
      progress rather than as luck.</p>
    </details>
  </section>

  <section>
    <div class="cards" id="cards"></div>
  </section>

  <section id="perCell">
    <h2>Each experiment</h2>
    <div class="tabs" id="tabs"></div>
    <div class="tabs" id="views">
      <button class="tab" data-v="raw" aria-pressed="true">As measured</button>
      <button class="tab" data-v="smooth" aria-pressed="false">Smoothed</button>
      <button class="tab" data-v="best" aria-pressed="false">Best so far</button>
    </div>
    <div class="sub" id="metricNote" style="margin-bottom:12px"></div>
    <div class="grid" id="charts"></div>
  </section>

  <section>
    <div class="hrow">
      <h2 id="tableTitle">Details</h2>
      <button class="act" id="cullBtn" disabled>Force a cull</button>
      <button class="act" id="deepBtn" disabled>Deep dive</button>
    </div>
    <div class="sub" id="cullNote" style="margin-bottom:6px"></div>
    <div class="sub" id="deepNote" style="margin-bottom:12px"></div>
    <div class="tableWrap"><table><thead><tr>
      <th id="thName">Run</th><th id="thBest">Skill</th>
      <th id="thLines">Lines</th><th id="thPieces">Pieces</th>
      <th>Generation</th><th id="thKept">Kept</th>
    </tr></thead><tbody id="rows"></tbody></table></div>
    <details>
      <summary>What these numbers are</summary>
      <p><b>Skill</b> is the champion replayed on one fixed bank of games that nothing trains or selects
      on &mdash; a measuring stick, not a target. <b>Kept</b> is the share of challengers that survived
      independent verification; a low number means the search is mostly chasing noise.</p>
    </details>
  </section>

</main>
<script>
const $=s=>document.querySelector(s);
const METRICS=[
  {k:"skill",   label:"held-out skill",   hint:"pieces + 25 × lines, reward-independent"},
  {k:"lines",   label:"held-out lines",   hint:"lines cleared per game"},
  {k:"pieces",  label:"held-out pieces",  hint:"pieces placed per game"},
  {k:"fitness", label:"held-out fitness", hint:"the reward being optimised — comparable here because every cell shares one reward"},
  {k:"buried",  label:"held-out holes buried", hint:"cells sealed under the stack per piece — lower is better"},
];
let metric="skill", view="raw", state=null;

function scale(v,lo,hi,a,b){ return hi===lo ? (a+b)/2 : a+(v-lo)/(hi-lo)*(b-a); }

/* Lower is better for holes buried; everything else is better higher. */
const LOWER_IS_BETTER={buried:1};
/* The running best on a bank that never changes and that nothing selects on.
   That is what makes the line monotone: it is not a claim that the cell never
   got worse, it is "the best this cell has ever been measured at, so far". */
function bestSoFar(pts,k){
  const lower=!!LOWER_IS_BETTER[k];
  let run=null;
  return pts.map(p=>{
    const v=p[k];
    if(run===null||(lower?v<run:v>run)) run=v;
    return Object.assign({},p,{[k]:run});
  });
}
/* A trailing mean over the same fixed games. Not a ratchet and not a re-draw of
   the bank — just less noise on an identical measurement, which is the only
   honest way to make a trend visible. */
function smooth(pts,k,w){
  return pts.map((p,i)=>{
    const lo=Math.max(0,i-w+1);
    let sum=0,n=0;
    for(let j=lo;j<=i;j++){ sum+=pts[j][k]; n++; }
    return Object.assign({},p,{[k]:sum/n});
  });
}
function shape(raw,k){
  if(view==='best') return bestSoFar(raw,k);
  if(view==='smooth') return smooth(raw,k,3);
  return raw;
}
function panel(cell,dom,xdom){
  const W=270,H=86,PL=6,PR=6,PT=8,PB=12;
  const raw=(cell.series||[]).filter(p=>p[metric]!=null);
  const pts=shape(raw,metric);
  const nowV=raw.length?raw[raw.length-1][metric]:null;
  const cur=pts.length?pts[pts.length-1][metric]:null;
  const first=pts.length?pts[0][metric]:null;
  const delta=(cur!=null&&first!=null)?cur-first:null;
  let body;
  if(pts.length<2){
    body='<svg viewBox="0 0 '+W+' '+H+'"><text x="'+(W/2)+'" y="'+(H/2)+'" fill="var(--faint)" font-size="11" text-anchor="middle">waiting for data</text></svg>';
  }else{
    const d=pts.map(p=>{
      const x=scale(p.gen,xdom[0],xdom[1],PL,W-PR);
      const y=scale(p[metric],dom[0],dom[1],H-PB,PT);
      return x.toFixed(1)+','+y.toFixed(1);
    }).join(' ');
    const gy=[dom[0],(dom[0]+dom[1])/2,dom[1]].map(v=>
      '<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+scale(v,dom[0],dom[1],H-PB,PT).toFixed(1)+'" y2="'+scale(v,dom[0],dom[1],H-PB,PT).toFixed(1)+'" stroke="var(--line)" stroke-width="1"/>').join('');
    const lastPt=pts[pts.length-1];
    body='<svg viewBox="0 0 '+W+' '+H+'" data-cell="'+cell.name+'">'+gy+
      '<polyline fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="'+d+'"/>'+
      '<circle r="3" fill="var(--series)" stroke="var(--panel)" stroke-width="2" cx="'+scale(lastPt.gen,xdom[0],xdom[1],PL,W-PR).toFixed(1)+'" cy="'+scale(lastPt[metric],dom[0],dom[1],H-PB,PT).toFixed(1)+'"/>'+
      '<g class="hov" style="display:none"><line stroke="var(--faint)" stroke-width="1" y1="'+PT+'" y2="'+(H-PB)+'"/><circle r="3.5" fill="var(--ink)"/></g>'+
      '<rect x="0" y="0" width="'+W+'" height="'+H+'" fill="transparent" class="hit"/></svg>';
  }
  const fmt=v=>v==null?'—':(Math.abs(v)>=100?v.toFixed(0):v.toFixed(2));
  const sign=delta==null?'':(delta>=0?'+':'');
  const dcls=delta==null?'dim':(delta>0?'good':(delta<0?'warn':'dim'));
  let nowTxt='';
  if(view==='best'&&nowV!=null&&nowV!==cur) nowTxt=' · now '+fmt(nowV);
  else if(view!=='best'&&cell.bestSkill!=null&&metric==='skill') nowTxt=' · best '+fmt(cell.bestSkill);
  return '<div class="mini" data-cell="'+cell.name+'">'+
    '<div class="t"><span class="n" title="'+cell.name+'">'+cell.name+'</span>'+
    '<span class="cur">'+fmt(cur)+' <span class="'+dcls+'" style="font-size:11px">'+sign+fmt(delta)+'</span></span></div>'+
    '<div class="d" data-read>gen '+(cell.gen||0).toLocaleString()+nowTxt+'</div>'+body+'</div>';
}

function draw(){
  if(!state) return;
  const cells=state.cells;
  const vals=[],gens=[];
  for(const c of cells){
    const raw=(c.series||[]).filter(p=>p[metric]!=null);
    for(const p of shape(raw,metric)) vals.push(p[metric]);
    for(const p of (c.series||[])) gens.push(p.gen);
  }
  if(!vals.length){ $('#charts').innerHTML='<div class="mini">no data yet</div>'; return; }
  let lo=Math.min(...vals), hi=Math.max(...vals);
  const pad=(hi-lo)*0.08||1; lo-=pad; hi+=pad;
  const xdom=[Math.min(...gens),Math.max(...gens)];
  /* Order the panels by the number each one is actually showing — the current
     metric, under the current view. The table below ranks on best-ever, which is
     the right key there because "best skill" is its first column; using that key
     here put a panel headlined 121 above one headlined 146 and made the row look
     unsorted. The two orders answer different questions and now each is sorted on
     what it displays. */
  const shown=c=>{
    const raw=(c.series||[]).filter(p=>p[metric]!=null);
    if(!raw.length) return null;
    const pts=shape(raw,metric);
    return pts[pts.length-1][metric];
  };
  const sign=LOWER_IS_BETTER[metric]?1:-1;   // holes buried: fewer is better
  const ordered=cells.slice().sort((a,b)=>{
    const x=shown(a),y=shown(b);
    if(x==null&&y==null) return 0;
    if(x==null) return 1;
    if(y==null) return -1;
    return sign*(x-y);
  });
  $('#charts').innerHTML=ordered.map(c=>panel(c,[lo,hi],xdom)).join('');
  const m=METRICS.find(x=>x.k===metric);
  $('#metricNote').textContent=m.hint+'. Same vertical scale on every panel, best first. Hover for a value.';
  // hover readout
  for(const svg of document.querySelectorAll('#charts svg[data-cell]')){
    const name=svg.getAttribute('data-cell');
    const cell=cells.find(c=>c.name===name);
    const pts=(cell.series||[]).filter(p=>p[metric]!=null);
    const g=svg.querySelector('.hov'), read=svg.parentElement.querySelector('[data-read]');
    const base=read.textContent;
    svg.addEventListener('mousemove',ev=>{
      const r=svg.getBoundingClientRect();
      const vx=(ev.clientX-r.left)/r.width*270;
      let bestP=pts[0],bd=1e9;
      for(const p of pts){ const x=scale(p.gen,xdom[0],xdom[1],6,264); if(Math.abs(x-vx)<bd){bd=Math.abs(x-vx);bestP=p;} }
      const x=scale(bestP.gen,xdom[0],xdom[1],6,264), y=scale(bestP[metric],lo,hi,74,8);
      g.style.display='';
      g.querySelector('line').setAttribute('x1',x); g.querySelector('line').setAttribute('x2',x);
      g.querySelector('circle').setAttribute('cx',x); g.querySelector('circle').setAttribute('cy',y);
      read.textContent='gen '+bestP.gen.toLocaleString()+' · '+(+bestP[metric]).toFixed(2);
    });
    svg.addEventListener('mouseleave',()=>{ g.style.display='none'; read.textContent=base; });
  }
}

/* The progression chart: two series, so it carries a legend AND direct labels —
   identity is never colour alone. Leader in the primary hue, record in the second;
   both validated against this surface. */
function drawProgress(s){
  const rows=(s.leader||[]).filter(r=>r.leader!=null);
  if(rows.length<2){
    $('#progChart').innerHTML='';
    $('#progNote').textContent=rows.length?'One reading so far — the next is due within a few minutes.':'';
    $('#heroWhat').style.display=rows.length?'':'none';
    return; }
  $('#heroWhat').style.display='';
  const W=1000,H=210,PL=52,PR=118,PT=14,PB=26;
  const xs=rows.map((_,i)=>i);
  const vals=rows.flatMap(r=>[r.leader,r.record].filter(v=>v!=null));
  let lo=Math.min(...vals),hi=Math.max(...vals);
  const pad=(hi-lo)*0.15||5; lo-=pad; hi+=pad;
  const X=i=>PL+(xs.length<2?0:i/(xs.length-1))*(W-PL-PR);
  const Y=v=>PT+(1-(v-lo)/(hi-lo))*(H-PT-PB);
  const line=(key,col)=>{
    const p=rows.map((r,i)=>r[key]==null?null:X(i).toFixed(1)+','+Y(r[key]).toFixed(1)).filter(Boolean);
    return p.length<2?'':'<polyline fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="'+p.join(' ')+'"/>';
  };
  const last=rows[rows.length-1];
  const grid=[lo,(lo+hi)/2,hi].map(v=>
    '<g><line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" stroke="var(--line)"/>'+
    '<text x="'+(PL-10)+'" y="'+(Y(v)+4).toFixed(1)+'" fill="var(--faint)" font-size="12" text-anchor="end">'+v.toFixed(0)+'</text></g>').join('');
  const dot=(v,col)=>v==null?'':'<circle cx="'+X(rows.length-1).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="4.5" fill="'+col+'" stroke="var(--panel)" stroke-width="2.5"/>';
  const tag=(v,col,label)=>v==null?'':'<text x="'+(W-PR+12)+'" y="'+(Y(v)+4).toFixed(1)+'" fill="'+col+'" font-size="13" font-weight="500">'+label+' '+v.toFixed(1)+'</text>';
  /* Both series carry a direct label as well as a hue, so identity never rests on
     colour alone — the one rule that survives every restyle. */
  const baseline=s.genius?'record':'start';
  $('#progChart').innerHTML=
    '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto">'+grid+
    line('record','var(--series2)')+line('leader','var(--series)')+
    dot(last.record,'var(--series2)')+dot(last.leader,'var(--series)')+
    tag(last.record,'var(--series2)',baseline)+tag(last.leader,'var(--series)','now')+
    '</svg>';
  $('#progWhat').innerHTML='Every reading replays the leading brain on the same <b>'+last.verifiedOn+
    ' games</b>, which nothing on this page trains or selects on. The '+baseline+' line is the brain this run '+
    'began from, on those identical games.';
  $('#progNote').textContent='';
}

function fmt(n,d=1){return n==null?'—':(+n).toFixed(d)}

/* Force a cull. The button asks; genius.js decides, on the same fresh judging
   bank and with the same protections a scheduled era uses. */
let cullSent=0;
$('#cullBtn').addEventListener('click',async()=>{
  const g=state&&state.genius; if(!g) return;
  const n=g.spawnPerEra||7;
  const young=(g.live||[]).filter(c=>!c.cullable&&!c.deep).length;
  if(!confirm('Judge every cell now on a fresh bank, retire the worst '+n+
    ', and start '+n+' new ones from the record brain?'+
    (young?'\\n\\n'+young+' cell(s) are under '+g.minAgeMin+' min old and cannot be retired yet — fewer may go.':'')))
    return;
  const b=$('#cullBtn'); b.disabled=true; b.textContent='requesting…';
  try{
    const r=await fetch('/api/cull',{method:'POST'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    cullSent=Date.now();
  }catch(e){ b.textContent='request failed'; setTimeout(tick,1500); return; }
  tick();
});

function paintCull(s){
  const b=$('#cullBtn'), note=$('#cullNote'), g=s.genius;
  /* No meta-controller means a single-population run: there are no cells to cull
     and no cells to suspend, so both controls and both explanations are simply
     not part of this page rather than being shown greyed out. */
  if(!g){ b.style.display='none'; note.style.display='none'; return; }
  b.style.display=''; note.style.display='';
  const n=g.spawnPerEra||7;
  /* Feature-detect the controller. A dashboard newer than the genius.js it is
     watching would otherwise offer a button that writes a file nobody reads. */
  if(g.minAgeMin==null){
    b.disabled=true; b.className='act'; b.textContent='force a cull unavailable';
    note.innerHTML='The running controller predates this button, so it would not see the request. '+
      'It takes effect after the next controller restart. Scheduled culls every '+g.eraMinutes+
      ' min are unaffected.';
    return;
  }
  const busy=s.cullPending||(Date.now()-cullSent<12000);
  b.disabled=busy;
  b.className='act'+(busy?' pending':'');
  b.textContent=busy?'Waiting for the controller…':'Force a cull';
  const young=(g.live||[]).filter(c=>!c.cullable&&!c.deep);
  note.innerHTML='Retires the '+n+' weakest and starts '+n+' new ones from the best brain.'+
    (young.length?' <span class="warn">'+young.length+' too young to retire.</span>':'');
}
/* The deep dive. Same contract as the cull button: the page asks, genius.js
   decides. It cannot promote anything by itself — whatever the dive produces
   still has to win a fresh bank and then a confirmation against the record. */
let deepSent=0;
$('#deepBtn').addEventListener('click',async()=>{
  const g=state&&state.genius, d=g&&g.deep; if(!d) return;
  if(!confirm('Suspend every cell and give the whole box to the leading one for '+
    d.minutes+' min?\\n\\nThe paused cells keep their populations in memory and carry on '+
    'exactly where they stopped. If the dive beats the record on a fresh bank and then on a '+
    (g.confirmGames||100)+'-game confirmation it becomes the new record; if not, nothing changes.'))
    return;
  const b=$('#deepBtn'); b.disabled=true; b.textContent='requesting…';
  try{
    const r=await fetch('/api/deep',{method:'POST'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    deepSent=Date.now();
  }catch(e){ b.textContent='request failed'; setTimeout(tick,1500); return; }
  tick();
});

function paintDeep(s){
  const b=$('#deepBtn'), note=$('#deepNote'), wrap=$('#deepBanner');
  const g=s.genius, d=g&&g.deep;
  if(!d){
    if(!g){ b.style.display='none'; note.style.display='none'; wrap.style.display='none'; return; }
    b.style.display=''; note.style.display='';
    b.disabled=true; b.textContent='deep dive unavailable';
    note.textContent='The running controller predates the deep dive; it takes effect after the next controller restart.';
    wrap.style.display='none'; return;
  }
  b.style.display=''; note.style.display='';
  const a=d.active;
  const busy=!!a||s.deepPending||(Date.now()-deepSent<15000);
  b.disabled=busy||!d.every;
  b.className='act'+(busy?' pending':'');
  b.textContent=a?'Deep dive running…':(busy?'Waiting for the controller…':'Deep dive');
  note.innerHTML='Pauses every experiment and gives the whole machine to the leading one for '+
    d.minutes+' min.'+
    (d.canFreeze===false?' <span class="warn">This host cannot pause processes.</span>':'');

  if(a){
    const total=Math.max(1,a.endsAt-a.startedAt);
    const pct=Math.max(0,Math.min(100,(s.now-a.startedAt)/total*100));
    const left=Math.max(0,Math.round((a.endsAt-s.now)/60000));
    wrap.className='deep'; wrap.style.display='';
    wrap.innerHTML='<div class="t">Deep dive on '+a.from+'</div>'+
      '<div class="prog"><i style="width:'+pct.toFixed(1)+'%"></i></div>'+
      'The whole machine is on this one brain for another '+left+' min. Every other experiment is '+
      'paused with its population intact, so a flat line below is the pause, not a stall.';
    return;
  }
  const l=d.last;
  if(l){
    wrap.className='deep done'; wrap.style.display='';
    wrap.innerHTML='<div class="t">'+(l.promoted?'The last deep dive found a better brain'
        :'The last deep dive found nothing better')+'</div>'+
      l.minutes+' min on '+l.from+', reaching generation '+(l.gen||0).toLocaleString()+'. '+
      'On games drawn after it finished: '+fmt(l.skill)+' against '+fmt(l.record)+'.';
    return;
  }
  wrap.style.display='none';
}

async function tick(){
  try{ state=await (await fetch('/api/status',{cache:'no-store'})).json(); }
  catch(e){ $('#dot').className='dot off'; $('#sub').textContent='cannot reach the server'; return; }
  const s=state;
  $('#dot').className='dot';
  const running=s.cells.filter(c=>!c.finished).length;
  $('#sub').textContent=s.host+(s.cells.length>1?' · '+running+' of '+s.cells.length+' running':'')+
    (s.genius?' · era '+s.genius.era:'');
  $('#clock').textContent=new Date().toLocaleTimeString();
  const best=s.cells[0]||{};
  const totalGens=s.cells.reduce((a,c)=>a+(c.gen||0),0);
  const checks=s.cells.reduce((a,c)=>a+(c.gateChecks||0),0);
  const rejects=s.cells.reduce((a,c)=>a+(c.gateRejects||0),0);
  const G=s.genius, hof=G&&G.hof;
  const mins=G&&G.nextEraAt?Math.max(0,Math.round((G.nextEraAt-s.now)/60000)):null;
  /* ---- the hero -----------------------------------------------------------
     One number, chosen as the most trustworthy one available. First choice is
     the leading brain on the fixed verification bank, because that is the only
     figure comparable across the whole run; then the head-to-head gate score;
     then the record. The delta beside it is against the brain this run started
     from, on those same games — the only comparison that means anything. */
  const lrows=(s.leader||[]).filter(r=>r.leader!=null);
  const last=lrows[lrows.length-1];
  let hv=null,hlabel='Skill',hsub='',hd=null;
  if(last){
    hv=last.leader; hlabel='Skill'; hd=last.record!=null?last.leader-last.record:null;
    hsub='on the same '+last.verifiedOn+' games every time, which nothing trains or selects on';
  }else if(!G&&best.gateSkill!=null){
    hv=best.gateSkill; hlabel='Verified skill';
    hsub='champion and challenger head to head on '+(best.gateGames||'held-out')+' games neither has seen';
  }else if(hof){
    hv=hof.skill; hlabel='Best brain';
    hsub=fmt(hof.lines,2)+' lines and '+fmt(hof.pieces)+' pieces a game, on '+hof.games+' unseen games';
  }else if(best.holdout){ hv=best.holdout.skill; hsub='on '+best.holdout.games+' unseen games'; }
  $('#heroLabel').textContent=hlabel;
  $('#heroVal').innerHTML=(hv==null?'&mdash;':fmt(hv))+
    (hd==null?'':' <span class="d '+(hd>0?'good':hd<0?'dim':'dim')+'">'+(hd>0?'+':'')+hd.toFixed(1)+
      ' vs '+(G?'the record':'the start')+'</span>');
  $('#heroSub').textContent=hsub;

  const cards=[];
  cards.push(['Generation',(best.gen||totalGens).toLocaleString(),fmt(best.secs)+' s each']);
  if(best.holdout) cards.push(
    ['Lines a game',fmt(best.holdout.lines,2),''],
    ['Pieces a game',fmt(best.holdout.pieces),'']);
  cards.push(['Challengers kept',checks?Math.round((1-rejects/checks)*100)+'%':'—',
    (checks-rejects)+' of '+checks+' survived verification']);
  if(hof) cards.push(
    ['Brain',(hof.hidden||[]).join(' → ')||'—',
      (hof.params?hof.params.toLocaleString()+' weights':'')],
    ['Next era',mins!=null?mins+' min':'—',
      G.spawnPerEra+' of '+G.cells+' cells replaced']);
  $('#cards').innerHTML=cards.map(([k,v,x])=>'<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div>'+(x?'<div class="sub">'+x+'</div>':'')+'</div>').join('');

  $('#tabs').innerHTML=METRICS.map(m=>
    '<button class="tab" data-m="'+m.k+'" aria-pressed="'+(m.k===metric)+'">'+m.label+'</button>').join('');
  for(const b of document.querySelectorAll('#tabs .tab'))
    b.addEventListener('click',()=>{ metric=b.getAttribute('data-m'); draw();
      for(const o of document.querySelectorAll('#tabs .tab')) o.setAttribute('aria-pressed',o===b); });
  for(const b of document.querySelectorAll('#views .tab')){
    b.setAttribute('aria-pressed',b.getAttribute('data-v')===view);
    b.onclick=()=>{ view=b.getAttribute('data-v'); draw();
      for(const o of document.querySelectorAll('#views .tab')) o.setAttribute('aria-pressed',o===b); };
  }

  /* Six columns instead of thirteen. σ, promotions, buried-per-piece and age were
     diagnostics for a search that no longer exists on this page by default; what
     is left is what a person actually reads to answer "how good, and how fast". */
  $('#rows').innerHTML=s.cells.map(c=>{
    const h=c.holdout;
    const rej=c.gateChecks?Math.round(c.gateRejects/c.gateChecks*100):null;
    /* A paused cell's numbers are frozen too, and a row that looks identical for
       fifteen minutes reads as a stall unless it says why. */
    const tag=c.deep?' <span class="warn">deep dive</span>'
      :(c.frozen?' <span class="warn">paused</span>':(c.finished?' <span class="dim">done</span>':''));
    const sub=c.variant?'<div class="sub">'+c.variant+'</div>':'';
    return '<tr><td>'+c.name+tag+sub+'</td>'+
      '<td>'+fmt(c.bestSkill!=null?c.bestSkill:(h&&h.skill))+'</td>'+
      '<td>'+fmt(h&&h.lines,2)+'</td><td>'+fmt(h&&h.pieces)+'</td>'+
      '<td>'+(c.gen||0).toLocaleString()+'<div class="sub">'+fmt(c.secs)+' s/gen</div></td>'+
      '<td class="'+(rej!=null&&rej>90?'warn':'')+'">'+(rej==null?'—':(100-rej)+'%')+'</td></tr>';
  }).join('');
  // one experiment is not a comparison — the small multiples only earn their space
  // when there is something to compare them against
  $('#perCell').style.display=s.cells.length>1?'':'none';
  $('#tableTitle').textContent=s.cells.length>1?'Experiments':'Details';

  /* Say how many games are behind each held-out column, every time — comparing a
     40-game score with a 100-game one as if they were the same measurement is how
     a lucky draw becomes a record. */
  const PG=s.probeGames;
  const gtxt=PG==null?'':(Array.isArray(PG)?PG.join('/')+' games':PG+' games');
  const hdr=(id,label)=>{ const el=$('#'+id); if(el) el.innerHTML=label+
    (gtxt?'<div class="sub" style="font-weight:400">'+gtxt+'</div>':''); };
  hdr('thBest','Skill'); hdr('thLines','Lines'); hdr('thPieces','Pieces');

  drawProgress(s);
  paintCull(s);
  paintDeep(s);

  draw();
}
tick(); setInterval(tick,10000);
</script></body></html>`;

/* The page's JavaScript lives inside a template literal, so a `\n` written here
 * becomes a real newline *there* — which turns a browser string literal into an
 * unterminated one and stops the entire script parsing. The failure is silent
 * and remote: the server is healthy, the API answers, and the page sits on
 * "connecting…" forever with nothing in any log. Parse it once at startup so the
 * mistake is loud, immediate and on this side of the wire. */
(() => {
    const m = PAGE.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) { console.error("FATAL: no script block in the page"); process.exit(1); }
    try { new Function(m[1]); }
    catch (e) {
        console.error("FATAL: the page script does not parse — " + e.message);
        console.error("(check for a single-backslash escape inside the PAGE template literal)");
        process.exit(1);
    }
})();

/* ---- server -------------------------------------------------------------- */
http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/api/status") {
        let body;
        try { body = JSON.stringify(collect()); }
        catch (e) {
            res.writeHead(500, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: String(e && e.message || e) }));
        }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(body);
    }
    /* The only two things this server will write. Each takes nothing from the
     * request — no body, no parameters, no path — and creates a single fixed
     * filename inside the directory it is already watching. genius.js notices it,
     * deletes it, and acts under exactly the rules its own schedule uses. Nothing
     * here decides anything; it only asks. */
    const SENTINEL = { "/api/cull": "CULL_NOW", "/api/deep": "DEEP_NOW" };
    if (SENTINEL[url]) {
        if (req.method !== "POST") {
            res.writeHead(405, { "content-type": "application/json", "allow": "POST" });
            return res.end(JSON.stringify({ error: "POST only" }));
        }
        try {
            fs.writeFileSync(path.join(DIR, SENTINEL[url]), String(Date.now()));
        } catch (e) {
            res.writeHead(500, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: String(e && e.message || e) }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, requestedAt: Date.now() }));
    }
    if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(PAGE);
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
}).listen(PORT, "0.0.0.0", () => {
    console.log(`dashboard on http://0.0.0.0:${PORT}  (watching ${DIR})`);
});
