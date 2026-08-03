/* test_headless.js — run the whole sim without a browser.
 *
 *   node test_headless.js            everything
 *   node test_headless.js oracle     just the scripted-reference run
 *
 * The load-bearing test is `oracle`: a hand-written IK controller that plays
 * every one of the 49 goal specs. It answers the question that otherwise
 * poisons every disappointing training run — "is the task even possible?" — and
 * it audits the reward ledger while it does it. If the scripted controller can
 * satisfy the referee but earns a falling fitness, the ledger is wrong; if it
 * cannot satisfy the referee at all, the physics or the referee is wrong. Both
 * are things you want to find out before spending a night on a GA.
 */
"use strict";

const { loadSim } = require("./simload.js");
const loaded = loadSim(__dirname);

let PASS = 0, FAIL = 0;
const only = process.argv[2];
function test(name, fn) {
    if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
    try { fn(); console.log(`  ok   ${name}`); PASS++; }
    catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); FAIL++; }
}
function assert(c, m) { if (!c) throw new Error(m || "assertion failed"); }
function close(a, b, tol, m) { if (Math.abs(a - b) > tol) throw new Error(`${m || ""} ${a} vs ${b} (tol ${tol})`); }

console.log(`loaded: ${loaded.join(", ")}`);
console.log(`embedding: ${Embedding.mode}${Embedding.meta ? " (" + Embedding.meta.model + ", " + Embedding.nativeDim + "->" + Embedding.dim + ")" : ""} dim=${Embedding.dim}`);
if (Embedding.warning) console.log(`  ! ${Embedding.warning}`);
console.log();

/* ==================================================== 1. the language bank */
console.log("task bank");
test("539 sentences, 392 train / 147 held out", () => {
    assert(TASKS.length === 539, "got " + TASKS.length);
    assert(TASKS_TRAIN.length === 392, "train " + TASKS_TRAIN.length);
    assert(TASKS_HOLDOUT.length === 147, "holdout " + TASKS_HOLDOUT.length);
});
test("every sentence is unique and mentions a colour", () => {
    const s = new Set(TASKS.map(t => t.text));
    assert(s.size === TASKS.length, `${TASKS.length - s.size} duplicates`);
    for (const t of TASKS)
        assert(COLORS.some(c => t.text.toLowerCase().includes(c)), "no colour in: " + t.text);
});
test("held-out phrasings share specs with training ones, never sentences", () => {
    const trainTexts = new Set(TASKS_TRAIN.map(t => t.text));
    const trainSpecs = new Set(TASKS_TRAIN.map(t => t.specIdx));
    for (const t of TASKS_HOLDOUT) {
        assert(!trainTexts.has(t.text), "leaked sentence: " + t.text);
        assert(trainSpecs.has(t.specIdx), "holdout spec never trained: " + t.id);
    }
});
test("corpus hash is stable across two builds", () => {
    const a = corpusHash(), b = corpusHash();
    assert(a === b && /^[0-9a-f]{8}$/.test(a), a);
});

/* ============================================ 2. the referee (business logic) */
console.log("\ngoal logic");
const mkBalls = (arr) => arr.map((c, i) => ({ id: i, color: c }));

test("SORT accepts only the named colours, into matching buckets", () => {
    const spec = { kind: "SORT", params: { colors: [1] } };            // green
    const balls = mkBalls([1, 1, 0]);                                   // g g r
    const e = new GoalEvaluator(spec, balls);
    assert(e.target === 2, "target " + e.target);
    assert(e.deliver(1, 1, [1, 2, 0, 0]).correct, "green->green should be correct");
    assert(!e.deliver(1, 2, [1, 1, 0, 0]).correct, "green->blue must fail");
    assert(!e.deliver(0, 0, [1, 1, 0, 0]).correct, "red is not named");
});

test("ALTERNATE refuses two of a colour in a row", () => {
    const spec = { kind: "ALTERNATE", params: { colors: [0, 2] } };      // red/blue
    const e = new GoalEvaluator(spec, mkBalls([0, 0, 2, 2]));
    assert(e.target === 4, "target " + e.target);
    assert(e.deliver(0, 0, [2, 0, 2, 0]).correct, "first red ok");
    assert(!e.deliver(0, 0, [1, 0, 2, 0]).correct, "second red in a row must fail");
    assert(e.deliver(2, 2, [1, 0, 2, 0]).correct, "blue after red ok");
    assert(e.deliver(0, 0, [1, 0, 1, 0]).correct, "red after blue ok");
});

test("ALTERNATE may start with either colour", () => {
    const spec = { kind: "ALTERNATE", params: { colors: [0, 2] } };
    const e = new GoalEvaluator(spec, mkBalls([0, 2]));
    const a = e.allowedColors([1, 0, 1, 0]);
    assert(a.has(0) && a.has(2), "both colours should open the sequence");
});

test("ORDER blocks the second colour until the first is exhausted", () => {
    const spec = { kind: "ORDER", params: { colors: [0, 2] } };
    const e = new GoalEvaluator(spec, mkBalls([0, 0, 2]));
    assert(!e.allowedColors([2, 0, 1, 0]).has(2), "blue must wait");
    e.deliver(0, 0, [2, 0, 1, 0]);
    assert(!e.allowedColors([1, 0, 1, 0]).has(2), "blue must still wait");
    e.deliver(0, 0, [1, 0, 1, 0]);
    assert(e.allowedColors([0, 0, 1, 0]).has(2), "now blue is allowed");
});

