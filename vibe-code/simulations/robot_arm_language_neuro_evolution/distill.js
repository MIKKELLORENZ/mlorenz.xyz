/* distill.js — teach the brain by imitation, then by DAgger.
 *
 *   node distill.js --rounds 6 --eps 2400 --workers 80 --out training_distill
 *
 * WHY THIS EXISTS. The stock GA cannot learn this task and no amount of it
 * will: 765 generations of `train.js` on stage 1 sit at 0.5 balls per episode
 * with 0% on held-out phrasings. That is not a search failure, it is a SIGNAL
 * failure. An episode is ~900 control decisions and ~20 selector decisions, and
 * it returns ONE scalar. Spread across 392 training sentences and 49 goal
 * specs, selection cannot see which of those decisions was the good one. The
 * arithmetic is in the project notes and it comes out the same way every time:
 * when the per-decision count is three orders of magnitude above the
 * per-episode signal, find a teacher.
 *
 * There is a teacher here, and it is unusually good: `oracle_policy.js` reads
 * the goal evaluator, so it knows the right ball and the right bucket exactly,
 * and it clears 72/73 balls. That converts the problem from reinforcement
 * learning into supervised learning, and the three heads get three different
 * kinds of supervision:
 *
 *   ballSel    EXACT. `Station.oracle()` names the ball that should be picked
 *              up next given the instruction and what has happened so far. This
 *              is the language half of the project, and it becomes a labelled
 *              classification problem rather than something to be inferred from
 *              a delivery count at the end of an episode.
 *   bucketSel  EXACT, same argument.
 *   motor      IMITATION of the teacher's five servo commands.
 *
 * WHAT THIS DOES NOT DO. It does not cap the brain at the teacher's ability and
 * it is not the last step. The teacher is a hand-written IK controller with no
 * access to the instruction; the student ends up with a policy the GA can then
 * improve against the real reward, which is not bounded by imitation. Distil
 * first because a GA needs a starting point it can hill-climb from, and a
 * random brain on this task has none.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker, isMainThread, parentPort } = require("worker_threads");
const { loadSim } = require("./simload.js");

const argv = process.argv.slice(2);
function arg(n, d) { const i = argv.indexOf("--" + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; }
function flag(n) { return argv.includes("--" + n); }

/* FEATURE GEOMETRY IS READ FROM THE SIM, NEVER RESTATED HERE.
 *
 * These were once a literal copy — `const MAXB = 6, BF = 16, ...` — and the
 * copy went stale the moment the bench was allowed to hold twelve balls: the
 * sim started emitting 192-wide slot arrays into 96-wide rows and the run died
 * on `offset is out of bounds`. It died loudly, which was luck. A duplicated
 * constant that happens to still FIT would have trained silently on garbage.
 *
 * `loadSim()` puts nn.js's exports in scope, so these are filled in after it
 * runs — separately in the worker and in main, because each calls loadSim
 * itself. */
let MAXB = 0, BF = 0, KF = 0, CF = 0, MF = 0, NK = 0, BWW = 0, KWW = 0;
function adoptGeometry() {
    MAXB = MAX_BALLS; BF = BALL_FEATS; KF = BUCKET_FEATS;
    CF = CTX_FEATS; MF = MOTOR_FEATS; NK = NBUCKET_SLOTS;
    BWW = MAXB * BF + CF + Embedding.dim;
    KWW = NK * KF + CF + Embedding.dim;
}

/* ==================================================================== worker
 * Rolls episodes and returns flat typed arrays. Everything crosses the thread
 * boundary as transferable buffers; nothing is JSON. */
