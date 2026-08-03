// Page wiring: the training loop, the watch/compare tab, the charts, the
// junction inspector and persistence.
'use strict';

const SAVE_KEY = 'traffic_light_ne_v1';

// Playback speeds for the watch tab, as a multiple of real time. Anything below
// 1x needs the leftover-time accumulator in stepWatch: the physics step is a
// fixed 0.1s, so a loop that runs "at least one step per frame" cannot go
// slower than six times real time however small the pace factor is.
const PACE_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15];
const PACE_DEFAULT = 5;   // 2x
const PACE_SLOW = 2;      // the "slow motion" button
const paceLabel = p => (p < 1 ? `${p}× slow` : p === 1 ? '1× real time' : `${p}×`);

const S = {
    ev: null,
    ren: null,
    mode: 'train',
    paused: false,
    budget: 12,
    headless: false,
    lastFrame: 0,
    stepAcc: 0,
    watch: null,
    seedInput: ''
};

const $ = id => document.getElementById(id);
// Read a control, falling back to the engine default if it is empty or junk.
// A zero population or a zero-length episode does not fail loudly - it fails as
// an undefined genome several frames later, so it is worth refusing here.
const num = (id, fallback) => {
    const el = $(id);
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
};
// Same, for a zero-based index where 0 is a perfectly good answer.
const idx = (id, fallback, hi) => {
    const el = $(id);
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? clamp(v, 0, hi) : fallback;
};
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 0 : d) : '–');
const pct = v => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '–');

// --- boot -------------------------------------------------------------------
function boot() {
    S.ren = new Renderer($('city'));
    buildTierSelects();
    applyUrlParams();
    newRun();
    bindControls();
    warmUp();
    requestAnimationFrame(frame);
}

// URL hooks, used for screenshots and headless checks:
//   ?tier=3      start on a particular city
//   ?mode=watch  open the watch/compare tab
//   ?bench=90    advance the world 90 simulated seconds synchronously at load
// The bench hook exists because under headless Chrome's virtual time
// requestAnimationFrame barely fires, so a page that only warms up across
// frames screenshots as an empty city.
function urlParams() {
    if (typeof location === 'undefined' || !location.search) return null;
    try { return new URLSearchParams(location.search); } catch (e) { return null; }
}

function applyUrlParams() {
    const p = urlParams();
    if (!p) return;
    if (p.get('tier') !== null) {
        const t = clamp(parseInt(p.get('tier'), 10) || 0, 0, CITY_TIERS.length - 1);
        $('sel-tier').value = String(t);
        $('watch-tier').value = String(t);
        $('chk-lock').checked = true;
    }
    if (p.get('mode') === 'watch') S.mode = 'watch';
}

function warmUp() {
    const p = urlParams();
    const secs = p ? parseFloat(p.get('bench')) : NaN;
    if (S.mode === 'watch') {
        applyMode();
        startWatch();
    }
    if (!Number.isFinite(secs) || secs <= 0) return;
    const w = S.mode === 'watch' ? S.watch.a : S.ev.world;
    const other = S.mode === 'watch' ? S.watch.b : null;
    const steps = Math.min(6000, Math.round(secs / SIM.DT));
    for (let i = 0; i < steps; i++) {
        if (w.t < w.episodeLen) w.step(SIM.DT);
        if (other && other.t < other.episodeLen) other.step(SIM.DT);
    }
    // Freeze after warming up. Under virtual time the clock does not advance
    // inside a synchronous block, so leaving the training loop running means
    // every frame burns its whole step cap and the screenshot never arrives.
    S.paused = true;
    // The panel normally refreshes every sixth frame; under virtual time only a
    // handful of frames ever run, so push one now or the screenshot shows the
    // placeholder markup instead of the run it just warmed up.
    panelTick = 5;
    updatePanel(16);
    drawCurrent();
    if (typeof document !== 'undefined') document.title = 'warmed ' + w.t.toFixed(0) + 's';
}