test("COUNT stops at N and nothing else may move", () => {
    const spec = { kind: "COUNT", params: { color: 3, n: 2 } };          // two yellow
    const e = new GoalEvaluator(spec, mkBalls([3, 3, 3, 0]));
    assert(e.target === 2, "target " + e.target);
    assert(!e.permittedColors().has(0), "red is not permitted at all");
    e.deliver(3, 3, [1, 0, 0, 3]);
    e.deliver(3, 3, [1, 0, 0, 2]);
    assert(e.allowedColors([1, 0, 0, 1]).size === 0, "count is spent");
    const r = e.finish([1, 0, 0, 1]);
    assert(r.complete, "should be complete: " + JSON.stringify(r));
});

test("COUNT overshoot is caught by the audit", () => {
    const spec = { kind: "COUNT", params: { color: 3, n: 1 } };
    const e = new GoalEvaluator(spec, mkBalls([3, 3]));
    e.deliver(3, 3, [0, 0, 0, 2]);
    e.deliver(3, 3, [0, 0, 0, 1]);                                       // one too many
    const r = e.finish([0, 0, 0, 0]);
    assert(!r.complete && r.violations.length > 0, JSON.stringify(r));
});

test("LEAVE_ONE keeps exactly one spare back", () => {
    const spec = { kind: "LEAVE_ONE", params: { colors: [0, 1, 2, 3], spare: 3 } };
    const e = new GoalEvaluator(spec, mkBalls([0, 1, 3, 3]));            // two yellow
    assert(e.target === 3, "target " + e.target);
    assert(e.allowedColors([1, 1, 0, 2]).has(3), "one of the two yellows may go");
    e.deliver(3, 3, [1, 1, 0, 2]);
    assert(!e.allowedColors([1, 1, 0, 1]).has(3), "the last yellow must stay");
    e.deliver(0, 0, [1, 1, 0, 1]); e.deliver(1, 1, [0, 1, 0, 1]);
    assert(e.finish([0, 0, 0, 1]).complete, "one yellow left = complete");
    const e2 = new GoalEvaluator(spec, mkBalls([0, 1, 3, 3]));
    e2.deliver(3, 3, [1, 1, 0, 2]); e2.deliver(3, 3, [1, 1, 0, 1]);
    assert(!e2.finish([1, 1, 0, 0]).complete, "taking both yellows must fail the audit");
});

test("EXCLUDE forbids touching the skipped colour at all", () => {
    const spec = { kind: "EXCLUDE", params: { skip: 3 } };
    const e = new GoalEvaluator(spec, mkBalls([0, 1, 3]));
    assert(!e.permittedColors().has(3), "yellow forbidden");
    assert(e.noteGrasp(0), "red grasp fine");
    assert(!e.noteGrasp(3), "yellow grasp is a violation");
    e.deliver(0, 0, [1, 1, 0, 1]); e.deliver(1, 1, [0, 1, 0, 1]);
    assert(!e.finish([0, 0, 0, 1]).complete, "a forbidden grasp already happened");
    const e2 = new GoalEvaluator(spec, mkBalls([0, 1, 3]));
    e2.deliver(0, 0, [1, 1, 0, 1]); e2.deliver(1, 1, [0, 1, 0, 1]);
    assert(e2.finish([0, 0, 0, 1]).complete, "clean run should complete");
});

test("ALL_TO_ONE routes every colour to one bucket", () => {
    const spec = { kind: "ALL_TO_ONE", params: { bucket: 2 } };
    const e = new GoalEvaluator(spec, mkBalls([0, 1, 3]));
    assert(bucketFor(spec, 0) === 2 && bucketFor(spec, 3) === 2, "all roads to blue");
    assert(e.deliver(0, 2, [1, 1, 0, 1]).correct, "red into blue is correct here");
    assert(!e.deliver(1, 1, [0, 1, 0, 1]).correct, "green into green is wrong here");
});

test("every spec produces a satisfiable scene at every ball budget", () => {
    /* Tested at EVERY cap, not just 6. A curriculum cap is a statement about
     * difficulty, but trimming can collide with the rules: "leave one red
     * behind" cut to a single ball leaves only the spare, so nothing may
     * legally move, the target is zero, and the episode reports "complete"
     * before it starts. The arm would be scored on a task containing no correct
     * action. Caught by pinning a LEAVE_ONE sentence while stage 1 was active. */
    const specs = buildSpecs();
    for (let s = 0; s < specs.length; s++) {
        for (let cap = 1; cap <= 6; cap++)
            for (let seed = 0; seed < 6; seed++) {
                const rng = taskRng(1000 + s * 31 + seed);
                const balls = buildScene(null, specs[s], rng, { maxBalls: cap });
                const e = new GoalEvaluator(specs[s], balls);
                assert(e.target > 0,
                    `spec ${s} (${specs[s].kind}) target=0 at cap ${cap} with ${balls.length} balls`);
                assert(balls.length <= MAX_BALLS, `spec ${s}: ${balls.length} balls exceeds slots`);
            }
        for (let seed = 0; seed < 12; seed++) {
            const rng = taskRng(1000 + s * 31 + seed);
            const balls = buildScene(null, specs[s], rng, { maxBalls: 6 });
            assert(balls.length > 0 && balls.length <= 6, `spec ${s}: ${balls.length} balls`);
            const e = new GoalEvaluator(specs[s], balls);
            assert(e.target > 0, `spec ${s} (${specs[s].kind}) target=0 with ${balls.length} balls`);
            // balls must be inside the reachable area and not on top of each other
            for (let i = 0; i < balls.length; i++) {
                const b = balls[i];
                assert(b.x >= BALL_AREA.x0 - 1e-9 && b.x <= BALL_AREA.x1 + 1e-9, "ball outside area");
                for (let j = i + 1; j < balls.length; j++)
                    assert(Math.hypot(b.x - balls[j].x, b.z - balls[j].z) > 0.05, "balls overlap");
            }
        }
    }
});