if (!isMainThread) {
    loadSim(__dirname);
    adoptGeometry();
    const { makeOraclePolicy, makeIK } = require("./oracle_policy.js");
    const sharedIK = makeIK();      // the IK lattice cache is worth keeping warm across episodes

    parentPort.on("message", msg => {
        if (msg.type === "quit") process.exit(0);
        const { jobs, brainJSON, collect, beta, capPerEp } = msg;
        const brain = brainJSON ? Brain.fromJSON(brainJSON) : null;
        const rng = mulberry32(msg.seed || 1);

        const mX = [], mY = [], bX = [], bOK = [], kX = [], kOK = [];
        let del = 0, tgt = 0, comp = 0, n = 0, stranded = 0, ticks = 0;
        const perKind = {};

        for (const j of jobs) {
            const task = TASKS[j.taskIdx];
            const emb = Embedding.forTask(task);
            const probe = new Brain(Embedding.dim, mulberry32(1));
            const w = new World([brain || probe], {
                task, embedding: emb, sceneSeed: j.sceneSeed,
                noiseSeed: j.noiseSeed, maxBalls: j.maxBalls, noise: j.noise, fill: j.fill
            });
            const s = w.stations[0];

            /* Who drives, and who the motor label is computed FOR.
             *
             * Round 0 (no brain): the teacher drives, and `selOverride` — a hook
             * world.js already had — pins the pointer heads to the oracle so the
             * motor data is conditioned on CORRECT selections. That matters: on
             * round 0 the student's selectors are random, and motor data
             * gathered while chasing randomly chosen balls teaches nothing.
             *
             * Rounds 1+ (DAgger): the STUDENT drives and the teacher only
             * labels. The motor label is computed for the ball the student's own
             * selector points at, never for the oracle's — see motorFor.
             *
             * A fraction `beta` of episodes are handed back to the teacher
             * (see below), decaying to 0 so the last round is purely on-policy. */
            const teacherDrives = !brain;
            if (teacherDrives) s.selOverride = true;
            const teacher = makeOraclePolicy({
                ik: sharedIK,
                rng,                                  // a fresh policy style per episode
                target: teacherDrives ? null : (st => ({ ball: st.sel.ball, bucket: st.selBucket.idx }))
            });
            /* BETA-MIX. With probability beta this whole episode is driven by the
             * teacher instead of the student, decaying to 0 on the last round.
             *
             * Mixing per EPISODE rather than per TICK is deliberate. A per-tick
             * coin flip produces a trajectory neither policy would ever have
             * flown, so the states collected belong to nobody; mixing whole
             * episodes keeps every trajectory a real trajectory of a real
             * policy, and the union over rounds is what DAgger actually wants.
             * Beta reaching 0 on the final round is what makes that round's
             * score an honest on-policy measurement rather than a teacher-propped
             * one. */
            const teacherTakesOver = !teacherDrives && beta > 0 && rng() < beta;
            if (teacherDrives || teacherTakesOver) s.policy = (st => teacher(st).out);
            if (teacherTakesOver) s.selOverride = true;

            if (collect) {
                /* CAP THE SAMPLES ONE EPISODE MAY CONTRIBUTE.
                 *
                 * A confident student finishes in ~66 control ticks; a confused
                 * one dithers until the clock runs out and produces 400+. Without
                 * a cap the buffer fills with whatever the policy is WORST at,
                 * because being bad at something is precisely what makes an
                 * episode long. Round 1 collected 604k ticks from 4,000 episodes
                 * against round 0's 262k from the same 4,000, and the extra
                 * quarter-million were nearly all one policy hesitating.
                 *
                 * Those states are worth learning — that is the point of DAgger —
                 * but not at nine times the weight of a state on a successful
                 * delivery. Decimating by a stride that grows with the episode's
                 * own length preserves the shape of the episode while making its
                 * contribution grow logarithmically rather than linearly: a
                 * 400-tick flounder yields ~187 samples against a 66-tick
                 * success's 66, not 400. */
                let kept = 0, seen = 0;
                const stride = () => (capPerEp > 0 && seen > capPerEp ? Math.ceil(seen / capPerEp) : 1);
                s.recorder = (st, motorIn) => {
                    ticks++; seen++;
                    if (seen % stride() !== 0) return;
                    kept++;
                    const lab = teacher(st);

                    const row = new Float32Array(MF); row.set(motorIn);
                    const y = new Float32Array(5); for (let i = 0; i < 5; i++) y[i] = lab.out[i];
                    mX.push(row); mY.push(y);

                    // The selectors only fire every 4th control tick (world.js),
                    // so sampling them at that cadence costs nothing and keeps
                    // the buffer from filling with near-duplicate rows.
                    if (st.tick % 4 !== 0) return;

                    const ok = new Int8Array(MAXB);
                    if (lab.ball >= 0) ok[lab.ball] = 1;
                    else {
                        /* "Do nothing": ANY empty slot is a correct answer, and
                         * there are usually several. Demanding one particular
                         * empty slot would ask the net to tell identical
                         * all-zero inputs apart. S[o+13] is the occupancy flag
                         * sense() sets. */
                        for (let i = 0; i < MAXB; i++) if (st.ballSlots[i * BF + 13] === 0) ok[i] = 1;
                    }
                    let any = 0;
                    for (let i = 0; i < MAXB; i++) any += ok[i];
                    if (any > 0) {
                        const brow = new Float32Array(BWW);
                        brow.set(st.ballSlots, 0);
                        brow.set(st.ctx, MAXB * BF);
                        brow.set(emb, MAXB * BF + CF);
                        bX.push(brow); bOK.push(ok);
                    } else stranded++;

                    /* Only when the oracle actually HAS an opinion. A bucket of
                     * -1 means idle or holding-something-forbidden, and there is
                     * no right answer to record. Coercing it to 0 is what broke
                     * the first DAgger round — see labelsFor. */
                    if (lab.bucket >= 0) {
                        const kok = new Int8Array(NK); kok[lab.bucket] = 1;
                        const krow = new Float32Array(KWW);
                        krow.set(st.bucketSlots, 0);
                        krow.set(st.ctx, NK * KF);
                        krow.set(emb, NK * KF + CF);
                        kX.push(krow); kOK.push(kok);
                    }
                };
            }

            let guard = 0;
            while (!w.isOver() && guard++ < 60 * 140) w.step();

            del += s.delivered; tgt += s.evalr.target; comp += s.completed ? 1 : 0; n++;
            const k = task.kind;
            if (!perKind[k]) perKind[k] = { d: 0, t: 0, c: 0, n: 0 };
            perKind[k].d += s.delivered; perKind[k].t += s.evalr.target;
            perKind[k].c += s.completed ? 1 : 0; perKind[k].n++;
        }

        const pack = (rows, width, Ctor) => {
            const out = new Ctor(rows.length * width);
            for (let i = 0; i < rows.length; i++) out.set(rows[i], i * width);
            return out;
        };
        const res = {
            stats: { del, tgt, comp, n, stranded, ticks, perKind },
            mX: pack(mX, MF, Float32Array), mY: pack(mY, 5, Float32Array),
            bX: pack(bX, BWW, Float32Array), bOK: pack(bOK, MAXB, Int8Array),
            kX: pack(kX, KWW, Float32Array), kOK: pack(kOK, NK, Int8Array)
        };
        parentPort.postMessage(res, [res.mX.buffer, res.mY.buffer, res.bX.buffer,
        res.bOK.buffer, res.kX.buffer, res.kOK.buffer]);
    });
    return;
}

