// Page wiring: the training loop, the watch/compare tab, the charts, the
// substation inspector and persistence.
'use strict';

const SAVE_KEY = 'power_grid_ne_v1';

const S = {
    ev: null,
    ren: null,
    mode: 'train',
    chosen: false,
    paused: true,
    budget: 14,
    headless: false,
    lastFrame: 0,
    stepAcc: 0,
    watch: null,
    seedInput: '',
    log: [],
    evQueue: [],
    evLast: 0,
    evMore: 0
};

let panelTick = 0;
const $ = id => document.getElementById(id);
// Read a control, falling back to the engine default if it is empty or junk. A
// zero population or a zero-length episode does not fail loudly - it fails as an
// undefined genome several frames later, so it is worth refusing here.
const num = (id, fallback) => {
    const el = $(id);
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
};
const idx = (id, fallback, hi) => {
    const el = $(id);
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? clamp(v, 0, hi) : fallback;
};
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 0 : d) : '–');
const pct = (v, d) => (Number.isFinite(v) ? (v * 100).toFixed(d === undefined ? 0 : d) + '%' : '–');
// Money, in thousands of euros, which is the scale everything here lives at.
const eur = v => {
    if (!Number.isFinite(v)) return '–';
    const k = v / 1000;
    if (Math.abs(k) >= 1000) return (k / 1000).toFixed(2) + 'M';
    return (Math.abs(k) >= 100 ? k.toFixed(0) : k.toFixed(1)) + 'k';
};
const hhmm = h => {
    const t = ((h % 24) + 24) % 24;
    const hh = Math.floor(t), mm = Math.round((t - hh) * 60);
    return String(hh).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
};

// --- boot -------------------------------------------------------------------
function boot() {
    S.ren = new Renderer($('grid'));
    buildTierSelects();
    applyUrlParams();
    newRun();
    bindControls();
    bindStartModal();
    warmUp();
    requestAnimationFrame(frame);
}

// The page opens on a choice, not on a running training loop. The two modes are
// genuinely different activities - one is an experiment you supervise for hours,
// the other is a two-minute demonstration - and dropping someone straight into
// the first with a wall of sliders is how you lose them. If the URL already says
// which mode it wants (?mode=watch, used for screenshots and links), the choice
// has been made and the modal never appears.
function bindStartModal() {
    const modal = $('start-modal');
    if (!modal) return;
    for (const btn of modal.querySelectorAll('.start-opt')) {
        btn.addEventListener('click', () => {
            modal.classList.add('gone');
            S.chosen = true;
            S.paused = false;
            setMode(btn.dataset.mode);
        });
    }
    if (S.chosen) modal.classList.add('gone');
}

// Everything that differs between the two modes lives here, so there is exactly
// one place to look. Panel cards declare which mode they belong to with
// data-only, and WATCH MODE IS STRICTLY AN EVALUATION - no population, no
// sliders, no mutation rate, nothing that could be mistaken for a thing you are
// supposed to tune before the demonstration means anything.
function setMode(mode) {
    S.mode = mode === 'watch' ? 'watch' : 'train';
    for (const tab of document.querySelectorAll('.mode-tab')) {
        tab.classList.toggle('active', tab.dataset.mode === S.mode);
    }
    for (const el of document.querySelectorAll('[data-only]')) {
        const only = el.dataset.only;
        el.classList.toggle('hidden', only !== 'both' && only !== S.mode);
    }
    $('watch-controls').classList.toggle('hidden', S.mode !== 'watch');
    $('race').classList.toggle('hidden', S.mode !== 'watch');
    if (S.mode !== 'watch') $('winner-banner').classList.add('hidden');
    $('canvas-overlay').classList.add('hidden');
    if (S.mode === 'watch') {
        refreshBrainSelects();
        startWatch();
    }
    drawCurrent();
    panelTick = 5;
    updatePanel();
}

// URL hooks, used for screenshots and headless checks:
//   ?tier=3      start on a particular network
//   ?mode=watch  open the watch/compare tab
//   ?bench=60    advance the world 60 dispatch intervals synchronously at load
//   ?day=1234    pin the weather and fault schedule of the watched day
//   ?paused=1    load, warm up, draw once, and then do nothing
// The bench hook exists because under headless Chrome's virtual time
// requestAnimationFrame barely fires, so a page that only warms up across frames
// screenshots as an empty diagram.
function urlParams() {
    if (typeof location === 'undefined' || !location.search) return null;
    try { return new URLSearchParams(location.search); } catch (e) { return null; }
}