/* ================================================================= 3. the arm */
console.log("\narm");
test("READY pose is the midpoint of every limit", () => {
    for (let j = 0; j < 5; j++)
        close(HOME[j], (ARM.limits[j][0] + ARM.limits[j][1]) / 2, 1e-9, "joint " + j);
});
test("a newborn's 0.5 outputs hold the ready pose", () => {
    const a = new Arm({});
    a.setCommand([0.5, 0.5, 0.5, 0.5, 0.5]);
    for (let i = 0; i < 200; i++) a.step(1 / 60);
    for (let j = 0; j < 5; j++) close(a.q[j], HOME[j], 1e-3, "joint " + j);
    const g = a.graspPoint();
    assert(g.y > 0.15 && g.y < 0.25, "ready height " + g.y);
    assert(Math.abs(g.x) < 0.01, "ready x " + g.x);
});
test("servos respect rate limits and joint stops under a sustained command", () => {
    // The four pose joints integrate, so a full-scale command has to be HELD to
    // drive them anywhere — issuing it once and stepping just lets the leak pull
    // the pose back to READY.
    const a = new Arm({});
    const dt = 1 / 60, control = 4;
    let prev = a.q.slice();
    for (let i = 0; i < 900; i++) {
        if (i % control === 0) a.setCommand([1, 1, 1, 1, 1], dt * control);
        a.step(dt);
        for (let j = 0; j < 5; j++) {
            assert(Math.abs(a.q[j] - prev[j]) <= ARM.rates[j] * dt + 1e-9, `joint ${j} exceeded its rate`);
            assert(a.q[j] >= ARM.limits[j][0] - 1e-9 && a.q[j] <= ARM.limits[j][1] + 1e-9, `joint ${j} past its stop`);
        }
        prev = a.q.slice();
    }
    for (let j = 0; j < 5; j++) close(a.q[j], ARM.limits[j][1], 2e-3, "joint " + j + " should reach its max");
});

test("a steady 0.5 command holds the ready pose against the leak", () => {
    const a = new Arm({});
    const dt = 1 / 60;
    for (let i = 0; i < 900; i++) {
        if (i % 4 === 0) a.setCommand([0.5, 0.5, 0.5, 0.5, 0.5], dt * 4);
        a.step(dt);
    }
    for (let j = 0; j < 5; j++) close(a.q[j], HOME[j], 1e-3, "joint " + j + " drifted");
});

test("a small constant bias settles instead of running away", () => {
    /* The whole risk of incremental control: a newborn's outputs sit ~0.01 off
     * 0.5, and integrating that for a whole episode would walk every joint into
     * its end stop. The leak has to turn a constant bias into a bounded offset. */
    const a = new Arm({});
    const dt = 1 / 60;
    for (let i = 0; i < 1800; i++) {
        if (i % 4 === 0) a.setCommand([0.52, 0.52, 0.52, 0.52, 0.5], dt * 4);
        a.step(dt);
    }
    for (let j = 0; j < 4; j++) {
        const [lo, hi] = ARM.limits[j];
        const frac = Math.abs(a.q[j] - HOME[j]) / (hi - lo);
        assert(frac < 0.25, `joint ${j} drifted ${(frac * 100).toFixed(0)}% of its range on a 2% bias`);
    }
});
/* This one is an invariant, not a behaviour, and it is here because violating
 * it silently makes the entire task impossible while every other test passes.
 * Twice. The grasp point is where a ball must be able to sit; if any part of
 * the gripper's collision geometry reaches that far, the ball is shoved out of
 * the spot it is supposed to occupy and nothing can ever be picked up. A GA run
 * under that condition just looks mysteriously flat. */
test("the grasp point is clear of the gripper's own collision geometry", () => {
    const tipR = BALL_R + 0.012;          // closed-jaw sphere, see world.js
    const wristR = BALL_R + 0.020;
    assert(ARM.graspOffset > tipR + 0.01,
        `jaws (${ARM.graspOffset}) must clear the tip collider (${tipR.toFixed(3)}) with margin`);
    assert(ARM.L3 + ARM.graspOffset > wristR + 0.01,
        `wrist collider (${wristR.toFixed(3)}) reaches the grasp point`);
    // and an open gripper must not collide at the jaws at all
    const a = new Arm({});
    a.q[4] = 1.0; a.updateFK();
    const g = a.graspPoint();
    const s = new Station(new Brain(Embedding.dim, mulberry32(1)),
        { kind: "SORT", params: { colors: [0] }, text: "" }, { kind: "SORT", params: { colors: [0] } },
        [{ id: 0, color: 0, x: g.x, y: g.y, z: g.z, vx: 0, vy: 0, vz: 0, held: false, inBucket: -1, lost: false, grabbed: false }],
        { noiseSeed: 1 });
    s.arm.q[4] = 1.0; s.arm.updateFK();
    s.policy = () => [0.5, 0.5, 0.5, 0.5, 1.0];
    const b0 = { x: s.balls[0].x, z: s.balls[0].z };
    for (let i = 0; i < 30; i++) s.physics(1 / 60);
    assert(Math.hypot(s.balls[0].x - b0.x, s.balls[0].z - b0.z) < 0.005,
        "an open gripper sitting on a ball pushed it sideways");
});