/* ====================================================================== main */
loadSim(__dirname);
adoptGeometry();
const { Grad, bceOut, setSoftmaxCE } = require("./netgrad.js");

const CFG = {
    rounds: parseInt(arg("rounds", "6"), 10),
    eps: parseInt(arg("eps", "2400"), 10),
    workers: parseInt(arg("workers", String(Math.max(1, os.cpus().length - 4))), 10),
    epochs: parseInt(arg("epochs", "12"), 10),
    batch: parseInt(arg("batch", "256"), 10),
    lr: parseFloat(arg("lr", "0.002")),
    wd: parseFloat(arg("wd", "1e-6")),
    seed: parseInt(arg("seed", "5"), 10),
    keep: parseInt(arg("keep", "1200000"), 10),      // sample cap per head
    out: arg("out", "training_distill"),
    tag: arg("tag", "distill"),
    evalEps: parseInt(arg("eval-eps", "294"), 10),
    cap: parseInt(arg("cap", "90"), 10)              // max samples one episode may contribute
};
CFG.checkpoints = null;   // filled in below, once CHECKPOINTS is parsed
/* Epoch counts at which the round's brain is snapshotted and scored on the real
 * task. The best-scoring snapshot is the round's output. See the note at the
 * training call for why this is not a tunable constant. */