function applyUrlParams() {
    const p = urlParams();
    if (!p) return;
    if (p.get('tier') !== null) {
        const t = clamp(parseInt(p.get('tier'), 10) || 0, 0, GRID_TIERS.length - 1);
        $('sel-tier').value = String(t);
        $('watch-tier').value = String(t);
        $('chk-lock').checked = true;
    }
    if (p.get('mode') === 'watch') { S.mode = 'watch'; S.chosen = true; S.paused = false; }
    if (p.get('mode') === 'train') { S.mode = 'train'; S.chosen = true; S.paused = false; }
    // Screenshotting the TRAIN tab needs this. Under headless Chrome's virtual
    // time the clock only advances while the renderer is idle, so the training
    // loop's own millisecond budget never expires and the page runs a whole
    // generation inside one frame, forever. (Evolution.run has a step ceiling so
    // it cannot wedge outright, but a capture still never finishes.)
    if (p.get('paused') === '1') S.paused = true;
}

function warmUp() {
    const p = urlParams();
    const n = p ? parseFloat(p.get('bench')) : NaN;
    setMode(S.mode);
    if (!Number.isFinite(n) || n <= 0) return;
    const w = S.mode === 'watch' ? S.watch.a : S.ev.world;
    const other = S.mode === 'watch' ? S.watch.b : null;
    for (let i = 0; i < Math.min(600, n); i++) {
        if (!w.done) w.step();
        if (other && !other.done) other.step();
    }
    // Draw once, synchronously, right here. Under headless Chrome's virtual time
    // requestAnimationFrame barely fires, so a page that only ever draws from the
    // animation loop screenshots as an empty black canvas even though the world
    // behind it is five hours into a storm.
    panelTick = 5;
    drawCurrent();
    updatePanel();
    if (typeof document !== 'undefined') document.title = 'warmed ' + w.t;
}

function drawSeed() {
    if (S.seedInput !== '' && Number.isFinite(+S.seedInput)) return (+S.seedInput) >>> 0;
    return (Math.random() * 0xffffffff) >>> 0;
}

function newRun(settings) {
    const s = Object.assign({
        population: Math.round(num('sl-pop', GA_DEFAULTS.population)),
        episodeScale: num('sl-eplen', 100) / 100,
        sigma: num('sl-sigma', GA_DEFAULTS.sigma * 100) / 100,
        mutGenes: Math.round(num('sl-K', GA_DEFAULTS.mutGenes)),
        tier: idx('sel-tier', 0, GRID_TIERS.length - 1),
        lockTier: !!($('chk-lock') && $('chk-lock').checked),
        n1Weight: ($('chk-n1') && $('chk-n1').checked) ? 1 : 0
    }, settings || {});
    const seed = drawSeed();
    S.ev = new Evolution(s, seed);
    $('lab-seed').textContent = seed;
    S.ren.selected = -1;
    S.log.length = 0;
    S.evQueue.length = 0;
    S.evMore = 0;
    renderLog();
}

function buildTierSelects() {
    $('sel-tier').innerHTML = GRID_TIERS
        .map((t, i) => `<option value="${i}">${i + 1}. ${t.name}</option>`).join('');
    // The watch list spells out what each grid is like, because "IEEE 14" means
    // nothing to anyone who has not read a power-systems textbook.
    $('watch-tier').innerHTML = GRID_TIERS
        .map((t, i) => `<option value="${i}">${t.buses} substations — ${t.blurb}</option>`).join('');
    $('watch-tier').value = '3';
    refreshBrainSelects();
}

function refreshBrainSelects() {
    const opts = [];
    if (typeof DEFAULT_BRAIN !== 'undefined' && DEFAULT_BRAIN) opts.push('<option value="default">Mikkel&rsquo;s evolved operator</option>');
    if (S.mode !== 'watch' || (S.ev && S.ev.champion)) {
        opts.push('<option value="champion">The best one you have trained</option>');
    }
    if (S.mode !== 'watch') opts.push('<option value="leader">This generation&rsquo;s leader</option>');
    opts.push('<option value="expert">Normal program: rewire as well</option>');
    opts.push('<option value="redispatch">Normal program: turn stations up/down</option>');
    opts.push('<option value="donothing">Do nothing at all</option>');
    const a = $('watch-brain'), b = $('watch-rival');
    const keepA = a.value, keepB = b.value;
    a.innerHTML = opts.join('');
    b.innerHTML = opts.join('');
    // Watch mode drops the options that only exist mid-training, so a remembered
    // choice can name an option that is no longer there - in which case the
    // select silently goes blank and the race runs with no operator at all.
    const has = (sel, v) => v && Array.prototype.some.call(sel.options, o => o.value === v);
    const fallback = (typeof DEFAULT_BRAIN !== 'undefined' && DEFAULT_BRAIN) ? 'default' : 'expert';
    a.value = has(a, keepA) ? keepA : fallback;
    b.value = has(b, keepB) ? keepB : (a.value === 'expert' ? 'donothing' : 'expert');
}

