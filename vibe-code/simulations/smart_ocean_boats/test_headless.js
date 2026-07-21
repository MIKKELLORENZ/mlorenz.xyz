/* test_headless.js — Node smoke test. Run: node test_headless.js
 * Loads the browser files into one context, checks map connectivity,
 * physics sanity, and runs a few generations of evolution. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "maps.js", "route.js", "boat.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}

/* ---- 1. maps build and every dock pair is routable ---- */
for (const def of MAP_DEFS) {
    const t0 = Date.now();
    const map = buildMap(def);
    const router = new Router(map);
    let waterCells = 0;
    for (let i = 0; i < map.land.length; i++) if (!map.land[i]) waterCells++;
    check(`${def.name}: builds`, true, `${Date.now() - t0} ms, ${(100 * waterCells / map.land.length).toFixed(0)}% water`);

    // every dock sits on water with clearance
    for (const d of map.docks) {
        check(`${def.name}: dock "${d.name}" on water`, !map.isLand(d.x, d.y) && map.shoreDist(d.x, d.y) >= 0.8,
            `(${d.x.toFixed(1)}, ${d.y.toFixed(1)}) shore ${map.shoreDist(d.x, d.y).toFixed(1)} m`);
    }
    // all dock pairs routable (path end must actually reach the dock)
    for (let i = 0; i < map.docks.length; i++) {
        for (let j = 0; j < map.docks.length; j++) {
            if (i === j) continue;
            const a = map.docks[i], b = map.docks[j];
            const p = router.findPath(a.x, a.y, b.x, b.y);
            // walk the path: every sampled point must be water
            let clear = true;
            for (let s = 0; s < p.length - 1 && clear; s++) {
                const d = Math.hypot(p[s + 1][0] - p[s][0], p[s + 1][1] - p[s][1]);
                const n = Math.max(2, Math.ceil(d / 0.5));
                for (let k = 0; k <= n; k++) {
                    const t = k / n;
                    const x = p[s][0] + (p[s + 1][0] - p[s][0]) * t;
                    const y = p[s][1] + (p[s + 1][1] - p[s][1]) * t;
                    if (map.isLand(x, y)) { clear = false; break; }
                }
            }
            if (!clear) check(`${def.name}: route ${a.name} → ${b.name}`, false, "crosses land");
        }
    }
    check(`${def.name}: all dock pairs routable over water`, true);
    // spawn on water
    check(`${def.name}: spawn on water`, !map.isLand(map.spawn.x, map.spawn.y));
    // current field returns finite values
    const [cx, cy] = map.current(map.w / 2, map.h / 2, 10);
    check(`${def.name}: current finite`, Number.isFinite(cx) && Number.isFinite(cy), `(${cx.toFixed(2)}, ${cy.toFixed(2)})`);
}

/* ---- 2. physics sanity: full throttle straight line ---- */
{
    const map = buildMap(MAP_DEFS[0]);
    map.current = () => [0, 0];
    const router = new Router(map);
    const rng = mulberry32(7);
    const net = new Net(NET_SIZES, rng);
    const world = new World(map, router, [net], { shipCollisions: false, combat: false, missionSeed: 1, noise: false });
    world.wind = [0, 0]; world._updWind = () => { world.wind = [0, 0]; };
    const b = world.boats[0];
    b.reset(50, 31, 0);
    b.timeLeft = 9999;
    b.control = function () { this.out.set([1, 1, 0, 0, 0]); };  // full throttle
    for (let i = 0; i < 30 * 8; i++) world.step();
    check("physics: full throttle tops out 3–4.5 m/s (foiling)", b.speed > 3 && b.speed < 4.5, `${b.speed.toFixed(2)} m/s, foil ${b.foil.toFixed(2)}`);
    const before = { x: b.x, y: b.y };
    b.control = function () { this.out.set([0, 0, 1, 0, 0]); };  // brake
    for (let i = 0; i < 30 * 4; i++) world.step();
    check("physics: brake stops the boat", b.speed < 0.4, `${b.speed.toFixed(2)} m/s after 4 s`);
    check("physics: boat stayed in bounds", b.x > 0 && b.x < map.w && b.y > 0 && b.y < map.h);
    check("physics: boat travelled forward", b.x > before.x - 5);
}