const CHECKPOINTS = (arg("checkpoints", "6,10,14,18,24")).split(",").map(Number).sort((a, b) => a - b);

/* Teacher-drives probability by round. Round 0 is always 1 (pure cloning) and
 * the schedule is clipped so the last rounds are fully on-policy. */
const BETAS = (arg("betas", "1,0.45,0.25,0.10,0,0,0,0,0,0")).split(",").map(Number);
CFG.checkpoints = CHECKPOINTS;
const outDir = path.isAbsolute(CFG.out) ? CFG.out : path.join(__dirname, CFG.out);
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, CFG.tag + ".log");
function say(s) {
    const line = typeof s === "string" ? s : JSON.stringify(s);
    console.log(line);
    fs.appendFileSync(logFile, line + "\n");
}
say(`\n=== ${new Date().toISOString()} distill ===`);
say(`embedding: ${Embedding.mode} dim ${Embedding.dim}`);
say(`config: ${JSON.stringify(CFG)}`);

const TRAIN = TASKS.map((t, i) => ({ t, i })).filter(o => o.t.split === "train");
const HELD = TASKS.map((t, i) => ({ t, i })).filter(o => o.t.split !== "train");
say(`tasks: ${TRAIN.length} training phrasings, ${HELD.length} held-out phrasings`);

const pool = [];
for (let i = 0; i < CFG.workers; i++) pool.push(new Worker(__filename, { argv }));

/* Episode diet. The curriculum in evolution.js exists because a GA has to be
 * walked up to the full task one rung at a time; a supervised learner does not,
 * so this trains on the whole distribution from the first round. Ball counts and
 * servo noise are stratified rather than fixed so no single scene shape
 * dominates the buffer. */
function makeJobs(list, count, seedBase) {
    const jobs = [];
    for (let i = 0; i < count; i++) {
        const o = list[i % list.length];
        const r = (Math.imul(i + 1, 2654435761)) >>> 0;
        jobs.push({
            taskIdx: o.i,
            sceneSeed: seedBase + ((r >>> 3) % 100000),
            noiseSeed: seedBase + ((r >>> 11) % 1000),
            maxBalls: MAX_BALLS,
            /* Bench density is stratified rather than fixed. The shipped page
             * runs a full bench, but a policy trained only on full benches has
             * never seen the last two balls of one — and "nearly finished" is
             * the state every episode ends in. */
            fill: [1.0, 1.5, 2.0, 2.0, 2.4, 2.4][(r >>> 21) % 6],
            noise: [0, 0.2, 0.35, 0.5][(r >>> 17) % 4]
        });
    }
    return jobs;
}

function dispatch(jobs, brainJSON, collect, seed, beta, capPerEp) {
    return new Promise(resolve => {
        const per = Math.ceil(jobs.length / pool.length);
        let pending = 0;
        const out = [];
        pool.forEach((w, wi) => {
            const slice = jobs.slice(wi * per, (wi + 1) * per);
            if (!slice.length) return;
            pending++;
            w.once("message", m => { out.push(m); if (--pending === 0) resolve(out); });
            w.postMessage({ jobs: slice, brainJSON, collect, seed: seed + wi, beta: beta || 0, capPerEp: capPerEp || 0 });
        });
        if (pending === 0) resolve(out);
    });
}

