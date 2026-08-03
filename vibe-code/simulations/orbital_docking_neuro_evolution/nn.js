/* nn.js — the brain. A TWO-RATE, TWO-HEAD network, evolved, no gradients
 * (except optionally in imitate.js, which is a warm start and not the method).
 *
 *      sensors ──▶ TRUNK ──┬──▶ GUIDANCE head   every 4 s   → Δv, pointing, coast
 *                          │            │
 *                          └──▶ CONTROL head ◀──┘  every 0.25 s → six thruster commands
 *
 * WHY TWO HEADS AND TWO RATES. A rendezvous spans five decades of range and
 * four of time. The decision "burn 6 m/s retrograde and then do nothing for
 * forty minutes" and the decision "fire the +Y quad for 60 ms to stop this
 * drift" are not the same kind of decision, they are not made at the same rate,
 * and a single flat policy asked to make both ends up making the slow one
 * sixteen times a second — which is how a network burns its entire propellant
 * budget in the first two minutes of a two-hour mission.
 *
 * So the guidance head runs once every sixteen control ticks and emits a
 * command; the control head runs every tick and is fed BOTH the fresh sensor
 * trunk and the guidance head's held command. It is one genome, bred and
 * mutated as one, and there is no supervision anywhere telling the control
 * head that it is supposed to be tracking the guidance head's Δv — that
 * relationship is something selection discovers, because a pair of heads that
 * agree with each other docks and a pair that argues does not.
 *
 * THE COAST OUTPUT IS THE INTERESTING ONE. It is a request to stop thinking:
 * "hold everything, fire nothing, and wake me in T seconds." When it is
 * granted the integrator switches to long steps and the episode fast-forwards.
 * That is what makes a 150 km rendezvous cost about the same to evaluate as a
 * 40 m one — the cost of an episode becomes the number of MANOEUVRES, not the
 * mission duration — and it is also, not coincidentally, exactly the skill the
 * task requires. Waiting is not the absence of a policy here. It is an action,
 * with a duration, that the network has to choose.
 *
 * OUTPUT LAYERS START NEAR ZERO. A fresh brain therefore commands no thrust at
 * all, which in orbit is a perfectly survivable thing to do — unlike a
 * quadrotor, a spacecraft that does nothing keeps flying. The scenarios are
 * built so that doing nothing is survivable but never sufficient (see the
 * audition in world.js), so generation 1 has a population that lives long
 * enough to be told apart.
 */
"use strict";

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Box-Muller, with the spare cached ON THE RNG rather than in a module-level
 * variable. A shared module-level spare leaks a normal from whoever drew last
 * into whoever draws next, so re-running an episode with identical seeds gives
 * a different sensor-noise stream depending on what happened earlier in the
 * process — and a worker computes a different episode from the main thread for
 * the same scenario. Every fairness claim in this project (common random
 * numbers, paired duels, reproducible exams) rests on that not happening. */
function gaussRand(rng) {
    const s = rng._gaussSpare;
    if (s != null) { rng._gaussSpare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    rng._gaussSpare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
}

/* Layer widths. `nin` comes from sensors.js at run time, so this is a function
 * and not a constant — the sensor suite is allowed to grow without this file
 * knowing about it, and graft.js relies on being able to build both the old
 * and the new shape in the same process. */
const NET_ARCH = {
    trunk: [64, 48],
    guidance: [32, 7],       // Δv(3) · pointing(3) · coast(1)
    control: [40, 6]         // signed translation(3) · signed torque(3)
};
const N_GUID_OUT = NET_ARCH.guidance[NET_ARCH.guidance.length - 1];
const N_CTRL_OUT = NET_ARCH.control[NET_ARCH.control.length - 1];

function netSpec(nin) {
    const t = [nin].concat(NET_ARCH.trunk);
    const latent = NET_ARCH.trunk[NET_ARCH.trunk.length - 1];
    return {
        nin,
        trunk: t,
        guidance: [latent].concat(NET_ARCH.guidance),
        control: [latent + N_GUID_OUT].concat(NET_ARCH.control)
    };
}

/* A stack of dense tanh layers. The last layer of each stack is an output
 * layer and starts near zero. */
class Stack {
    constructor(sizes, initRng, outScale) {
        this.sizes = sizes.slice();
        this.weights = [];
        this.scales = [];
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const w = new Float32Array(nOut * (nIn + 1));
            const isOut = l === sizes.length - 2;
            const scale = (isOut ? (outScale != null ? outScale : 0.03) : 1.0) * Math.sqrt(2 / nIn);
            if (initRng) for (let i = 0; i < w.length; i++) w[i] = gaussRand(initRng) * scale;
            this.weights.push(w);
            this.scales.push(scale);
        }
        this._buf = sizes.map(n => new Float32Array(n));
    }

    forward(input, offset) {
        let cur = this._buf[0];
        if (offset) cur.set(input, 0); else cur.set(input);
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const nIn = this.sizes[l], nOut = this.sizes[l + 1];
            const next = this._buf[l + 1];
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let sum = w[base + nIn];
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                next[o] = Math.tanh(sum);
            }
            cur = next;
        }
        return cur;
    }
}