test("forward kinematics keeps the links rigid", () => {
    const a = new Arm({ rng: mulberry32(3) });
    const rng = mulberry32(9);
    for (let k = 0; k < 400; k++) {
        for (let j = 0; j < 4; j++) {
            const [lo, hi] = ARM.limits[j];
            a.q[j] = lo + rng() * (hi - lo);
        }
        a.updateFK();
        const f = a.fk();
        close(Math.hypot(f.elbow.x - f.shoulder.x, f.elbow.y - f.shoulder.y, f.elbow.z - f.shoulder.z), ARM.L1, 1e-6, "L1");
        close(Math.hypot(f.wrist.x - f.elbow.x, f.wrist.y - f.elbow.y, f.wrist.z - f.elbow.z), ARM.L2, 1e-6, "L2");
        close(Math.hypot(f.tip.x - f.wrist.x, f.tip.y - f.wrist.y, f.tip.z - f.wrist.z), ARM.L3, 1e-6, "L3");
    }
});

test("every ball position and bucket rim is reachable gripper-down", () => {
    let worstBall = 0, worstBucket = 0;
    for (const x of [BALL_AREA.x0, 0, BALL_AREA.x1])
        for (const z of [BALL_AREA.z0, 0.05, BALL_AREA.z1]) {
            const r = solveIK({ x, y: BALL_R, z });
            worstBall = Math.max(worstBall, r.err);
        }
    for (const x of BUCKET.xs) {
        const r = solveIK({ x, y: BUCKET.rim + 0.06, z: BUCKET.z });
        worstBucket = Math.max(worstBucket, r.err);
    }
    assert(worstBall < GRASP_R, `worst ball residual ${worstBall.toFixed(4)} m >= grasp radius ${GRASP_R}`);
    assert(worstBucket < BUCKET.r, `worst bucket residual ${worstBucket.toFixed(4)} m >= bucket radius ${BUCKET.r}`);
});

/* ============================================================== 4. physics */
console.log("\nphysics");
function soloStation(spec, balls, opts) {
    const brain = new Brain(Embedding.dim, mulberry32(1));
    return new Station(brain, { kind: spec.kind, params: spec.params, text: "" }, spec, balls,
        Object.assign({ noiseSeed: 5 }, opts || {}));
}

test("a dropped ball falls, settles on the table and stays there", () => {
    const spec = { kind: "SORT", params: { colors: [0] } };
    const s = soloStation(spec, [{ id: 0, color: 0, x: 0.1, y: 0.3, z: 0.1, vx: 0, vy: 0, vz: 0, held: false, inBucket: -1, lost: false, grabbed: false }]);
    s.policy = () => [0.5, 0.5, 0.5, 0.5, 1.0];
    for (let i = 0; i < 240; i++) s.physics(1 / 60);
    close(s.balls[0].y, BALL_R, 1e-3, "resting height");
    assert(Math.abs(s.balls[0].vy) < 1e-6, "still bouncing");
});

test("a ball released over a bucket is captured and counted", () => {
    const spec = { kind: "SORT", params: { colors: [0] } };
    const s = soloStation(spec, [{ id: 0, color: 0, x: BUCKET.xs[0], y: 0.25, z: BUCKET.z, vx: 0, vy: 0, vz: 0, held: false, inBucket: -1, lost: false, grabbed: false }]);
    s.policy = () => [0.5, 0.5, 0.5, 0.5, 1.0];
    for (let i = 0; i < 240; i++) s.physics(1 / 60);
    assert(s.balls[0].inBucket === 0, "not captured (inBucket=" + s.balls[0].inBucket + ")");
    assert(s.bucketFill[0] === 1, "fill not counted");
});

test("closing the gripper on a ball grabs it; opening drops it", () => {
    const spec = { kind: "SORT", params: { colors: [0] } };
    const a = new Arm({});
    a.setCommand([0.5, 0.5, 0.5, 0.5, 0.5]);
    for (let i = 0; i < 200; i++) a.step(1 / 60);
    const g = a.graspPoint();
    const s = soloStation(spec, [{ id: 0, color: 0, x: g.x, y: g.y, z: g.z, vx: 0, vy: 0, vz: 0, held: false, inBucket: -1, lost: false, grabbed: false }]);
    s.policy = () => [0.5, 0.5, 0.5, 0.5, 0.0];        // close
    for (let i = 0; i < 60; i++) { if (i % 4 === 0) s.control(new Float32Array(Embedding.dim), 4 / 60); s.physics(1 / 60); }
    assert(s.held === 0, "did not grab");
    s.policy = () => [0.5, 0.5, 0.5, 0.5, 1.0];        // open
    for (let i = 0; i < 60; i++) { if (i % 4 === 0) s.control(new Float32Array(Embedding.dim), 4 / 60); s.physics(1 / 60); }
    assert(s.held === -1, "did not release");
});

test("a ball pushed off the edge is marked lost and penalised", () => {
    const spec = { kind: "SORT", params: { colors: [0] } };
    const s = soloStation(spec, [{ id: 0, color: 0, x: TABLE.x1 + 0.05, y: BALL_R, z: 0.1, vx: 0.5, vy: 0, vz: 0, held: false, inBucket: -1, lost: false, grabbed: false }]);
    s.policy = () => [0.5, 0.5, 0.5, 0.5, 1.0];
    const f0 = s.fitness;
    for (let i = 0; i < 200; i++) s.physics(1 / 60);
    assert(s.balls[0].lost, "should be lost");
    assert(s.fitness < f0, "no penalty applied");
});

/* ================================================= 5. the scripted reference */
console.log("\nscripted reference controller");

const makeOraclePolicy = makeReferencePolicy;      // see reference_policy.js

