// Demand and renewable output. No data files, no recorded traces - every number
// in an episode is generated from the seed, which is what makes common random
// numbers possible (every genome in a generation gets the identical day) and
// what makes a held-out benchmark mean something (a day nobody trained on).
//
// The three processes are built the way the physical quantity actually behaves,
// not as noise around a sine wave:
//
//   LOAD    base x diurnal shape by customer class x weekly modulation x an
//           Ornstein-Uhlenbeck deviation with a two-hour memory, split into a
//           system-wide common factor and a per-bus idiosyncratic one, plus
//           occasional ramp events (an arc furnace, an interconnector schedule).
//   SOLAR   clear-sky irradiance from orbital geometry - Spencer's declination
//           and equation of time, Kasten-Young air mass, a Hottel beam
//           transmittance - multiplied by a clearness index that is
//           beta-distributed with the right mean for the site and autocorrelated
//           over about an hour. The geometry is exact; the sky is random.
//   WIND    an AR(1) process in gaussian space pushed through the normal CDF
//           into a uniform and then through the inverse Weibull CDF, so the
//           marginal is exactly Weibull and the autocorrelation lands where it
//           was asked for. That series then goes through a manufacturer power
//           curve with cut-in, rated, cut-out and restart hysteresis.
//
// The whole episode is generated at reset(). That costs nothing and buys the
// thing that matters: a forecast can be the true future plus an error, which is
// what a forecast is, rather than a persistence guess dressed up as one.
'use strict';

const WX = {
    DT_MIN: 5,                 // one dispatch interval
    LAT: 53.4 * Math.PI / 180, // northern Europe: a big seasonal solar swing
    LON_DEG: -2.2,
    TZ_DEG: 0,
    SOLAR_DERATE: 0.94,        // module temperature and soiling
    WIND_K: 2.05,              // Weibull shape at hub height
    WIND_C: 9.4,               // Weibull scale, m/s
    CUT_IN: 3.5, RATED: 12.5, CUT_OUT: 25.0, RESTART: 21.5,
    OU_TAU_H: 2.0,             // load noise memory
    KT_RHO: 0.93,              // clearness index AR(1) per 5 min (~1.2 h memory)
    WIND_RHO_SLOW: 0.9855,     // synoptic, ~5.5 h
    WIND_RHO_FAST: 0.84        // gusts, ~25 min
};

// --- solar geometry ---------------------------------------------------------
// Spencer (1971) Fourier fits. Deterministic: given the day of the year and the
// hour, this is where the sun is, and no amount of weather changes it.
function solarDeclination(dayOfYear) {
    const g = 2 * Math.PI * (dayOfYear - 1) / 365;
    return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
        - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
        - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
}

function equationOfTime(dayOfYear) {
    const g = 2 * Math.PI * (dayOfYear - 1) / 365;
    return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
        - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));   // minutes
}

// Clear-sky global horizontal irradiance, W/m^2. Beam via Hottel's transmittance
// through a Kasten-Young air mass, diffuse as a fixed fraction of the beam -
// crude for a radiometer, more than good enough for a power curve.
function clearSkyGHI(dayOfYear, hourLocal) {
    const dec = solarDeclination(dayOfYear);
    const eot = equationOfTime(dayOfYear);
    const solarTime = hourLocal + (4 * (WX.LON_DEG - WX.TZ_DEG) + eot) / 60;
    const omega = (solarTime - 12) * 15 * Math.PI / 180;
    const cosZ = Math.sin(WX.LAT) * Math.sin(dec) + Math.cos(WX.LAT) * Math.cos(dec) * Math.cos(omega);
    if (cosZ <= 0.015) return 0;
    const zDeg = Math.acos(Math.min(1, cosZ)) * 180 / Math.PI;
    const m = 1 / (cosZ + 0.50572 * Math.pow(96.07995 - zDeg, -1.6364));
    const g0 = 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * dayOfYear / 365));
    const beam = g0 * Math.pow(0.72, Math.pow(m, 0.678));
    return Math.max(0, beam * cosZ * 1.11);
}