// Put the page into whichever mode S.mode says. The right-hand column is the
// training instrument panel - generation charts, GA sliders, the champion card
// - and none of it applies while two controllers race each other, so watch mode
// drops it and the city takes the full width.
function applyMode() {
    const watching = S.mode === 'watch';
    for (const tab of document.querySelectorAll('.mode-tab')) {
        tab.classList.toggle('active', tab.dataset.mode === S.mode);
    }
    $('watch-controls').classList.toggle('hidden', !watching);
    $('panel').classList.toggle('hidden', watching);
    $('canvas-overlay').classList.toggle('hidden', !S.headless || watching);
    // The junction inspector is inside the panel, so watch mode stops offering
    // a click that now has nowhere to report to.
    $('map-hint').textContent = watching
        ? 'scroll to zoom · drag to pan'
        : 'click a junction to inspect it · scroll to zoom · drag to pan';
}

function drawSeed() {
    if (S.seedInput !== '' && Number.isFinite(+S.seedInput)) return (+S.seedInput) >>> 0;
    return (Math.random() * 0xffffffff) >>> 0;
}

function newRun(settings) {
    const s = Object.assign({
        population: Math.round(num('sl-pop', GA_DEFAULTS.population)),
        episodeLen: num('sl-eplen', GA_DEFAULTS.episodeLen),
        demand: num('sl-demand', 100) / 100,
        pedDemand: num('sl-demand', 100) / 100,
        sigma: num('sl-sigma', GA_DEFAULTS.sigma * 100) / 100,
        mutGenes: Math.round(num('sl-K', GA_DEFAULTS.mutGenes)),
        tier: idx('sel-tier', 0, CITY_TIERS.length - 1),
        lockTier: !!($('chk-lock') && $('chk-lock').checked)
    }, settings || {});
    const seed = drawSeed();
    S.ev = new Evolution(s, seed);
    $('lab-seed').textContent = seed;
    S.ren.selected = -1;
    S.history = [];
}

function buildTierSelects() {
    const opts = CITY_TIERS.map((t, i) => `<option value="${i}">${i + 1}. ${t.name}</option>`).join('');
    $('sel-tier').innerHTML = opts;
    $('watch-tier').innerHTML = opts;
    $('watch-tier').value = '2';
    refreshBrainSelects();
}

function refreshBrainSelects() {
    const opts = [];
    if (typeof DEFAULT_BRAIN !== 'undefined' && DEFAULT_BRAIN) opts.push('<option value="default">Mikkel&rsquo;s evolved brain</option>');
    opts.push('<option value="champion">This run&rsquo;s champion</option>');
    opts.push('<option value="leader">This generation&rsquo;s leader</option>');
    opts.push('<option value="actuated">Vehicle-actuated controller</option>');
    opts.push('<option value="fixed">Fixed-time plan</option>');
    opts.push('<option value="random">Random switching</option>');
    const a = $('watch-brain'), b = $('watch-rival');
    const keepA = a.value, keepB = b.value;
    a.innerHTML = opts.join('');
    b.innerHTML = opts.join('');
    a.value = keepA || (typeof DEFAULT_BRAIN !== 'undefined' && DEFAULT_BRAIN ? 'default' : 'champion');
    b.value = keepB || 'actuated';
    if (!a.value) a.value = 'champion';
    if (!b.value) b.value = 'actuated';
}

// --- main loop --------------------------------------------------------------
function frame(now) {
    const dt = Math.min(100, now - (S.lastFrame || now));
    S.lastFrame = now;
    if (!S.paused) {
        if (S.mode === 'train') stepTraining();
        else stepWatch(dt);
    }
    if (!(S.mode === 'train' && S.headless)) drawCurrent();
    updatePanel(dt);
    requestAnimationFrame(frame);
}

function stepTraining() {
    const budget = S.headless ? Math.max(30, S.budget * 3) : S.budget;
    const t0 = performance.now();
    // The step cap is not a performance knob - it is a safety net. Under
    // headless Chrome's virtual time performance.now() is frozen for the whole
    // of a synchronous block, so a purely wall-clock-bounded loop never exits
    // and the page hangs instead of screenshotting. 20 000 steps is far more
    // than any real frame does.
    S.ev.run(budget, 20000);
    const spent = performance.now() - t0;
    S.stepAcc = S.stepAcc * 0.9 + (spent > 0 ? budget / spent : 1) * 0.1;
    drainEvents();
}