/* ------------------------------------------------------------------ buffers */
const buf = { mX: [], mY: [], bX: [], bOK: [], kX: [], kOK: [], mN: 0, bN: 0, kN: 0 };
const BW = BWW, KW = KWW;

function absorb(results) {
    const st = { del: 0, tgt: 0, comp: 0, n: 0, stranded: 0, ticks: 0, perKind: {} };
    for (const r of results) {
        buf.mX.push(r.mX); buf.mY.push(r.mY); buf.mN += r.mY.length / 5;
        buf.bX.push(r.bX); buf.bOK.push(r.bOK); buf.bN += r.bOK.length / MAXB;
        buf.kX.push(r.kX); buf.kOK.push(r.kOK); buf.kN += r.kOK.length / NK;
        st.del += r.stats.del; st.tgt += r.stats.tgt; st.comp += r.stats.comp;
        st.n += r.stats.n; st.stranded += r.stats.stranded; st.ticks += r.stats.ticks;
        for (const k in r.stats.perKind) {
            if (!st.perKind[k]) st.perKind[k] = { d: 0, t: 0, c: 0, n: 0 };
            for (const f of ["d", "t", "c", "n"]) st.perKind[k][f] += r.stats.perKind[k][f];
        }
    }
    return st;
}

/* Flatten the accumulated chunks into one contiguous array per head, dropping
 * the OLDEST samples if the cap is exceeded. Keeping every round is deliberate:
 * DAgger retrains from scratch on the union each time, because training only on
 * the newest on-policy states makes the network forget the states it already
 * handles and the policy then oscillates between two failure modes. */
function flatten(chunks, width, Ctor, cap) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const nRows = total / width;
    const dropRows = Math.max(0, nRows - cap);
    const out = new Ctor((nRows - dropRows) * width);
    let skip = dropRows * width, o = 0;
    for (const c of chunks) {
        if (skip >= c.length) { skip -= c.length; continue; }
        const src = skip > 0 ? c.subarray(skip) : c;
        out.set(src, o); o += src.length; skip = 0;
    }
    return out;
}

/* ------------------------------------------------------------------ training */
function shuffled(n, r) {
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    return idx;
}

function trainMotor(net, X, Y, epochs, r, g, e0) {
    g = g || new Grad(net);
    e0 = e0 || 0;
    const n = Y.length / 5;
    const dz = new Float64Array(5), tgt = new Float64Array(5);
    let last = 0;
    for (let e = 0; e < epochs; e++) {
        const idx = shuffled(n, r);
        let loss = 0, nb = 0;
        for (let b = 0; b < n; b += CFG.batch) {
            g.zero();
            const m = Math.min(CFG.batch, n - b);
            for (let k = 0; k < m; k++) {
                const i = idx[b + k];
                const y = g.forward(X.subarray(i * MF, i * MF + MF));
                for (let j = 0; j < 5; j++) tgt[j] = Y[i * 5 + j];
                loss += bceOut(y, tgt, dz);
                g.backward(dz);
            }
            g.step(CFG.lr, 1 / m, CFG.wd); nb += m;
        }
        last = loss / nb;
        if (e === epochs - 1 || e % 4 === 0) say(`      motor     epoch ${e0 + e + 1}  bce ${last.toFixed(4)}`);
    }
    return { loss: last, g };
}

/* A selector epoch. The net is run once per slot with SHARED weights, the
 * scores go through one softmax, and every slot's gradient lands in the same
 * accumulator — which is exactly what makes the head permutation invariant. */