// --- wind turbine power curve -----------------------------------------------
// The cut-out is the part that matters. A storm does not ramp a wind farm down;
// it switches it off, and the whole fleet in one weather system goes at once.
function turbinePower(v, cutOutState) {
    if (cutOutState) return v < WX.RESTART ? -1 : 0;   // -1 = restart permitted
    if (v < WX.CUT_IN) return 0;
    if (v >= WX.CUT_OUT) return -2;                    // -2 = cut out now
    if (v >= WX.RATED) return 1;
    const a = v * v * v - WX.CUT_IN * WX.CUT_IN * WX.CUT_IN;
    const b = WX.RATED * WX.RATED * WX.RATED - WX.CUT_IN * WX.CUT_IN * WX.CUT_IN;
    return Math.max(0, Math.min(1, a / b));
}

// --- diurnal load shapes ----------------------------------------------------
// Three customer classes, because a network whose buses all peak at the same
// instant has no interesting redispatch in it.
//
// Each shape is NORMALISED to a daily mean of exactly one, and the amplitudes
// are set so the residential peak lands around 1.33x its own daily mean, which
// is what a real distribution feeder does. Getting this wrong is not cosmetic:
// the first version of this file peaked at 1.64x mean without normalisation,
// which stacked with the per-episode scale to put 1.7x nominal load on networks
// whose thermal ratings had been sized against a 1.34x study case. Every larger
// network then collapsed on its opening interval and it looked like a solver
// bug.
function rawLoadShape(cls, h) {
    const bump = (c, w, a) => a * Math.exp(-0.5 * Math.pow((h - c) / w, 2));
    if (cls === 0) {           // residential: morning and a bigger evening peak
        return 0.78 + bump(7.6, 1.6, 0.15) + bump(19.4, 2.4, 0.32) + bump(13.0, 2.8, 0.06);
    }
    if (cls === 1) {           // commercial: a broad working-day plateau
        const on = 1 / (1 + Math.exp(-(h - 7.2) * 1.5));
        const off = 1 / (1 + Math.exp((h - 18.6) * 1.2));
        return 0.62 + 0.44 * on * off + bump(12.5, 2.0, 0.05);
    }
    // industrial: near flat, shift changes visible, a real dip only at night
    return 0.92 + bump(10, 3.4, 0.10) + bump(15, 3.0, 0.09) - bump(3.5, 2.6, 0.11);
}

const SHAPE_MEAN = [0, 1, 2].map(cls => {
    let s = 0;
    for (let i = 0; i < 480; i++) s += rawLoadShape(cls, i * 24 / 480);
    return s / 480;
});

function loadShape(cls, hour) {
    const h = ((hour % 24) + 24) % 24;
    return rawLoadShape(cls, h) / SHAPE_MEAN[cls];
}

function weeklyFactor(cls, dayOfWeek) {
    const sat = dayOfWeek === 5, sun = dayOfWeek === 6;
    if (cls === 0) return sun ? 1.04 : sat ? 1.02 : 1.0;
    if (cls === 1) return sun ? 0.62 : sat ? 0.78 : 1.0;
    return sun ? 0.80 : sat ? 0.90 : 1.0;
}

// --- tabulated inverse CDFs -------------------------------------------------
// The clearness index needs an inverse incomplete beta, which has no closed
// form and costs a bisection over a continued fraction. Called once per solar
// farm per interval it was, measured, a quarter of the whole simulator.
//
// So it is tabulated: evaluate the FORWARD cdf on a grid of x once, then invert
// that grid by interpolation. 512 forward evaluations replace tens of thousands
// of bisections, the table is keyed on the beta parameters - which are fixed per
// tier - and cached for the process, so in a whole training run it is built
// about six times.
const BETA_TABLES = new Map();