// --- main loop --------------------------------------------------------------
function frame(now) {
    const dt = Math.min(120, now - (S.lastFrame || now));
    S.lastFrame = now;
    if (!S.paused) {
        if (S.mode === 'train') stepTraining();
        else stepWatch(dt);
    }
    if (!(S.mode === 'train' && S.headless)) drawCurrent();
    tickEventLog(now);
    updatePanel();
    requestAnimationFrame(frame);
}

function stepTraining() {
    const budget = S.headless ? Math.max(30, S.budget * 3) : S.budget;
    const t0 = performance.now();
    S.ev.run(budget);
    const spent = performance.now() - t0;
    S.stepAcc = S.stepAcc * 0.9 + (spent > 0 ? budget / spent : 1) * 0.1;
    drainEvents();
}

function drainEvents() {
    if (!S.ev.events.length) return;
    for (const e of S.ev.events) {
        if (e.type === 'tier') toast(`Network unlocked: ${e.name}`);
    }
    S.ev.events.length = 0;
}

function toast(msg) {
    const el = $('caption-sub');
    el.textContent = msg;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
}

function drawCurrent() {
    const w = S.mode === 'train' ? S.ev.world : (S.watch && S.watch.a);
    if (!w) return;
    S.ren.draw(w);
    updateLive(w);
    drainWorldEvents(w);
}

// The event log is the narrative of the day: what broke, what the operator did
// about it, what the relays did when it did not.
//
// It is PACED, and it has to be. A cascade produces six or seven events inside a
// single five-minute step, and at anything above the slowest speed those arrived
// and were pushed off the top of the list within a few frames - the most
// interesting thing that happens all day, and it was unreadable. So events go
// into a queue and are revealed one at a time on a wall-clock timer, regardless
// of how fast the simulation is running. The queue is never silently dropped:
// a counter says how many are still waiting.
const EV_HOLD_MS = 620;      // minimum time each event is alone on screen
const EV_MIN_MS = 190;       // ...unless a backlog builds up, then hurry a bit

function drainWorldEvents(w) {
    if (!w.events.length) return;
    for (const e of w.events) {
        const cls = (e.type === 'blackout' || e.type === 'shed' || e.type === 'uvls'
            || e.type === 'island') ? 'bad'
            : (e.type === 'open' || e.type === 'close' || e.type === 'sub') ? 'act'
                : (e.type === 'trip' || e.type === 'outage' || e.type === 'gentrip') ? '' : 'info';
        // The clock the event happened at, so a message read late is still
        // anchored to a moment in the day.
        const hour = ((w.wx && w.wx.startHour) || 0) + e.t * SIM.DT_H;
        S.evQueue.push({ cls, text: e.text, at: hhmm(hour) });
    }
    w.events.length = 0;
    if (S.evQueue.length > 60) S.evQueue.splice(0, S.evQueue.length - 60);
}

// Called every frame. Releases at most one queued event per interval.
function tickEventLog(nowMs) {
    if (!S.evQueue.length) {
        if (S.evMore) { S.evMore = 0; renderLog(); }
        return;
    }
    // A backlog shortens the gap, but never below EV_MIN_MS - the point is that
    // every line gets a moment on screen even during a cascade.
    const gap = Math.max(EV_MIN_MS, EV_HOLD_MS - S.evQueue.length * 55);
    if (nowMs - (S.evLast || 0) < gap) return;
    S.evLast = nowMs;
    S.log.unshift(S.evQueue.shift());
    if (S.log.length > 7) S.log.length = 7;
    S.evMore = S.evQueue.length;
    renderLog();
}

function renderLog() {
    const el = $('event-log');
    if (!el) return;
    const rows = S.log.map(l =>
        `<div class="ev ${l.cls}"><span class="ev-at">${l.at || ''}</span>${l.text}</div>`);
    if (S.evMore > 0) rows.push(`<div id="ev-more">+${S.evMore} more happening…</div>`);
    el.innerHTML = rows.join('');
}

// --- watch / compare --------------------------------------------------------
function makeWatchController(kind) {
    if (kind === 'default' && typeof DEFAULT_BRAIN !== 'undefined' && DEFAULT_BRAIN) {
        const d = deserializeGenome(DEFAULT_BRAIN);
        if (d) return brainController(d.genome, { record: true });
    }
    if (kind === 'champion' && S.ev.champion) return brainController(S.ev.champion.genome, { record: true });
    if (kind === 'leader') {
        const top = S.ev.lastRank.length ? S.ev.lastRank[0] : 0;
        return brainController(S.ev.genomes[top], { record: true });
    }
    if (kind === 'donothing' || kind === 'redispatch' || kind === 'expert') return makeController(kind);
    return makeController('expert');
}