function runScripted(task, sceneSeed, opts) {
    const brain = new Brain(Embedding.dim, mulberry32(1));
    const w = new World([brain], Object.assign({
        task, embedding: Embedding.forTask(task), sceneSeed, noiseSeed: 11, maxBalls: 6
    }, opts || {}));
    w.stations[0].policy = makeOraclePolicy();
    let guard = 0;
    while (!w.isOver() && guard++ < 60 * 90) w.step();
    return w.stations[0];
}

test("the scripted controller completes a one-ball SORT and is paid for it", () => {
    const task = TASKS.find(t => t.kind === "SORT" && t.params.colors.length === 1 && t.split === "train");
    const s = runScripted(task, 3, { maxBalls: 1 });
    assert(s.delivered >= 1, `delivered ${s.delivered}, log: ${JSON.stringify(s.log)}`);
    assert(s.completed, "not marked complete");
    assert(s.fitness > REWARD.deliver, `fitness ${s.fitness.toFixed(0)} should clear one delivery`);
});

test("the scripted controller clears every goal kind", () => {
    const byKind = {};
    for (const kind of ["SORT", "ALTERNATE", "LEAVE_ONE", "COUNT", "ORDER", "EXCLUDE", "ALL_TO_ONE"]) {
        const tasks = TASKS.filter(t => t.kind === kind && t.split === "train");
        let done = 0, runs = 0, del = 0, tgt = 0;
        for (let k = 0; k < 4; k++) {
            const t = tasks[(k * 37) % tasks.length];
            const s = runScripted(t, 100 + k * 13);
            runs++; if (s.completed) done++;
            del += s.delivered; tgt += s.evalr.target;
        }
        byKind[kind] = { done, runs, del, tgt };
    }
    const bad = Object.entries(byKind).filter(([, v]) => v.del < v.tgt * 0.75);
    console.log("       " + Object.entries(byKind)
        .map(([k, v]) => `${k} ${v.done}/${v.runs} complete, ${v.del}/${v.tgt} balls`).join("\n       "));
    assert(bad.length === 0, "under-performing kinds: " + bad.map(([k, v]) => `${k} ${v.del}/${v.tgt}`).join(", "));
});

test("fitness rises monotonically with how much of the job gets done", () => {
    // Same scene, three controllers: do nothing / reach only / full job.
    const task = TASKS.find(t => t.kind === "SORT" && t.params.colors.length === 1 && t.split === "train");
    const mk = (policy) => {
        const brain = new Brain(Embedding.dim, mulberry32(1));
        const w = new World([brain], { task, embedding: Embedding.forTask(task), sceneSeed: 21, noiseSeed: 11, maxBalls: 2 });
        w.stations[0].policy = policy;
        let guard = 0;
        while (!w.isOver() && guard++ < 60 * 90) w.step();
        return w.stations[0];
    };
    const idle = mk(() => [0.5, 0.5, 0.5, 0.5, 1.0]);
    const reachOnly = mk((s) => {
        const o = s.oracle();
        if (!o.ball) return [0.5, 0.5, 0.5, 0.5, 1.0];
        const sol = solveIK({ x: o.ball.x, y: o.ball.y + 0.02, z: o.ball.z });
        const n = [];
        for (let j = 0; j < 4; j++) {
            const [lo, hi] = ARM.limits[j];
            n.push(Math.max(0, Math.min(1, (sol.q[j] - lo) / (hi - lo))));
        }
        return [...n, 1.0];                                   // never closes the gripper
    });
    const full = mk(makeOraclePolicy());
    console.log(`       idle ${idle.fitness.toFixed(0)} < reach ${reachOnly.fitness.toFixed(0)} < full ${full.fitness.toFixed(0)}`);
    assert(reachOnly.fitness > idle.fitness, "reaching must beat idling");
    assert(full.fitness > reachOnly.fitness * 2, "finishing the job must dominate reaching");
});

/* ------------------------------------------------- reward-economy audits
 *
 * These are the tests that matter most and they exist because the fleet beat
 * the ledger once already: at generation 46 the best brain scored 3,715 with
 * zero balls delivered, by grabbing a ball and letting go of it over and over.
 * Every shaping term reset on release, so each re-grasp re-paid the bonus.
 * A GA finds that loop long before it finds the task. */

test("grab-and-drop farming earns nothing after the first grasp", () => {
    const task = TASKS.find(t => t.kind === "SORT" && t.params.colors.length === 1 && t.split === "train");
    const brain = new Brain(Embedding.dim, mulberry32(1));
    const w = new World([brain], {
        task, embedding: Embedding.forTask(task), sceneSeed: 3, noiseSeed: 11, maxBalls: 1
    });
    const s = w.stations[0];
    // Hover onto the ball, close, open, and repeat forever — the exact loop the
    // population discovered.
    let cycles = 0, opening = false, holdT = 0;
    s.policy = (st) => {
        const b = st.balls[0];
        const sol = solveIK({ x: b.x, y: b.y, z: b.z });
        const n = driveTo(sol.q, st.arm);
        if (st.held >= 0) { holdT++; if (holdT > 4) { opening = true; } }
        if (opening) {
            holdT = 0;
            if (st.held < 0) { opening = false; cycles++; }
            return [...n, 1.0];
        }
        return [...n, 0.0];
    };
    let guard = 0;
    while (!w.isOver() && guard++ < 60 * 90) w.step();
    console.log(`       ${cycles} grab/drop cycles, fitness ${s.fitness.toFixed(0)}, delivered ${s.delivered}`);
    assert(cycles >= 3, `the exploit policy only managed ${cycles} cycles — test is not exercising it`);
    // One grasp bonus, one approach ramp, one lift ramp, minus a drop penalty
    // per release. Nowhere near the thousands the exploit used to pay.
    const ceiling = REWARD.grasp + REWARD.reach + REWARD.near + REWARD.close + REWARD.lift + REWARD.carry + REWARD.release + REWARD.point + REWARD.aim;
    assert(s.delivered === 0, "this policy should never deliver anything");
    assert(s.fitness < ceiling, `farming paid ${s.fitness.toFixed(0)}, ceiling for one un-delivered ball is ${ceiling}`);
});