function betaInverseTable(a, b) {
    const key = a.toFixed(4) + ',' + b.toFixed(4);
    let t = BETA_TABLES.get(key);
    if (t) return t;
    const M = 512, N = 257;
    const xs = new Float64Array(M + 1), cdf = new Float64Array(M + 1);
    for (let i = 0; i <= M; i++) {
        xs[i] = i / M;
        cdf[i] = betaCdf(xs[i], a, b);
    }
    for (let i = 1; i <= M; i++) if (cdf[i] < cdf[i - 1]) cdf[i] = cdf[i - 1];
    t = new Float64Array(N);
    let j = 0;
    for (let k = 0; k < N; k++) {
        const u = (k + 0.5) / N;
        while (j < M && cdf[j + 1] < u) j++;
        const lo = cdf[j], hi = cdf[j + 1];
        const f = hi > lo ? (u - lo) / (hi - lo) : 0;
        t[k] = xs[j] + (xs[j + 1] - xs[j]) * f;
    }
    if (BETA_TABLES.size > 64) BETA_TABLES.clear();
    BETA_TABLES.set(key, t);
    return t;
}

function lookupInverse(table, u) {
    const n = table.length;
    const x = clamp(u, 0, 1) * n - 0.5;
    if (x <= 0) return table[0];
    if (x >= n - 1) return table[n - 1];
    const i = x | 0, f = x - i;
    return table[i] + (table[i + 1] - table[i]) * f;
}

// --- the generator ----------------------------------------------------------
class Weather {
    constructor(net, spec) {
        this.net = net;
        this.spec = spec || {};
        this.steps = 0;
    }