// keepDay: re-run the SAME day with whatever is selected now. Changing who is
// driving has to hold the weather fixed or the comparison is worthless - and
// this is the whole point of the mode, so it is the default for every control
// except the button that explicitly asks for a new day.
function startWatch(keepDay) {
    const tier = idx('watch-tier', 3, GRID_TIERS.length - 1);
    const sameGrid = S.watch && S.watch.tier === tier;
    const reuse = keepDay && sameGrid && S.watch ? S.watch.seed : null;
    // ?day=N pins BOTH the network and the day, so a screenshot or a headless
    // comparison can be repeated exactly. Without it the network is drawn from
    // the run seed and the day from the clock, which is what you want when you
    // are actually watching and useless when you are trying to reproduce.
    const p = urlParams();
    const pinned = p ? parseFloat(p.get('day')) : NaN;
    const pin = Number.isFinite(pinned) ? (pinned >>> 0) : null;
    const net = makeNetwork(tier, mixSeed(0x671D, tier * 31, pin === null ? S.ev.runSeed : pin));
    const seed = reuse !== null ? reuse
        : (pin === null ? ((Math.random() * 0xffffffff) >>> 0) : pin);
    const opts = {
        steps: Math.max(24, Math.round((net.spec.steps || 144) * num('sl-eplen', 100) / 100)),
        n1Weight: ($('chk-n1') && $('chk-n1').checked) ? 1 : 0
    };
    const a = new World(net, opts).reset(seed, makeWatchController($('watch-brain').value));
    const b = new World(net, opts).reset(seed, makeWatchController($('watch-rival').value));
    S.watch = { a, b, tier, seed, net, done: false };
    S.ren.selected = -1;
    S.log.length = 0;
    renderLog();
    $('race-a-name').textContent = $('watch-brain').selectedOptions[0].textContent;
    $('race-b-name').textContent = $('watch-rival').selectedOptions[0].textContent;
    $('watch-status').textContent = '';
    $('btn-watch-pause').textContent = 'Pause';
    // The result of the LAST day has to go the moment a new one starts, and it
    // has to go from here rather than from the button that was clicked: three
    // different controls start a new day and only one of them is the button on
    // the banner itself.
    $('winner-banner').classList.add('hidden');
    $('race').classList.remove('hidden');
    drawCurrent();
    panelTick = 5;
    updatePanel();
}

function stepWatch(dtMs) {
    if (!S.watch) startWatch();
    const w = S.watch;
    if (w.done) return;
    const pace = num('watch-pace', 6);
    // `pace` is dispatch intervals per second of wall clock.
    w.acc = (w.acc || 0) + (dtMs / 1000) * pace;
    let guard = 0;
    while (w.acc >= 1 && guard++ < 400) {
        w.acc -= 1;
        if (!w.a.done) w.a.step();
        if (!w.b.done) w.b.step();
        if (w.a.done && w.b.done) break;
    }
    if (w.a.done && w.b.done && !w.done) {
        w.done = true;
        const ma = w.a.finish(), mb = w.b.finish();
        // finish() books the cost of a collapse for the hours the day would
        // still have run, so the bars have to be redrawn after it or they show a
        // number the verdict underneath them contradicts.
        updateRace();
        $('watch-status').innerHTML = dayVerdict(ma, mb, $('watch-brain'), $('watch-rival'));
        // Flush whatever is still queued. The day is over and the verdict is on
        // screen; a backlog counting down behind a result is just noise.
        while (S.evQueue.length && S.log.length < 7) S.log.unshift(S.evQueue.shift());
        S.evQueue.length = 0;
        S.evMore = 0;
        renderLog();
        showWinner(ma, mb, $('watch-brain'), $('watch-rival'));
    }
}

// The headline goes on the map, in type you cannot miss, because a result
// announced in the last sentence of a paragraph below the fold is not announced.
// The detail stays in the panel for anyone who wants it.
function showWinner(ma, mb, selA, selB) {
    const nameA = selA.options[selA.selectedIndex].textContent;
    const nameB = selB.options[selB.selectedIndex].textContent;
    const diff = ma.score - mb.score;
    const gap = Math.abs(diff);
    const t = $('wb-title'), sub = $('wb-sub');

    if (gap < 2000) {
        t.textContent = 'A dead heat';
        t.className = 'wb-title tie';
        sub.textContent = 'Nothing happened today that either of them could win or lose on. ' +
            'Most days are like this — that is what makes the bad ones expensive.';
    } else {
        const aWon = diff > 0;
        t.textContent = (aWon ? nameA : nameB) + ' won';
        t.className = 'wb-title ' + (aWon ? 'ai' : 'rival');
        const lostA = ma.demandMWh - ma.servedMWh, lostB = mb.demandMWh - mb.servedMWh;
        let why;
        if (Math.abs(lostA - lostB) > 1) {
            const better = aWon ? lostA : lostB, worse = aWon ? lostB : lostA;
            why = `${fmt(worse - better)} MWh of power reached people that otherwise would not have.`;
        } else if (ma.lineTrips !== mb.lineTrips) {
            why = `${Math.abs(ma.lineTrips - mb.lineTrips)} fewer power lines overheated and cut out.`;
        } else {
            why = 'Nobody lost power either way — this one was decided on cost alone.';
        }
        sub.textContent = `by €${eur(gap)}. ${why}`;
    }
    $('winner-banner').classList.remove('hidden');
}