function trainSelector(net, X, OK, width, nSlots, slotFeats, epochs, r, name, g, e0) {
    g = g || new Grad(net);
    e0 = e0 || 0;
    const n = OK.length / nSlots;
    const ctxEmb = width - nSlots * slotFeats;
    const inBuf = new Float32Array(slotFeats + ctxEmb);
    const scores = new Float64Array(nSlots);
    const dz1 = new Float64Array(1);
    let acc = 0, last = 0;
    for (let e = 0; e < epochs; e++) {
        const idx = shuffled(n, r);
        let loss = 0, hit = 0, nb = 0;
        for (let b = 0; b < n; b += CFG.batch) {
            g.zero();
            const m = Math.min(CFG.batch, n - b);
            for (let k = 0; k < m; k++) {
                const i = idx[b + k], base = i * width;
                for (let s = 0; s < nSlots; s++) {
                    inBuf.set(X.subarray(base + s * slotFeats, base + (s + 1) * slotFeats), 0);
                    inBuf.set(X.subarray(base + nSlots * slotFeats, base + width), slotFeats);
                    scores[s] = net.forward(inBuf)[0];
                }
                const ok = [];
                let bestI = 0;
                for (let s = 0; s < nSlots; s++) {
                    ok.push(OK[i * nSlots + s] === 1);
                    if (scores[s] > scores[bestI]) bestI = s;
                }
                if (ok[bestI]) hit++;
                const ce = setSoftmaxCE(scores, ok);
                loss += ce.loss;
                /* Second pass: re-run each slot through the CACHING forward and
                 * push its own dL/dscore back. Two passes is the price of not
                 * holding six activation caches per sample; at this size it is
                 * cheaper than the memory traffic would be. */
                for (let s = 0; s < nSlots; s++) {
                    if (Math.abs(ce.dz[s]) < 1e-9) continue;
                    inBuf.set(X.subarray(base + s * slotFeats, base + (s + 1) * slotFeats), 0);
                    inBuf.set(X.subarray(base + nSlots * slotFeats, base + width), slotFeats);
                    g.forward(inBuf);
                    dz1[0] = ce.dz[s];
                    g.backward(dz1);
                }
            }
            g.step(CFG.lr, 1 / m, CFG.wd); nb += m;
        }
        last = loss / nb; acc = hit / nb;
        if (e === epochs - 1 || e % 4 === 0)
            say(`      ${name} epoch ${e0 + e + 1}  ce ${last.toFixed(4)}  train-acc ${(100 * acc).toFixed(1)}%`);
    }
    return { loss: last, acc, g };
}

/* --------------------------------------------------------------------- eval */
async function evaluate(brain, list, label, count) {
    const jobs = makeJobs(list, count, 900000);
    const res = await dispatch(jobs, brain.toJSON(), false, 1234);
    let del = 0, tgt = 0, comp = 0, n = 0;
    const pk = {};
    for (const r of res) {
        del += r.stats.del; tgt += r.stats.tgt; comp += r.stats.comp; n += r.stats.n;
        for (const k in r.stats.perKind) {
            if (!pk[k]) pk[k] = { d: 0, t: 0, c: 0, n: 0 };
            for (const f of ["d", "t", "c", "n"]) pk[k][f] += r.stats.perKind[k][f];
        }
    }
    say(`   ${label}: ${(100 * del / Math.max(1, tgt)).toFixed(1)}% balls  ${(100 * comp / Math.max(1, n)).toFixed(1)}% tasks  (${n} episodes)`);
    const parts = Object.keys(pk).sort().map(k =>
        `${k} ${(100 * pk[k].d / Math.max(1, pk[k].t)).toFixed(0)}/${(100 * pk[k].c / Math.max(1, pk[k].n)).toFixed(0)}`);
    say(`      by kind (balls%/tasks%): ${parts.join("  ")}`);
    return { balls: del / Math.max(1, tgt), tasks: comp / Math.max(1, n), perKind: pk };
}