function drainEvents() {
    if (!S.ev.events.length) return;
    for (const e of S.ev.events) {
        if (e.type === 'tier') toast(`Tier unlocked: ${e.name}`);
    }
    S.ev.events.length = 0;
}

function toast(msg) {
    const el = $('caption-sub');
    el.textContent = msg;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
}

function drawCurrent() {
    const w = S.mode === 'train' ? S.ev.world : (S.watch && S.watch.a);
    if (!w) return;
    S.ren.draw(w, S.mode === 'watch' && !S.paused && S.watch ? S.watch.lead : 0);
    updateLive(w);
}

// --- watch / compare --------------------------------------------------------
function makeController(kind, ep) {
    if (kind === 'default' && typeof DEFAULT_BRAIN !== 'undefined' && DEFAULT_BRAIN) {
        const d = deserializeGenome(DEFAULT_BRAIN);
        if (d) return brainController(d.genome);
    }
    // Asking for a brain must never quietly hand back a classical controller
    // under a brain's name: fall back to the shipped brain, then to whatever
    // genome is currently leading, and only then to something else.
    if (kind === 'champion') {
        if (S.ev.champion) return brainController(S.ev.champion.genome);
        if (typeof DEFAULT_BRAIN !== 'undefined' && DEFAULT_BRAIN) {
            const d = deserializeGenome(DEFAULT_BRAIN);
            if (d) return brainController(d.genome);
        }
        kind = 'leader';
    }
    if (kind === 'leader') {
        const top = S.ev.lastRank.length ? S.ev.lastRank[0] : 0;
        return brainController(S.ev.genomes[top]);
    }
    if (kind === 'fixed') return fixedTimeController();
    if (kind === 'random') return randomController((Math.random() * 1e9) >>> 0);
    if (kind === 'actuated') return actuatedController();
    return actuatedController();
}

function startWatch() {
    const tier = idx('watch-tier', 2, CITY_TIERS.length - 1);
    const city = makeCity(tier, mixSeed(0xC17 + tier * 31, 0, S.ev.runSeed));
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const opts = {
        episodeLen: num('sl-eplen', GA_DEFAULTS.episodeLen),
        demand: num('sl-demand', 100) / 100,
        pedDemand: num('sl-demand', 100) / 100
    };
    const a = new World(city, opts).reset(seed, makeController($('watch-brain').value));
    const b = new World(city, opts).reset(seed, makeController($('watch-rival').value));
    S.watch = { a, b, tier, seed, done: false, acc: 0, lead: 0 };
    S.ren.selected = -1;
    $('race-a-name').textContent = $('watch-brain').selectedOptions[0].textContent;
    $('race-b-name').textContent = $('watch-rival').selectedOptions[0].textContent;
    $('watch-status').textContent = '';
}

function currentPace() {
    return PACE_STEPS[idx('sl-pace', PACE_DEFAULT, PACE_STEPS.length - 1)];
}

// Move the speed slider from code and keep its readout honest.
function setPace(i) {
    const at = clamp(i, 0, PACE_STEPS.length - 1);
    $('sl-pace').value = String(at);
    $('lab-pace').textContent = paceLabel(PACE_STEPS[at]);
    toast(`Playback ${paceLabel(PACE_STEPS[at])}`);
}