// The day is over: say who won, by how much, and why - in words. Whoever is
// reading this page has just watched a diagram of coloured lines for two
// minutes and is entitled to be told what happened.
function dayVerdict(ma, mb, selA, selB) {
    const nameA = selA.options[selA.selectedIndex].textContent;
    const nameB = selB.options[selB.selectedIndex].textContent;
    const diff = ma.score - mb.score;
    const win = diff > 0 ? nameA : nameB;
    const lose = diff > 0 ? nameB : nameA;
    const gap = Math.abs(diff);

    // No headline here: it is on the map, in large type. This is the detail.
    const head = gap < 2000 ? ''
        : (gap > 200000
            ? `<b>A big gap</b>, so something went wrong today and one of them handled it better.`
            : `<b>A small gap</b> — a quiet day where the difference is money, not lights.`);

    const bits = [];
    void win; void lose;
    const lostA = ma.demandMWh - ma.servedMWh, lostB = mb.demandMWh - mb.servedMWh;
    if (lostA > 1 || lostB > 1) {
        bits.push(`Power that never reached anybody: <b>${fmt(lostA)} MWh</b> under ${nameA}, ` +
            `<b>${fmt(lostB)} MWh</b> under ${nameB}` +
            (Math.abs(lostA - lostB) > 1
                ? ` — that difference alone is most of the money.`
                : `.`));
    } else {
        bits.push(`Nobody lost power under either of them, so this was decided purely on cost.`);
    }
    bits.push(`Lines that overheated and cut out: <b>${ma.lineTrips}</b> vs <b>${mb.lineTrips}</b>. ` +
        `Changes ordered: ${fmt(ma.redispatchMWh)} MWh of power moved and ` +
        `${ma.switchActions + ma.subActions + ma.reconnects} switches, against ` +
        `${fmt(mb.redispatchMWh)} MWh and ${mb.switchActions + mb.subActions + mb.reconnects}.`);
    bits.push(`<i>Safety score (never rewarded): ready for any single line failing ` +
        `${pct(ma.n1SecureFrac)} of the day vs ${pct(mb.n1SecureFrac)}.</i>`);

    return (head ? head + '<br>' : '') + bits.join('<br>');
}

function runningScore(w) {
    const m = w.m;
    return m.revenue - m.fuelCost - m.premiumCost - m.curtailCost - m.switchCost
        - m.riskCost - m.lostLoadCost - m.blackoutCost;
}

function updateRace() {
    if (!S.watch) return;
    const va = runningScore(S.watch.a), vb = runningScore(S.watch.b);
    const lo = Math.min(0, va, vb), hi = Math.max(1, va, vb);
    const f = v => ((v - lo) / (hi - lo || 1)) * 100 + '%';
    $('race-a-fill').style.width = f(va);
    $('race-b-fill').style.width = f(vb);
    // A bar that is short because the day was a disaster looks exactly like a
    // bar that is short because the operator is losing, so losing money is
    // coloured rather than merely shorter. On a bad day BOTH turn red, which is
    // the honest picture: nobody won, one of them lost less.
    $('race-a-fill').classList.toggle('loss', va < 0);
    $('race-b-fill').classList.toggle('loss', vb < 0);
    $('race-a-val').textContent = '€' + eur(va);
    $('race-b-val').textContent = '€' + eur(vb);
    $('race-a-val').classList.toggle('loss', va < 0);
    $('race-b-val').classList.toggle('loss', vb < 0);
}

// --- panel ------------------------------------------------------------------
function updateLive(w) {
    if (!w.m) return;
    const hour = (w.wx.startHour || 0) + w.t * SIM.DT_H;
    $('live-clock').textContent = hhmm(hour);
    $('live-demand').textContent = fmt(w.demandNow) + ' MW';
    let renew = 0, tot = 0;
    for (let g = 0; g < w.net.nGen; g++) {
        tot += w.st.pg[g];
        if (w.net.gen[g].renew) renew += w.st.pg[g];
    }
    $('live-renew').textContent = pct(tot > 0 ? renew / tot : 0);
    const ml = w.maxLoading || Math.max(0, ...Array.from(w.flows.load));
    const el = $('live-load');
    el.textContent = pct(ml);
    el.className = ml >= 1 ? 'bad' : ml >= 0.9 ? 'warn' : 'good';
    const n1 = $('live-n1');
    n1.textContent = pct(w.n1.worst);
    n1.className = w.n1.worst >= 1 ? 'warn' : 'good';
    let uns = 0;
    for (let s = 0; s < w.net.nBus; s++) uns += w.st.pd[s] * w.st.shed[s];
    if (w.blackout) uns = w.demandNow;
    $('live-unserved').textContent = fmt(uns) + ' MW';
    $('live-margin').textContent = '€' + eur(runningScore(w));
}