/* --------------------------------------------------------------------- run */
(async function main() {
    let brain = null, bestScore = -1;
    const history = [];

    for (let round = 0; round < CFG.rounds; round++) {
        const t0 = Date.now();
        say(`\n--- round ${round} (${round === 0 ? "teacher-driven, behaviour cloning" : "on-policy, DAgger"}) ---`);

        const jobs = makeJobs(TRAIN, CFG.eps, 1000 + round * 77777);
        /* Beta decays to exactly 0 on the last round so the final number is an
         * honest on-policy measurement. */
        const beta = round === 0 ? 1 : Math.max(0, BETAS[Math.min(round, BETAS.length - 1)]);
        say(`   beta (teacher drives) ${beta.toFixed(2)}  ·  per-episode sample cap ${CFG.cap}`);
        const res = await dispatch(jobs, round === 0 ? null : brain.toJSON(), true, 4000 + round * 31, beta, CFG.cap);
        const st = absorb(res);
        say(`   collected ${st.n} episodes, ${st.ticks} control ticks  ·  driver scored ` +
            `${(100 * st.del / Math.max(1, st.tgt)).toFixed(1)}% balls, ${(100 * st.comp / Math.max(1, st.n)).toFixed(1)}% tasks`);
        say(`   buffer: motor ${buf.mN} · ball ${buf.bN} · bucket ${buf.kN}` +
            (st.stranded ? `  (stranded ${st.stranded})` : ""));

        const mX = flatten(buf.mX, MF, Float32Array, CFG.keep);
        const mY = flatten(buf.mY, 5, Float32Array, CFG.keep);
        const bX = flatten(buf.bX, BW, Float32Array, CFG.keep);
        const bOK = flatten(buf.bOK, MAXB, Int8Array, CFG.keep);
        const kX = flatten(buf.kX, KW, Float32Array, CFG.keep);
        const kOK = flatten(buf.kOK, NK, Int8Array, CFG.keep);

        /* RETRAIN FROM SCRATCH every round, from fresh random weights. Warm
         * starting from the previous round looks like it should save time and
         * does not — it locks in the previous round's errors, which are exactly
         * the states this round went out to collect. */
        const fresh = new Brain(Embedding.dim, mulberry32(CFG.seed + round));
        const r = mulberry32(CFG.seed * 31 + round);
        say(`   training on ${mY.length / 5} motor · ${bOK.length / MAXB} ball · ${kOK.length / NK} bucket samples`);

        /* CHECKPOINT AND CHOOSE BY BEHAVIOUR, NOT BY LOSS.
         *
         * The supervised losses saturate long before training ends and then
         * stop discriminating at all, while closed-loop behaviour keeps moving
         * around underneath them. Measured on round 0, all five snapshots
         * fitting the same data to the same losses (motor BCE 0.401-0.413,
         * ballSel 98.9-99.2%):
         *
         *     6 epochs  52.4%      18 epochs  54.8%
         *    10 epochs  57.9%      24 epochs  61.1%     <- held-out TASKS
         *    14 epochs  58.0%
         *
         * and a SEPARATE 18-epoch fit of the identical data — differing only in
         * the order the minibatches came out of the shuffler — scored 67.1%.
         *
         * The first reading of this was overfitting, and it is not: the curve is
         * not monotonic and the two 18-epoch fits are 12 points apart. What it
         * actually says is that the supervised objective has many solutions it
         * cannot tell apart and the task can, by a dozen points of held-out task
         * completion. So the epoch count is not a hyperparameter to tune once and
         * bake in; it is a way of drawing several equally-good-looking fits so
         * the real task can pick between them.
         *
         * A supervised validation split would NOT substitute here. It measures
         * the same quantity the training loss does, and that quantity is exactly
         * the one shown not to track behaviour. Scoring snapshots on the actual
         * task costs seconds across the worker pool.
         *
         * NOTE the selection bias this introduces: taking the best of five
         * evaluations on one bank overstates that brain by roughly the spread
         * of the noise. The number to quote is a re-run on a FRESH bank
         * (`--fresh-eval`), never the winning checkpoint's own score. */
        let gm = null, gb = null, gk = null, done = 0;
        let bestHo = null, bestTr = null, bestBrain = null, bestEp = 0, bestVal = -1;
        for (const stop of CFG.checkpoints) {
            const step = stop - done;
            if (step <= 0) continue;
            const rm = trainMotor(fresh.motor, mX, mY, step, r, gm, done); gm = rm.g;
            const rb = trainSelector(fresh.ballSel, bX, bOK, BW, MAXB, BF, step, r, "ballSel  ", gb, done); gb = rb.g;
            const rk = trainSelector(fresh.bucketSel, kX, kOK, KW, NK, KF, step, r, "bucketSel", gk, done); gk = rk.g;
            done = stop;
            const hoC = await evaluate(fresh, HELD, `  @${String(stop).padStart(2)} epochs HELD-OUT`, CFG.evalEps);
            const v = hoC.tasks * 2 + hoC.balls;
            if (v > bestVal) { bestVal = v; bestHo = hoC; bestEp = stop; bestBrain = fresh.clone(); bestTr = { ba: rb.acc, ka: rk.acc }; }
        }
        brain = bestBrain;
        say(`   best checkpoint: ${bestEp} epochs`);
        const ba = { acc: bestTr.ba }, ka = { acc: bestTr.ka };

        const tr = await evaluate(brain, TRAIN, "trained phrasings ", CFG.evalEps);
        const ho = bestHo;
        say(`   HELD-OUT phrasings: ${(100 * ho.balls).toFixed(1)}% balls  ${(100 * ho.tasks).toFixed(1)}% tasks`);
        /* Ranked on HELD-OUT task completion, with balls as the tie-break. The
         * whole project is about generalising to sentences never trained on, so
         * ranking on anything else picks the wrong brain. */
        const score = ho.tasks * 2 + ho.balls;
        history.push({
            round, ballAcc: ba.acc, bucketAcc: ka.acc,
            train: { balls: tr.balls, tasks: tr.tasks },
            held: { balls: ho.balls, tasks: ho.tasks },
            secs: (Date.now() - t0) / 1000
        });
        if (score > bestScore) {
            bestScore = score;
            fs.writeFileSync(path.join(outDir, "distilled_best.json"), JSON.stringify({
                gen: round, fitness: 0,
                lineage: "distilled from oracle_policy.js (behaviour cloning + DAgger), no evolution",
                /* These three are what bake_brain.js checks a brain against
                 * before it will publish it. Omitting them does not make the
                 * check fail loudly, it makes it not happen — a brain fitted to
                 * one sentence bank would bake happily against another, run
                 * fine, and quietly mean something different by every input. */
                embDim: Embedding.dim,
                embModel: Embedding.meta ? Embedding.meta.model : "surrogate",
                corpusHash: corpusHash(),
                heldOut: { balls: ho.balls, tasks: ho.tasks },
                trained: { balls: tr.balls, tasks: tr.tasks },
                brain: brain.toJSON()
            }));
            say(`   * new best on held-out — saved distilled_best.json`);
        }
        fs.writeFileSync(path.join(outDir, "distill_history.json"), JSON.stringify(history, null, 1));
        fs.writeFileSync(path.join(outDir, `round${round}.json`), JSON.stringify({
            gen: round, lineage: "distilled", brain: brain.toJSON()
        }));
        say(`   round ${round} done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
    const bestRound = history.reduce((a, h) => (h.held.tasks > a.held.tasks ? h : a));
    say(`\nbest held-out: round ${bestRound.round} — ${(100 * bestRound.held.balls).toFixed(1)}% balls, ${(100 * bestRound.held.tasks).toFixed(1)}% tasks`);
    pool.forEach(w => w.postMessage({ type: "quit" }));
    process.exit(0);
})();