test("carrying a ball and never letting go is decisively worse than releasing", () => {
    /* The trap this project fell into three separate times. With the grasp
     * bonus already banked, "hold on for the rest of the episode" was the safe
     * play, and a probe found the champion carrying balls to the bucket with
     * its gripper open 0% of the time across twelve episodes. Letting go badly
     * has to beat not letting go at all, or the last rung is never climbed. */
    const task = TASKS.find(t => t.kind === "SORT" && t.params.colors.length === 1 && t.split === "train");
    const run = (everOpen) => {
        const brain = new Brain(Embedding.dim, mulberry32(1));
        const w = new World([brain], {
            task, embedding: Embedding.forTask(task), sceneSeed: 3, noiseSeed: 11, maxBalls: 1
        });
        const s = w.stations[0];
        // Identical behaviour in every respect except the last command: both
        // reach, grasp, lift and carry to the bucket. Only one opens its hand.
        const base = makeReferencePolicy();
        s.policy = (st) => {
            const out = base(st);
            if (!everOpen && st.held >= 0) out[4] = 0.0;      // clamped shut forever
            return out;
        };
        let g = 0;
        while (!w.isOver() && g++ < 60 * 90) w.step();
        return { fit: s.fitness, del: s.delivered };
    };
    const clamped = run(false), releases = run(true);
    console.log(`       carries and holds ${clamped.fit.toFixed(0)} (${clamped.del} delivered)  ·  ` +
        `carries and releases ${releases.fit.toFixed(0)} (${releases.del} delivered)`);
    assert(clamped.del === 0, "the clamped-shut policy must not deliver anything");
    // Decisively, not marginally. The two runs are identical up to the final
    // command, so this gap IS the value of opening the hand — it has to be big
    // enough that a mutation which discovers it is obviously worth keeping.
    assert(releases.fit > clamped.fit * 3,
        `releasing (${releases.fit.toFixed(0)}) barely beats holding on (${clamped.fit.toFixed(0)})`);
    // The clamped run legitimately earns reach, grasp, lift and carry — it did
    // those things. What it must NOT do is approach the full ladder, which
    // includes the release rung it never climbed.
    const fullLadder = REWARD.reach + REWARD.near + REWARD.close + REWARD.grasp
        + REWARD.lift + REWARD.carry + REWARD.release + REWARD.point + REWARD.aim;
    assert(clamped.fit < fullLadder * 0.8,
        `carrying and never letting go banks ${clamped.fit.toFixed(0)} of a ${fullLadder} ladder`);
});

test("no policy can out-earn a delivery without delivering", () => {
    // The invariant behind the whole ledger: for a single-ball task, everything
    // the shaping ladder can pay must come to less than one correct delivery.
    // If it does not, the population has a reason to farm rather than finish.
    const ladder = REWARD.grasp + REWARD.reach + REWARD.near + REWARD.close + REWARD.lift + REWARD.carry + REWARD.release + REWARD.point + REWARD.aim;
    assert(ladder < REWARD.deliver,
        `shaping ladder (${ladder}) must be worth less than one delivery (${REWARD.deliver})`);
});

test("obeying beats disobeying on the same scene", () => {
    // An EXCLUDE task: the compliant run vs one that sorts the forbidden colour too.
    const task = TASKS.find(t => t.kind === "EXCLUDE" && t.split === "train");
    const good = runScripted(task, 55);
    const mk = () => {
        const brain = new Brain(Embedding.dim, mulberry32(1));
        const w = new World([brain], { task, embedding: Embedding.forTask(task), sceneSeed: 55, noiseSeed: 11 });
        /* A policy that ignores the exclusion and sorts EVERY ball by colour,
         * taking the forbidden colour first so the disobedience is guaranteed
         * rather than left to where the balls happened to land. (An earlier
         * version picked the nearest ball, and on this scene the nearest ball
         * was always a legal one — the two runs scored identically and the test
         * passed nothing.) */
        const base = makeOraclePolicy();
        w.stations[0].policy = (s) => {
            const realOracle = s.oracle.bind(s);
            s.oracle = () => {
                const g = s.arm.graspPoint();
                if (s.held >= 0) {
                    const b = s.balls[s.held];
                    return { phase: "carry", ball: b, bucket: b.color };
                }
                const free = s.balls.filter(b => !b.lost && b.inBucket < 0 && !b.held);
                if (!free.length) return { phase: "idle", ball: null, bucket: -1 };
                const skip = s.spec.params.skip;
                const forbidden = free.filter(b => b.color === skip);
                const pool = forbidden.length ? forbidden : free;
                let best = pool[0], bd = Infinity;
                for (const b of pool) {
                    const d = Math.hypot(b.x - g.x, b.y - g.y, b.z - g.z);
                    if (d < bd) { bd = d; best = b; }
                }
                return { phase: "reach", ball: best, bucket: best.color, dist: bd };
            };
            const out = base(s);
            s.oracle = realOracle;
            return out;
        };
        let guard = 0;
        while (!w.isOver() && guard++ < 60 * 90) w.step();
        return w.stations[0];
    };
    const greedy = mk();
    console.log(`       obedient ${good.fitness.toFixed(0)} vs greedy ${greedy.fitness.toFixed(0)} (greedy moved ${greedy.evalr.touchedForbidden} forbidden)`);
    assert(good.fitness > greedy.fitness, "the ledger must pay obedience better than greed");
});