function updatePanel() {
    if (++panelTick % 6 !== 0) return;
    const ev = S.ev;
    const h = ev.history.length ? ev.history[ev.history.length - 1] : null;

    if (S.mode === 'train') {
        const e = ev.evaluating;
        let sub;
        if (e && e.audition) sub = `auditioning day ${e.ep + 1} of ${ev.probeCount} — is there anything here to win?`;
        else if (e && e.kind === 'baseline') sub = `measuring the ${e.name} control room (day ${e.ep + 1})`;
        else if (e) sub = `scoring operator ${e.idx + 1} of ${ev.genomes.length}, day ${e.ep + 1}`;
        else sub = '';
        $('caption-main').textContent = `Generation ${ev.gen} · ${ev.net.label}`;
        if (!$('caption-sub').classList.contains('flash')) $('caption-sub').textContent = sub;
        $('stat-progress').textContent = e && e.kind === 'genome'
            ? `${e.idx + 1} / ${ev.genomes.length}` : (e && e.audition ? 'audition' : 'baselines');
    } else {
        $('caption-main').textContent = S.watch ? S.watch.net.label : 'Watch';
        $('caption-sub').textContent = S.watch ? `day seed ${S.watch.seed}` : '';
        updateRace();
    }

    $('stat-gen').textContent = ev.gen;
    $('stat-tier').textContent = `${ev.tier + 1} / ${GRID_TIERS.length}`;
    $('stat-buses').textContent = ev.net.nBus;
    $('stat-stag').textContent = ev.stagnation;
    $('stat-div').textContent = ev.diversity ? ev.diversity.toFixed(3) : '–';
    if (h) {
        $('stat-best').textContent = '€' + eur(h.best);
        const d = h.adv;
        $('stat-vs').textContent = (d >= 0 ? '+€' : '−€') + eur(Math.abs(d));
        $('stat-vs').className = 'stat-value ' + (d >= 0 ? 'good' : 'bad');
        $('stat-served').textContent = pct(h.served, 1);
        $('stat-trips').textContent = fmt(ev.champion && ev.champion.metrics ? ev.champion.metrics.lineTrips : 0, 1);
    }
    if (ev.champion) {
        const m = ev.champion.metrics || {};
        $('champion-note').innerHTML =
            `Generation ${ev.champion.gen}, network ${(ev.champion.tier | 0) + 1}: ` +
            `<b>${(ev.champion.advEur || 0) >= 0 ? '+' : '−'}€${eur(Math.abs(ev.champion.advEur || 0))}</b> against the best classical control room on its day, ` +
            `${pct(m.servedFrac, 1)} of demand served, ` +
            `${pct(m.n1SecureFrac)} of intervals N&#8209;1 secure, ` +
            `${fmt(m.lineTrips, 1)} line trips, ${fmt(m.redispatchMWh)} MWh redispatched.`;
    }
    drawCharts();
    drawInspector();
}

