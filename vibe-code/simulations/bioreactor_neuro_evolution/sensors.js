/* sensors.js — what the lab actually knows, and the observation built from it.
 *
 * Two kinds of number reach the controller:
 *
 *   ONLINE   every hour, from probes in the vessel: DO, pH, temperature, the
 *            capacitance probe (viable biovolume), off-gas oxygen uptake, and
 *            the colour of the medium. Noisy, and some of them drift.
 *
 *   OFFLINE  when a sample is taken and after the assay has run: metabolites,
 *            cell count and viability, aggregate size, stage markers by flow
 *            cytometry, and the lineage's functional readout. Each arrives
 *            hours after the sample was drawn, and the controller sees the
 *            LAST value and its AGE. Before the first sample the value is zero
 *            and the age is saturated, which the network learns to read as
 *            "unknown".
 *
 * The observation also carries a temporal block — lagged differences of the
 * online channels and two leaky integrals — because a controller that can see
 * the pH but not whether it is falling cannot tell a culture that is spent
 * from one that is about to be. That lesson was learned the hard way on the
 * tokamak sim in this collection.
 *
 * AND IT CARRIES THE ORDER. Eight of the inputs say which of the five
 * products this batch is for and how far through its run it is. The marker
 * channels are generic — m0 is the pluripotency marker and m1…m7 are the
 * stages of whichever chain is running — so the same network reads a
 * cardiomyocyte run and a kidney run through the same wires, and has to learn
 * what m3 means in each. That is the whole point: one controller, five
 * protocols, told which one it is running and nothing else.
 */
"use strict";

const ONLINE_KEYS = ["DO", "pH", "T", "cap", "OUR", "colour"];
const MARKER_KEYS = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"];
const OFFLINE_KEYS = ["glc", "lac", "gln", "nh4", "osm", "viable", "viability", "aggD", "aggCV"]
    .concat(MARKER_KEYS).concat(["func"]);
const LAGS = [1, 3, 6, 12, 24];
const LAG_CH = ["DO", "pH", "cap", "OUR"];
const HIST_LEN = 25;

/* Scaling for the observation: (x − centre) / span, so every channel lands
 * roughly in ±1. These are FIXED by construction of the units, not fitted. */
const SCALE = {
    DO: [40, 30], pH: [7.3, 0.25], T: [37, 2], cap: [1.5, 1.5], OUR: [0.15, 0.15], colour: [0.5, 0.5],
    glc: [8, 8], lac: [12, 12], gln: [1.5, 1.5], nh4: [2, 2], osm: [320, 40],
    viable: [1.5, 1.5], viability: [0.8, 0.2], aggD: [250, 150], aggCV: [0.25, 0.15],
    func: [0.5, 0.5]
};
for (const k of MARKER_KEYS) SCALE[k] = [0.5, 0.5];

class Lab {
    /* rng: the sensor-noise stream; identical for every unit in a generation. */
    constructor(scn, rng) {
        this.scn = scn;
        this.lin = scn.lin;
        this.rng = rng;
        this.online = {};
        this.offline = {};        // key → {value, tSample}
        this.pending = [];        // samples in the assay queue
        this.hist = [];           // ring of online readings, one per tick
        this.intPH = 0; this.intDO = 0;
        this.prevOffline = {};    // previous value per key, for rates of change
        this.lastCue = new Float64Array(N_CUE).fill(-999);
        this.tookSamples = 0;
    }