// Advance both worlds by however much simulated time this frame is worth.
// Whole 0.1s steps are taken and the remainder is carried to the next frame, so
// at 0.25x roughly one frame in sixteen actually steps; the rest of the time
// the renderer coasts the cars forward through `lead`, which is what stops slow
// motion looking like a slideshow.
function stepWatch(dtMs, override) {
    if (!S.watch) startWatch();
    const w = S.watch;
    if (w.done) return;
    const add = override !== undefined ? override : (dtMs / 1000) * currentPace();
    // A slow or backgrounded frame must not be paid back all at once, or the
    // city lurches. The manual step button is exempt: it asks for exactly the
    // time it names.
    const cap = override !== undefined ? add + SIM.DT : 0.6;
    w.acc = Math.min(cap, w.acc + add);
    let guard = 0;
    while (w.acc >= SIM.DT && guard++ < 4000) {
        const aliveA = w.a.t < w.a.episodeLen ? (w.a.step(SIM.DT), true) : false;
        if (w.b.t < w.b.episodeLen) w.b.step(SIM.DT);
        w.acc -= SIM.DT;
        if (!aliveA) break;
    }
    w.lead = clamp(w.acc, 0, SIM.DT);
    if (w.a.t >= w.a.episodeLen) {
        w.done = true;
        const ma = w.a.finish(), mb = w.b.finish();
        $('watch-status').textContent =
            `finished — ${ma.carsOut + ma.pedsOut} arrivals vs ${mb.carsOut + mb.pedsOut}, ` +
            `${ma.meanCarDelay.toFixed(0)}s vs ${mb.meanCarDelay.toFixed(0)}s delay, ` +
            `${ma.crashes + ma.pedHits} vs ${mb.crashes + mb.pedHits} accidents`;
    }
}

function updateRace() {
    if (!S.watch) return;
    const a = S.watch.a.m, b = S.watch.b.m;
    const va = a.carsOut + a.pedsOut, vb = b.carsOut + b.pedsOut;
    const max = Math.max(1, va, vb);
    $('race-a-fill').style.width = (va / max * 100) + '%';
    $('race-b-fill').style.width = (vb / max * 100) + '%';
    $('race-a-val').textContent = va;
    $('race-b-val').textContent = vb;
}

// --- panel ------------------------------------------------------------------
function updateLive(w) {
    if (!w.m) return;
    $('live-clock').textContent = fmt(w.t) + 's';
    $('live-cars').textContent = `${w.m.carsOut} / ${w.m.carsIn}`;
    $('live-peds').textContent = `${w.m.pedsOut} / ${w.m.pedsIn}`;
    const n = Math.max(1, w.m.carsIn);
    $('live-delay').textContent = fmt(w.m.carDelay / n) + 's';
    $('live-crash').textContent = w.m.crashes;
    $('live-hit').textContent = w.m.pedHits;
}

var panelTick = 0;
function updatePanel(dtMs) {
    if (++panelTick % 6 !== 0) return;
    const ev = S.ev;
    const h = ev.history.length ? ev.history[ev.history.length - 1] : null;

    if (S.mode === 'train') {
        const e = ev.evaluating;
        let sub;
        if (e && e.kind === 'baseline') sub = `measuring the ${e.name} controller (episode ${e.ep + 1})`;
        else if (e) sub = `scoring genome ${e.idx + 1} of ${ev.genomes.length}, episode ${e.ep + 1}`;
        else sub = '';
        $('caption-main').textContent = `Generation ${ev.gen} · ${ev.city.name}`;
        if (!$('caption-sub').classList.contains('flash')) $('caption-sub').textContent = sub;
        $('stat-progress').textContent = e && e.kind === 'genome'
            ? `${e.idx + 1} / ${ev.genomes.length}` : 'baselines';
    } else {
        $('caption-main').textContent = S.watch ? `${CITY_TIERS[S.watch.tier].name}` : 'Watch';
        $('caption-sub').textContent = S.watch ? `seed ${S.watch.seed}` : '';
        updateRace();
        // Everything below lives in the training panel, which is not on screen
        // in watch mode. Redrawing two charts into a hidden card every sixth
        // frame is work the playback could be spending on the city.
        return;
    }

    $('stat-gen').textContent = ev.gen;
    $('stat-tier').textContent = `${ev.tier + 1} / ${CITY_TIERS.length}`;
    $('stat-lights').textContent = ev.city.signals.length;
    $('stat-stag').textContent = ev.stagnation;
    $('stat-div').textContent = ev.diversity ? ev.diversity.toFixed(3) : '–';
    $('stat-rate').textContent = fmt(S.stepAcc * 100, 0) + '%';
    if (h) {
        $('stat-best').textContent = fmt(h.best);
        const d = h.best - h.actuated;
        $('stat-vs').textContent = (d >= 0 ? '+' : '') + fmt(d);
        $('stat-vs').className = 'stat-value ' + (d >= 0 ? 'good' : 'bad');
        $('stat-thr').textContent = pct(h.thr);
        $('stat-delay').textContent = fmt(h.delay) + 's';
        $('stat-crash').textContent = fmt(h.crashes, 1);
    }
    if (ev.champion) {
        const m = ev.champion.metrics || {};
        $('champion-note').textContent =
            `Generation ${ev.champion.gen}, tier ${(ev.champion.tier | 0) + 1}: ` +
            `${pct(m.carThroughput)} of vehicles and ${pct(m.pedThroughput)} of people arrived, ` +
            `${fmt(m.meanCarDelay)}s delay each, ${fmt(m.crashes, 1)} collisions.`;
    }
    drawCharts();
    drawInspector();
}