// --- charts -----------------------------------------------------------------
function drawCharts() {
    benchChart($('chart-bench'), S.ev.history);
    violChart($('chart-viol'), S.ev.history);
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

// Margins span orders of magnitude once a blackout is in the mix, so the axis is
// a symmetric log. A linear axis would compress every interesting difference
// into one pixel the moment a single genome loses the grid.
function symlog(v) { return Math.sign(v) * Math.log10(1 + Math.abs(v) / 1000); }

function benchChart(cv, hist) {
    const g = chartBase(cv);
    if (!hist.length) return;
    const w = cv.width, h = cv.height;
    const keys = ['best', 'median', 'donothing', 'redispatch', 'expert'];
    const vals = [];
    for (const r of hist) for (const k of keys) if (Number.isFinite(r[k])) vals.push(symlog(r[k]));
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 0.2) { max = min + 0.2; }
    if (min < 0 && max > 0) {
        const y = h - 4 - ((0 - min) / (max - min)) * (h - 10);
        g.strokeStyle = 'rgba(255,255,255,0.14)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    g.strokeStyle = 'rgba(154,214,255,0.18)';
    for (let i = 1; i < hist.length; i++) {
        if (hist[i].tier !== hist[i - 1].tier) {
            const x = (i / (hist.length - 1)) * (w - 2) + 1;
            g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
        }
    }
    const S2 = k => r => symlog(r[k]);
    series(g, hist, S2('donothing'), min, max, w, h, 'rgba(255,255,255,0.22)', 1);
    series(g, hist, S2('redispatch'), min, max, w, h, 'rgba(190,205,225,0.45)', 1.2);
    series(g, hist, S2('expert'), min, max, w, h, 'rgba(143,240,180,0.75)', 1.4, [4, 3]);
    series(g, hist, S2('median'), min, max, w, h, '#9ad6ff', 1.3);
    series(g, hist, S2('best'), min, max, w, h, '#ffbe6b', 1.8);
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.font = '9px sans-serif';
    g.fillText('symlog €', 3, 10);
}

function violChart(cv, hist) {
    const g = chartBase(cv);
    if (!hist.length) return;
    const w = cv.width, h = cv.height;
    // Overload frequency as bars, N-1 security as a line, both on 0..1.
    g.fillStyle = 'rgba(255,107,107,0.45)';
    for (let i = 0; i < hist.length; i++) {
        const v = hist[i].overload || 0;
        if (!v) continue;
        const x = hist.length > 1 ? (i / (hist.length - 1)) * (w - 2) + 1 : w / 2;
        const bh = v * (h - 8);
        g.fillRect(x - 1, h - 4 - bh, 2, bh);
    }
    series(g, hist, r => r.n1, 0, 1, w, h, '#8ff0b4', 1.8);
    series(g, hist, r => r.expN1, 0, 1, w, h, 'rgba(143,240,180,0.35)', 1.2, [3, 3]);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '9px sans-serif';
    g.fillText('100%', 2, 10);
    g.fillText('dashed = expert', w - 76, 10);
}

// --- substation inspector ---------------------------------------------------
function drawInspector() {
    const w = S.mode === 'train' ? S.ev.world : (S.watch && S.watch.a);
    const i = S.ren.selected;
    if (!w || i < 0 || i >= w.net.nBus) return;
    const net = w.net, st = w.st, bus = net.bus[i];
    $('insp-which').textContent = `${bus.name} · ${bus.baseKV} kV`;

    let rows = '';
    for (const e of net.subs[i].elems) {
        if (e.kind !== 'br') continue;
        const b = e.ref, br = net.branch[b];
        const live = st.status[b];
        const ld = live ? w.flows.load[b] : 0;
        const cls = !live ? 'out' : ld >= 1 ? 'over' : ld >= 0.9 ? 'hot' : ld >= 0.75 ? 'warn' : 'ok';
        const flow = e.side === 0 ? w.flows.pf[b] : w.flows.pt[b];
        rows += `<tr><td>${net.bus[e.other].name}</td>` +
            `<td><span class="pill ${cls}">${live ? Math.round(ld * 100) + '%' : 'out'}</span></td>` +
            `<td>${live ? fmt(flow) : '–'}</td>` +
            `<td>${br.rate}</td>` +
            `<td>${Math.round(w.n1.perBranch[b] * 100)}%</td>` +
            `<td>${st.topo[i][net.subs[i].elems.indexOf(e)] === 2 ? 'B' : 'A'}</td></tr>`;
    }
    let gens = '';
    for (const gen of net.gen) {
        if (gen.bus !== i) continue;
        const f = gen.pmax > 0 ? Math.max(0, st.pg[gen.id]) / gen.pmax : 0;
        gens += `<div class="insp-now"><b>${gen.name}</b> ${fmt(st.pg[gen.id])} / ${fmt(gen.pmax)} MW` +
            (gen.renew ? ` <span class="hint">available ${fmt(st.renewAvail[gen.id])}${st.curtail[gen.id] > 0.01 ? ', curtailed ' + pct(st.curtail[gen.id]) : ''}</span>`
                : ` <span class="hint">€${gen.cost}/MWh${Math.abs(st.redisp[gen.id]) > 0.5 ? ', redispatched ' + (st.redisp[gen.id] > 0 ? '+' : '') + fmt(st.redisp[gen.id]) + ' MW' : ''}</span>`) +
            `<div class="bar"><i style="width:${(f * 100).toFixed(0)}%;background:${GEN_KINDS[gen.kind].color}"></i></div></div>`;
    }
    const split = w.res && w.res.subNode2[i] >= 0;
    const vm = st.vm[i];
    const vcls = vm < 0.05 ? 'out' : (vm < SIM.VM_LO || vm > SIM.VM_HI) ? 'over' : 'ok';
    $('insp-body').innerHTML =
        `<p class="insp-now">Voltage <span class="pill ${vcls}">${vm > 0.05 ? vm.toFixed(3) + ' pu' : 'dark'}</span> ` +
        `&middot; load <b>${fmt(st.pd[i] * (1 - st.shed[i]))} MW</b>` +
        (st.shed[i] > 0.01 ? ` <span class="pill over">${pct(st.shed[i])} shed</span>` : '') +
        (split ? ' <span class="pill warn">busbars split</span>' : '') +
        (st.subCd[i] > 0 ? ` <span class="hint">locked for ${st.subCd[i]} intervals</span>` : '') + `</p>` +
        (rows ? `<table class="insp"><thead><tr><th>to</th><th>loading</th><th>MW</th><th>MVA limit</th><th>worst N-1</th><th>bar</th></tr></thead><tbody>${rows}</tbody></table>` : '') +
        gens;
}

// --- controls ---------------------------------------------------------------
function bindControls() {
    for (const tab of document.querySelectorAll('.mode-tab')) {
        tab.addEventListener('click', () => setMode(tab.dataset.mode));
    }

    $('btn-pause').addEventListener('click', () => {
        S.paused = !S.paused;
        $('btn-pause').textContent = S.paused ? 'Resume' : 'Pause';
    });
    $('btn-watch-pause').addEventListener('click', () => {
        S.paused = !S.paused;
        $('btn-watch-pause').textContent = S.paused ? 'Play' : 'Pause';
    });
    $('btn-reset').addEventListener('click', () => { newRun(); });
    $('btn-watch-run').addEventListener('click', () => {
        S.paused = false;
        startWatch(false);
    });

    // These three had NO change handler, which is a plain bug and an unusually
    // confusing one: picking a different operator appeared to change nothing,
    // because the selects were only read when a new day was started. Now
    // swapping an operator re-runs the identical day - same weather, same
    // faults, same minute - which is exactly the comparison the mode exists to
    // make. Changing the grid necessarily starts a new day.
    $('wb-again').addEventListener('click', () => { S.paused = false; startWatch(false); });
    $('watch-brain').addEventListener('change', () => { S.paused = false; startWatch(true); });
    $('watch-rival').addEventListener('change', () => { S.paused = false; startWatch(true); });
    $('watch-tier').addEventListener('change', () => { S.paused = false; startWatch(false); });

    const slider = (id, lab, fn) => {
        const el = $(id);
        el.addEventListener('input', () => { $(lab).textContent = fn(+el.value); });
        $(lab).textContent = fn(+el.value);
    };
    slider('sl-budget', 'lab-budget', v => { S.budget = v; return v + ' ms'; });
    slider('sl-pop', 'lab-pop', v => v);
    slider('sl-eplen', 'lab-eplen', v => v + '%');
    slider('sl-sigma', 'lab-sigma', v => { if (S.ev) S.ev.s.sigma = v / 100; return (v / 100).toFixed(2); });
    slider('sl-K', 'lab-K', v => { if (S.ev) S.ev.s.mutGenes = v; return v; });

    $('sel-tier').addEventListener('change', () => {
        S.ev.tier = idx('sel-tier', 0, GRID_TIERS.length - 1);
        S.ev.advanceWindow.length = 0;
        S.ev.headroomWindow.length = 0;
        S.ev.tierAge = 0;
        if (S.ev.champion) S.ev.champion.fitness = -Infinity;
        S.ev.startGeneration();
    });
    $('chk-lock').addEventListener('change', () => { S.ev.s.lockTier = $('chk-lock').checked; });
    $('chk-n1').addEventListener('change', () => {
        S.ev.s.n1Weight = $('chk-n1').checked ? 1 : 0;
        toast($('chk-n1').checked
            ? 'N-1 insecurity is now charged for — the security chart is no longer independent'
            : 'N-1 insecurity is measured but not charged for');
    });
    $('chk-headless').addEventListener('change', () => {
        S.headless = $('chk-headless').checked;
        $('canvas-overlay').classList.toggle('hidden', !S.headless || S.mode !== 'train');
    });
    $('chk-n1arc').addEventListener('change', () => { S.ren.showN1 = $('chk-n1arc').checked; });
    $('inp-seed').addEventListener('change', () => { S.seedInput = $('inp-seed').value.trim(); });

    const cv = $('grid');
    cv.addEventListener('click', e => {
        const w = S.mode === 'train' ? S.ev.world : (S.watch && S.watch.a);
        if (!w || S.dragging) return;
        const r = cv.getBoundingClientRect();
        S.ren.selected = S.ren.pick(w, e.clientX - r.left, e.clientY - r.top);
    });
    cv.addEventListener('wheel', e => {
        e.preventDefault();
        S.ren.zoom = clamp(S.ren.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.5, 8);
    }, { passive: false });
    let down = false, lx = 0, ly = 0;
    cv.addEventListener('pointerdown', e => {
        down = true; S.dragging = false; lx = e.clientX; ly = e.clientY;
        cv.setPointerCapture(e.pointerId);
    });
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
        if (e.key === ' ') { e.preventDefault(); $('btn-pause').click(); }
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
    a.download = `power-grid-champion-gen${S.ev.champion.gen}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
}