    _g() {
        let u = 0, v = 0;
        while (u === 0) u = this.rng();
        while (v === 0) v = this.rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    /* Read the probes at hour t (integer). */
    readOnline(r, t) {
        const f = probeFaultsAt(this.scn, t);
        const S = r.lin.stages;
        let capVol = 0;
        for (let i = 0; i < r.nc; i++) capVol += r.N[i] * S[i].vol;
        const o = {
            DO: Math.max(0, r.DO * f.doGain + 1.5 * this._g()),
            pH: r.pH + f.pHOffset + 0.01 * this._g(),
            T: r.T + 0.05 * this._g(),
            // capacitance reads viable biovolume; it is reported in
            // "pluripotent-cell equivalents" and a culture of big mature cells
            // therefore reads high — the operator knows that
            cap: Math.max(0, capVol / 900 * f.capGain * (1 + 0.03 * this._g())),
            OUR: Math.max(0, r.OUR * (1 + 0.05 * this._g())),
            colour: r.colour()
        };
        this.online = o;
        this.hist.push(o);
        if (this.hist.length > HIST_LEN) this.hist.shift();
        // leaky integrals, 12 h time constant
        const k = 1 / 12;
        this.intPH += k * ((o.pH - 7.3) - this.intPH);
        this.intDO += k * ((o.DO - 40) - this.intDO);
        return o;
    }

    /* Take whatever samples the calendar says are due at hour t. */
    sample(r, t) {
        const due = assaysDueAt(this.scn, t);
        const L = r.lin;
        for (const name of due) {
            const a = ASSAYS[name];
            const v = {};
            const Nv = r.Nv;
            const g = () => this._g();
            switch (name) {
                case "metabolites":
                    v.glc = Math.max(0, r.glc * (1 + 0.03 * g()) + 0.1 * g());
                    v.lac = Math.max(0, r.lac * (1 + 0.03 * g()) + 0.1 * g());
                    v.gln = Math.max(0, r.gln * (1 + 0.04 * g()) + 0.05 * g());
                    v.nh4 = Math.max(0, r.nh4 * (1 + 0.05 * g()) + 0.05 * g());
                    v.osm = r.osm + 3 * g();
                    break;
                case "counts":
                    v.viable = Math.max(0, Nv * (1 + 0.08 * g()));
                    v.viability = Math.max(0, Math.min(1, r.viability + 0.03 * g()));
                    v.aggD = Math.max(20, r.d * (1 + 0.08 * g()));
                    v.aggCV = Math.max(0.05, 0.22 + 0.15 * Math.max(0, 1 - r.A / (r.Nv * 1e3 / L.agg.nSeed + 1e-6)) + 0.03 * g());
                    break;
                case "flow": {
                    /* One marker per stage, in slots m0…m7. The map from a
                     * compartment to the thing a cytometer sees is approximate
                     * on purpose: a marker is never clean. Each reads mostly
                     * its own stage with a little of the neighbouring one,
                     * ±3 % absolute noise, and slots past the end of this
                     * lineage's chain read zero. */
                    const fr = (i) => Nv > 1e-9 ? r.N[i] / Nv : 0;
                    const fl = (x) => Math.max(0, Math.min(1, x + 0.03 * g()));
                    for (let k = 0; k < MARKER_KEYS.length; k++) {
                        if (k >= L.nStage) { v[MARKER_KEYS[k]] = 0; continue; }
                        const own = fr(k);
                        const younger = k > 0 ? fr(k - 1) : 0;
                        const older = k + 1 < L.nStage ? fr(k + 1) : 0;
                        v[MARKER_KEYS[k]] = fl(0.92 * own + 0.10 * younger + 0.06 * older);
                    }
                    v.func = Math.max(0, Math.min(1, r.funcValue() + 0.04 * g()));
                    break;
                }
            }
            this.pending.push({ name, values: v, tSample: t, tReady: t + a.delay });
            this.tookSamples++;
        }
        // deliver what is ready
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const p = this.pending[i];
            if (t >= p.tReady) {
                for (const k of Object.keys(p.values)) {
                    if (this.offline[k]) this.prevOffline[k] = this.offline[k];
                    this.offline[k] = { value: p.values[k], tSample: p.tSample };
                }
                this.pending.splice(i, 1);
            }
        }
    }

    latest(key) { return this.offline[key] ? this.offline[key].value : null; }
    age(key, t) { return this.offline[key] ? t - this.offline[key].tSample : 999; }

    noteAction(act, t) {
        for (let i = 0; i < N_CUE; i++) if (act.cue[i] > 0.02 * (this.lin.cues[i] ? this.lin.cues[i].hi : 1)) this.lastCue[i] = t;
    }
}

/* ------------------------------------------------------------ observation */
/* Layout, in order:
 *   clock & calendar      4
 *   the order             6   (which of five products, and days left)
 *   online                6
 *   actuator echo        15   (6 process knobs + 6 cue levels + medium one-hot)
 *   dosing history       12   (per channel: hours since dosed, level in vessel)
 *   offline value+age    36   (18 keys)
 *   temporal             24   (5 lags × 4 channels, 2 integrals, 2 offline rates)
 */
const N_CLOCK = 4, N_ORDER = N_LIN + 1, N_ONLINE = ONLINE_KEYS.length;
const N_ECHO = N_BASE + N_CUE + N_MED, N_DOSE = N_CUE * 2;
const N_OFF = OFFLINE_KEYS.length * 2, N_TEMP = LAGS.length * LAG_CH.length + 4;
const N_IN = N_CLOCK + N_ORDER + N_ONLINE + N_ECHO + N_DOSE + N_OFF + N_TEMP;
const NET_SIZES = [N_IN, 96, 48, N_OUT];