/* ================================================================ 6. brains */
console.log("\nbrain");
test("selector and motor shapes line up with the feature layout", () => {
    const b = new Brain(Embedding.dim, mulberry32(7));
    const sizes = netSizes(Embedding.dim);
    assert(b.ballSel.sizes[0] === BALL_FEATS + CTX_FEATS + Embedding.dim, "ball selector input width");
    assert(b.bucketSel.sizes[0] === BUCKET_FEATS + CTX_FEATS + Embedding.dim, "bucket selector input width");
    assert(b.motor.sizes[0] === MOTOR_FEATS, "motor input width");
    assert(b.motor.sizes[b.motor.sizes.length - 1] === 5, "five servos");
    console.log(`       ${b.paramCount()} evolved weights ` +
        `(ball ${sizes.ballSel.join("-")}, bucket ${sizes.bucketSel.join("-")}, motor ${sizes.motor.join("-")})`);
});
test("an empty slot is a valid 'do nothing' choice", () => {
    const b = new Brain(Embedding.dim, mulberry32(7));
    const slots = new Float32Array(MAX_BALLS * BALL_FEATS);       // every slot empty
    const ctx = new Float32Array(CTX_FEATS);
    const r = b.selectBall(slots, ctx, new Float32Array(Embedding.dim));
    assert(r.idx >= 0 && r.idx < MAX_BALLS, "must still return a slot");
    close(r.conf, 1 / MAX_BALLS, 1e-6, "identical slots must tie");
});
test("newborn outputs sit near the ready pose", () => {
    let sum = 0, n = 0;
    for (let k = 0; k < 20; k++) {
        const b = new Brain(Embedding.dim, mulberry32(100 + k));
        const out = b.act(new Float32Array(MOTOR_FEATS).fill(0.2));
        for (let j = 0; j < 5; j++) { sum += Math.abs(out[j] - 0.5); n++; }
    }
    const dev = sum / n;
    console.log(`       mean |output - 0.5| = ${dev.toFixed(4)}`);
    assert(dev < 0.08, "newborns should not be slamming servos: " + dev);
});
test("clone, mutate and serialise round-trip", () => {
    const b = new Brain(Embedding.dim, mulberry32(5));
    const c = b.clone();
    const inp = new Float32Array(MOTOR_FEATS).fill(0.3);
    const o1 = Array.from(b.act(inp)), o2 = Array.from(c.act(inp));
    for (let i = 0; i < 5; i++) close(o1[i], o2[i], 1e-9, "clone drifted");
    c.mutate(1.0, 0.4, mulberry32(6));
    const o3 = Array.from(c.act(inp));
    assert(o3.some((v, i) => Math.abs(v - o1[i]) > 1e-6), "mutation changed nothing");
    const round = Brain.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    const o4 = Array.from(round.act(inp));
    for (let i = 0; i < 5; i++) close(o3[i], o4[i], 1e-6, "serialisation drifted");
});
test("crossover mixes both parents", () => {
    const rng = mulberry32(11);
    const a = new Brain(Embedding.dim, mulberry32(1));
    const b = new Brain(Embedding.dim, mulberry32(2));
    const c = Brain.crossover(a, b, rng);
    let fromA = 0, fromB = 0, other = 0;
    const wa = a.motor.weights[0], wb = b.motor.weights[0], wc = c.motor.weights[0];
    for (let i = 0; i < wc.length; i++) {
        if (wc[i] === wa[i]) fromA++; else if (wc[i] === wb[i]) fromB++; else other++;
    }
    assert(fromA > 0 && fromB > 0, `A ${fromA} B ${fromB} blended ${other}`);
});

/* ============================================================ 7. determinism */
console.log("\nreproducibility");
test("same seeds give byte-identical episodes", () => {
    const task = TASKS_TRAIN[10];
    const run = () => {
        const brains = [new Brain(Embedding.dim, mulberry32(4))];
        const w = new World(brains, { task, embedding: Embedding.forTask(task), sceneSeed: 8, noiseSeed: 3 });
        let g = 0;
        while (!w.isOver() && g++ < 60 * 60) w.step();
        return w.results()[0];
    };
    const a = run(), b = run();
    close(a.fitness, b.fitness, 1e-9, "fitness");
    assert(a.delivered === b.delivered, "deliveries");
});
test("every station in a generation faces the identical scene", () => {
    const task = TASKS_TRAIN[3];
    const brains = [0, 1, 2, 3].map(i => new Brain(Embedding.dim, mulberry32(50 + i)));
    const w = new World(brains, { task, embedding: Embedding.forTask(task), sceneSeed: 12, noiseSeed: 4 });
    const ref = w.stations[0].balls;
    for (const s of w.stations) {
        assert(s.balls.length === ref.length, "different ball count");
        for (let i = 0; i < ref.length; i++) {
            close(s.balls[i].x, ref[i].x, 1e-12, "ball x");
            close(s.balls[i].z, ref[i].z, 1e-12, "ball z");
            assert(s.balls[i].color === ref[i].color, "ball colour");
        }
    }
});

