// Headless assertion suite. Run with:  node test_headless.js
//
// Covers the three things that silently ruin a run like this: a city whose
// routing or pedestrian graph is quietly broken, a world whose physics lets
// law-abiding drivers crash for no reason (in which case evolution is being
// blamed for the simulator), and a genome layout whose crossover or mutation
// does not do what it says.
'use strict';

const { loadSim } = require('./harness');
const S = loadSim(__dirname);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function group(t) { console.log('\n' + t); }

// --- cities -----------------------------------------------------------------
group('City layouts');
const cities = [];
for (let tier = 0; tier < S.CITY_TIERS.length; tier++) {
    const c = S.makeCity(tier, 1000 + tier);
    cities.push(c);
    const nSig = c.signals.length;
    ok(`tier ${tier} builds (${c.spec.name})`, c.nodes.length > 0 && c.links.length > 0);
    ok(`tier ${tier} has signals`, nSig >= 1, `signals=${nSig}`);
    ok(`tier ${tier} every portal pair routable`, c.routesOk === true);
    // Three quarters of a roundabout island is a long way round, so those get a
    // bigger ceiling than a path across an ordinary junction.
    ok(`tier ${tier} connectors have length`,
        c.connectors.every(k => k.len > 4 && k.len < (k.round ? 110 : 60)),
        String(Math.max(...c.connectors.map(k => k.len)).toFixed(0)));
    ok(`tier ${tier} links have length`, c.links.every(l => l.len > 8));
    // Every signalised node must be able to serve both axes.
    const bad = c.signals.filter(id => {
        const n = c.nodes[id];
        let ns = 0, ew = 0;
        for (let k = 0; k < 4; k++) if (n.arms[k]) (k % 2 === 0 ? ns++ : ew++);
        return ns === 0 || ew === 0;
    });
    ok(`tier ${tier} no signal is single-axis`, bad.length === 0, `bad=${bad.length}`);
    // Bitmap
    let on = 0;
    for (let i = 0; i < c.map.bits.length; i++) on += c.map.bits[i];
    ok(`tier ${tier} road bitmap populated`, on > 40 && on < c.map.bits.length * 0.8, `cells=${on}`);
    ok(`tier ${tier} pooled map is 16x16`, c.map.pooled.length === 256);
    ok(`tier ${tier} ego crops are 12x12`, c.lightInfo.every(i => i.ego.length === 144));
    // Pedestrian graph reachability between portal corners
    const g = c.ped;
    let unreachable = 0;
    for (const a of c.portals) for (const b of c.portals) {
        if (a === b) continue;
        if (g.next[(a * 4) * g.count + (b * 4)] < 0) unreachable++;
    }
    ok(`tier ${tier} pedestrian graph connected`, unreachable === 0, `unreachable=${unreachable}`);
}

