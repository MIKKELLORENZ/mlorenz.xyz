/* world.js — one episode: a whole population of tokamaks running the same
 * task, side by side, plus (optionally) the PID baseline running the same task
 * in the same conditions for comparison.
 *
 * FAIRNESS RULES. Every plasma in a generation gets:
 *   - the same task and the same target trajectory
 *   - the same initial coil currents, including the same random starting error
 *   - the same domain randomisation draw (same wall time constant, same coil
 *     gains, same resistivity)
 *   - the same sensor-noise stream
 *
 * All of that follows from giving every Tokamak an RNG with the SAME seed and
 * making sure they consume it in the same order — which they do, because they
 * run in lockstep and the only thing that differs between them is the vector of
 * voltages their brain asks for. The only difference between two members of a
 * generation is their brain. Without this, ranking measures luck.
 */
"use strict";

class World {
    constructor(machine, brains, opts) {
        this.mac = machine || getMachine();
        this.opts = opts || {};
        const seed = (opts.missionSeed | 0) * 7919 + 13;

        // The task is built once and shared: it owns the target trajectory and
        // the (perturbed) initial equilibrium, so every controller inherits the
        // identical starting drift.
        // The difficulty rung is a property of the EPISODE, not of a controller:
        // task and plasma both read it, so every unit in this world faces the
        // same machine on the same rung. Defaults to 0, which is the simulator
        // exactly as it was before the ladder existed.
        this.level = (opts.level | 0) || 0;
        this.task = makeTask(opts.taskId || "elongated", this.mac, mulberry32(seed), {
            duration: opts.duration, level: this.level
        });
        this.duration = this.task.duration;
        this.steps = Math.round(this.duration / DT_CTRL);

        this.units = brains.map((brain, i) => {
            const tok = new Tokamak(this.mac, {
                rng: mulberry32(seed + 1),          // identical stream for every unit
                noise: opts.noise !== false,
                randomise: opts.randomise !== false,
                level: this.level
            });
            tok.reset(this.task, mulberry32(seed + 1));
            return {
                idx: i, brain, tok,
                score: 0, errSum: 0, errN: 0, deadAt: -1,
                act: new Float32Array(modeSpec().act)
            };
        });

        // The baseline shares the episode exactly — same task object, same seed,
        // same noise. When the UI says "PID vs champion" it means it.
        this.pid = null;
        if (opts.withPid) {
            const tok = new Tokamak(this.mac, {
                rng: mulberry32(seed + 1), noise: opts.noise !== false,
                randomise: opts.randomise !== false, level: this.level
            });
            tok.reset(this.task, mulberry32(seed + 1));
            const ctrl = opts.pidController || new PIDController(this.mac);
            ctrl.reset(this.task);
            this.pid = { tok, ctrl, score: 0, errSum: 0, errN: 0, deadAt: -1, act: new Float64Array(19) };
        }

        this.k = 0;
        this.time = 0;
        this.events = [];
    }

    /* A dead plasma still costs, and it costs MUCH more than the −4 floor on the
     * per-step reward. Surviving badly must always beat disrupting early;
     * otherwise the fastest route to a good score is a quick clean disruption
     * that stops the clock, and a population will find that in two generations.
     *
     * 8.0, not 4.5. At 4.5 the gap between "alive and hopeless" (−4) and "dead"
     * (−4.5) was half a point, so the reward barely preferred survival at all —
     * and the first trained brain duly came out with WORSE survival than doing
     * nothing (40% vs 51%) while scoring better on shape error. It had found the
     * trade the reward was quietly offering: command more voltage, hold a better
     * boundary while you live, and die sooner. Doubling the gap removes it. */
    static DEAD_STEP_COST = 8.0;

    _advance(u, action) {
        if (u.tok.dead) { u.score -= World.DEAD_STEP_COST; return; }
        u.tok.step(action);
        if (u.tok.dead) {
            u.deadAt = this.k;
            u.score -= World.DEAD_STEP_COST;
            return;
        }
        u.score += u.tok.reward(action);
        u.errSum += u.tok.boundaryError();
        u.errN++;
    }

    step() {
        const nAct = modeSpec().act;
        for (const u of this.units) {
            if (u.tok.dead) { u.score -= World.DEAD_STEP_COST; continue; }
            const obs = u.tok.observe();
            const out = u.brain.forward(obs);
            for (let i = 0; i < nAct; i++) u.act[i] = out[i];
            this._advance(u, u.act);
        }
        if (this.pid) {
            const p = this.pid;
            if (p.tok.dead) p.score -= World.DEAD_STEP_COST;
            else {
                const a = p.ctrl.step(p.tok);
                for (let i = 0; i < 19; i++) p.act[i] = a[i];
                this._advance(p, p.act);
            }
        }
        this.k++;
        this.time = this.k * DT_CTRL;
    }

    isOver() {
        if (this.k >= this.steps) return true;
        if (this.pid && !this.pid.tok.dead) return false;
        return this.units.every(u => u.tok.dead);
    }

    /* Fitness is mean reward per control step, scaled by 100 so the numbers read
     * like percentages of a perfect hold. A clean episode lands near +70, a
     * disruption a quarter of the way in near −110. */
    results() {
        return this.units.map(u => ({
            brain: u.brain,
            fitness: 100 * u.score / this.steps,
            survival: u.deadAt < 0 ? 1 : u.deadAt / this.steps,
            boundaryErr: u.errN ? u.errSum / u.errN : 0.5,
            disrupted: u.tok.dead,
            reason: u.tok.deadReason
        }));
    }

    pidResult() {
        if (!this.pid) return null;
        const p = this.pid;
        return {
            fitness: 100 * p.score / this.steps,
            survival: p.deadAt < 0 ? 1 : p.deadAt / this.steps,
            boundaryErr: p.errN ? p.errSum / p.errN : 0.5,
            disrupted: p.tok.dead,
            reason: p.tok.deadReason
        };
    }

    get leaderIdx() {
        let best = 0, bf = -1e18;
        for (const u of this.units) {
            const f = u.score - (u.tok.dead ? 1e6 : 0);
            if (f > bf) { bf = f; best = u.idx; }
        }
        return best;
    }
}

/* Run one brain through one task from start to finish and hand back a full
 * trace. Used by the tests, the trainer's held-out exam and the UI's
 * side-by-side replay — anywhere that wants the whole episode rather than a
 * frame at a time. */
function runEpisode(machine, brain, taskId, opts) {
    opts = opts || {};
    const w = new World(machine, brain ? [brain] : [], Object.assign({ taskId }, opts));
    const trace = opts.trace ? [] : null;
    while (!w.isOver()) {
        w.step();
        if (trace && w.k % (opts.traceEvery || 20) === 0) {
            const t = brain ? w.units[0].tok : w.pid.tok;
            trace.push({
                t: t.t, R: t.pR, Z: t.pZ, Ip: t.Ip, kappa: t.kappa,
                delta: t.delta, err: t.boundaryError(), dead: t.dead
            });
        }
    }
    const r = brain ? w.results()[0] : w.pidResult();
    r.trace = trace;
    r.duration = w.duration;
    return r;
}

if (typeof module !== "undefined") module.exports = { World, runEpisode };