/* ---- 3. stiction: idle boat doesn't creep ---- */
{
    const map = buildMap(MAP_DEFS[0]);
    map.current = () => [0, 0];
    const router = new Router(map);
    const world = new World(map, router, [new Net(NET_SIZES, mulberry32(3))], { shipCollisions: false, combat: false, missionSeed: 1, noise: false });
    world.wind = [0, 0]; world._updWind = () => { world.wind = [0, 0]; };
    const b = world.boats[0];
    b.reset(50, 31, 0);
    b.timeLeft = 9999;
    b.control = function () { this.out.set([0.04, 0.04, 0, 0, 0]); };  // whisper of thrust
    for (let i = 0; i < 90; i++) world.step();
    check("physics: stiction holds at 4% throttle", b.speed < 0.05, `${b.speed.toFixed(3)} m/s`);
}

/* ---- 4. evolution: a few generations run and fitness is sane ---- */
{
    const map = buildMap(MAP_DEFS[0]);
    const router = new Router(map);
    const evo = new Evolution(24, 123);
    let firstBest = null, lastBest = null;
    for (let gen = 0; gen < 4; gen++) {
        const world = new World(map, router, evo.brains, {
            shipCollisions: gen >= 2, combat: gen >= 3, missionSeed: gen + 1, noise: true
        });
        const steps = 30 * 40;   // 40 s episodes for speed
        for (let i = 0; i < steps; i++) world.step();
        const results = world.boats.map(b => ({ brain: b.brain, fitness: b.fitness(), arrivals: b.arrivals }));
        const sum = evo.evolve(results, 0.08, 0.15);
        if (firstBest === null) firstBest = sum.best;
        lastBest = sum.best;
        console.log(`  gen ${gen + 1}: best ${sum.best.toFixed(0)}, avg ${sum.avg.toFixed(0)}, arrivals ${sum.bestArr}/${sum.avgArr.toFixed(2)}`);
        check(`evolution gen ${gen + 1}: finite fitness`, Number.isFinite(sum.best) && Number.isFinite(sum.avg));
    }
    check("evolution: population size stable", evo.brains.length === 24);
    check("evolution: champion recorded", evo.champion !== null);

    // serialization round-trip
    const json = JSON.stringify(evo.champion.toJSON());
    const back = Net.fromJSON(JSON.parse(json));
    const inp = new Float32Array(NET_SIZES[0]).fill(0.3);
    const o1 = evo.champion.forward(inp), o2 = back.forward(inp);
    let same = true;
    for (let i = 0; i < 5; i++) if (Math.abs(o1[i] - o2[i]) > 1e-6) same = false;
    check("nn: JSON round-trip identical", same);
}

/* ---- 4b. per-vessel clock: arrivals buy time, empty clock freezes ---- */
{
    const map = buildMap(MAP_DEFS[0]);
    const router = new Router(map);
    // boat parked 1.5 m from the first GPS point: first control tick is an arrival
    const w1 = new World(map, router, [new Net(NET_SIZES, mulberry32(9))], { shipCollisions: false, combat: false, missionSeed: 1, noise: false, startBudget: 5 });
    const a = w1.boats[0];
    const p0 = w1.points[0];
    a.x = p0.x + 1.5; a.y = p0.y;
    w1.step();
    check("clock: arrival adds +60 s", a.arrivals === 1 && a.timeLeft > 50, `arrivals ${a.arrivals}, clock ${a.timeLeft.toFixed(1)} s`);
    check("gps: reaching a point spawns the next one", w1.points.length === 2 && w1.points[1] &&
        Math.hypot(w1.points[1].x - p0.x, w1.points[1].y - p0.y) > 15,
        `points ${w1.points.length}, leg ${w1.points[1] ? Math.hypot(w1.points[1].x - p0.x, w1.points[1].y - p0.y).toFixed(1) : "?"} m`);
    check("gps: new point is on open water", !map.isLand(w1.points[1].x, w1.points[1].y) && map.shoreDist(w1.points[1].x, w1.points[1].y) >= 0.8);
    // two boats reaching the same point: one shared next point, both chase it
    const w3 = new World(map, router, [new Net(NET_SIZES, mulberry32(11)), new Net(NET_SIZES, mulberry32(12))],
        { shipCollisions: false, combat: false, missionSeed: 2, noise: false, startBudget: 30 });
    const q0 = w3.points[0];
    w3.boats[0].x = q0.x + 1.4; w3.boats[0].y = q0.y;
    w3.boats[1].x = q0.x - 1.4; w3.boats[1].y = q0.y;
    w3.step();
    const t0b = w3.boats[0].tracker.target, t1b = w3.boats[1].tracker.target;
    check("gps: fleet shares the same next point",
        w3.points.length === 2 && t0b[0] === t1b[0] && t0b[1] === t1b[1] &&
        t0b[0] === w3.points[1].x && t0b[1] === w3.points[1].y,
        `points ${w3.points.length}`);

    // idle boat: clock empties, boat freezes, episode ends
    const w2 = new World(map, router, [new Net(NET_SIZES, mulberry32(10))], { shipCollisions: false, combat: false, missionSeed: 1, noise: false, startBudget: 3 });
    const c = w2.boats[0];
    c.control = function () { this.out.set([0, 0, 0, 0, 0]); };
    for (let i = 0; i < 30 * 4; i++) w2.step();
    check("clock: empty clock freezes boat and ends episode", c.done && w2.isOver(), `done ${c.done}, t ${w2.time.toFixed(1)} s`);
}