function sc(key, v) { const s = SCALE[key]; return (v - s[0]) / s[1]; }
const cl3 = (x) => Math.max(-3, Math.min(3, x));

function observe(lab, r, t, out) {
    const o = out || new Float32Array(N_IN);
    let i = 0;
    const scn = lab.scn, L = r.lin, H = scn.hours;
    const c = calendarAt(scn, t);
    // clock & calendar
    o[i++] = t / H * 2 - 1;
    o[i++] = (c.hod - 12) / 12;
    o[i++] = c.labOpen ? 1 : -1;
    o[i++] = Math.min(1, hoursToLab(scn, t) / 48) * 2 - 1;
    // the order: which product, and how many days are left
    for (let k = 0; k < N_LIN; k++) o[i++] = k === L.idx ? 1 : -1;
    o[i++] = Math.min(1, (H - t) / 240) * 2 - 1;
    // online
    const on = lab.online;
    for (const k of ONLINE_KEYS) o[i++] = cl3(sc(k, on[k]));
    // actuator echo
    const a = r.act;
    for (const s of ACT_BASE) o[i++] = (a[s.key] - s.lo) / (s.hi - s.lo) * 2 - 1;
    for (let k = 0; k < N_CUE; k++) o[i++] = L.cues[k] ? a.cue[k] / L.cues[k].hi * 2 - 1 : -1;
    for (let m = 0; m < N_MED; m++) o[i++] = a.medium === m ? 1 : -1;
    // dosing history: when each channel last ran, and what is still in the vessel
    for (let k = 0; k < N_CUE; k++) {
        o[i++] = Math.min(1, (t - lab.lastCue[k]) / 96) * 2 - 1;
        o[i++] = L.cues[k] ? Math.min(2, r.cue[k] / (1.5 * L.cues[k].ec50)) - 1 : -1;
    }
    // offline: value (0 if unknown) and age (saturating at 48 h)
    for (const k of OFFLINE_KEYS) {
        const v = lab.latest(k);
        o[i++] = v == null ? 0 : cl3(sc(k, v));
        o[i++] = Math.min(1, lab.age(k, t) / 48) * 2 - 1;
    }
    // temporal: lagged differences of the online channels
    const h = lab.hist, n = h.length;
    for (const k of LAG_CH) {
        const s = SCALE[k][1];
        for (const Lg of LAGS) {
            const past = n > Lg ? h[n - 1 - Lg][k] : (n ? h[0][k] : on[k]);
            o[i++] = cl3((on[k] - past) / s);
        }
    }
    o[i++] = cl3(lab.intPH / 0.25);
    o[i++] = cl3(lab.intDO / 30);
    // rate of change of the last two offline metabolite samples
    for (const k of ["glc", "lac"]) {
        const cur = lab.offline[k], prev = lab.prevOffline[k];
        if (cur && prev && cur.tSample > prev.tSample) {
            const rate = (cur.value - prev.value) / (cur.tSample - prev.tSample);   // mM/h
            o[i++] = cl3(rate / 0.5);
        } else o[i++] = 0;
    }
    if (i !== N_IN) throw new Error(`observation is ${i} wide, expected ${N_IN}`);
    return o;
}

/* What each input is, for the network view on the page. One entry per input,
 * in the same order, so the diagram can label the bands without knowing
 * anything about the layout. */
function inputGroups(L) {
    const lin = L || LINEAGES[0];
    const g = [];
    g.push({ label: "clock & calendar", n: N_CLOCK, detail: "how far through the run, time of day, is the lab open, how long until it is" });
    g.push({ label: "the order", n: N_ORDER, detail: "which of the five products this batch is for, and how many days are left" });
    g.push({ label: "probes, now", n: N_ONLINE, detail: "oxygen, pH, temperature, capacitance, off-gas, medium colour" });
    g.push({ label: "what it just did", n: N_ECHO, detail: "its own last command, echoed back" });
    g.push({ label: "dosing history", n: N_DOSE, detail: "per pump: hours since it last ran, and what is still in the vessel" });
    g.push({ label: "lab results + age", n: N_OFF, detail: "every offline assay and how old it is — zero means never sampled" });
    g.push({ label: "trends", n: N_TEMP, detail: "the probes differenced against 1, 3, 6, 12 and 24 h ago, two leaky integrals, two assay slopes" });
    return g;
}

if (typeof module !== "undefined") {
    module.exports = {
        Lab, observe, N_IN, NET_SIZES, ONLINE_KEYS, OFFLINE_KEYS, MARKER_KEYS, LAGS, LAG_CH,
        SCALE, inputGroups
    };
}