// --- charts -----------------------------------------------------------------
function drawCharts() {
    const ev = S.ev;
    benchChart($('chart-bench'), ev.history);
    thrChart($('chart-thr'), ev.history);
}

function chartBase(cv) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(255,255,255,0.02)';
    g.fillRect(0, 0, cv.width, cv.height);
    return g;
}

function series(g, data, get, min, max, w, h, color, width, dash) {
    g.strokeStyle = color;
    g.lineWidth = width || 1.4;
    g.setLineDash(dash || []);
    g.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
        const v = get(data[i]);
        if (!Number.isFinite(v)) continue;
        const x = data.length > 1 ? (i / (data.length - 1)) * (w - 2) + 1 : w / 2;
        const y = h - 4 - ((v - min) / (max - min || 1)) * (h - 10);
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
}

function benchChart(cv, hist) {
    const g = chartBase(cv);
    if (!hist.length) return;
    const w = cv.width, h = cv.height;
    const vals = [];
    for (const r of hist) for (const k of ['best', 'median', 'fixed', 'actuated', 'random']) {
        if (Number.isFinite(r[k])) vals.push(r[k]);
    }
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 1) { max = min + 1; }
    // Zero line, so "worse than doing nothing" is visible at a glance.
    if (min < 0 && max > 0) {
        const y = h - 4 - ((0 - min) / (max - min)) * (h - 10);
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    // Tier boundaries.
    g.strokeStyle = 'rgba(154,214,255,0.18)';
    for (let i = 1; i < hist.length; i++) {
        if (hist[i].tier !== hist[i - 1].tier) {
            const x = (i / (hist.length - 1)) * (w - 2) + 1;
            g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
        }
    }
    series(g, hist, r => r.random, min, max, w, h, 'rgba(255,255,255,0.18)', 1);
    series(g, hist, r => r.fixed, min, max, w, h, 'rgba(190,205,225,0.45)', 1.2);
    series(g, hist, r => r.actuated, min, max, w, h, 'rgba(143,240,180,0.75)', 1.4, [4, 3]);
    series(g, hist, r => r.median, min, max, w, h, '#9ad6ff', 1.3);
    series(g, hist, r => r.best, min, max, w, h, '#ffbe6b', 1.8);
}

function thrChart(cv, hist) {
    const g = chartBase(cv);
    if (!hist.length) return;
    const w = cv.width, h = cv.height;
    let maxC = 1;
    for (const r of hist) maxC = Math.max(maxC, r.crashes + r.hits);
    g.fillStyle = 'rgba(255,107,107,0.5)';
    for (let i = 0; i < hist.length; i++) {
        const v = (hist[i].crashes || 0) + (hist[i].hits || 0);
        if (!v) continue;
        const x = hist.length > 1 ? (i / (hist.length - 1)) * (w - 2) + 1 : w / 2;
        const bh = (v / maxC) * (h - 8);
        g.fillRect(x - 1, h - 4 - bh, 2, bh);
    }
    series(g, hist, r => r.thr, 0, 1, w, h, '#8ff0b4', 1.8);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '9px sans-serif';
    g.fillText('100%', 2, 10);
    g.fillText(maxC + ' acc', w - 34, 10);
}