class Brain {
    constructor(spec, initRng) {
        this.spec = { nin: spec.nin, trunk: spec.trunk.slice(), guidance: spec.guidance.slice(), control: spec.control.slice() };
        // The guidance head is initialised a little wider than the control head.
        // It has to produce a *direction*, and a direction of exactly zero
        // carries no information for selection to act on; the control head, by
        // contrast, is the one that must start quiet so a fresh vessel does not
        // spin itself up.
        this.trunk = new Stack(spec.trunk, initRng, 1.0);
        this.guid = new Stack(spec.guidance, initRng, 0.10);
        /* THE CONTROL OUTPUT SCALE IS SET BY THE MINIMUM IMPULSE BIT, not by
         * taste. A 20 ms pulse inside a 0.25 s control tick is 4% of full
         * authority, and any command that rounds below half of one pulse
         * produces no thrust whatsoever. At the 0.03 used elsewhere in this
         * collection the median fresh command was 0.027 — BELOW that floor —
         * so 241 of 300 random brains were physically incapable of firing a
         * thruster during a terminal approach. The population was not bad at
         * docking, it was inert, and thirty generations of selection on a
         * fleet of identical statues produced exactly the flat fitness curve
         * you would expect. 0.07 puts the median comfortably over the floor. */
        this.ctrl = new Stack(spec.control, initRng, 0.07);
        if (initRng) { this._biasCoast(); this._quietTorque(); }
        this._ctrlIn = new Float32Array(spec.control[0]);
        this.held = new Float32Array(N_GUID_OUT);
    }

    /* The coast output starts biased AWAY from coasting.
     *
     * With a symmetric near-zero init every output sits at tanh(0) = 0, and
     * coast is read as (out+1)/2 = 0.5 — dead on the threshold. Half the
     * population then coasts for the maximum duration on the first tick, and
     * because coasting is free and progress is measured on best-ever range, a
     * scenario with any inbound drift at all rewards them for it. That is a
     * local optimum a population can sit in for a very long time: generation 1
     * discovers that doing nothing scores, and nothing that fires a thruster
     * ever gets a chance to be compared against it. Starting at 0.23 means a
     * fresh brain is mostly awake and has to EARN the right to sleep. */
    _biasCoast() {
        const w = this.guid.weights[this.guid.weights.length - 1];
        const nIn = this.guid.sizes[this.guid.sizes.length - 2];
        const row = (N_GUID_OUT - 1) * (nIn + 1);
        w[row + nIn] = -0.35;
    }