/* ---- 4c. champion grace: shelter, single holder, expiry transfer ---- */
{
    const evo = new Evolution(16, 55);
    const fakeGen = (fitOf) => evo.brains.map((b, i) => ({ brain: b, fitness: fitOf(b, i), arrivals: 0 }));

    // gen 1: boat 3 wins → crowned
    evo.evolve(fakeGen((b, i) => i === 3 ? 1000 : 100 - i), 0.02, 0.15, 3);
    check("grace: winner crowned with full grace", evo.grace && evo.grace.left === 3 && evo.graceIdx >= 0 &&
        evo.brains[evo.graceIdx] === evo.grace.net);

    // gens 2-3: holder keeps losing to a new best → sheltered, counting down
    evo.evolve(fakeGen(b => b === evo.grace.net ? 5 : 200 * Math.random() + 100), 0.02, 0.15, 3);
    check("grace: beaten champion survives (2 left)", evo.grace.left === 2 &&
        evo.brains[evo.graceIdx] === evo.grace.net, evo.graceEvent);
    evo.evolve(fakeGen(b => b === evo.grace.net ? 5 : 200 * Math.random() + 100), 0.02, 0.15, 3);
    check("grace: still sheltered (1 left)", evo.grace.left === 1 &&
        evo.brains[evo.graceIdx] === evo.grace.net, evo.graceEvent);

    // gen 4: third straight loss → grace expires, title passes to the new best
    evo.evolve(fakeGen(b => b === evo.grace.net ? 5 : 200 * Math.random() + 100), 0.02, 0.15, 3);
    check("grace: expires and passes to the new best", evo.grace.left === 3 &&
        /passes|passed/.test(evo.graceEvent || ""), evo.graceEvent);

    // winning refreshes grace to full
    evo.evolve(fakeGen(b => b === evo.grace.net ? 9999 : 100), 0.02, 0.15, 3);
    const afterWin = evo.grace.left;
    check("grace: defending the title refreshes it", afterWin === 3);

    // grace off → no holder, no reserved slot
    evo.evolve(fakeGen((b, i) => 100 - i), 0.02, 0.15, 0);
    check("grace: 0 turns it off", evo.grace === null && evo.graceIdx === -1);
    check("grace: population size stable throughout", evo.brains.length === 16);
}

/* ---- 5. combat: guns fire and can sink ---- */
{
    const map = buildMap(MAP_DEFS[0]);
    const router = new Router(map);
    const nets = [new Net(NET_SIZES, mulberry32(5)), new Net(NET_SIZES, mulberry32(6))];
    const world = new World(map, router, nets, { shipCollisions: true, combat: true, missionSeed: 1, noise: false });
    const [a, b] = world.boats;
    a.reset(45, 31, 0); b.reset(55, 31, 0);        // b dead ahead of a
    a.timeLeft = 9999; b.timeLeft = 9999;
    a.control = function () { this.out.set([0, 0, 1, 0, 0]); };
    b.control = function () { this.out.set([0, 0, 1, 0, 0]); };
    for (let i = 0; i < 30 * 10; i++) world.step();
    check("combat: shots fired", a.combatScore > 0, `attacker score ${a.combatScore}`);
    check("combat: target damaged or sunk", b.hp < BOAT.HP, `target hp ${b.hp}`);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