group('City features: curves, roundabouts, one-ways, the ring road');
{
    for (let tier = 0; tier < S.CITY_TIERS.length; tier++) {
        const c = cities[tier];
        ok(`tier ${tier} is closed-looped (no street is a dead end)`, c.closedLoop === true);
    }
    const curvy = cities.filter(c => c.edges.some(e => Math.abs(e.curve) > 2));
    ok('some layouts have streets that bend', curvy.length >= 3, `${curvy.length} of ${cities.length}`);
    // A curve is longer than the chord between its own two endpoints. (Compare
    // against the CENTRELINE's ends, not the junction centres: the centreline
    // runs stop line to stop line and is shorter than the node-to-node span.)
    const bent = curvy[0].edges.find(e => Math.abs(e.curve) > 2);
    const bp = bent.centre.pts;
    const chord = Math.hypot(bp[bp.length - 2] - bp[0], bp[bp.length - 1] - bp[1]);
    ok('a bending street is longer than the straight line between its ends',
        bent.centre.len > chord * 1.001, `${bent.centre.len.toFixed(1)} vs ${chord.toFixed(1)}`);
    ok('a bending street has a lower speed limit than a straight one',
        curvy.some(c => c.links.some(l => l.vLimit < l.speed - 0.5)));

    const withRound = cities.filter(c => c.nodes.some(n => n.round));
    ok('some layouts have roundabouts', withRound.length >= 2, `${withRound.length}`);
    const rc = withRound[0];
    ok('a roundabout has no traffic signals', rc.nodes.every(n => !(n.round && n.signal)));
    ok('roundabouts are excluded from the light list',
        rc.signals.every(id => !rc.nodes[id].round));
    const rconn = rc.connectors.find(k => k.round);
    ok('a roundabout path goes round the island', rconn && rconn.len > 20, rconn && rconn.len.toFixed(1));
    ok('a roundabout must be taken slowly', rconn.vLimit < 9, rconn && rconn.vLimit.toFixed(1));
    ok('a straight run through a plain junction is not slowed',
        cities[0].connectors.find(k => k.turn === 'S').vLimit > 13);
    ok('a turn through a plain junction is slowed',
        cities[0].connectors.find(k => k.turn === 'R').vLimit < 8);

    const ring = cities.find(c => c.edges.some(e => e.hw));
    ok('one layout has a ring road', !!ring);
    ok('the ring road has a higher speed limit',
        ring.edges.filter(e => e.hw).every(e => e.speed > ROADSPEED(S)), 'ring speed');
    ok('the ring road forms a closed circuit',
        ring.edges.filter(e => e.hw).length >= 8, `${ring.edges.filter(e => e.hw).length} sections`);
    ok('the ring road is worth using for some trips', (() => {
        // A trip that uses the ring at least once: routing is by TIME, so the
        // long way round has to actually win somewhere.
        const N = ring.nodes.length;
        for (const a of ring.portals) for (const b of ring.portals) {
            if (a === b) continue;
            let at = a, guard = 0;
            while (at !== b && guard++ < 200) {
                const l = S.nextLinkTo(ring, at, b);
                if (!l) break;
                if (l.hw) return true;
                at = l.to;
            }
        }
        return false;
    })());

    const ow = cities.find(c => c.edges.some(e => e.oneWay !== 0));
    ok('some layouts have one-way streets', !!ow);
    if (ow) {
        const e = ow.edges.find(x => x.oneWay !== 0);
        ok('a one-way street carries traffic in one direction only',
            ow.links.filter(l => l.edge === e.id).length === 1);
    }
}
function ROADSPEED(S) { return S.ROAD.SPEED; }

group('City determinism');
{
    const a = S.makeCity(3, 777), b = S.makeCity(3, 777);
    ok('same seed -> same node count', a.nodes.length === b.nodes.length);
    ok('same seed -> same bitmap', a.map.bits.every((v, i) => v === b.map.bits[i]));
    const d = S.makeCity(3, 778);
    ok('different seed -> different layout', !a.map.bits.every((v, i) => v === d.map.bits[i]));
}