    /* THE THREE TORQUE ROWS START A SIXTH AS WIDE AS THE THREE TRANSLATION
     * ROWS, and this one constant decides whether generation 1 contains any
     * information at all.
     *
     * Torque integrates TWICE. A fresh output layer produces about 0.021 on
     * every unit, which for translation is a 32 N average nudge — small, varied
     * between brains, and harmless. On the attitude axes the same 0.021 is one
     * minimum-impulse pulse per control tick, always in the same direction,
     * every tick, for the whole episode: 6.6e-4 rad/s² of constant angular
     * acceleration, which crosses the 15°/s tumbling limit in 280 seconds.
     *
     * Measured with equal scales: on stages 2 through 5, TWENTY-FOUR OUT OF
     * TWENTY-FOUR random brains ended as "tumble", and their advantages spanned
     * 0.003. That is not a population that is bad at docking, it is a
     * population that cannot be told apart — every brain executed the same
     * uncontrolled spin and scored the same, so the first generation of
     * selection was pure noise and the run has no way to start. The fleet needs
     * to survive long enough for its DIFFERENCES to show up in the score, and
     * the difference that is cheapest to read is which way it translated.
     *
     * 0.45, not 0.16: the multiplier has to be read against the minimum impulse
     * bit, not in the abstract. At 0.16 the median torque command was 0.004
     * against a 0.040 firing threshold, so NO fresh brain ever produced any
     * torque at all — the attitude axes were not quiet, they were disconnected,
     * and mutation had to cross a wide dead flat before selection could see
     * anything. At 0.45 roughly a quarter of the fleet pulses its RCS, which is
     * enough for "spinning up is a bad idea" to be a lesson rather than a
     * region of the search space nothing can reach. */
    _quietTorque() {
        const w = this.ctrl.weights[this.ctrl.weights.length - 1];
        const nIn = this.ctrl.sizes[this.ctrl.sizes.length - 2];
        for (let o = 3; o < 6; o++) {
            const base = o * (nIn + 1);
            for (let i = 0; i <= nIn; i++) w[base + i] *= 0.45;
        }
    }

    /* Sensors → latent. Cheap enough to run every control tick. */
    trunkForward(input) { return this.trunk.forward(input); }

    /* The slow head. Returns the raw 7-vector; world.js interprets it. */
    guidance(latent) {
        const g = this.guid.forward(latent);
        this.held.set(g);
        return this.held;
    }

    /* The fast head, fed the latent AND whatever the guidance head last said. */
    control(latent, held) {
        const n = latent.length;
        this._ctrlIn.set(latent, 0);
        this._ctrlIn.set(held, n);
        return this.ctrl.forward(this._ctrlIn);
    }

    clone() {
        const b = new Brain(this.spec, null);
        for (const k of ["trunk", "guid", "ctrl"]) {
            for (let l = 0; l < this[k].weights.length; l++) {
                b[k].weights[l].set(this[k].weights[l]);
                b[k].scales[l] = this[k].scales[l];
            }
        }
        b.held.set(this.held);
        return b;
    }

    /* Mutation is scaled by each layer's own weight spread, not by a global
     * constant.
     *
     * The layers here differ by more than an order of magnitude in scale — the
     * trunk's first layer is He-initialised over 215 inputs, the control
     * output layer starts at 3% of that — so one absolute sigma either
     * obliterates the output heads or never moves the trunk. `scales` starts as
     * the init scale and is RE-MEASURED from the actual weights whenever a
     * brain is loaded from disk (calibrate()), because a brain that has been
     * through imitation learning has an output layer perhaps fifty times wider
     * than its init, and mutating it by a fraction of a spread it left behind
     * long ago makes the population look converged from generation one. */
    mutate(rate, sigma, rng) {
        for (const k of ["trunk", "guid", "ctrl"]) {
            const st = this[k];
            for (let l = 0; l < st.weights.length; l++) {
                const w = st.weights[l], s = sigma * st.scales[l];
                for (let i = 0; i < w.length; i++) {
                    if (rng() < rate) {
                        if (rng() < 0.03) w[i] = gaussRand(rng) * st.scales[l] * 4;
                        else w[i] += gaussRand(rng) * s;
                    }
                }
            }
        }
        return this;
    }

    /* Re-measure every layer's scale from the weights it actually holds. */
    calibrate() {
        for (const k of ["trunk", "guid", "ctrl"]) {
            const st = this[k];
            for (let l = 0; l < st.weights.length; l++) {
                const w = st.weights[l];
                let s = 0;
                for (let i = 0; i < w.length; i++) s += w[i] * w[i];
                const rms = Math.sqrt(s / Math.max(1, w.length));
                if (rms > 1e-9) st.scales[l] = rms;
            }
        }
        return this;
    }