    // Generate a whole episode. Everything downstream reads arrays; nothing
    // downstream draws a random number, which is what keeps two genomes on the
    // same seed byte-identical.
    reset(seed, nSteps) {
        const net = this.net, spec = this.spec;
        const rng = mulberry32(seed >>> 0);
        this.steps = nSteps;
        this.seed = seed >>> 0;

        this.dayOfYear = 1 + Math.floor(rng() * 365);
        this.dayOfWeek = Math.floor(rng() * 7);
        this.startHour = Math.floor(rng() * 24);
        this.loadScale = (spec.loadScale || 1) * (0.94 + rng() * 0.14);
        const vol = spec.loadVol === undefined ? 1 : spec.loadVol;

        const nB = net.nBus, nG = net.nGen, T = nSteps;
        this.pd = new Float64Array(T * nB);
        this.qd = new Float64Array(T * nB);
        this.renew = new Float64Array(T * nG);
        this.ghi = new Float64Array(T);
        this.windSpeed = new Float64Array(T);
        this.totLoad = new Float64Array(T);
        this.totRenew = new Float64Array(T);

        // --- load: one common factor plus per-bus idiosyncratic OU -----------
        const dtH = WX.DT_MIN / 60;
        const a = Math.exp(-dtH / WX.OU_TAU_H);
        const sdCommon = 0.030 * vol, sdBus = 0.045 * vol;
        let common = gaussian(rng) * sdCommon;
        const busOU = new Float64Array(nB);
        for (let s = 0; s < nB; s++) busOU[s] = gaussian(rng) * sdBus;
        // Per-bus power factor drift: reactive demand is not a fixed multiple of
        // real demand, and the difference is where the voltage problems live.
        const pfDrift = new Float64Array(nB);
        for (let s = 0; s < nB; s++) pfDrift[s] = 0.9 + rng() * 0.25;

        // Ramp events: a Poisson number of them over the episode, each landing on
        // one bus, ramping over 15-45 minutes and holding for up to three hours.
        const events = [];
        const lam = (spec.rampEvents || 0);
        let nEvents = 0;
        {
            let p = Math.exp(-lam), cum = p, u = rng(), k = 0;
            while (u > cum && k < 12) { k++; p *= lam / k; cum += p; }
            nEvents = k;
        }
        const bigBuses = [];
        for (let s = 0; s < nB; s++) if (net.bus[s].pd0 > 0) bigBuses.push(s);
        for (let e = 0; e < nEvents && bigBuses.length; e++) {
            const bus = bigBuses[Math.floor(rng() * bigBuses.length)];
            events.push({
                bus,
                t0: Math.floor(rng() * Math.max(1, T - 12)),
                ramp: 3 + Math.floor(rng() * 7),                 // 15-45 min
                hold: 6 + Math.floor(rng() * 30),                // 30 min - 2.5 h
                mag: (rng() < 0.62 ? 1 : -1) * (0.18 + rng() * 0.55)
            });
        }
        this.events = events;

        // --- clearness index: AR(1) in gaussian space, beta marginal ---------
        const cloud = spec.cloudiness === undefined ? 1 : spec.cloudiness;
        // A clearer site has a higher beta mean and a tighter spread; a cloudy
        // one has a low mean and the characteristic bimodal fat tail.
        //
        // The beta parameters are fixed for the whole episode, so the inverse
        // CDF is tabulated once on a quantile grid and interpolated afterwards.
        // Inverting the incomplete beta by bisection at every farm at every
        // interval was, measured, a quarter of the entire simulator's runtime.
        const kA = Math.max(1.1, 5.6 / cloud), kB = Math.max(1.0, 1.55 * cloud);
        const KT_TABLE = betaInverseTable(kA, kB);
        let zSkyCommon = gaussian(rng);
        const zSkyFarm = new Float64Array(nG);
        for (let g = 0; g < nG; g++) zSkyFarm[g] = gaussian(rng);

        // --- wind: slow synoptic plus fast gust, both AR(1) -------------------
        const wMean = spec.windMean === undefined ? 1 : spec.windMean;
        const wc = WX.WIND_C * wMean * (0.85 + rng() * 0.3);
        let zwSlow = gaussian(rng), zwFast = gaussian(rng);
        const zwFarm = new Float64Array(nG);
        for (let g = 0; g < nG; g++) zwFarm[g] = gaussian(rng);
        const cutState = new Uint8Array(nG);
        // Farms are correlated by distance: the same weather system crosses them
        // all, an hour or two apart.
        const farmW = new Float64Array(nG);
        for (const g of net.gen) farmW[g.id] = 0.62 + 0.3 * net.bus[g.bus].x;

        for (let t = 0; t < T; t++) {
            const hour = this.startHour + t * dtH;
            const day = this.dayOfYear + Math.floor(hour / 24);
            const dow = (this.dayOfWeek + Math.floor(hour / 24)) % 7;
            const hLocal = hour % 24;

            common = common * a + gaussian(rng) * sdCommon * Math.sqrt(1 - a * a);
            let tot = 0;
            for (let s = 0; s < nB; s++) {
                busOU[s] = busOU[s] * a + gaussian(rng) * sdBus * Math.sqrt(1 - a * a);
                const bus = net.bus[s];
                if (bus.pd0 === 0 && bus.qd0 === 0) continue;
                let mul = loadShape(bus.loadClass, hLocal) * weeklyFactor(bus.loadClass, dow);
                mul *= (1 + common + busOU[s]);
                for (const ev of events) {
                    if (ev.bus !== s) continue;
                    const dt = t - ev.t0;
                    if (dt < 0) continue;
                    let f = 0;
                    if (dt < ev.ramp) f = dt / ev.ramp;
                    else if (dt < ev.ramp + ev.hold) f = 1;
                    else if (dt < ev.ramp * 2 + ev.hold) f = 1 - (dt - ev.ramp - ev.hold) / ev.ramp;
                    mul *= 1 + ev.mag * f;
                }
                mul = Math.max(0.05, mul) * this.loadScale;
                const p = bus.pd0 * mul;
                this.pd[t * nB + s] = p;
                this.qd[t * nB + s] = bus.qd0 * mul * pfDrift[s];
                tot += p;
            }
            this.totLoad[t] = tot;

            // Sky
            zSkyCommon = zSkyCommon * WX.KT_RHO + gaussian(rng) * Math.sqrt(1 - WX.KT_RHO * WX.KT_RHO);
            const csGHI = clearSkyGHI(day, hLocal);
            this.ghi[t] = csGHI;

            // Wind
            zwSlow = zwSlow * WX.WIND_RHO_SLOW + gaussian(rng) * Math.sqrt(1 - WX.WIND_RHO_SLOW * WX.WIND_RHO_SLOW);
            zwFast = zwFast * WX.WIND_RHO_FAST + gaussian(rng) * Math.sqrt(1 - WX.WIND_RHO_FAST * WX.WIND_RHO_FAST);
            const zwSys = 0.86 * zwSlow + 0.5 * zwFast;
            this.windSpeed[t] = weibullInv(normCdf(zwSys / Math.hypot(0.86, 0.5)), WX.WIND_K, wc);

            let totR = 0;
            for (let gi = 0; gi < nG; gi++) {
                const g = net.gen[gi];
                if (!g.renew) continue;
                if (g.kind === 'solar') {
                    zSkyFarm[gi] = zSkyFarm[gi] * 0.86 + gaussian(rng) * Math.sqrt(1 - 0.86 * 0.86);
                    const z = 0.78 * zSkyCommon + 0.62 * zSkyFarm[gi];
                    const kt = lookupInverse(KT_TABLE, normCdf(z / Math.hypot(0.78, 0.62)));
                    const ghi = csGHI * kt;
                    const p = g.pmax * Math.min(1, ghi / 950) * WX.SOLAR_DERATE;
                    this.renew[t * nG + gi] = Math.max(0, p);
                } else {
                    zwFarm[gi] = zwFarm[gi] * 0.93 + gaussian(rng) * Math.sqrt(1 - 0.93 * 0.93);
                    const w = farmW[gi];
                    const z = (zwSys * w + zwFarm[gi] * 0.55) / Math.hypot(w, 0.55);
                    const v = weibullInv(normCdf(z), WX.WIND_K, wc);
                    const pc = turbinePower(v, cutState[gi]);
                    let frac;
                    if (pc === -2) { cutState[gi] = 1; frac = 0; }
                    else if (pc === -1) { cutState[gi] = 0; frac = turbinePower(v, 0); }
                    else if (cutState[gi]) frac = 0;
                    else frac = pc;
                    if (frac < 0) frac = 0;
                    // Wake losses and availability: a farm never makes nameplate.
                    this.renew[t * nG + gi] = g.pmax * frac * 0.93;
                }
                totR += this.renew[t * nG + gi];
            }
            this.totRenew[t] = totR;
        }

        // --- forecasts -------------------------------------------------------
        // The true future plus an error that grows with horizon, drawn ONCE per
        // episode so a controller cannot average the noise away by asking twice.
        this.fc = {};
        for (const h of [6, 24]) {                    // 30 min and 2 h ahead
            const errL = new Float64Array(T), errR = new Float64Array(T);
            const sL = 0.012 * Math.sqrt(h), sR = 0.07 * Math.sqrt(h);
            let eL = gaussian(rng) * sL, eR = gaussian(rng) * sR;
            for (let t = 0; t < T; t++) {
                eL = eL * 0.9 + gaussian(rng) * sL * Math.sqrt(1 - 0.81);
                eR = eR * 0.9 + gaussian(rng) * sR * Math.sqrt(1 - 0.81);
                const j = Math.min(T - 1, t + h);
                errL[t] = this.totLoad[j] * (1 + eL);
                errR[t] = Math.max(0, this.totRenew[j] * (1 + eR));
            }
            this.fc['load' + h] = errL;
            this.fc['renew' + h] = errR;
        }
        return this;
    }

    loadAt(t, out) {
        const nB = this.net.nBus;
        const tt = Math.min(this.steps - 1, Math.max(0, t));
        for (let s = 0; s < nB; s++) {
            out.pd[s] = this.pd[tt * nB + s];
            out.qd[s] = this.qd[tt * nB + s];
        }
    }

    renewAt(t, out) {
        const nG = this.net.nGen;
        const tt = Math.min(this.steps - 1, Math.max(0, t));
        for (let g = 0; g < nG; g++) out[g] = this.renew[tt * nG + g];
    }
}

if (typeof module !== 'undefined') {
    module.exports = {
        WX, Weather, solarDeclination, equationOfTime, clearSkyGHI,
        turbinePower, loadShape, weeklyFactor, betaInverseTable, lookupInverse
    };
}