// --- junction inspector -----------------------------------------------------
function drawInspector() {
    const w = S.mode === 'train' ? S.ev.world : (S.watch && S.watch.a);
    const i = S.ren.selected;
    if (!w || i < 0 || i >= w.lights.length) return;
    const l = w.lights[i];
    $('insp-which').textContent = `junction ${i + 1} of ${w.lights.length}`;
    const phName = ['north–south', 'east–west', 'all pedestrians'][l.phase];
    const stName = ['green', 'amber', 'all-red'][l.state];
    const dirs = ['N', 'E', 'S', 'W'];
    let rows = '';
    for (let k = 0; k < 4; k++) {
        const n = w.city.nodes[l.node];
        if (!n.arms[k]) continue;
        const sg = armSignal(l, k);
        rows += `<tr><td>${dirs[k]}</td>` +
            `<td><span class="pill ${sg}">${sg}</span></td>` +
            `<td>${l.queue[k]}</td><td>${l.pedWait[k]}</td><td>${l.pedIn[k]}</td>` +
            `<td>${fmt(l.sinceGreenArm[k])}s</td></tr>`;
    }
    const act = ['hold', 'go north–south', 'go east–west', 'let people cross'][l.lastAction] || '–';
    const amber = lerp(SIG.AMBER_MIN, SIG.AMBER_MAX, (l.lastAmber + 1) / 2);
    const allRed = lerp(SIG.ALLRED_MIN, SIG.ALLRED_MAX, (l.lastAllRed + 1) / 2);
    $('insp-body').innerHTML =
        `<p class="insp-now">Showing <b>${phName}</b>, ${stName}, for ${fmt(l.tPhase, 1)}s.</p>` +
        `<table class="insp"><thead><tr><th>arm</th><th>signal</th><th>queue</th><th>waiting</th><th>crossing</th><th>since green</th></tr></thead><tbody>${rows}</tbody></table>` +
        `<p class="insp-dec">Last decision: <b>${act}</b> &middot; amber it would set <b>${amber.toFixed(1)}s</b> &middot; all-red <b>${allRed.toFixed(1)}s</b></p>`;
}

