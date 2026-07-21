// Bootstrap + main loop: fixed-timestep simulation with speed stops and a
// time-boxed max-speed burst mode, UI wiring, localStorage persistence and a
// runnable self-test.
'use strict';

(function () {

    const SPEED_STOPS = [0.5, 1, 2, 4, 8, 16, Infinity];
    const SPEED_LABELS = ['0.5×', '1×', '2×', '4×', '8×', '16×', 'Max'];
    const SAVE_KEY = 'food_delivery_ne_v5';   // arch v5: single type-blind ray channel

    const S = {
        town: null, jobs: null, world: null, ev: null, staticCanvas: null,
        townSeedBase: 0, townCounter: 0,
        speedStop: 1, preHeadlessStop: 1, paused: false, headless: false,
        selectedIdx: 0, autoSelectBest: true, showSensors: true,
        stepCarry: 0, frameCount: 0,
        stepsWindow: 0, rateStamp: 0, simRate: 60,
        lastSave: 0, saveNote: ''
    };

    let simCanvas, simCtx, nnCanvas, chartFit, chartDeliv;

    // -----------------------------------------------------------------------
    // Town / world lifecycle
    // -----------------------------------------------------------------------

    function townSeedFor(counter) { return mixSeed(S.townSeedBase, counter, 0x70FF); }

    function buildTown(counter) {
        S.townCounter = counter;
        // Rotate through the four town layout variants (classic grid,
        // roundabout, one-way couplet, curves+roundabout+one-way).
        S.town = generateTown(townSeedFor(counter), counter % 4);
        buildAdjacency(S.town);
        S.jobs = generateJobs(S.town, townSeedFor(counter), 60);
        S.staticCanvas = renderTownStatic(S.town);
        S.world = createWorld(S.town, S.jobs);
        if (S.ev) S.ev.attach(S.world);
        const seedEl = $('seed-label');
        if (seedEl) seedEl.textContent = '#' + townSeedFor(counter).toString(16);
    }

    function changeTown() {
        buildTown(S.townCounter + 1);
        S.ev.onTownChanged(S.townCounter);
        S.ev.startGeneration();
        toast('New town generated — same brains, fresh streets', 'info');
    }

    // -----------------------------------------------------------------------
    // Simulation stepping
    // -----------------------------------------------------------------------

    function tickOnce() {
        const r = S.ev.tick();
        S.stepsWindow++;
        if (r.generationEnded) onGenerationEnd();
    }

    function onGenerationEnd() {
        for (const e of S.ev.events.splice(0)) {
            if (e.type === 'champion') toast(`New champion in generation ${e.gen} — fitness ${Math.round(e.fitness)}`, 'good');
            else if (e.type === 'phase') toast(e.phase === 1
                ? 'Curriculum phase 1 — cars now start empty and must pick up first'
                : 'Curriculum phase 2 — jobs now rotate across the full pool', 'good');
        }
        drawCharts();
        const N = S.ev.s.autoChangeEvery;
        if (N > 0 && S.ev.gen > 1 && (S.ev.gen - 1) % N === 0) {
            changeTown();
            autosave();
            return;              // changeTown already started the next generation
        }
        autosave();
        S.ev.startGeneration();
    }

    function frame() {
        resizeCanvases();
        if (!S.paused) {
            const target = SPEED_STOPS[S.speedStop];
            const t0 = performance.now();
            if (target === Infinity) {
                let burst = 0;
                while (performance.now() - t0 < 11 && burst < 350) {
                    for (let k = 0; k < 8; k++) tickOnce();
                    burst++;
                }
            } else {
                S.stepCarry += target;
                while (S.stepCarry >= 1 && performance.now() - t0 < 14) {
                    tickOnce();
                    S.stepCarry -= 1;
                }
                if (S.stepCarry > 6) S.stepCarry = 6;
            }
        }
        const now = performance.now();
        if (now - S.rateStamp > 500) {
            S.simRate = (S.stepsWindow * 1000) / Math.max(1, now - S.rateStamp);
            S.stepsWindow = 0;
            S.rateStamp = now;
        }
        render();
        S.frameCount++;
        requestAnimationFrame(frame);
    }

    // -----------------------------------------------------------------------
    // Rendering + stats
    // -----------------------------------------------------------------------

    function currentBestIdx() {
        let best = -1, bestF = -Infinity;
        for (const car of S.world.cars) {
            const f = episodeFitness(car.m);
            if (f > bestF) { bestF = f; best = car.idx; }
        }
        return best;
    }

    function render() {
        const maxed = SPEED_STOPS[S.speedStop] === Infinity;
        if (S.autoSelectBest && S.frameCount % 45 === 0) {
            const alive = S.world.cars.filter(c => c.alive);
            let best = -1, bestF = -Infinity;
            for (const car of alive) {
                const f = episodeFitness(car.m);
                if (f > bestF) { bestF = f; best = car.idx; }
            }
            if (best >= 0) S.selectedIdx = best;
        }
        S.world.recordCarIdx = S.selectedIdx;

        if (S.headless && maxed) {
            renderHeadlessSummary(simCanvas, simCtx, S.world, S.ev, S.simRate / 60);
        } else {
            renderWorld(simCanvas, simCtx, S.world, S.staticCanvas, {
                selectedIdx: S.selectedIdx,
                bestIdx: currentBestIdx(),
                showSensors: S.showSensors
            });
        }
        if (S.frameCount % 6 === 0) {
            const sel = S.world.cars[S.selectedIdx];
            drawNNViz(nnCanvas, S.world.lastRecord, sel ? sel.genome : null);
        }
        if (S.frameCount % 10 === 0) updateStats();
    }

    function updateStats() {
        const ev = S.ev;
        const hist = ev.history[ev.history.length - 1];
        $('stat-gen').textContent = ev.gen;
        $('stat-phase').textContent = ev.evalMode ? 'FROZEN EVAL · no time limit'
            : ev.phase === 0 ? 'phase 0 · delivery only'
            : ev.phase === 1 ? 'phase 1 · pickup + deliver' : 'phase 2 · full job pool';
        $('stat-best').textContent = ev.champion ? Math.round(ev.champion.fitness).toLocaleString() : '–';
        $('stat-deliv').textContent = hist ? `${hist.dBest.toFixed(1)} / ${hist.dMean.toFixed(2)}` : '–';
        $('stat-rate').textContent = (S.simRate / 60).toFixed(S.simRate < 300 ? 1 : 0) + '×';
        $('stat-alive').textContent = S.world.cars.filter(c => c.alive).length + '/' + S.world.cars.length;
        $('stat-episode').textContent = `${ev.episodeIdx + 1}/${ev.s.episodesPerGen} · t=${S.world.simTime.toFixed(0)}s` +
            (S.world.carContact ? '' : ' · ghost');
        $('stat-stag').textContent = ev.stagnation + (ev.s.stagnationAdapt && ev.stagnation >= 10 ? ' (boosted)' : '');
        $('stat-div').textContent = ev.diversity ? ev.diversity.toFixed(3) : '–';

        const sel = S.world.cars[S.selectedIdx];
        if (sel) {
            $('tele-state').textContent = sel.alive
                ? (sel.leg === 'toPickup' ? '→ pickup' : '→ delivery') + (sel.carrying ? ' · 🍕' : '')
                : sel.retired || 'idle';
            $('tele-speed').textContent = Math.abs(sel.v).toFixed(0) + ' px/s';
            $('tele-jobs').textContent = `${sel.m.deliveries} deliv · ${sel.m.pickups} pick`;
            $('tele-cover').textContent = (sel.m.coverage * 100 / Math.max(1, sel.m.deliveries + sel.m.pickups + 1)).toFixed(0) + `% avg · ${sel.m.replans} rp · ${sel.m.misses} miss`;
            $('tele-coll').textContent = `${sel.m.carColl} car · ${sel.m.pedColl} ped`;
            $('tele-law').textContent = `${sel.m.wrongSideSec.toFixed(1)}s wrong side · ${sel.m.redLightRuns} red`;
            $('tele-fit').textContent = Math.round(episodeFitness(sel.m)).toLocaleString();
        }
        $('save-note').textContent = S.saveNote;
    }

    function drawCharts() {
        drawHistoryChart(chartFit, S.ev.history, ['best', 'mean'], [ACCENT2, 'rgba(154,214,255,0.55)'], v => Math.round(v).toLocaleString() + ' fit');
        drawHistoryChart(chartDeliv, S.ev.history, ['dBest', 'dMean'], [GOOD, 'rgba(154,214,255,0.55)'], v => v.toFixed(1) + ' deliveries');
    }

    function resizeCanvases() {
        const wrap = $('viewport');
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.clientWidth, h = wrap.clientHeight;
        if (simCanvas.width !== Math.round(w * dpr) || simCanvas.height !== Math.round(h * dpr)) {
            simCanvas.width = Math.round(w * dpr);
            simCanvas.height = Math.round(h * dpr);
            simCanvas.style.width = w + 'px';
            simCanvas.style.height = h + 'px';
        }
    }

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    function autosave() {
        const now = performance.now();
        if (now - S.lastSave < 5000) return;
        S.lastSave = now;
        try {
            const data = {
                v: 1, townSeedBase: S.townSeedBase, townCounter: S.townCounter,
                speedStop: S.speedStop, ev: S.ev.toJSON()
            };
            localStorage.setItem(SAVE_KEY, JSON.stringify(data));
            S.saveNote = 'autosaved gen ' + S.ev.gen;
        } catch (e) {
            S.saveNote = 'autosave failed (storage full?)';
        }
    }

    function tryLoad() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || data.v !== 1) return null;
            return data;
        } catch (e) { return null; }
    }

    function exportChampion() {
        if (!S.ev.champion) { toast('No champion yet — train at least one generation', 'warn'); return; }
        const payload = JSON.stringify(serializeGenome(S.ev.champion.genome, {
            fitness: S.ev.champion.fitness, gen: S.ev.champion.gen, exported: new Date().toISOString()
        }));
        const blob = new Blob([payload], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `food-delivery-champion-gen${S.ev.champion.gen}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Champion exported', 'good');
    }

    function importChampion(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const de = deserializeGenome(JSON.parse(reader.result));
                if (!de) { toast('Import rejected: incompatible or corrupt genome', 'warn'); return; }
                S.ev.champion = { genome: de.genome, fitness: (de.meta && de.meta.fitness) || 0, gen: S.ev.gen };
                S.ev.genomes[0] = cloneGenome(de.genome);
                if (S.ev.genomes.length > 1) {
                    const g = cloneGenome(de.genome);
                    mutateGenomeK(g, S.ev.s.mutGenes, S.ev.s.sigma, 0.002, S.ev.rng());
                    S.ev.genomes[1] = g;
                }
                toast('Champion imported — it joins the population next generation', 'good');
            } catch (e) {
                toast('Import failed: ' + e.message, 'warn');
            }
        };
        reader.readAsText(file);
    }

    // Run seed from the UI field: a number gives a deterministic run, an
    // empty/invalid field draws a random one (and shows what was drawn).
    function readSeedFromUI() {
        const el = $('inp-seed');
        const v = el ? parseInt(el.value, 10) : NaN;
        if (Number.isFinite(v)) return v >>> 0;
        const drawn = (Math.random() * 0xffffffff) >>> 0;
        if (el) el.value = String(drawn);
        return drawn;
    }

    function resetTraining() {
        if (!confirm('Reset all training? Champion, population and history are wiped.')) return;
        localStorage.removeItem(SAVE_KEY);
        const settings = readSettingsFromUI();
        const seed = readSeedFromUI();
        S.ev = new Evolution(settings, seed);
        S.ev.attach(S.world);
        S.ev.startGeneration();
        drawCharts();
        toast(`Training reset — fresh population, seed ${seed}`, 'info');
    }

    // -----------------------------------------------------------------------
    // Self-test
    // -----------------------------------------------------------------------

    function runSelfTest() {
        const results = [];
        const ok = (c, name) => results.push((c ? '✓ ' : '✗ ') + name);
        try {
            const rng = mulberry32(7);
            const g1 = randomGenome(rng), g2 = randomGenome(rng);
            const ser = deserializeGenome(JSON.parse(JSON.stringify(serializeGenome(g1))));
            ok(ser && ser.genome.every((v, i) => v === g1[i]), 'serialize round trip');
            const child = crossoverGenomes(g1, g2, rng);
            let pure = child.length === NN_GENOME_LEN;
            for (let i = 0; i < child.length && pure; i++) pure = (child[i] === g1[i] || child[i] === g2[i]);
            ok(pure, 'copy-paste crossover');
            const gm = cloneGenome(g1);
            mutateGenomeK(gm, 32, 0.15, 0, rng);
            let changed = 0;
            for (let i = 0; i < gm.length; i++) if (gm[i] !== g1[i]) changed++;
            ok(changed === 32 && validGenome(gm), 'K-gene mutation');
            const tA = generateTown(4242), tB = generateTown(4242);
            ok(tA.buildings.length === tB.buildings.length && tA.edges.length === tB.edges.length, 'deterministic town');
            buildAdjacency(tA);
            const jobs = generateJobs(tA, 4242, 30);
            ok(jobs.length >= 20, 'job pool');
            {
                const tV = generateTown(777, 3);
                buildAdjacency(tV);
                const rings = tV.edges.filter(e => e.ring);
                const rb = tV.roundabout;
                const west = rb && nearestLanePoint(tV, rb.x - 200, rb.y, 1, 0);
                const east = rb && nearestLanePoint(tV, rb.x + 200, rb.y, 1, 0);
                const across = west && east ? buildRoute(tV, west, east) : null;
                ok(!!rb && rings.length === 4 && !!across &&
                    tV.edges.some(e => e.axis === 'c' && !e.ring) &&
                    generateTown(778, 2).edges.some(e => e.oneway),
                    'town variants: roundabout + curves + one-ways routable');
            }
            // No route may reverse heading (>=149 deg turn within 80px).
            const hasReversal = (route) => {
                const pts = route.pts;
                for (let i = 1; i < pts.length - 1; i++) {
                    let sum = 0, dist = 0;
                    for (let j = i; j < pts.length - 1 && dist < 80; j++) {
                        const a1 = Math.atan2(pts[j].y - pts[j - 1].y, pts[j].x - pts[j - 1].x);
                        const a2 = Math.atan2(pts[j + 1].y - pts[j].y, pts[j + 1].x - pts[j].x);
                        sum += wrapAngle(a2 - a1);
                        dist += Math.hypot(pts[j + 1].x - pts[j].x, pts[j + 1].y - pts[j].y);
                        if (Math.abs(sum) > 2.6) return true;
                    }
                }
                return false;
            };
            ok(jobs.every(j => !hasReversal(j.route)), 'no U-turns in routes');
            // Motor test: a proportional controller must corner a route on-road.
            let cornerRoute = null;
            for (const j of jobs) {
                let turnSum = 0;
                for (let i = 1; i < j.route.pts.length - 1; i++) {
                    const a1 = Math.atan2(j.route.pts[i].y - j.route.pts[i - 1].y, j.route.pts[i].x - j.route.pts[i - 1].x);
                    const a2 = Math.atan2(j.route.pts[i + 1].y - j.route.pts[i].y, j.route.pts[i + 1].x - j.route.pts[i].x);
                    turnSum += Math.abs(wrapAngle(a2 - a1));
                }
                if (turnSum > 1.2 && j.route.total < 1000) { cornerRoute = j.route; break; }
            }
            let cornerPass = false;
            if (cornerRoute) {
                const pts = cornerRoute.pts;
                const carT = { x: pts[0].x, y: pts[0].y, theta: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x), v: 0, routeIdx: 0, maxRouteDist: 0 };
                let offroad = false;
                for (let tick = 0; tick < Math.round(45 / DT); tick++) {
                    const f = followRoute(cornerRoute, carT);
                    if (f.routeDist >= cornerRoute.total * 0.95) { cornerPass = true; break; }
                    const steer = clamp(2.6 * Math.sin(f.headingErr) - 0.035 * f.crossTrack, -1, 1);
                    const throttle = clamp(0.75 - Math.abs(f.turn1) * 0.5 - Math.abs(Math.sin(f.headingErr)) * 0.3, 0.22, 0.8);
                    carT.v = Math.min((carT.v + throttle * CAR_ACCEL * DT) * (1 - 0.6 * DT), CAR_MAXV);
                    carT.theta = wrapAngle(carT.theta + (carT.v / WHEELBASE) * Math.tan(steer * MAX_STEER) * DT);
                    carT.x += Math.cos(carT.theta) * carT.v * DT;
                    carT.y += Math.sin(carT.theta) * carT.v * DT;
                    const lp = lanePosition(tA, carT.x, carT.y, Math.cos(carT.theta), Math.sin(carT.theta));
                    if (!(lp.dist <= ROAD_HALF + 4)) { offroad = true; break; }
                }
                cornerPass = cornerPass && !offroad;
            }
            ok(cornerPass, 'cornering motor test (stays on-road)');
            // Arrival pipeline: a braking controller must deliver for real; a
            // non-braking one must drive through without delivering and get an
            // overshoot replan. nnForward is swapped and ALWAYS restored.
            {
                const steerFrom = inp => clamp(2.6 * inp[15] - 0.035 * inp[17] * 68, -1, 1);
                const origForward = nnForward;
                try {
                    const redStop = inp => inp[24] >= 0.5 && inp[23] < 0.45;
                    let maxDwellInp = 0;
                    nnForward = (g, inp) => {
                        maxDwellInp = Math.max(maxDwellInp, inp[32]);
                        const vPx = inp[14] * 360;
                        if (redStop(inp)) return [steerFrom(inp), vPx > 4 ? -0.6 : 0];
                        let throttle;
                        if (inp[21] >= 0.12) {
                            throttle = clamp(0.42 - Math.abs(inp[19]) * 0.9 - Math.abs(inp[15]) * 0.2, 0.15, 0.45);
                        } else {
                            const distPx = inp[18] * 300;
                            if (distPx > 60) throttle = 0.3;
                            else if (vPx > 30) throttle = -0.7;
                            else if (distPx > 14) throttle = 0.1;
                            else throttle = vPx > 3 ? -0.4 : 0;
                        }
                        return [steerFrom(inp), throttle];
                    };
                    const wA = createWorld(tA, jobs);
                    startEpisode(wA, [randomGenome(mulberry32(41))], 1, 0, 977);
                    wA.peds.length = 0;   // fatal peds would randomize scripted runs
                    const carA = wA.cars[0];
                    let tk = 0;
                    while (tk++ < 60 * 150 && carA.alive && carA.m.deliveries === 0) stepWorld(wA);
                    ok(carA.m.pickups >= 1 && carA.m.deliveries >= 1, 'arrival pipeline: standstill stop, then drives on and delivers');
                    ok(maxDwellInp >= 0.8, 'dwell-progress input rises while registering');

                    // Phase-0 curriculum rung: cars spawn ALREADY CARRYING and
                    // must only drive the leg + stop - no pickup involved. The
                    // carry-leg progress ramp must have paid along the way.
                    const wC = createWorld(tA, jobs);
                    startEpisode(wC, [randomGenome(mulberry32(44))], 0, 0, 977);
                    wC.peds.length = 0;
                    const carC = wC.cars[0];
                    const spawnOk = carC.carrying && carC.leg === 'toDelivery';
                    tk = 0;
                    while (tk++ < 60 * 150 && carC.alive && carC.m.deliveries === 0) stepWorld(wC);
                    ok(spawnOk && carC.m.deliveries >= 1 && carC.m.pickups === 0 &&
                        carC.m.legProgress > 50,
                        'phase 0 spawns carrying: delivery-only leg, progress ramp pays');

                    // Symmetric forfeiture: ANY death while carrying forfeits
                    // that pickup's credit (not just the parking timeout).
                    const wF = createWorld(tA, jobs);
                    startEpisode(wF, [randomGenome(mulberry32(45))], 1, 0, 977);
                    const carF = wF.cars[0];
                    carF.carrying = true; carF.curPickupEarned = 0.8; carF.m.pickupEarned = 1.3;
                    _retire(carF, 'crash');
                    ok(Math.abs(carF.m.pickupEarned - 0.5) < 1e-9 && carF.curPickupEarned === 0,
                        'death while carrying forfeits the pickup credit');

                    // Ghost episodes: with carContactEvery=2, episode slot 1
                    // runs without car contact - radar blind, pass-through -
                    // while slot 0 keeps full contact.
                    const wGh = createWorld(tA, jobs);
                    wGh.carContactEvery = 2;
                    startEpisode(wGh, [randomGenome(mulberry32(46)), randomGenome(mulberry32(47))], 1, 1, 977);
                    const ghostOff = wGh.carContact === false;
                    const [gA, gB] = wGh.cars;
                    gB.x = gA.x + Math.cos(gA.theta) * 8;
                    gB.y = gA.y + Math.sin(gA.theta) * 8;
                    gB.theta = gA.theta;
                    wGh.peds.length = 0;
                    _rebuildDynGrid(wGh);   // rays read the dyn grid - refresh after staging
                    computeInputs(wGh, gA);
                    const ghostRay0 = gA.inp[0];
                    wGh.carContact = true;         // same staging, contact on
                    computeInputs(wGh, gA);
                    const contactRay0 = gA.inp[0];
                    wGh.carContact = false;
                    const radarBlind = contactRay0 < 0.1 && ghostRay0 > contactRay0 + 0.05;
                    stepWorld(wGh);
                    startEpisode(wGh, [randomGenome(mulberry32(46))], 1, 0, 977);
                    ok(ghostOff && radarBlind && gA.alive && gB.alive && wGh.carContact === true,
                        'ghost episodes: radar blind + pass-through, slot 0 keeps contact');

                    // Missed-target machinery, staged on a door with straight
                    // road before and beyond so geometry is deterministic.
                    let door = null;
                    for (let rIdx = 0; rIdx < tA.buildings.length && !door; rIdx++) {
                        const lane = tA.buildings[rIdx].lane;
                        if (!lane) continue;
                        let clear = true;
                        for (let d = 20; d <= 240 && clear; d += 20) {
                            if (!(lanePosition(tA, lane.x + lane.dirX * d, lane.y + lane.dirY * d, lane.dirX, lane.dirY).dist <= ROAD_HALF)) clear = false;
                        }
                        for (let d = 20; d <= 280 && clear; d += 20) {
                            if (!(lanePosition(tA, lane.x - lane.dirX * d, lane.y - lane.dirY * d, lane.dirX, lane.dirY).dist <= ROAD_HALF)) clear = false;
                        }
                        // Reds are fatal - the staged corridor must be light-free.
                        if (clear) {
                            for (const n of tA.nodes) {
                                if (!n.light) continue;
                                const rel = (n.x - lane.x) * lane.dirX + (n.y - lane.y) * lane.dirY;
                                const perp = Math.abs((n.x - lane.x) * -lane.dirY + (n.y - lane.y) * lane.dirX);
                                if (perp < 30 && rel > -300 && rel < 260) { clear = false; break; }
                            }
                        }
                        if (clear) { door = { rIdx, lane }; break; }
                    }
                    const stageAt = (world) => {
                        world.peds.length = 0;
                        const car = world.cars[0];
                        const sL = nearestLanePoint(tA, door.lane.x - door.lane.dirX * 260, door.lane.y - door.lane.dirY * 260, door.lane.dirX, door.lane.dirY);
                        car.x = sL.x; car.y = sL.y;
                        car.theta = Math.atan2(door.lane.dirY, door.lane.dirX);
                        car.v = 0;
                        car.job = { restIdx: door.rIdx, homeIdx: jobs[0].homeIdx, route: jobs[0].route };
                        car.leg = 'toPickup'; car.carrying = false;
                        car.coverageBase = 0; car.legCoverage = 0; car.dwell = 0;
                        _setRoute(car, buildRoute(tA, sL, door.lane));
                        return car;
                    };

                    // Fast drive-through: no arrival, replans back, counts a
                    // miss - and orbiting cannot farm coverage (capped at 1).
                    nnForward = (g, inp) => {
                        if (redStop(inp)) return [steerFrom(inp), inp[14] * 360 > 4 ? -0.6 : 0];
                        return [steerFrom(inp), clamp(0.3 - Math.abs(inp[19]) * 0.6 - Math.abs(inp[15]) * 0.2, 0.15, 0.22)];
                    };
                    const wB = createWorld(tA, jobs);
                    startEpisode(wB, [randomGenome(mulberry32(42))], 1, 0, 977);
                    const carB = door ? stageAt(wB) : wB.cars[0];
                    let minD = Infinity;
                    tk = 0;
                    while (tk++ < 60 * 120 && carB.alive && carB.m.misses < 2) {
                        stepWorld(wB);
                        const d = Math.hypot(carB.x - door.lane.x, carB.y - door.lane.y);
                        if (d < minD) minD = d;
                    }
                    ok(door && minD < 30 && carB.m.pickups === 0 && carB.m.replans >= 1, 'drive-through: no arrival + overshoot replan');
                    ok(carB.m.misses >= 2 && carB.m.coverage <= 1 + 1e-9, 'misses counted, coverage capped (no orbit farming)');

                    // GPS recovery window: slow and just past the end, the
                    // heading error flips back toward the door instead of
                    // flagging off-route; far past, off-route triggers.
                    const rr = jobs[0].route;
                    const rrLast = rr.pts.length - 1;
                    const rrDir = Math.atan2(rr.pts[rrLast].y - rr.pts[rrLast - 1].y, rr.pts[rrLast].x - rr.pts[rrLast - 1].x);
                    const stub = { x: rr.target.x + Math.cos(rrDir) * 40, y: rr.target.y + Math.sin(rrDir) * 40, theta: rrDir, v: 20, routeIdx: rrLast - 1, maxRouteDist: 0 };
                    const fNear = followRoute(rr, stub);
                    stub.x = rr.target.x + Math.cos(rrDir) * 130;
                    stub.y = rr.target.y + Math.sin(rrDir) * 130;
                    stub.routeIdx = rrLast - 1;
                    const fFar = followRoute(rr, stub);
                    ok(fNear.recovering && Math.cos(fNear.headingErr) < -0.6 && !fNear.offRoute && !fFar.recovering && fFar.offRoute,
                        'overshoot recovery: GPS aims back within 90px, off-route beyond');

                    // Reverse recovery end-to-end: slow overshoot, backs up,
                    // still gets the pickup - zero misses, zero replans.
                    nnForward = (g, inp) => {
                        if (inp[16] < -0.4) {
                            const d = inp[18] * 300, v = inp[14] * 360;
                            if (d > 30) return [0, -0.5];
                            return [0, v < -8 ? 0.3 : 0];
                        }
                        const steer = steerFrom(inp);
                        if (redStop(inp)) return [steer, inp[14] * 360 > 4 ? -0.6 : 0];
                        if (inp[21] < 0.3) return [steer, 0.12];
                        return [steer, clamp(0.3 - Math.abs(inp[19]) * 0.8, 0.15, 0.2)];
                    };
                    const wR = createWorld(tA, jobs);
                    startEpisode(wR, [randomGenome(mulberry32(43))], 1, 0, 977);
                    const carR = door ? stageAt(wR) : wR.cars[0];
                    tk = 0;
                    let sawRecover = false;
                    while (tk++ < 60 * 45 && carR.alive && carR.m.pickups === 0) {
                        stepWorld(wR);
                        if (carR.lastFollow && carR.lastFollow.recovering) sawRecover = true;
                    }
                    ok(sawRecover && carR.m.pickups >= 1 && carR.m.misses === 0 && carR.m.replans === 0,
                        'reverse recovery rescues an overshot stop');

                    // Head-on fault: right-side car 0.35x, wrong-side 2x; both die.
                    nnForward = () => [0, 0];
                    const eH = tA.edges.find(x => x.axis === 'h' && x.len > 220);
                    const mxH = (Math.min(eH.x1, eH.x2) + Math.max(eH.x1, eH.x2)) / 2;
                    const wH = createWorld(tA, jobs);
                    startEpisode(wH, [randomGenome(mulberry32(51)), randomGenome(mulberry32(52))], 1, 0, 88);
                    wH.peds.length = 0;
                    const [hA, hB] = wH.cars;
                    hA.x = mxH - 6; hA.y = eH.y1 + LANE_OFFSET; hA.theta = 0; hA.v = 30;
                    hB.x = mxH + 6; hB.y = eH.y1 + LANE_OFFSET; hB.theta = Math.PI; hB.v = 30;
                    for (const c of [hA, hB]) { c.steer = 0; c.throttle = 0; c.rawSteer = 0; c.rawThrottle = 0; }
                    stepWorld(wH);
                    ok(!hA.alive && !hB.alive && hA.m.carCollFault === 0.35 && hB.m.carCollFault === 2.0,
                        'head-on fault: right side 0.35x, wrong side 2x');

                    // Pedestrians are fatal: a pinned ped crossing toward a
                    // staged car must eliminate it (and respawn elsewhere).
                    const wP = createWorld(tA, jobs);
                    startEpisode(wP, [randomGenome(mulberry32(47))], 1, 0, 977);
                    const carP = door ? stageAt(wP) : wP.cars[0];
                    carP.v = 120;
                    nnForward = () => [0, 0.3];
                    wP.peds.push(_newPedOnLoop(wP, 0, wP.pedRng));
                    const pedT = wP.peds[0];
                    const ppx = carP.x + Math.cos(carP.theta) * 30;
                    const ppy = carP.y + Math.sin(carP.theta) * 30;
                    pedT.crossing = {
                        fx: ppx, fy: ppy,
                        tx: ppx - Math.cos(carP.theta) * 60, ty: ppy - Math.sin(carP.theta) * 60,
                        t: 0, toLoop: pedT.loop, toCorner: pedT.seg, node: { light: null }, axis: 'h'
                    };
                    pedT.wait = 0; pedT.x = ppx; pedT.y = ppy;
                    tk = 0;
                    while (tk++ < 60 * 2 && carP.alive) stepWorld(wP);
                    ok(!carP.alive && carP.retired === 'pedestrian', 'hitting a pedestrian is fatal');

                    // Frozen eval: time limit lifted, no generation turnover.
                    const evE = new Evolution({ population: 16, episodesPerGen: 1, episodeLen: 2, eliteGrace: 4 }, 202);
                    const wE = createWorld(tA, jobs);
                    evE.attach(wE);
                    evE.startGeneration();
                    evE.setEvalMode(true);
                    let sawRestart = false, genEnd = false, maxT = 0;
                    for (let i = 0; i < 60 * 80; i++) {   // 60s ABS watchdog ceiling + margin
                        maxT = Math.max(maxT, wE.simTime);
                        const r = evE.tick();
                        if (r.evalRestarted) sawRestart = true;
                        if (r.generationEnded) { genEnd = true; break; }
                        if (sawRestart && i > 60 * 5) break;
                    }
                    ok(!genEnd && sawRestart && evE.gen === 1 && maxT > 2.05, 'frozen eval: no time limit, no evolution');
                } finally {
                    nnForward = origForward;
                }
            }
            const ev = new Evolution({ population: 16, episodesPerGen: 1, episodeLen: 8 }, 777);
            const w = createWorld(tA, jobs);
            ev.attach(w);
            ev.startGeneration();
            let gens = 0, guard = 0;
            while (gens < 2 && guard++ < 60 * 8 * 2 + 400) {
                if (ev.tick().generationEnded) { gens++; if (gens < 2) ev.startGeneration(); }
            }
            ok(gens === 2 && ev.history.every(h => Number.isFinite(h.best)), '2 headless generations, finite fitness');
            ok(ev.genomes.length === 16 && ev.genomes.every(validGenome), 'population intact');
            let champInPop = false;
            for (const g of ev.genomes) {
                let same = true;
                for (let i = 0; i < g.length; i += 97) if (g[i] !== ev.champion.genome[i]) { same = false; break; }
                if (same) { champInPop = true; break; }
            }
            ok(champInPop, 'champion preserved in population');
            ok(ev.eliteRoster.length >= 1 &&
                ev.eliteRoster.every(e => ev.genomes.some(g => ev._identical(g, e.genome))),
                'elite grace roster active');
        } catch (e) {
            results.push('✗ EXCEPTION: ' + e.message);
        }
        const failed = results.filter(r => r[0] === '✗').length;
        console.log('[self-test]\n' + results.join('\n'));
        toast(failed === 0 ? `Self-test: all ${results.length} checks passed` : `Self-test: ${failed} FAILED — see console`, failed === 0 ? 'good' : 'warn');
    }

    // -----------------------------------------------------------------------
    // UI wiring
    // -----------------------------------------------------------------------

    function readSettingsFromUI() {
        return {
            population: parseInt($('sl-pop').value, 10),
            elites: parseInt($('sl-elites').value, 10),
            eliteGrace: parseInt($('sl-grace').value, 10),
            mutChance: parseInt($('sl-mutchance').value, 10) / 100,
            mutGenes: mutGenesFromSlider(parseInt($('sl-mutgenes').value, 10)),
            sigma: parseFloat($('sl-sigma').value),
            eliteMutants: parseInt($('sl-elitemut').value, 10) / 100,
            eliteSigma: parseFloat($('sl-elitesigma').value),
            immigrantFrac: parseInt($('sl-immigrants').value, 10) / 100,
            pressure: parseFloat($('sl-pressure').value),
            stagnationAdapt: $('chk-stagnation').checked,
            episodesPerGen: parseInt($('sl-episodes').value, 10),
            episodeLen: parseInt($('sl-eplen').value, 10),
            autoChangeEvery: parseInt($('sel-autochange').value, 10),
            carContactEvery: parseInt($('sel-carcontact').value, 10),
            curriculumThreshold: parseFloat($('sl-curriculum').value)
        };
    }

    function bindControls() {
        // Forward to the CURRENT Evolution instance: Reset replaces S.ev, and
        // closures over the boot-time instance would silently write settings
        // into the dead one (sliders stopped applying after a Reset).
        const ev = {
            get s() { return S.ev.s; },
            setPopulation: v => S.ev.setPopulation(v)
        };
        // Applies at the next generation build - no reset needed.
        bindRange('sl-pop', 'lb-pop', v => v, v => ev.setPopulation(v));
        bindRange('sl-elites', 'lb-elites', v => v, v => ev.s.elites = v);
        bindRange('sl-grace', 'lb-grace', v => v + ' gens', v => ev.s.eliteGrace = v);
        bindRange('sl-mutchance', 'lb-mutchance', v => v + '%', v => ev.s.mutChance = v / 100);
        bindRange('sl-mutgenes', 'lb-mutgenes', v => mutGenesFromSlider(v) + ' genes', v => ev.s.mutGenes = mutGenesFromSlider(v));
        bindRange('sl-sigma', 'lb-sigma', v => 'σ ' + v.toFixed(2), v => ev.s.sigma = v);
        bindRange('sl-elitemut', 'lb-elitemut', v => v + '%', v => ev.s.eliteMutants = v / 100);
        bindRange('sl-elitesigma', 'lb-elitesigma', v => 'σ ' + v.toFixed(2), v => ev.s.eliteSigma = v);
        bindRange('sl-immigrants', 'lb-immigrants', v => v + '%', v => ev.s.immigrantFrac = v / 100);
        bindRange('sl-pressure', 'lb-pressure', v => v.toFixed(1), v => ev.s.pressure = v);
        bindRange('sl-eplen', 'lb-eplen', v => v + 's', v => ev.s.episodeLen = v);
        bindRange('sl-episodes', 'lb-episodes', v => v, v => ev.s.episodesPerGen = v);
        bindRange('sl-curriculum', 'lb-curriculum', v => v.toFixed(1), v => ev.s.curriculumThreshold = v);
        $('chk-stagnation').addEventListener('change', e => ev.s.stagnationAdapt = e.target.checked);
        $('sel-autochange').addEventListener('change', e => ev.s.autoChangeEvery = parseInt(e.target.value, 10));
        $('sel-carcontact').addEventListener('change', e => ev.s.carContactEvery = parseInt(e.target.value, 10));

        // Speed buttons.
        const group = $('speed-group');
        SPEED_LABELS.forEach((lb, i) => {
            const b = document.createElement('button');
            b.className = 'btn speed-btn' + (i === S.speedStop ? ' active' : '');
            b.textContent = lb;
            b.addEventListener('click', () => {
                S.speedStop = i;
                S.stepCarry = 0;
                group.querySelectorAll('.speed-btn').forEach((x, xi) => x.classList.toggle('active', xi === i));
            });
            group.appendChild(b);
        });

        $('btn-pause').addEventListener('click', () => {
            S.paused = !S.paused;
            $('btn-pause').textContent = S.paused ? 'Resume' : 'Pause';
        });
        $('chk-headless').addEventListener('change', e => {
            S.headless = e.target.checked;
            if (S.headless) {
                S.preHeadlessStop = S.speedStop;
                S.speedStop = SPEED_STOPS.length - 1;
            } else {
                S.speedStop = S.preHeadlessStop;
            }
            const group2 = $('speed-group');
            group2.querySelectorAll('.speed-btn').forEach((x, xi) => x.classList.toggle('active', xi === S.speedStop));
        });
        $('chk-eval').addEventListener('change', e => {
            S.ev.setEvalMode(e.target.checked);
            toast(e.target.checked
                ? 'Frozen eval: no time limit, evolution paused — runs until every car is out'
                : 'Eval off — generation restarted, training resumes', 'info');
        });

        $('btn-newtown').addEventListener('click', () => { changeTown(); autosave(); });
        $('btn-export').addEventListener('click', exportChampion);
        $('btn-import').addEventListener('click', () => $('file-import').click());
        $('file-import').addEventListener('change', e => {
            if (e.target.files && e.target.files[0]) importChampion(e.target.files[0]);
            e.target.value = '';
        });
        $('btn-reset').addEventListener('click', resetTraining);
        $('btn-selftest').addEventListener('click', runSelfTest);

        $('chk-follow').addEventListener('change', e => camera.follow = e.target.checked);
        $('chk-sensors').addEventListener('change', e => S.showSensors = e.target.checked);
        $('chk-autobest').addEventListener('change', e => S.autoSelectBest = e.target.checked);

        simCanvas.addEventListener('click', e => {
            const rect = simCanvas.getBoundingClientRect();
            const sel = camera.follow ? S.world.cars[S.selectedIdx] : null;
            const w = canvasToWorld(simCanvas, S.town, sel, e.clientX - rect.left, e.clientY - rect.top);
            let best = -1, bestD = 30 * 30;
            for (const car of S.world.cars) {
                const d = dist2(car.x, car.y, w.x, w.y);
                if (d < bestD) { bestD = d; best = car.idx; }
            }
            if (best >= 0) {
                S.selectedIdx = best;
                S.autoSelectBest = false;
                $('chk-autobest').checked = false;
            }
        });

        window.addEventListener('keydown', e => {
            if (e.code === 'Space' && e.target === document.body) {
                e.preventDefault();
                $('btn-pause').click();
            }
        });
    }

    function applySettingsToUI(s) {
        $('sl-pop').value = s.population;
        $('sl-elites').value = s.elites;
        $('sl-grace').value = (s.eliteGrace === undefined ? 4 : s.eliteGrace);
        $('sl-mutchance').value = Math.round(s.mutChance * 100);
        // invert log mapping
        $('sl-mutgenes').value = Math.round(100 * Math.log(Math.max(1, s.mutGenes)) / Math.log(NN_GENOME_LEN));
        $('sl-sigma').value = s.sigma;
        $('sl-elitemut').value = Math.round((s.eliteMutants === undefined ? 0.08 : s.eliteMutants) * 100);
        $('sl-elitesigma').value = (s.eliteSigma === undefined ? 0.18 : s.eliteSigma);
        $('sl-immigrants').value = Math.round(s.immigrantFrac * 100);
        $('sl-pressure').value = s.pressure;
        $('chk-stagnation').checked = !!s.stagnationAdapt;
        $('sl-eplen').value = s.episodeLen;
        $('sl-episodes').value = s.episodesPerGen;
        $('sel-autochange').value = String(s.autoChangeEvery || 0);
        $('sel-carcontact').value = String(s.carContactEvery || 2);
        $('sl-curriculum').value = s.curriculumThreshold;
    }

    // -----------------------------------------------------------------------
    // Boot
    // -----------------------------------------------------------------------

    function boot() {
        simCanvas = $('sim');
        simCtx = simCanvas.getContext('2d');
        nnCanvas = $('nnviz');
        chartFit = $('chart-fitness');
        chartDeliv = $('chart-deliveries');

        const saved = tryLoad();
        if (saved) {
            S.townSeedBase = saved.townSeedBase >>> 0;
            buildTown(saved.townCounter || 0);
            S.ev = Evolution.fromJSON(saved.ev, (Math.random() * 0xffffffff) >>> 0);
            if (S.ev) {
                S.speedStop = typeof saved.speedStop === 'number' ? saved.speedStop : 1;
                if ($('inp-seed')) $('inp-seed').value = String(S.ev.runSeed);
                toast(`Resumed training at generation ${S.ev.gen}`, 'info');
            }
        }
        if (!S.ev) {
            // Fresh install: the benchmark combo from the 2026-07 parameter
            // sweep - town base 20260719 (its town #0) + run seed 7 reached
            // 3 deliveries by ~gen 60 at the default 120s episodes.
            S.townSeedBase = 20260719;
            buildTown(0);
            S.ev = new Evolution({}, readSeedFromUI());
        }
        // Debug helper: ?town=N previews layout variant N on a FRESH session
        // (fixed seed base; never clobbers a resumed save).
        const urlTown = parseInt(new URLSearchParams(location.search).get('town') || '', 10);
        if (!saved && Number.isFinite(urlTown)) {
            S.townSeedBase = 20260719;
            buildTown(urlTown);
            S.ev.onTownChanged(S.townCounter);
        }
        S.ev.attach(S.world);
        applySettingsToUI(S.ev.s);
        bindControls();
        S.ev.startGeneration();
        drawCharts();
        camera.x = S.town.W / 2;
        camera.y = S.town.H / 2;
        if (new URLSearchParams(location.search).get('selftest') === '1') {
            setTimeout(runSelfTest, 300);
        }
        S.rateStamp = performance.now();
        requestAnimationFrame(frame);
    }

    document.addEventListener('DOMContentLoaded', boot);
})();