// --- network ---------------------------------------------------------------
group('Genome and forward pass');
{
    const rng = S.mulberry32(4);
    const g = S.randomGenome(rng);
    ok('genome length matches sections', g.length === S.NN_GENOME_LEN);
    ok('genome is finite', S.validGenome(g));
    console.log(`       genome = ${S.NN_GENOME_LEN} genes, trunk input = ${S.TRUNK_IN}`);

    const city = cities[2];
    const mf = new Float64Array(S.MAP_OUT);
    S.encodeMaps(g, city.map.pooled, city.lightInfo[0].ego, mf);
    ok('map encoder finite', Array.from(mf).every(Number.isFinite));
    ok('map encoder not all zero', Array.from(mf).some(v => Math.abs(v) > 1e-9));

    const ctx = S.makeContext();
    ctx.map.set(mf);
    for (let i = 0; i < ctx.core.length; i++) ctx.core[i] = Math.sin(i);
    for (let i = 0; i < ctx.arms.length; i++) ctx.arms[i] = (i % 7) / 7;
    const o1 = Array.from(S.nnForward(g, ctx));
    const o2 = Array.from(S.nnForward(g, ctx));
    ok('forward deterministic', o1.every((v, i) => v === o2[i]));
    ok('forward finite and bounded', o1.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
    ok('output width is 6', o1.length === 6);

    // Crossover must be pure copy-paste, and whole rows at that.
    const a = S.randomGenome(S.mulberry32(11));
    const b = S.randomGenome(S.mulberry32(12));
    const child = S.crossoverGenomes(a, b, S.mulberry32(13));
    let fromParent = 0;
    for (let i = 0; i < child.length; i++) if (child[i] === a[i] || child[i] === b[i]) fromParent++;
    ok('every child gene comes from a parent', fromParent === child.length, `${fromParent}/${child.length}`);
    let mixed = 0;
    for (const sec of S.SECTIONS) {
        for (let o = 0; o < sec.nOut; o++) {
            let fa = 0, fb = 0;
            for (let i = 0; i < sec.nIn; i++) {
                const idx = sec.wOff + o * sec.nIn + i;
                if (child[idx] === a[idx]) fa++;
                if (child[idx] === b[idx]) fb++;
            }
            if (fa !== sec.nIn && fb !== sec.nIn) mixed++;
        }
    }
    ok('rows are inherited whole', mixed === 0, `mixed rows=${mixed}`);

    const m = S.cloneGenome(a);
    S.mutateGenomeK(m, 25, 0.3, 0, S.mulberry32(9));
    let diff = 0;
    for (let i = 0; i < m.length; i++) if (m[i] !== a[i]) diff++;
    ok('mutation touches about K genes', diff >= 20 && diff <= 25, `diff=${diff}`);

    const ser = S.serializeGenome(g, { x: 1 });
    const back = S.deserializeGenome(JSON.parse(JSON.stringify(ser)));
    ok('serialize round trip', !!back && back.genome.every((v, i) => v === g[i]));
    ok('version guard rejects foreign brains', S.deserializeGenome({ version: 'other', arch: S.NN_ARCH_ID, genome: [] }) === null);
}

// --- signal state machine ---------------------------------------------------
group('Signal state machine');
{
    const city = cities[0];
    const l = S.createLight(city, city.lightInfo[0]);
    S.resetLight(l, S.mulberry32(1));
    l.phase = S.PH.NS; l.state = S.ST.GREEN; l.tPhase = 0;
    ok('min green is enforced', S.requestPhase(l, S.PH.EW, 3, 1) === false);
    l.tPhase = S.SIG.MIN_GREEN + 0.1;
    ok('change accepted after min green', S.requestPhase(l, S.PH.EW, 3, 1) === true);
    ok('amber comes first', l.state === S.ST.AMBER);
    let saw = { amber: 0, allred: 0 };
    for (let i = 0; i < 200; i++) {
        if (l.state === S.ST.AMBER) saw.amber += 0.1;
        if (l.state === S.ST.ALLRED) saw.allred += 0.1;
        S.stepLight(l, 0.1);
        if (l.state === S.ST.GREEN && l.phase === S.PH.EW) break;
    }
    ok('amber lasted about the requested time', Math.abs(saw.amber - 3) < 0.25, `amber=${saw.amber.toFixed(2)}`);
    ok('all-red lasted about the requested time', Math.abs(saw.allred - 1) < 0.25, `allred=${saw.allred.toFixed(2)}`);
    ok('phase actually changed', l.phase === S.PH.EW && l.state === S.ST.GREEN);

    // Clearance lengths are clamped no matter what the brain asks for.
    l.tPhase = 30;
    S.requestPhase(l, S.PH.NS, 99, 99);
    ok('amber clamped to the safe envelope', l.amberDur === S.SIG.AMBER_MAX);
    ok('all-red clamped to the safe envelope', l.allRedDur === S.SIG.ALLRED_MAX);

    // Conflicting movements are never green together.
    let violations = 0;
    for (let ph = 0; ph < 3; ph++) {
        for (let k = 0; k < 4; k++) {
            if (S.armServed(ph, k) && S.crossOpen(ph, k)) violations++;   // cars and people, same arm
            if (S.armServed(ph, k) && S.armServed(ph, (k + 1) % 4)) violations++;  // crossing streams
        }
    }
    ok('no phase serves conflicting movements', violations === 0, `violations=${violations}`);
    ok('the pedestrian phase stops all traffic', [0, 1, 2, 3].every(k => !S.armServed(S.PH.PED, k)));
}

// --- the world --------------------------------------------------------------
function runOne(city, ctrl, seed, opts) {
    const w = new S.World(city, Object.assign({ episodeLen: 200 }, opts || {}));
    w.reset(seed, ctrl);
    const m = w.run();
    return { m, w };
}

group('World: a fixed-time plan on a single crossroads');
{
    const city = cities[0];
    const { m } = runOne(city, S.fixedTimeController(), 42);
    console.log(`       in=${m.carsIn} out=${m.carsOut} thr=${(m.carThroughput * 100).toFixed(0)}% ` +
        `delay=${m.meanCarDelay.toFixed(1)}s peds=${m.pedsOut}/${m.pedsIn} crashes=${m.crashes} hits=${m.pedHits}`);
    ok('cars were generated', m.carsIn > 20, `carsIn=${m.carsIn}`);
    ok('most cars reached their destination', m.carThroughput > 0.7, `thr=${m.carThroughput.toFixed(2)}`);
    ok('pedestrians reached their destination', m.pedsOut > 0, `peds=${m.pedsOut}/${m.pedsIn}`);
    ok('delay is plausible', m.meanCarDelay >= 0 && m.meanCarDelay < 90, `delay=${m.meanCarDelay.toFixed(1)}`);
    ok('a sane plan causes no vehicle crashes', m.crashes === 0, `crashes=${m.crashes}`);
    ok('a sane plan hits nobody', m.pedHits === 0, `hits=${m.pedHits}`);
    ok('nobody enters on a red', m.redEntries === 0, `redEntries=${m.redEntries}`);
}

group('World: determinism and common random numbers');
{
    const city = cities[1];
    const a = runOne(city, S.fixedTimeController(), 7).m;
    const b = runOne(city, S.fixedTimeController(), 7).m;
    ok('same seed -> identical outcome', a.carsOut === b.carsOut && a.carDelay === b.carDelay);
    const c = runOne(city, S.fixedTimeController(), 8).m;
    ok('different seed -> different outcome', a.carsOut !== c.carsOut || a.carDelay !== c.carDelay);
    // The trip schedule must not depend on the controller at all.
    const w1 = new S.World(city, { episodeLen: 200 });
    w1.reset(7, S.fixedTimeController());
    const w2 = new S.World(city, { episodeLen: 200 });
    w2.reset(7, S.actuatedController());
    ok('identical trips for every controller',
        w1.carSched.length === w2.carSched.length &&
        w1.carSched.every((e, i) => e.t === w2.carSched[i].t && e.o === w2.carSched[i].o && e.d === w2.carSched[i].d));
}

group('World: controllers rank the way they should');
{
    const city = cities[2];
    const fixed = runOne(city, S.fixedTimeController(), 11).m;
    const act = runOne(city, S.actuatedController(), 11).m;
    const rnd = runOne(city, S.randomController(3), 11).m;
    const sf = S.episodeScore(fixed), sa = S.episodeScore(act), sr = S.episodeScore(rnd);
    console.log(`       fixed  ${sf.toFixed(0)}  thr=${(fixed.carThroughput * 100).toFixed(0)}% delay=${fixed.meanCarDelay.toFixed(1)}s crash=${fixed.crashes} hit=${fixed.pedHits}`);
    console.log(`       actuat ${sa.toFixed(0)}  thr=${(act.carThroughput * 100).toFixed(0)}% delay=${act.meanCarDelay.toFixed(1)}s crash=${act.crashes} hit=${act.pedHits}`);
    console.log(`       random ${sr.toFixed(0)}  thr=${(rnd.carThroughput * 100).toFixed(0)}% delay=${rnd.meanCarDelay.toFixed(1)}s crash=${rnd.crashes} hit=${rnd.pedHits}`);
    ok('actuated control beats a fixed plan', sa > sf, `${sa.toFixed(0)} vs ${sf.toFixed(0)}`);
    ok('random switching is the worst of the three', sr < sf && sr < sa);

    // Recklessness has to be punishable, or the safety half of the score is
    // decorative: switch often AND give the shortest clearance the hardware
    // allows, and people get hurt.
    const reckless = {
        name: 'reckless',
        _r: S.mulberry32(17),
        decide(world, l) {
            if (this._r() > 0.25) return { target: -1 };
            return { target: Math.floor(this._r() * 2), amber: S.SIG.AMBER_MIN, allRed: 0 };
        }
    };
    let harm = 0;
    for (const seed of [11, 12, 13]) {
        const m = runOne(city, reckless, seed).m;
        harm += m.crashes + m.pedHits;
    }
    ok('reckless switching hurts people', harm > 0, `crashes+hits=${harm}`);
}

group('World: short clearance is what causes collisions');
{
    // Same city, same trips, same phase plan - only the clearance differs.
    const city = cities[2];
    const plan = (amber, allRed) => ({
        name: 'plan',
        decide(world, l) {
            if (l.tPhase < 20) return { target: -1 };
            return { target: l.phase === S.PH.NS ? S.PH.EW : S.PH.NS, amber, allRed };
        }
    });
    let unsafe = 0, safe = 0;
    for (const seed of [21, 22, 23]) {
        unsafe += runOne(city, plan(S.SIG.AMBER_MIN, 0), seed).m.crashes;
        safe += runOne(city, plan(4.5, 2.5), seed).m.crashes;
    }
    console.log(`       2.0s amber + no all-red: ${unsafe} crashes | 4.5s + 2.5s: ${safe} crashes`);
    ok('cutting the clearance causes crashes', unsafe > 0, `crashes=${unsafe}`);
    ok('a generous clearance prevents them', safe === 0, `crashes=${safe}`);
}

group('World: pedestrians');
{
    const city = cities[3];
    const { m, w } = runOne(city, S.fixedTimeController(), 31);
    ok('a lot of people walk', m.pedsIn > 40, `pedsIn=${m.pedsIn}`);
    ok('most of them arrive', m.pedThroughput > 0.5, `thr=${m.pedThroughput.toFixed(2)}`);
    ok('nobody is run over by a lawful plan', m.pedHits === 0, `hits=${m.pedHits}`);
    ok('pedestrian delay is plausible', m.meanPedDelay > 0 && m.meanPedDelay < 200, `delay=${m.meanPedDelay.toFixed(1)}`);
}

group('World: an all-red controller starves the city');
{
    const city = cities[1];
    const stuck = { name: 'stuck', decide() { return { target: -1 }; } };
    const { m } = runOne(city, stuck, 5);
    // Nothing switches, so only one axis ever moves - the max-out timer is the
    // only thing that saves it, which is exactly what it is for.
    ok('a frozen controller scores far below a plan', S.episodeScore(m) < S.episodeScore(runOne(city, S.fixedTimeController(), 5).m));
    ok('the max-out timer still serves both axes', m.carThroughput > 0.2, `thr=${m.carThroughput.toFixed(2)}`);
}

// --- brains -----------------------------------------------------------------
group('A brain can drive the lights');
{
    const city = cities[1];
    const g = S.createBootstrapGenome(S.mulberry32(3));
    const { m, w } = runOne(city, S.brainController(g), 77);
    console.log(`       prior brain: thr=${(m.carThroughput * 100).toFixed(0)}% delay=${m.meanCarDelay.toFixed(1)}s ` +
        `crash=${m.crashes} hit=${m.pedHits} score=${S.episodeScore(m).toFixed(0)}`);
    ok('the brain moved traffic', m.carsOut > 5, `out=${m.carsOut}`);
    ok('the score is finite', Number.isFinite(S.episodeScore(m)));
    const rnd = runOne(city, S.brainController(S.randomGenome(S.mulberry32(5))), 77).m;
    console.log(`       random brain: thr=${(rnd.carThroughput * 100).toFixed(0)}% delay=${rnd.meanCarDelay.toFixed(1)}s ` +
        `crash=${rnd.crashes} score=${S.episodeScore(rnd).toFixed(0)}`);
    ok('the hand-written prior beats a random brain', S.episodeScore(m) > S.episodeScore(rnd));
    ok('lights actually changed phase', w.lights.some(l => l.sinceServed[0] < 1e9));
}

group('A brain trained on one city can be dropped on another');
{
    const g = S.createBootstrapGenome(S.mulberry32(3));
    let allFinite = true;
    for (const c of cities) {
        const r = runOne(c, S.brainController(g), 91, { episodeLen: 90 });
        if (!Number.isFinite(S.episodeScore(r.m))) allFinite = false;
    }
    ok('the same genome runs every tier, unmodified', allFinite);
}

// --- evolution --------------------------------------------------------------
group('Evolution');
{
    const ev = new S.Evolution({ population: 6, episodesPerGen: 1, episodeLen: 60, citiesPerTier: 1 }, 5);
    ok('population initialised', ev.genomes.length === 6);
    ev.runGeneration();
    ok('a generation completes', ev.gen === 2 && ev.history.length === 1);
    const h = ev.history[0];
    console.log(`       gen1: best=${h.best.toFixed(0)} median=${h.median.toFixed(0)} ` +
        `fixed=${h.fixed.toFixed(0)} actuated=${h.actuated.toFixed(0)} random=${h.random.toFixed(0)}`);
    ok('baselines were measured', Number.isFinite(h.fixed) && Number.isFinite(h.actuated) && Number.isFinite(h.random));
    ok('a champion was crowned', !!ev.champion);
    ok('scores are finite', Number.isFinite(h.best) && Number.isFinite(h.mean));
    ev.runGeneration();
    ok('a second generation completes', ev.gen === 3);
    ok('the population size is stable', ev.genomes.length === 6);

    const json = JSON.parse(JSON.stringify(ev.toJSON()));
    const back = S.Evolution.fromJSON(json, 5);
    ok('a run round-trips through JSON', !!back && back.gen === ev.gen && back.tier === ev.tier);
    ok('the champion survives the round trip', !!back.champion &&
        back.champion.genome.every((v, i) => v === ev.champion.genome[i]));
}

// The trainer scored a 200s episode on cities the page runs for 380s, because
// Evolution.worldFor wrote the raw setting over the length the World
// constructor had already scaled by the city's timeScale. Nothing compared a
// cached world's clock with a fresh one, so it was invisible for a whole
// 40-generation run - and it made collisions free, since a truncated episode
// never congests.
group('Evolution: a trained episode is the same length as a measured one');
{
    const tier = S.CITY_TIERS.length - 1;
    const scale = S.CITY_TIERS[tier].timeScale || 1;
    ok('the hardest tier really does scale its clock', scale > 1, `timeScale=${scale}`);

    const city = S.makeCity(tier, 4242);
    const fresh = new S.World(city, { episodeLen: 100 });
    ok('a fresh world scales the requested length', Math.abs(fresh.episodeLen - 100 * scale) < 1e-9,
        `${fresh.episodeLen} vs ${100 * scale}`);

    const ev = new S.Evolution(
        { population: 4, episodesPerGen: 1, episodeLen: 100, citiesPerTier: 1, tier, lockTier: true }, 11);
    ok('the trainer builds its world on the same clock',
        Math.abs(ev.world.episodeLen - 100 * scale) < 1e-9, `${ev.world.episodeLen} vs ${100 * scale}`);

    // The cache is the part that broke: the second generation reuses the world.
    ev.runGeneration();
    ok('a cached world keeps the scaled clock',
        Math.abs(ev.world.episodeLen - 100 * scale) < 1e-9, `${ev.world.episodeLen} vs ${100 * scale}`);

    // And a settings change still takes effect, which is what worldFor is for.
    ev.s.episodeLen = 120;
    const again = ev.worldFor(city);
    ok('a changed setting still reaches a cached world',
        Math.abs(again.episodeLen - 120 * scale) < 1e-9, `${again.episodeLen} vs ${120 * scale}`);
}

group('Evolution: two runs with the same seed are identical');
{
    const mk = () => new S.Evolution({ population: 5, episodesPerGen: 1, episodeLen: 50, citiesPerTier: 1 }, 99);
    const a = mk(); a.runGeneration(); a.runGeneration();
    const b = mk(); b.runGeneration(); b.runGeneration();
    ok('identical history', JSON.stringify(a.history) === JSON.stringify(b.history));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
}