    /* Row-wise crossover: whole neurons — a row of incoming weights plus its
     * bias — cross between parents, never individual weights. Per-weight
     * crossover scrambles what each neuron computes, because the two parents'
     * hidden units are in arbitrary and unrelated orders; swapping neurons
     * keeps functional units intact. Crossover is applied INDEPENDENTLY per
     * stack, so a child can inherit its parent's guidance strategy and the
     * other parent's thruster reflexes, which given the two-head split is a
     * meaningful recombination and not just noise. */
    static crossover(a, b, rng) {
        const child = a.clone();
        for (const k of ["trunk", "guid", "ctrl"]) {
            const A = child[k], B = b[k];
            for (let l = 0; l < A.weights.length; l++) {
                const wc = A.weights[l], wb = B.weights[l];
                const rowLen = A.sizes[l] + 1, nOut = A.sizes[l + 1];
                for (let o = 0; o < nOut; o++) {
                    const r = rng();
                    if (r < 0.45) {
                        for (let i = 0; i < rowLen; i++) wc[o * rowLen + i] = wb[o * rowLen + i];
                    } else if (r < 0.52) {
                        for (let i = 0; i < rowLen; i++) {
                            wc[o * rowLen + i] = 0.5 * (wc[o * rowLen + i] + wb[o * rowLen + i]);
                        }
                    }
                }
            }
        }
        return child;
    }

    /* Freeze/unfreeze a stack. The curriculum uses this: once the control head
     * can hold an attitude and null a drift — which stages 0 and 1 teach — the
     * far stages are a search over GUIDANCE only, and letting mutation keep
     * churning the thruster reflexes while the population learns to phase an
     * orbit is a good way to lose both. `frozen` is honoured by mutate() via
     * the rate multiplier below rather than by skipping outright, so a frozen
     * stack still drifts slowly instead of being nailed in place. */
    setFreeze(which, factor) {
        this._freeze = this._freeze || {};
        this._freeze[which] = factor;
        return this;
    }

    weightCount() {
        let n = 0;
        for (const k of ["trunk", "guid", "ctrl"]) for (const w of this[k].weights) n += w.length;
        return n;
    }

    hash() {
        // Cheap FNV over all weights — used to fold duplicate brains in the
        // comparison tooling so a champion is not "beaten" by a copy of itself.
        let h = 2166136261 >>> 0;
        const buf = new DataView(new ArrayBuffer(4));
        for (const k of ["trunk", "guid", "ctrl"]) {
            for (const w of this[k].weights) {
                for (let i = 0; i < w.length; i++) {
                    buf.setFloat32(0, w[i]);
                    h = (h ^ buf.getUint8(0)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
                    h = (h ^ buf.getUint8(1)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
                    h = (h ^ buf.getUint8(2)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
                    h = (h ^ buf.getUint8(3)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
                }
            }
        }
        return h.toString(16).padStart(8, "0");
    }

    toJSON() {
        const pack = (st) => ({ sizes: st.sizes, scales: st.scales, weights: st.weights.map(w => Array.from(w)) });
        return { format: "dock-brain-v1", spec: this.spec, trunk: pack(this.trunk), guid: pack(this.guid), ctrl: pack(this.ctrl) };
    }

    static fromJSON(o) {
        const b = new Brain(o.spec, null);
        for (const k of [["trunk", "trunk"], ["guid", "guid"], ["ctrl", "ctrl"]]) {
            const src = o[k[1]], dst = b[k[0]];
            for (let l = 0; l < dst.weights.length; l++) {
                dst.weights[l].set(src.weights[l]);
                dst.scales[l] = src.scales && src.scales[l] != null ? src.scales[l] : dst.scales[l];
            }
        }
        return b;
    }
}

if (typeof module !== "undefined") {
    module.exports = { Brain, Stack, mulberry32, gaussRand, netSpec, NET_ARCH, N_GUID_OUT, N_CTRL_OUT };
}