/* ============================================================= 8. curriculum */
console.log("\ncurriculum & evolution");
test("stage 1 only ever draws single-colour SORT tasks", () => {
    const st = STAGES[0];
    for (let g = 1; g < 40; g++)
        for (const t of drawTasks(st, g, 4))
            assert(t.kind === "SORT" && t.params.colors.length === 1 && t.split === "train", "leaked: " + t.id);
});
test("training never draws a held-out phrasing", () => {
    for (const st of STAGES)
        for (let g = 1; g < 30; g++)
            for (const t of drawTasks(st, g, 5))
                assert(t.split === "train", "held-out phrasing leaked into training: " + t.id);
});
test("stages advance only on a sustained delivery rate", () => {
    const hist = [];
    assert(stageFor(1, hist, {}).id === 1, "starts at 1");
    for (let i = 0; i < 6; i++) hist.push({ stage: 1, avgDel: 0.02, topDel: 0.9 });
    assert(stageFor(7, hist, {}).id === 2, "should advance on the top quartile even with a weak fleet mean");
    const hist2 = [];
    for (let i = 0; i < 6; i++) hist2.push({ stage: 1, avgDel: 0.02, topDel: 0.2 });
    assert(stageFor(7, hist2, {}).id === 1, "should not advance on a weak fleet");
    assert(stageFor(7, hist, { stageLock: 4 }).id === 4, "lock ignored");
});
test("elites survive a generation byte-for-byte", () => {
    const evo = new Evolution(16, 1, Embedding.dim);
    const results = evo.brains.map((b, i) => ({ brain: b, fitness: 100 - i, delivered: 0, rate: 0, mistakes: 0, completed: 0 }));
    const bestBefore = results[0].brain.motor.weights[0].slice();
    evo.evolve(results, 0.2, 0.15, 3, {});
    const after = evo.brains[0].motor.weights[0];
    for (let i = 0; i < bestBefore.length; i++)
        assert(bestBefore[i] === after[i], "elite 0 was mutated at " + i);
});
test("a short run on stage 1 improves the fleet", () => {
    const POP = 24, GENS = 12, EPS = 2;
    const evo = new Evolution(POP, 20, Embedding.dim);
    const st = STAGES[0];
    let first = null, last = null;
    for (let g = 1; g <= GENS; g++) {
        const tasks = drawTasks(st, g, EPS);
        const acc = evo.brains.map(() => ({ fit: 0, del: 0, tgt: 0, mis: 0, comp: 0 }));
        tasks.forEach((task, e) => {
            const w = new World(evo.brains, {
                task, embedding: Embedding.forTask(task),
                sceneSeed: 1 + (g * 17 + e * 5), noiseSeed: 300 + g * 3 + e,
                maxBalls: st.maxBalls, noise: st.noise
            });
            let guard = 0;
            while (!w.isOver() && guard++ < 60 * 80) w.step();
            w.results().forEach((r, i) => {
                acc[i].fit += r.fitness; acc[i].del += r.delivered;
                acc[i].tgt += r.target; acc[i].mis += r.mistakes; acc[i].comp += r.completed;
            });
        });
        const results = evo.brains.map((b, i) => ({
            brain: b, fitness: acc[i].fit / EPS, delivered: acc[i].del / EPS,
            rate: acc[i].tgt > 0 ? acc[i].del / acc[i].tgt : 0,
            mistakes: acc[i].mis / EPS, completed: acc[i].comp / EPS
        }));
        const rec = evo.evolve(results, 0.22, 0.16, 3, {});
        if (g === 1) first = rec;
        last = rec;
    }
    console.log(`       gen 1 best ${first.best.toFixed(0)} avg ${first.avg.toFixed(0)}  ->  ` +
        `gen ${GENS} best ${last.best.toFixed(0)} avg ${last.avg.toFixed(0)}`);
    assert(last.best > first.best, `best did not improve (${first.best.toFixed(0)} -> ${last.best.toFixed(0)})`);
    assert(evo.championFit >= last.best - 1e-6, "champion should hold the record");
});

/* ============================================================= 9. embeddings */
console.log("\nembeddings");
test("every task has a vector of the declared width", () => {
    for (const t of TASKS) {
        const v = Embedding.forTask(t);
        assert(v && v.length === Embedding.dim, `${t.id}: ${v && v.length} != ${Embedding.dim}`);
        for (let i = 0; i < v.length; i++) assert(Number.isFinite(v[i]), "non-finite component in " + t.id);
    }
});
test("different goals get different vectors", () => {
    const a = Embedding.forTask(TASKS.find(t => t.kind === "SORT" && t.params.colors[0] === 0));
    const b = Embedding.forTask(TASKS.find(t => t.kind === "SORT" && t.params.colors[0] === 3));
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    assert(d > 0.1, "red and yellow SORT are indistinguishable (" + d.toFixed(4) + ")");
});
if (Embedding.mode === "qwen") {
    test("paraphrases of one goal sit closer than unrelated goals", () => {
        const cos = (a, b) => {
            let s = 0, na = 0, nb = 0;
            for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
            return s / (Math.sqrt(na * nb) || 1);
        };
        let same = 0, sn = 0, diff = 0, dn = 0;
        for (let i = 0; i < TASKS.length; i += 3)
            for (let j = i + 1; j < TASKS.length; j += 7) {
                const c = cos(Embedding.forTask(TASKS[i]), Embedding.forTask(TASKS[j]));
                if (TASKS[i].specIdx === TASKS[j].specIdx) { same += c; sn++; } else { diff += c; dn++; }
            }
        const ms = same / sn, md = diff / dn;
        console.log(`       mean cosine: same goal ${ms.toFixed(3)} · different goal ${md.toFixed(3)}`);
        assert(ms > md + 0.05, "the embedding does not separate goals");
    });
}

console.log(`\n${PASS} passed, ${FAIL} failed`);
process.exit(FAIL ? 1 : 0);