// --- controls ---------------------------------------------------------------
function bindControls() {
    const ev = () => S.ev;

    for (const tab of document.querySelectorAll('.mode-tab')) {
        tab.addEventListener('click', () => {
            S.mode = tab.dataset.mode;
            applyMode();
            if (S.mode === 'watch') { refreshBrainSelects(); startWatch(); }
        });
    }

    $('btn-pause').addEventListener('click', () => {
        S.paused = !S.paused;
        $('btn-pause').textContent = S.paused ? 'Resume' : 'Pause';
    });
    $('btn-watch-pause').addEventListener('click', () => {
        S.paused = !S.paused;
        $('btn-watch-pause').textContent = S.paused ? 'Resume' : 'Pause';
    });
    $('btn-reset').addEventListener('click', () => { newRun(); });
    $('btn-watch-run').addEventListener('click', () => { S.paused = false; $('btn-watch-pause').textContent = 'Pause'; startWatch(); });
    // One click to slow motion and one click back, so nobody has to work out
    // which slider stop is a quarter speed.
    $('btn-watch-slow').addEventListener('click', () => {
        const at = idx('sl-pace', PACE_DEFAULT, PACE_STEPS.length - 1);
        setPace(at <= PACE_SLOW ? PACE_DEFAULT : PACE_SLOW);
    });
    // Frame-stepping is the other half of watching a junction closely: pause,
    // then walk the world forward a second at a time.
    $('btn-watch-step').addEventListener('click', () => {
        S.paused = true;
        $('btn-watch-pause').textContent = 'Resume';
        stepWatch(0, 1);
        drawCurrent();
    });

    const slider = (id, lab, fn) => {
        const el = $(id);
        el.addEventListener('input', () => { $(lab).textContent = fn(+el.value); });
        $(lab).textContent = fn(+el.value);
    };
    slider('sl-budget', 'lab-budget', v => { S.budget = v; return v + ' ms'; });
    slider('sl-pop', 'lab-pop', v => v);
    slider('sl-eplen', 'lab-eplen', v => v + ' s');
    slider('sl-demand', 'lab-demand', v => {
        if (S.ev) { S.ev.s.demand = v / 100; S.ev.s.pedDemand = v / 100; }
        return v + '%';
    });
    slider('sl-pace', 'lab-pace', v => paceLabel(PACE_STEPS[clamp(Math.round(v), 0, PACE_STEPS.length - 1)]));
    slider('sl-sigma', 'lab-sigma', v => { if (S.ev) S.ev.s.sigma = v / 100; return (v / 100).toFixed(2); });
    slider('sl-K', 'lab-K', v => { if (S.ev) S.ev.s.mutGenes = v; return v; });

    $('sel-tier').addEventListener('change', () => {
        S.ev.tier = idx('sel-tier', 0, CITY_TIERS.length - 1);
        S.ev.advanceWindow.length = 0;
        S.ev.tierAge = 0;
        if (S.ev.champion) S.ev.champion.fitness = -Infinity;
        S.ev.startGeneration();
    });
    $('chk-lock').addEventListener('change', () => { S.ev.s.lockTier = $('chk-lock').checked; });
    $('chk-headless').addEventListener('change', () => {
        S.headless = $('chk-headless').checked;
        $('canvas-overlay').classList.toggle('hidden', !S.headless || S.mode !== 'train');
    });
    $('chk-det').addEventListener('change', () => { S.ren.showDetectors = $('chk-det').checked; });
    $('inp-seed').addEventListener('change', () => { S.seedInput = $('inp-seed').value.trim(); });

    // Canvas interaction.
    const cv = $('city');
    cv.addEventListener('click', e => {
        const w = S.mode === 'train' ? S.ev.world : (S.watch && S.watch.a);
        if (!w || S.dragging) return;
        const r = cv.getBoundingClientRect();
        S.ren.selected = S.ren.pick(w, e.clientX - r.left, e.clientY - r.top);
    });
    cv.addEventListener('wheel', e => {
        e.preventDefault();
        S.ren.zoom = clamp(S.ren.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.6, 8);
    }, { passive: false });
    let down = false, lx = 0, ly = 0;
    cv.addEventListener('pointerdown', e => { down = true; S.dragging = false; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
        if (!down) return;
        const dx = e.clientX - lx, dy = e.clientY - ly;
        if (Math.abs(dx) + Math.abs(dy) > 3) S.dragging = true;
        S.ren.panX += dx * (S.ren.dpr || 1);
        S.ren.panY += dy * (S.ren.dpr || 1);
        lx = e.clientX; ly = e.clientY;
    });
    cv.addEventListener('pointerup', () => { down = false; setTimeout(() => { S.dragging = false; }, 0); });

    $('btn-save').addEventListener('click', saveRun);
    $('btn-load').addEventListener('click', loadRun);
    $('btn-export').addEventListener('click', exportChampion);

    window.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        // Space hits whichever pause button is on screen, so the label the user
        // is looking at is the one that changes.
        if (e.key === ' ') { e.preventDefault(); $(S.mode === 'watch' ? 'btn-watch-pause' : 'btn-pause').click(); }
        if (S.mode !== 'watch') return;
        const at = idx('sl-pace', PACE_DEFAULT, PACE_STEPS.length - 1);
        if (e.key === '[' || e.key === ',') setPace(at - 1);
        else if (e.key === ']' || e.key === '.') setPace(at + 1);
    });
}

// --- persistence ------------------------------------------------------------
function saveRun() {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(S.ev.toJSON()));
        toast('Saved to this browser');
    } catch (err) { toast('Could not save: ' + err.message); }
}

function loadRun() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) { toast('Nothing saved yet'); return; }
        const ev = Evolution.fromJSON(JSON.parse(raw), drawSeed());
        if (!ev) { toast('Saved run is from an older brain layout'); return; }
        S.ev = ev;
        $('sel-tier').value = String(ev.tier);
        $('lab-seed').textContent = ev.runSeed;
        toast('Loaded');
    } catch (err) { toast('Could not load: ' + err.message); }
}

function exportChampion() {
    if (!S.ev.champion) { toast('No champion yet'); return; }
    const blob = new Blob([JSON.stringify(serializeGenome(S.ev.champion.genome, {
        fitness: S.ev.champion.fitness, gen: S.ev.champion.gen,
        tier: S.ev.champion.tier, metrics: S.ev.champion.metrics
    }), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `traffic-light-champion-gen${S.ev.champion.gen}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
}
