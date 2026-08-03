// The control room. One step is one five-minute dispatch interval, and in that
// interval the world does what a real one does, in this order:
//
//   1. the weather and the demand move
//   2. scheduled and forced outages land
//   3. the operator sees the last SCADA snapshot - not the new one - and acts
//   4. the market's economic dispatch is recomputed and the operator's
//      deviation is layered on top of it, ramp-limited
//   5. frequency response distributes whatever is left over
//   6. the AC power flow is solved, per island
//   7. protection integrates the thermal overloads and trips what it must,
//      and the flow is re-solved; repeat until nothing more trips
//   8. islands that cannot balance shed load in blocks
//   9. an N-1 screen runs over every remaining branch
//  10. the money is counted
//
// Step 3 is the one that makes this a control problem: the operator is always
// acting on the state before its own action, which is why an aggressive
// controller oscillates and a cautious one drifts into the wall.
//
// Everything in the score is denominated in euros, so a run's fitness is the
// operating margin of the control room over the episode. Everything that is a
// CONSTRAINT VIOLATION - overload duration, voltage excursions, N-1 insecurity -
// is counted separately and, apart from the overload risk charge the brief
// specifies, is never folded into the reward. That separation is the point: a
// score that already contains the security metric cannot be used to ask whether
// security was learned.
'use strict';

const SIM = {
    DT_MIN: 5,
    DT_H: 5 / 60,

    TARIFF: 70,           // EUR per MWh delivered to customers
    VOLL: 3000,           // EUR per MWh not delivered (aggregate value of lost load)
    // EUR per hour per unit of sum-of-squared excess loading - the risk charge
    // the brief specifies. The coefficient is a choice, and this one is set so
    // the exchange rate is the one a real control room works to: holding a line
    // at 115% costs about EUR 9 000 an hour, and the redispatch that would clear
    // it costs about EUR 1 200, so preventive action pays and doing it when
    // nothing is binding does not. Set it near zero and the optimal policy is to
    // wait for the relay; set it far higher and the operator redispatches
    // against imaginary problems.
    RISK: 350000,
    BLACKOUT: 120000,     // EUR, one-off, on system collapse

    LINE_TRIP_CD: 12,     // steps out after a protection trip (1 hour)
    SWITCH_CD: 6,         // steps before the same line may be switched again
    SUB_CD: 8,            // steps before the same substation may be reconfigured
    GEN_TRIP_CD: 24,
    RECLOSE_LIMIT: 3,     // trips on overload before the relay locks the line out

    // EUR per breaker operation. Switching was free, and a free lever is an
    // economics bug of exactly the kind that has bitten this simulation three
    // times already. With no price on it a genome can thrash the topology at no
    // cost and keep whatever it happens to win: the champion at generation 35
    // was operating breakers ten times a day on stressed days and four times a
    // day on days when nothing whatever was wrong, caused more line trips than
    // doing nothing at all (1.35 vs 0.60 per day), and was still winning
    // training generations - because on most days thrashing is merely harmless,
    // and on the rest it occasionally got lucky.
    //
    // 2500 is set against the two things it has to sit between. Ten operations a
    // day is 25k against a daily margin of about 150k, which is a real bill. One
    // justified operation is 2.5k against a cascade that costs 700k, which is
    // nothing. That is the whole intent: switching should be an instrument of
    // last resort, not a tic. The real cost in a control room is not the breaker
    // anyway, it is the risk of operating it and the person who has to authorise
    // it, which is why every operations manual in the industry minimises the
    // count.
    SWITCH_COST: 2500,

    HEAT_RATE: 0.30,      // thermal accumulation per step at loading 1.0+
    INST_TRIP: 1.55,      // instantaneous overcurrent: no time delay above this
    HEAT_COOL: 0.16,
    CASCADE_MAX: 8,

    SHED_BLOCK: 0.05,     // under-frequency load shedding, per block
    COLLAPSE_VM: 0.72,    // below this the case is called collapsed
    BLACKOUT_FRAC: 0.40,  // served below this fraction of demand ends the episode

    VM_LO: 0.94, VM_HI: 1.06
};

// --- observation container --------------------------------------------------
function makeObs(net) {
    return {
        net,
        global: new Float64Array(GLOBAL_CH),
        node: new Float64Array(net.nBus * NODE_CH),
        edge: new Float64Array(net.nBranch * 2 * EDGE_CH),
        gen: new Float64Array(net.nGen * GEN_CH),
        elem: net.subs.map(s => new Float64Array(Math.max(1, s.elems.length) * ELEM_CH))
    };
}

class World {
    constructor(net, opts) {
        this.net = net;
        this.opts = Object.assign({
            steps: (net.spec && net.spec.steps) || 144,
            n1Weight: 0,          // N-1 insecurity is REPORTED, not paid for
            loadScale: 1,
            incidents: true
        }, opts || {});
        this.wx = new Weather(net, net.spec);
        this.obs = makeObs(net);
        this.emb = new Embedding(net);
        this.fdCache = new Map();
        this.dcCache = new Map();
        const nB = net.nBus, nBr = net.nBranch, nG = net.nGen;
        this.st = {
            status: new Uint8Array(nBr),
            manual: new Uint8Array(nBr),
            heat: new Float64Array(nBr),
            cd: new Int16Array(nBr),
            repair: new Int16Array(nBr),
            reclose: new Uint8Array(nBr),
            topo: defaultTopo(net),
            subCd: new Int16Array(nB),
            pg: new Float64Array(nG),
            qg: new Float64Array(nG),
            base: new Float64Array(nG),
            redisp: new Float64Array(nG),
            curtail: new Float64Array(nG),
            genOn: new Uint8Array(nG),
            genCd: new Int16Array(nG),
            shed: new Float64Array(nB),
            pd: new Float64Array(nB),
            qd: new Float64Array(nB),
            renewAvail: new Float64Array(nG),
            vm: new Float64Array(nB * 2),
            va: new Float64Array(nB * 2)
        };
        this.flows = {
            pf: new Float64Array(nBr), qf: new Float64Array(nBr),
            pt: new Float64Array(nBr), qt: new Float64Array(nBr),
            sMax: new Float64Array(nBr), load: new Float64Array(nBr)
        };
        this.n1 = {
            worst: 0, worstBranch: -1, worstOutage: -1, nViolating: 0, nIslanding: 0,
            perBranch: new Float64Array(nBr), perOutage: new Float64Array(nBr)
        };
        this.scaleMW = Math.max(60, net.totalLoad);
        this.events = [];
    }

    // --- episode setup ------------------------------------------------------
    reset(seed, controller) {
        const net = this.net, st = this.st;
        this.seed = seed >>> 0;
        this.t = 0;
        this.steps = this.opts.steps | 0;
        this.done = false;
        this.blackout = false;
        this.blackoutStep = -1;
        this.controller = controller || null;
        this.events.length = 0;
        this.trace = [];

        const rng = mulberry32(mixSeed(seed, 0x9911));
        this.wx.reset(mixSeed(seed, 0x5EED), this.steps);

        st.status.fill(1);
        st.manual.fill(0);
        st.heat.fill(0);
        st.cd.fill(0);
        st.repair.fill(-1);
        st.reclose.fill(0);
        st.subCd.fill(0);
        st.redisp.fill(0);
        st.curtail.fill(0);
        st.genOn.fill(1);
        st.genCd.fill(0);
        st.shed.fill(0);
        st.pg.fill(0);
        st.qg.fill(0);
        st.topo = defaultTopo(net);
        for (let i = 0; i < st.vm.length; i++) { st.vm[i] = 1; st.va[i] = 0; }
        // The factorisation caches are deliberately NOT cleared between
        // episodes. B', B'' and the PTDF depend only on the switching state, and
        // every genome in a generation explores the same small set of switching
        // states on the same network, so a warm cache across an entire
        // generation is most of the reason this runs at a useful speed.
        this._ybusKey = null;

        // Randomised thermal limits per episode. The nameplate rating of a line
        // in July is not its rating in January, and an operator who has memorised
        // one set of numbers has learned nothing.
        const spec = net.spec || {};
        const jitter = spec.rateJitter === undefined ? 0.14 : spec.rateJitter;
        for (const br of net.branch) {
            br.rate = Math.max(20, br.rate0 * Math.exp((rng() * 2 - 1) * jitter));
        }

        // Outage schedule. Forced line outages are a Poisson stream over the
        // episode with a repair time; generator trips take a unit out cold.
        this.schedule = [];
        this.storms = [];
        if (this.opts.incidents !== false) {
            // Faults are not uniform over the network. Weather is a front that
            // crosses a region, and the lines it takes down are the lines in that
            // region - neighbours, sharing corridors, feeding the same load. That
            // spatial correlation is the whole reason a storm is dangerous and a
            // random scattering of the same number of outages is not: two lines
            // out of the same corridor is a contingency the network was never
            // planned for.
            // When a storm lands matters more than that it lands. A corridor
            // lost at four in the morning is an inconvenience; the same corridor
            // lost at the evening peak is the scenario every control room drills.
            // So the timing is drawn in proportion to the fourth power of that
            // interval's demand - still random, but heavily weighted towards the
            // hours when the network has no headroom left.
            const wsum = [];
            let acc = 0, peak = 1;
            for (let t = 0; t < this.steps; t++) peak = Math.max(peak, this.wx.totLoad[t]);
            for (let t = 0; t < this.steps; t++) {
                const f = this.wx.totLoad[t] / peak;
                acc += (t < 4 || t > this.steps - 24) ? 0 : Math.pow(f, 4);
                wsum.push(acc);
            }
            const drawTime = () => {
                if (acc <= 0) return 4 + Math.floor(rng() * Math.max(1, this.steps - 30));
                const u = rng() * acc;
                let lo = 0, hi = wsum.length - 1;
                while (lo < hi) { const mid = (lo + hi) >> 1; if (wsum[mid] < u) lo = mid + 1; else hi = mid; }
                return lo;
            };
            const nStorm = poisson(rng, (spec.forcedOutages || 0) * 0.55, 4);
            for (let i = 0; i < nStorm; i++) {
                // The front is centred on a real corridor rather than on a
                // random point of the plane: a network occupies a fraction of
                // its bounding box, so uniformly placed storms mostly landed in
                // empty space and the storm tiers were quieter than the calm
                // ones. Which corridor is still uniform - nothing here picks the
                // critical line.
                const seed = net.branch[Math.floor(rng() * net.nBranch)];
                const cx = (net.bus[seed.f].x + net.bus[seed.t].x) * 0.5;
                const cy = (net.bus[seed.f].y + net.bus[seed.t].y) * 0.5;
                const storm = {
                    x: cx + (rng() - 0.5) * 0.10,
                    y: cy + (rng() - 0.5) * 0.10,
                    r: 0.11 + rng() * 0.12,
                    at: drawTime(),
                    p: 0.45 + rng() * 0.35
                };
                this.storms.push(storm);
                // Two lines from one front is a contingency an operator can work
                // with; five is a system separation nobody can control, and an
                // episode that ends in one measures the weather draw rather than
                // the controller. The cap is the difference between a hard
                // problem and an unlearnable one.
                let taken = 0;
                for (let b = 0; b < net.nBranch && taken < 3; b++) {
                    const br = net.branch[b];
                    const mx = (net.bus[br.f].x + net.bus[br.t].x) * 0.5;
                    const my = (net.bus[br.f].y + net.bus[br.t].y) * 0.5;
                    if (Math.hypot(mx - storm.x, my - storm.y) > storm.r) continue;
                    if (rng() > storm.p) continue;
                    taken++;
                    this.schedule.push({
                        kind: 'line',
                        at: storm.at + Math.floor(rng() * 14),
                        ref: b,
                        repair: 18 + Math.floor(rng() * 40)
                    });
                }
            }
            const nG = poisson(rng, spec.genOutages || 0, 4);
            const disp = net.dispatchable.filter(g => g !== net.slackGen);
            for (let i = 0; i < nG && disp.length; i++) {
                this.schedule.push({
                    kind: 'gen',
                    at: 6 + Math.floor(rng() * Math.max(1, this.steps - 16)),
                    ref: disp[Math.floor(rng() * disp.length)],
                    repair: 30 + Math.floor(rng() * 60)
                });
            }
        }
        this.schedule.sort((a, b) => a.at - b.at);

        this.m = {
            servedMWh: 0, unservedMWh: 0, demandMWh: 0,
            fuelCost: 0, premiumCost: 0, curtailCost: 0, riskCost: 0,
            revenue: 0, lostLoadCost: 0, blackoutCost: 0,
            redispatchMWh: 0, curtailedMWh: 0, lossesMWh: 0,
            overloadSteps: 0, overloadIntegral: 0, maxLoading: 0,
            vViolSteps: 0, vMin: 2, vMax: 0,
            n1InsecureSteps: 0, n1Worst: 0, n1MeanWorst: 0,
            lineTrips: 0, switchActions: 0, subActions: 0, reconnects: 0, switchCost: 0,
            solverFallbacks: 0, solverFailures: 0, emergencyShed: 0, qLimitPasses: 0,
            steps: 0, blackout: 0, score: 0
        };

        // Prime the state: solve the opening snapshot so the operator's first
        // decision is taken on a real observation rather than on flat voltages.
        // Only a genome reads the observation tensors; the classical
        // controllers work straight off the flows and the screen. Building
        // several hundred normalised channels for a controller that ignores them
        // is a fifth of a baseline episode.
        this.wantsObs = !!(controller && controller.usesObs);
        this._readWeather(0);
        this._dispatch(null);
        this._solveAndProtect();
        this._screen();
        if (this.wantsObs) this._buildObs();
        if (this.controller && this.controller.reset) this.controller.reset(this);
        return this;
    }

    // --- one dispatch interval ---------------------------------------------
    step() {
        if (this.done) return false;
        const st = this.st;

        // 1. cooldowns and repairs tick first, so an action taken now sees the
        //    counters it will actually be bound by.
        for (let b = 0; b < this.net.nBranch; b++) {
            if (st.cd[b] > 0) st.cd[b]--;
            if (st.repair[b] > 0) {
                st.repair[b]--;
                if (st.repair[b] === 0) { st.status[b] = 1; st.repair[b] = -1; st.cd[b] = 0; }
            }
        }
        for (let s = 0; s < this.net.nBus; s++) if (st.subCd[s] > 0) st.subCd[s]--;
        for (let g = 0; g < this.net.nGen; g++) {
            if (st.genCd[g] > 0) { st.genCd[g]--; if (st.genCd[g] === 0) st.genOn[g] = 1; }
        }

        // 2. scheduled incidents
        while (this.schedule.length && this.schedule[0].at <= this.t) {
            const ev = this.schedule.shift();
            if (ev.kind === 'line' && st.status[ev.ref]) {
                st.status[ev.ref] = 0;
                st.repair[ev.ref] = ev.repair;
                st.heat[ev.ref] = 0;
                this.events.push({ t: this.t, type: 'outage', ref: ev.ref, text: `line ${this.net.branch[ev.ref].name} faulted` });
            } else if (ev.kind === 'gen' && st.genOn[ev.ref]) {
                st.genOn[ev.ref] = 0;
                st.genCd[ev.ref] = ev.repair;
                this.events.push({ t: this.t, type: 'gentrip', ref: ev.ref, text: `${this.net.gen[ev.ref].name} tripped` });
            }
        }

        // 3. the operator acts on the snapshot built at the end of the last step
        let action = null;
        if (this.controller) action = this.controller.act(this, this.obs);
        this.lastAction = action;
        this._applyTopoAction(action);

        // 4-5. weather, dispatch, frequency response
        this._readWeather(this.t);
        this._dispatch(action);

        // 6-8. solve, protect, cascade, shed
        this._solveAndProtect();

        // 9. security screen
        this._screen();

        // 10. money
        this._score();

        this.t++;
        this.m.steps = this.t;
        if (this.t >= this.steps) this.done = true;
        if (!this.done && this.wantsObs) this._buildObs();
        return !this.done;
    }

    run() {
        while (!this.done) this.step();
        return this.finish();
    }

    finish() {
        const m = this.m;
        // A blackout ends the episode, and the hours it would have run are
        // charged as fully unserved. Without that the cheapest way to stop
        // paying for fuel and risk would be to switch the country off.
        if (this.blackout) {
            const left = Math.max(0, this.steps - this.t);
            const lost = left * SIM.DT_H * this.net.totalLoad;
            m.unservedMWh += lost;
            m.demandMWh += lost;
            m.lostLoadCost += lost * SIM.VOLL;
            m.blackoutCost += SIM.BLACKOUT;
            m.blackout = 1;
        }
        m.score = m.revenue - m.fuelCost - m.premiumCost - m.curtailCost - m.switchCost
            - m.riskCost - m.lostLoadCost - m.blackoutCost;
        m.n1MeanWorst = m.steps ? m.n1MeanWorst / m.steps : 0;
        m.servedFrac = m.demandMWh > 0 ? m.servedMWh / m.demandMWh : 1;
        m.n1SecureFrac = m.steps ? 1 - m.n1InsecureSteps / m.steps : 1;
        m.overloadFrac = m.steps ? m.overloadSteps / m.steps : 0;
        return m;
    }

    // --- weather ------------------------------------------------------------
    _readWeather(t) {
        const st = this.st;
        this.wx.loadAt(t, st);
        this.wx.renewAt(t, st.renewAvail);
        let tot = 0;
        for (let s = 0; s < this.net.nBus; s++) tot += st.pd[s];
        this.demandNow = tot;
    }

    // --- dispatch -----------------------------------------------------------
    // The market clears a merit-order dispatch against the demand it can see.
    // The operator's redispatch is a deviation from that, projected to sum to
    // zero over the available dispatchable fleet so that "redispatch" cannot
    // quietly mean "conjure megawatts": the only thing it can do is move
    // production from one place to another, which is exactly the lever a real
    // control room has and exactly why it costs money.
    _dispatch(action) {
        const net = this.net, st = this.st;
        const nG = net.nGen;

        // Operator curtailment of renewables, held between steps.
        if (action && action.curtail) {
            for (let g = 0; g < nG; g++) {
                if (!net.gen[g].renew) continue;
                st.curtail[g] = Math.max(0, Math.min(1, action.curtail[g]));
            }
        }
        const avail = new Float64Array(nG);
        let curtailedMW = 0;
        for (let g = 0; g < nG; g++) {
            if (!net.gen[g].renew) continue;
            const full = st.genOn[g] ? st.renewAvail[g] : 0;
            avail[g] = full * (1 - st.curtail[g]);
            curtailedMW += full - avail[g];
        }
        this.curtailedMW = curtailedMW;

        st.base = economicDispatch(net, this.demandNow, avail, st.genOn);

        // Which units the operator can actually move: dispatchable, available,
        // and COMMITTED. A unit the market left off bar is cold, and no amount
        // of redispatch starts it inside five minutes. Forgetting the commitment
        // test silently pinned every uncommitted machine's deviation at its own
        // minimum stable output, which billed a do-nothing controller for two
        // thousand MWh of redispatch it never ordered.
        const movable = [];
        for (const g of net.dispatchable) {
            if (st.genOn[g] && st.base[g] > 0) movable.push(g);
            else st.redisp[g] = 0;
        }
        if (action && action.dP) {
            for (const g of movable) {
                const gen = net.gen[g];
                const want = Math.max(-1, Math.min(1, action.dP[g] || 0)) * gen.ramp;
                st.redisp[g] += want;
                // A deviation is bounded by the machine, not by the operator's
                // enthusiasm.
                st.redisp[g] = Math.max(gen.pmin - st.base[g],
                    Math.min(gen.pmax - st.base[g], st.redisp[g]));
            }
        }
        // Zero-sum projection over the units that can still move: redispatch
        // moves production from one place to another and cannot conjure it.
        //
        // Iterated, because one pass does not do it. Subtracting the mean and
        // then clipping to each machine's limits re-introduces exactly as much
        // imbalance as the clipping removed, so a controller that asked every
        // unit to go up at once was left with a genuine surplus - fifteen
        // megawatts of it, measured - which the slack machine then silently
        // absorbed for free. Each pass spreads the residual over only the units
        // that are not already against a bound, and four passes take it to
        // under a kilowatt.
        for (let pass = 0; pass < 4; pass++) {
            let sum = 0;
            const freeUnits = [];
            for (const g of movable) {
                sum += st.redisp[g];
                const gen = net.gen[g];
                const hi = gen.pmax - st.base[g], lo = gen.pmin - st.base[g];
                if (st.redisp[g] < hi - 1e-9 && st.redisp[g] > lo + 1e-9) freeUnits.push(g);
            }
            if (Math.abs(sum) < 1e-9) break;
            const spread = freeUnits.length ? freeUnits : movable;
            if (!spread.length) break;
            const corr = sum / spread.length;
            for (const g of spread) {
                const gen = net.gen[g];
                st.redisp[g] = Math.max(gen.pmin - st.base[g],
                    Math.min(gen.pmax - st.base[g], st.redisp[g] - corr));
            }
        }

        let redispMW = 0;
        for (let g = 0; g < nG; g++) {
            const gen = net.gen[g];
            let target;
            if (gen.renew) target = avail[g];
            else if (!st.genOn[g]) target = 0;
            else target = Math.max(gen.pmin, Math.min(gen.pmax, st.base[g] + st.redisp[g]));
            // Ramp limit against where the unit actually is now.
            const d = target - st.pg[g];
            const lim = gen.renew ? 1e9 : gen.ramp;
            st.pg[g] = st.pg[g] + Math.max(-lim, Math.min(lim, d));
            if (!gen.renew) redispMW += Math.abs(st.pg[g] - st.base[g]);
        }
        this.redispMW = redispMW;
    }

    // --- the solve ----------------------------------------------------------
    _solveAndProtect() {
        const net = this.net, st = this.st;
        let tripped = true, rounds = 0;
        this.solveOk = true;
        while (tripped && rounds < SIM.CASCADE_MAX) {
            tripped = false; rounds++;
            let ok = this._solveOnce();
            if (!ok) {
                // A case that will not solve is a voltage collapse in progress,
                // and a real system's answer to that is not to give up: it is
                // under-voltage load shedding. Up to six 12% blocks are dropped, one
                // at a time, and the case is retried. That is both what the
                // relays do and what the reward economy needs - without it every
                // near-collapse is an instant total blackout, which turns a
                // graded penalty into a cliff and gives evolution nothing to
                // climb.
                this.m.solverFailures++;
                for (let blk = 0; blk < 6 && !ok; blk++) {
                    let any = false;
                    for (let s = 0; s < net.nBus; s++) {
                        if (st.pd[s] <= 0 || st.shed[s] >= 1) continue;
                        st.shed[s] = Math.min(1, st.shed[s] + 0.12);
                        any = true;
                    }
                    if (!any) break;
                    this.m.emergencyShed++;
                    ok = this._solveOnce();
                }
                if (ok) {
                    this.events.push({
                        t: this.t, type: 'uvls',
                        text: 'emergency load shedding — voltage was collapsing'
                    });
                } else {
                    this.solveOk = false;
                    this._collapse('the power flow would not solve — voltage collapse');
                    return;
                }
            }
            branchFlows(net, this.res, st.status, this.vmN, this.vaN, this.flows);
            // Protection. A line does not trip the instant it goes over its
            // rating; it heats up. Above the instantaneous setting it goes at
            // once. That difference is the entire margin an operator has to
            // work in, and it is why a controller that reacts within one or two
            // intervals survives and one that reacts within five does not.
            for (let b = 0; b < net.nBranch; b++) {
                if (!st.status[b]) { st.heat[b] = Math.max(0, st.heat[b] - SIM.HEAT_COOL); continue; }
                const ld = this.flows.load[b];
                if (ld > 1) st.heat[b] += SIM.HEAT_RATE * (ld * ld - 1);
                else st.heat[b] = Math.max(0, st.heat[b] - SIM.HEAT_COOL);
                if (ld > SIM.INST_TRIP || st.heat[b] >= 1) {
                    st.status[b] = 0;
                    st.heat[b] = 0;
                    st.cd[b] = SIM.LINE_TRIP_CD;
                    st.manual[b] = 0;
                    st.reclose[b]++;
                    this.m.lineTrips++;
                    this.events.push({
                        t: this.t, type: 'trip', ref: b,
                        text: `line ${net.branch[b].name} tripped at ${(ld * 100).toFixed(0)}%`
                    });
                    tripped = true;
                }
            }
        }
        if (rounds >= SIM.CASCADE_MAX && tripped) {
            this._collapse('cascading outage did not settle');
        }
    }

    // Resolve topology, split into islands, balance each one, solve each one.
    _solveOnce() {
        const net = this.net, st = this.st;
        const key = topologyKey(net, st.status, st.topo);
        this.res = resolveTopology(net, st.topo);
        const res = this.res;
        const nN = res.nNode;
        if (!this.vmN || this.vmN.length < nN) {
            this.vmN = new Float64Array(nN + 8);
            this.vaN = new Float64Array(nN + 8);
        }
        for (let i = 0; i < nN; i++) {
            const src = i < net.nBus ? i : 0;
            this.vmN[i] = st.vm[src] > 0.4 ? st.vm[src] : 1;
            this.vaN[i] = i < net.nBus ? st.va[src] : 0;
        }
        const isl = findIslands(net, res, st.status);
        this.islands = isl;

        const psch = new Float64Array(nN), qsch = new Float64Array(nN);
        const type = new Int8Array(nN);
        const vset = new Float64Array(nN).fill(1);
        this.islandInfo = [];

        // Group nodes by island.
        const groups = [];
        for (let c = 0; c < isl.nComp; c++) groups.push([]);
        for (let i = 0; i < nN; i++) groups[isl.comp[i]].push(i);

        let anyOk = true;
        for (let c = 0; c < isl.nComp; c++) {
            const nodes = groups[c];
            const info = this._balanceIsland(nodes, isl.comp, c, psch, qsch, type, vset);
            this.islandInfo.push(info);
            if (info.dark) {
                for (const i of nodes) { this.vmN[i] = 0; this.vaN[i] = 0; }
                continue;
            }
            if (nodes.length === 1) { this.vmN[nodes[0]] = vset[nodes[0]] || 1; continue; }
            const ok = this._solveIsland(nodes, type, psch, qsch, vset, key, key + '#' + c);
            if (!ok) anyOk = false;
        }
        for (let s = 0; s < net.nBus; s++) { st.vm[s] = this.vmN[s]; st.va[s] = this.vaN[s]; }
        return anyOk;
    }

    // Match generation to demand inside one island. This is the frequency
    // controller: if there is not enough plant, load is shed in blocks; if there
    // is too much, renewables are backed off and then units come off bar.
    _balanceIsland(nodes, comp, c, psch, qsch, type, vset) {
        const net = this.net, st = this.st, res = this.res;
        const inIsland = new Uint8Array(net.nBus);
        let load = 0, loadQ = 0;
        for (let s = 0; s < net.nBus; s++) {
            if (comp[res.loadNode[s]] !== c) continue;
            inIsland[s] = 1;
            load += st.pd[s] * (1 - st.shed[s]);
            loadQ += st.qd[s] * (1 - st.shed[s]);
        }
        const gens = [];
        for (let g = 0; g < net.nGen; g++) {
            if (comp[res.genNode[g]] !== c) continue;
            if (!st.genOn[g]) continue;
            gens.push(g);
        }
        let gen = 0, capUp = 0, capDn = 0;
        for (const g of gens) {
            gen += st.pg[g];
            capUp += Math.max(0, (net.gen[g].renew ? st.pg[g] : net.gen[g].pmax) - st.pg[g]);
            capDn += Math.max(0, st.pg[g] - (net.gen[g].renew ? 0 : net.gen[g].pmin));
        }
        const info = { c, nodes: nodes.length, load, gen, dark: false, shedMW: 0, buses: inIsland };

        if (!gens.length || (load > 0 && gen <= 0 && capUp <= 0)) {
            // No generation at all: this island is dark.
            info.dark = true;
            info.shedMW = load;
            for (let s = 0; s < net.nBus; s++) if (inIsland[s]) st.shed[s] = 1;
            if (load > 0.02 * this.net.totalLoad) {
                this.events.push({ t: this.t, type: 'island', text: `${load.toFixed(0)} MW island lost — no generation` });
            }
            return info;
        }

        let imbalance = load - gen;             // positive = short of generation
        if (imbalance > 0) {
            const take = Math.min(imbalance, capUp);
            this._spread(gens, take, +1);
            imbalance -= take;
            if (imbalance > 0.5) {
                // Under-frequency load shedding: whole blocks, largest buses
                // first, because that is how the relays are actually set.
                const order = [];
                for (let s = 0; s < net.nBus; s++) if (inIsland[s] && st.shed[s] < 1) order.push(s);
                order.sort((a, b) => st.pd[b] - st.pd[a]);
                let need = imbalance;
                for (const s of order) {
                    while (need > 0.5 && st.shed[s] < 1) {
                        const blk = Math.min(SIM.SHED_BLOCK, 1 - st.shed[s]);
                        st.shed[s] += blk;
                        need -= st.pd[s] * blk;
                        info.shedMW += st.pd[s] * blk;
                    }
                    if (need <= 0.5) break;
                }
                // Only worth telling the operator about if it is a real block:
                // rounding a 0.3 MW trim to "0 MW shed" in the event log reads as
                // a bug.
                if (info.shedMW > 1.5) {
                    this.events.push({
                        t: this.t, type: 'shed',
                        text: `${info.shedMW.toFixed(0)} MW shed to hold frequency`
                    });
                }
            }
        } else if (imbalance < -0.5) {
            const give = Math.min(-imbalance, capDn);
            this._spread(gens, give, -1);
        }

        // Recompute after balancing and post the scheduled injections.
        for (const i of nodes) { psch[i] = 0; qsch[i] = 0; type[i] = 0; }
        for (let s = 0; s < net.nBus; s++) {
            if (!inIsland[s]) continue;
            const nd = res.loadNode[s];
            psch[nd] -= st.pd[s] * (1 - st.shed[s]) / PF.BASE_MVA;
            qsch[nd] -= st.qd[s] * (1 - st.shed[s]) / PF.BASE_MVA;
        }
        let slackGen = -1, slackCap = -1;
        for (const g of gens) {
            const nd = res.genNode[g];
            psch[nd] += st.pg[g] / PF.BASE_MVA;
            const gen = net.gen[g];
            const live = !gen.renew || st.pg[g] > 0.02 * gen.pmax;
            if (live && gen.pmax > slackCap && gen.dispatchable) { slackCap = gen.pmax; slackGen = g; }
            if (live && type[nd] === 0) { type[nd] = 1; vset[nd] = gen.vset; }
            else if (live && vset[nd] < gen.vset && gen.dispatchable) vset[nd] = gen.vset;
        }
        if (slackGen < 0) {
            // Only renewables left: the biggest one grid-forms. Modern inverters
            // genuinely can, and the alternative is to call every wind-only
            // island a blackout, which would be wrong.
            for (const g of gens) if (st.pg[g] > slackCap) { slackCap = st.pg[g]; slackGen = g; }
        }
        if (slackGen >= 0) {
            const nd = res.genNode[slackGen];
            type[nd] = 2;
            vset[nd] = net.gen[slackGen].vset;
            this.vmN[nd] = vset[nd];
            this.vaN[nd] = 0;
        }
        info.slackGen = slackGen;
        info.imbalance = imbalance;
        return info;
    }

    // Move `amount` MW across a set of units, proportional to the headroom each
    // one has in that direction.
    _spread(gens, amount, dir) {
        const net = this.net, st = this.st;
        let cap = 0;
        for (const g of gens) {
            const gen = net.gen[g];
            cap += dir > 0
                ? Math.max(0, (gen.renew ? st.pg[g] : gen.pmax) - st.pg[g])
                : Math.max(0, st.pg[g] - (gen.renew ? 0 : gen.pmin));
        }
        if (cap <= 1e-9) return;
        for (const g of gens) {
            const gen = net.gen[g];
            const h = dir > 0
                ? Math.max(0, (gen.renew ? st.pg[g] : gen.pmax) - st.pg[g])
                : Math.max(0, st.pg[g] - (gen.renew ? 0 : gen.pmin));
            st.pg[g] += dir * amount * (h / cap);
        }
    }

    // One island's AC solve. Fast decoupled first with the cached constant
    // factorisation; Newton-Raphson if that stalls, which happens near the nose
    // of the PV curve - exactly where the answer matters most.
    _solveIsland(nodes, type, psch, qsch, vset, baseKey, islKey) {
        const net = this.net, st = this.st, res = this.res;
        const Y = this._ybus(baseKey);
        const qlim = this._qLimits(nodes);

        // Reactive limits. A machine that has run out of excitation stops holding
        // its voltage and the bus it was holding sags, which is how most real
        // voltage collapses start. So a PV node whose machines are asking for
        // more reactive power than they have is converted to PQ at the limit and
        // the case is solved again.
        //
        // Converting a node moves it from B' to B'', so it is part of the
        // factorisation's identity and goes into the cache key. That matters
        // more than it looks: on IEEE 14 a peaker sits on its reactive limit
        // essentially all day, so the CONVERTED pattern is the steady state and
        // caching only the unconverted one meant a Newton solve every single
        // interval.
        let pattern = '';
        let r = null;
        for (let pass = 0; pass < 4; pass++) {
            for (const i of nodes) if (type[i] >= 1) this.vmN[i] = vset[i];
            const key = pattern ? islKey + '#' + pattern : islKey;
            let fd = this.fdCache.get(key);
            if (fd === undefined) {
                fd = buildFDMatrices(net, res, st.status, nodes, type);
                if (this.fdCache.size > 220) this.fdCache.clear();
                this.fdCache.set(key, fd);
            }
            r = fd ? fastDecoupled(Y, fd, nodes, psch, qsch, this.vmN, this.vaN, null) : null;
            if (!r || !r.ok) {
                // Fast decoupled has stalled, which near the nose of the PV curve
                // it will. Restart from flat and hand the case to Newton.
                this.m.solverFallbacks++;
                this._flatStart(nodes, type, vset);
                r = newtonRaphson(Y, nodes, type, psch, qsch, this.vmN, this.vaN,
                    qlim.qmin, qlim.qmax, null);
            }
            if (!r.ok) return false;

            // qsch at a PV node carries only the load, so the machines' output is
            // Qcalc minus that. A 0.02 pu deadband: two MVAr past the limit on a
            // machine rated in the hundreds is a rounding error, and chasing it
            // costs a whole extra solve.
            let changed = false;
            for (const i of nodes) {
                if (type[i] !== 1) continue;
                const qgen = this._nodeQ(Y, nodes, i) - qsch[i];
                if (qgen > qlim.qmax[i] + 0.02) {
                    type[i] = 0; qsch[i] += qlim.qmax[i]; pattern += i + '+'; changed = true;
                } else if (qgen < qlim.qmin[i] - 0.02) {
                    type[i] = 0; qsch[i] += qlim.qmin[i]; pattern += i + '-'; changed = true;
                }
            }
            if (!changed) break;
            this.m.qLimitPasses = (this.m.qLimitPasses || 0) + 1;
        }

        for (const i of nodes) {
            if (!Number.isFinite(this.vmN[i]) || !Number.isFinite(this.vaN[i])) return false;
            if (this.vmN[i] < SIM.COLLAPSE_VM) return false;
            if (this.vmN[i] > PF.VM_MAX) return false;
        }
        // Post each machine's reactive output back, split across the units at a
        // node in proportion to their capability, so the inspector and the
        // observation can show what the excitation is doing.
        const Yl = Y;
        for (const i of nodes) {
            const qNode = this._nodeQ(Yl, nodes, i) - qsch[i];
            let cap = 0;
            for (let g = 0; g < net.nGen; g++) {
                if (res.genNode[g] !== i || !st.genOn[g]) continue;
                cap += net.gen[g].qmax;
            }
            for (let g = 0; g < net.nGen; g++) {
                if (res.genNode[g] !== i || !st.genOn[g]) continue;
                st.qg[g] = cap > 0 ? qNode * PF.BASE_MVA * (net.gen[g].qmax / cap) : 0;
            }
        }
        return true;
    }

    // What would opening (or closing) this branch actually do? The DC screen
    // says one thing; an AC solve says what really happens, including the
    // reactive power the screen throws away. Two extra solves, and the state is
    // put back exactly as it was.
    //
    // This is what an operator does before executing a switching action: they
    // study it in the network model. The expert baseline gets to. The genome
    // does not - it has the same DC table the screen produces and has to learn
    // where that table lies, which is the whole point of giving it one.
    previewSwitch(b) {
        const st = this.st;
        if (b < 0 || b >= this.net.nBranch) return null;
        const save = {
            status: st.status[b],
            shed: st.shed.slice(), pg: st.pg.slice(), qg: st.qg.slice(),
            vm: st.vm.slice(), va: st.va.slice()
        };
        st.status[b] = st.status[b] ? 0 : 1;
        let out = { ok: false, maxLoading: Infinity, vmin: 0, lostMW: 0 };
        if (this._solveOnce()) {
            const f = branchFlows(this.net, this.res, st.status, this.vmN, this.vaN, null);
            let mx = 0, vmin = 2, lost = 0;
            for (let i = 0; i < this.net.nBranch; i++) if (st.status[i] && f.load[i] > mx) mx = f.load[i];
            for (let s = 0; s < this.net.nBus; s++) {
                if (st.vm[s] > 0.05 && st.vm[s] < vmin) vmin = st.vm[s];
                lost += st.pd[s] * (st.shed[s] - save.shed[s]);
            }
            out = { ok: true, maxLoading: mx, vmin, lostMW: Math.max(0, lost) };
        }
        st.status[b] = save.status;
        st.shed.set(save.shed); st.pg.set(save.pg); st.qg.set(save.qg);
        st.vm.set(save.vm); st.va.set(save.va);
        this._solveOnce();
        branchFlows(this.net, this.res, st.status, this.vmN, this.vaN, this.flows);
        return out;
    }

    _flatStart(nodes, type, vset) {
        for (const i of nodes) { if (type[i] === 0) this.vmN[i] = 1; this.vaN[i] = 0; }
        for (const i of nodes) if (type[i] >= 1) this.vmN[i] = vset[i];
    }

    // The admittance matrix depends on the switching state alone, so it is keyed
    // on that and shared by every island in it.
    _ybus(baseKey) {
        if (this._ybusKey === baseKey && this._ybusVal) return this._ybusVal;
        this._ybusVal = buildYbus(this.net, this.res, this.st.status);
        this._ybusKey = baseKey;
        return this._ybusVal;
    }

    _qLimits(nodes) {
        const net = this.net, res = this.res, st = this.st;
        const n = this.res.nNode;
        if (!this._qmin || this._qmin.length < n) {
            this._qmin = new Float64Array(n + 8);
            this._qmax = new Float64Array(n + 8);
        }
        for (const i of nodes) { this._qmin[i] = 0; this._qmax[i] = 0; }
        for (let g = 0; g < net.nGen; g++) {
            if (!st.genOn[g]) continue;
            const nd = res.genNode[g];
            const gen = net.gen[g];
            const live = !gen.renew || st.pg[g] > 0.02 * gen.pmax;
            if (!live) continue;
            this._qmin[nd] += gen.qmin / PF.BASE_MVA;
            this._qmax[nd] += gen.qmax / PF.BASE_MVA;
        }
        return { qmin: this._qmin, qmax: this._qmax };
    }

    _nodeQ(Y, nodes, i) {
        let q = 0;
        for (let k = Y.rowPtr[i]; k < Y.rowPtr[i + 1]; k++) {
            const j = Y.col[k];
            const d = this.vaN[i] - this.vaN[j];
            q += this.vmN[j] * (Y.gv[k] * Math.sin(d) - Y.bv[k] * Math.cos(d));
        }
        return this.vmN[i] * q;
    }

    _collapse(reason) {
        if (this.blackout) return;
        this.blackout = true;
        this.blackoutStep = this.t;
        this.done = true;
        for (let s = 0; s < this.net.nBus; s++) this.st.shed[s] = 1;
        this.events.push({ t: this.t, type: 'blackout', text: reason });
    }

    // --- N-1 screen ---------------------------------------------------------
    // A DC contingency screen over every remaining branch. It is linear and
    // lossless and it ignores reactive power, so it is an approximation - which
    // is exactly why its result is REPORTED and, by default, not paid for. The
    // controller is given the same table.
    _screen() {
        if (this.blackout) { this.n1.worst = 0; this.n1.nViolating = 0; return; }
        const net = this.net, st = this.st, res = this.res;
        const key = topologyKey(net, st.status, st.topo);
        let dcs = this.dcCache.get(key);
        if (dcs === undefined) {
            dcs = [];
            const isl = this.islands;
            const groups = [];
            for (let c = 0; c < isl.nComp; c++) groups.push([]);
            for (let i = 0; i < res.nNode; i++) groups[isl.comp[i]].push(i);
            for (let c = 0; c < isl.nComp; c++) {
                if (groups[c].length < 2) continue;
                const info = this.islandInfo[c];
                if (info && info.dark) continue;
                const ref = (info && info.slackGen >= 0) ? res.genNode[info.slackGen] : groups[c][0];
                const dc = buildDC(net, res, st.status, ref, groups[c]);
                if (dc) dcs.push(dc);
            }
            if (this.dcCache.size > 160) this.dcCache.clear();
            this.dcCache.set(key, dcs);
        }
        this.dcs = dcs;
        this.n1.worst = 0; this.n1.worstBranch = -1; this.n1.worstOutage = -1;
        this.n1.nViolating = 0; this.n1.nIslanding = 0;
        this.n1.perBranch.fill(0); this.n1.perOutage.fill(0);
        const tmp = {
            worst: 0, worstBranch: -1, worstOutage: -1, nViolating: 0, nIslanding: 0,
            perBranch: new Float64Array(net.nBranch), perOutage: new Float64Array(net.nBranch)
        };
        for (const dc of dcs) {
            screenN1(net, dc, this.flows.pf, tmp);
            if (tmp.worst > this.n1.worst) {
                this.n1.worst = tmp.worst;
                this.n1.worstBranch = tmp.worstBranch;
                this.n1.worstOutage = tmp.worstOutage;
            }
            this.n1.nViolating += tmp.nViolating;
            this.n1.nIslanding += tmp.nIslanding;
            for (let b = 0; b < net.nBranch; b++) {
                if (tmp.perBranch[b] > this.n1.perBranch[b]) this.n1.perBranch[b] = tmp.perBranch[b];
                if (tmp.perOutage[b] > this.n1.perOutage[b]) this.n1.perOutage[b] = tmp.perOutage[b];
            }
        }
        // A branch that is out of service is not a contingency, and a branch
        // whose outage islands the grid gets the worst possible mark rather than
        // a silently missing one.
        for (let b = 0; b < net.nBranch; b++) {
            if (!st.status[b]) this.n1.perOutage[b] = 0;
        }
    }

    // --- money and metrics --------------------------------------------------
    _score() {
        const net = this.net, st = this.st, m = this.m;
        const dt = SIM.DT_H;
        let served = 0, demand = 0;
        for (let s = 0; s < net.nBus; s++) {
            demand += st.pd[s];
            served += st.pd[s] * (1 - st.shed[s]);
        }
        if (this.blackout) served = 0;
        const unserved = Math.max(0, demand - served);
        m.demandMWh += demand * dt;
        m.servedMWh += served * dt;
        m.unservedMWh += unserved * dt;
        m.revenue += served * dt * SIM.TARIFF;
        m.lostLoadCost += unserved * dt * SIM.VOLL;

        // Fuel is billed on what the machines actually burned. The balancing
        // PREMIUM is billed only on what the operator ASKED for - st.redisp -
        // and not on the gap between the plant and the market schedule, because
        // that gap is also opened by the market's own ramping between intervals
        // and by frequency response, neither of which the operator ordered.
        // Billing the raw gap charged a do-nothing controller two thousand MWh
        // of redispatch it never performed, which was most of the margin.
        let fuel = 0, up = 0, dn = 0;
        for (let g = 0; g < net.nGen; g++) {
            const gen = net.gen[g];
            fuel += st.pg[g] * gen.cost * dt;
            if (!gen.dispatchable) continue;
            const d = st.redisp[g];
            if (d > 0) up += d; else dn += -d;
        }
        m.fuelCost += fuel;
        m.premiumCost += (up * REDISPATCH_PREMIUM_UP + dn * REDISPATCH_PREMIUM_DOWN) * dt;
        m.curtailCost += this.curtailedMW * CURTAIL_PREMIUM * dt;
        m.redispatchMWh += (up + dn) * dt;
        m.curtailedMWh += this.curtailedMW * dt;

        // The overload risk charge from the brief: sum of squared excess loading.
        let over = 0, nOver = 0, maxLd = 0;
        for (let b = 0; b < net.nBranch; b++) {
            if (!st.status[b]) continue;
            const ld = this.flows.load[b];
            if (ld > maxLd) maxLd = ld;
            if (ld > 1) { over += (ld - 1) * (ld - 1); nOver++; }
        }
        m.riskCost += over * dt * SIM.RISK;
        m.overloadIntegral += over * dt;
        if (nOver > 0) m.overloadSteps++;
        if (maxLd > m.maxLoading) m.maxLoading = maxLd;
        // Also published on the world itself: the observation builder computes
        // this too, but it is skipped for controllers that do not read the
        // tensors, and anything watching from outside still needs the number.
        this.maxLoading = maxLd;

        // Voltage limits are per bus, not global. A 400 kV transmission busbar is
        // held to 0.94-1.06 pu; an 11 kV generator terminal is not, and the
        // classic IEEE 14 case sets one of its machines to 1.09 pu on purpose. A
        // single global band reported 156 violations an episode that were the
        // published setpoints rather than anything the operator did.
        let vBad = 0;
        for (let s = 0; s < net.nBus; s++) {
            const v = st.vm[s];
            if (v <= 0.05) continue;                 // a dark bus has no voltage limit
            if (v < m.vMin) m.vMin = v;
            if (v > m.vMax) m.vMax = v;
            if (v < net.bus[s].vlo || v > net.bus[s].vhi) vBad++;
        }
        if (vBad) m.vViolSteps++;

        m.n1MeanWorst += this.n1.worst;
        if (this.n1.worst > m.n1Worst) m.n1Worst = this.n1.worst;
        if (this.n1.worst > 1) m.n1InsecureSteps++;
        // Off by default. Turning it on is a different experiment, not a better
        // reward: with it on, the N-1 metric stops being an independent measure
        // of what the controller learned.
        if (this.opts.n1Weight > 0 && this.n1.worst > 1) {
            m.riskCost += (this.n1.worst - 1) * (this.n1.worst - 1) * dt * SIM.RISK * this.opts.n1Weight;
        }

        let loss = 0;
        for (let b = 0; b < net.nBranch; b++) {
            if (!st.status[b]) continue;
            loss += this.flows.pf[b] + this.flows.pt[b];
        }
        m.lossesMWh += Math.max(0, loss) * dt;
        this.lossMW = Math.max(0, loss);

        if (!this.blackout && demand > 0 && served < demand * SIM.BLACKOUT_FRAC) {
            this._collapse(`only ${(served / demand * 100).toFixed(0)}% of demand served — system down`);
        }
        // Shed load is restored as soon as the island can carry it again.
        if (!this.blackout) {
            for (let s = 0; s < net.nBus; s++) {
                if (st.shed[s] > 0) st.shed[s] = Math.max(0, st.shed[s] - SIM.SHED_BLOCK);
            }
        }
    }

    // --- actions ------------------------------------------------------------
    // At most one topological action per interval. That is not a simplification
    // for the model's benefit - it is the rule real operators work under, and it
    // is what stops the search space from being 2^(elements) wide per step.
    _applyTopoAction(action) {
        if (!action || !action.topo) return;
        const st = this.st, net = this.net, a = action.topo;
        if (a.kind === 'line') {
            const b = a.ref | 0;
            if (b < 0 || b >= net.nBranch) return;
            if (st.cd[b] > 0 || st.repair[b] > 0) return;
            if (st.status[b]) {
                st.status[b] = 0; st.manual[b] = 1; st.cd[b] = SIM.SWITCH_CD;
                this.m.switchActions++; this.m.switchCost += SIM.SWITCH_COST;
                this.events.push({ t: this.t, type: 'open', ref: b, text: `opened ${net.branch[b].name}` });
            } else {
                // Recloser lockout. A line that has already tripped on overload
                // three times is not closed again by anybody: the relay locks
                // out and an engineer has to go and look at it. Without this
                // rule a controller that reconnects on sight gets into a
                // reconnect-trip-reconnect loop on a line that is 60% over its
                // rating, which is not a control problem, it is a bug wearing
                // one's costume.
                if (st.reclose[b] >= SIM.RECLOSE_LIMIT) return;
                st.status[b] = 1; st.manual[b] = 0; st.cd[b] = SIM.SWITCH_CD; st.heat[b] = 0;
                this.m.reconnects++; this.m.switchCost += SIM.SWITCH_COST;
                this.events.push({ t: this.t, type: 'close', ref: b, text: `reconnected ${net.branch[b].name}` });
            }
        } else if (a.kind === 'sub') {
            const s = a.ref | 0;
            if (s < 0 || s >= net.nBus || st.subCd[s] > 0) return;
            const elems = net.subs[s].elems;
            if (!a.assign || a.assign.length !== elems.length) return;
            // Reject a configuration that strands an element: a generator or a
            // load alone on a busbar with no line is disconnected, not switched,
            // and the line action already covers deliberate disconnection.
            let n1 = 0, n2 = 0, br1 = 0, br2 = 0;
            for (let i = 0; i < elems.length; i++) {
                const bus = a.assign[i] === 2 ? 2 : 1;
                if (bus === 1) { n1++; if (elems[i].kind === 'br') br1++; }
                else { n2++; if (elems[i].kind === 'br') br2++; }
            }
            if (n2 > 0 && (br1 === 0 || br2 === 0)) return;
            let changed = false;
            for (let i = 0; i < elems.length; i++) {
                const bus = a.assign[i] === 2 ? 2 : 1;
                if (st.topo[s][i] !== bus) changed = true;
            }
            if (!changed) return;
            for (let i = 0; i < elems.length; i++) st.topo[s][i] = a.assign[i] === 2 ? 2 : 1;
            st.subCd[s] = SIM.SUB_CD;
            this.m.subActions++; this.m.switchCost += SIM.SWITCH_COST;
            this.events.push({
                t: this.t, type: 'sub', ref: s,
                text: n2 > 0 ? `split ${net.bus[s].name} across both busbars`
                    : `restored ${net.bus[s].name} to one busbar`
            });
        }
    }

    // --- observation --------------------------------------------------------
    // Everything the operator can see, and nothing it cannot. The sensitivity
    // and relief channels are the output of the same PTDF and LODF tables the
    // greedy baseline runs on, so the brain is handed no information its
    // competition does not also have.
    _buildObs() {
        const net = this.net, st = this.st, o = this.obs, res = this.res;
        const S = this.scaleMW;
        const dt = this.flows;

        let maxLd = 0, sumLd = 0, nHot = 0, nOut = 0, nLive = 0;
        for (let b = 0; b < net.nBranch; b++) {
            if (!st.status[b]) { nOut++; continue; }
            nLive++;
            const ld = dt.load[b];
            if (ld > maxLd) maxLd = ld;
            sumLd += ld;
            if (ld > 0.9) nHot++;
        }
        const meanLd = nLive ? sumLd / nLive : 0;
        this.maxLoading = maxLd;

        // Which line is binding right now, and what a megawatt does to it.
        const worstB = this._worstBranch(maxLd);
        const sens = this._sensitivities(worstB);
        // Urgency gates the relief channels - a generator's sensitivity to the
        // binding constraint only means anything when the constraint is actually
        // binding. This used to read
        //
        //     const urgency = Math.max(0, maxLd - 0.92) * 3;
        //
        // and that single line switched the entire redispatch reflex OFF during
        // exactly the window worth acting in. On a typical costly day this system
        // sits at 83% loading with its worst contingency at 130-155% for twenty
        // minutes; then a storm takes the second circuit of the corridor, the
        // cascade runs, and the day costs seven hundred thousand euros. Through
        // that whole window every generator was being told its relief was zero,
        // so the only genomes that could act were the ones reacting to an
        // overload that had already happened, which is far too late for a
        // thermal accumulator that trips in five minutes at 130%.
        //
        // The binding BRANCH was already chosen by contingency exposure (see
        // _worstBranch); only the gate in front of it was blind. N-1 exposure is
        // deliberately worth less than a live overload, because it is a
        // contingent problem and acting on it costs real money now. This changes
        // what the operator can SEE, not what it is paid for: the reward still
        // contains no security term, and N-1 was already observable on five
        // other channels.
        //
        // The 1.45 threshold is calibrated, not chosen. The loading gate at 0.92
        // opens in roughly the top 15% of intervals on the storm tier (loading
        // p90 = 1.05). The worst contingency on that same tier has a MEDIAN of
        // 1.16 and p75 of 1.35, so gating N-1 at 1.02 - the first thing tried -
        // held the channel permanently open and turned relief into plain
        // sensitivity. 1.45 sits at about the same rarity as the loading gate,
        // which is the point: this is meant to be a second rare trigger, not a
        // second permanent one.
        const urgency = Math.max(0, maxLd - 0.92, (this.n1.worst - 1.45) * 0.6) * 3;

        // --- global ---------------------------------------------------------
        const g = o.global;
        const hour = (this.wx.startHour + this.t * SIM.DT_H) % 24;
        g[GLB.CLK_SIN] = Math.sin(hour / 24 * 2 * Math.PI);
        g[GLB.CLK_COS] = Math.cos(hour / 24 * 2 * Math.PI);
        const dow = (this.wx.dayOfWeek + Math.floor((this.wx.startHour + this.t * SIM.DT_H) / 24)) % 7;
        g[GLB.WEEKEND] = dow >= 5 ? 1 : -1;
        g[GLB.LOAD_REL] = this.demandNow / S - 1;
        let renewNow = 0, pgTot = 0, headUp = 0, headDn = 0;
        for (let i = 0; i < net.nGen; i++) {
            pgTot += st.pg[i];
            if (net.gen[i].renew) renewNow += st.pg[i];
            else if (st.genOn[i]) {
                headUp += Math.min(net.gen[i].ramp, net.gen[i].pmax - st.pg[i]);
                headDn += Math.min(net.gen[i].ramp, st.pg[i] - net.gen[i].pmin);
            }
        }
        g[GLB.RENEW_SHARE] = pgTot > 0 ? renewNow / pgTot * 2 - 1 : -1;
        g[GLB.RES_UP] = Math.min(2, headUp / S * 4) - 1;
        g[GLB.RES_DN] = Math.min(2, headDn / S * 4) - 1;
        g[GLB.MAX_LOAD] = Math.min(2, maxLd) - 1;
        g[GLB.MEAN_LOAD] = Math.min(2, meanLd * 1.6) - 1;
        g[GLB.FRAC_HOT] = net.nBranch ? nHot / net.nBranch * 2 - 1 : -1;
        g[GLB.FRAC_OUT] = net.nBranch ? nOut / net.nBranch * 4 - 1 : -1;
        g[GLB.N1_WORST] = Math.min(2.5, this.n1.worst) - 1;
        g[GLB.N1_FRAC] = net.nBranch ? Math.min(1, this.n1.nViolating / net.nBranch * 3) * 2 - 1 : -1;
        g[GLB.LOSSES] = Math.min(1, (this.lossMW || 0) / Math.max(1, this.demandNow) * 12) * 2 - 1;
        g[GLB.SLACK_P] = st.pg[net.slackGen] / Math.max(1, net.gen[net.slackGen].pmax) * 2 - 1;
        g[GLB.T_REMAIN] = (1 - this.t / Math.max(1, this.steps)) * 2 - 1;
        let vmin = 2, vmax = 0;
        for (let s = 0; s < net.nBus; s++) {
            const v = st.vm[s];
            if (v <= 0.05) continue;
            if (v < vmin) vmin = v;
            if (v > vmax) vmax = v;
        }
        g[GLB.VMIN] = (vmin > 1.9 ? 1 : vmin - 1) * 8;
        g[GLB.VMAX] = (vmax - 1) * 8;
        const fcL = this.wx.fc.load6[Math.min(this.steps - 1, this.t)];
        const fcR = this.wx.fc.renew6[Math.min(this.steps - 1, this.t)];
        g[GLB.FC_LOAD] = clamp((fcL - this.demandNow) / Math.max(1, this.demandNow) * 8, -2, 2);
        g[GLB.FC_RENEW] = clamp((fcR - renewNow) / Math.max(1, S * 0.3) * 3, -2, 2);

        // --- per substation --------------------------------------------------
        for (let s = 0; s < net.nBus; s++) {
            const p = s * NODE_CH, nd2 = res.subNode2[s];
            const n = o.node;
            n[p + ND.VM1] = (st.vm[s] - 1) * 8;
            n[p + ND.VM2] = nd2 >= 0 ? (this.vmN[nd2] - 1) * 8 : (st.vm[s] - 1) * 8;
            n[p + ND.VA_SIN] = Math.sin(st.va[s]);
            n[p + ND.VA_COS] = Math.cos(st.va[s]);
            n[p + ND.PLOAD] = st.pd[s] * (1 - st.shed[s]) / S * 4;
            n[p + ND.QLOAD] = st.qd[s] * (1 - st.shed[s]) / S * 8;
            let pg = 0, qg = 0, hasD = 0, hasR = 0, hUp = 0, hDn = 0, rNow = 0;
            for (let gi = 0; gi < net.nGen; gi++) {
                if (net.gen[gi].bus !== s) continue;
                pg += st.pg[gi]; qg += st.qg[gi];
                if (net.gen[gi].renew) { hasR = 1; rNow += st.pg[gi]; }
                else if (st.genOn[gi]) {
                    hasD = 1;
                    hUp += Math.min(net.gen[gi].ramp, net.gen[gi].pmax - st.pg[gi]);
                    hDn += Math.min(net.gen[gi].ramp, st.pg[gi] - net.gen[gi].pmin);
                }
            }
            n[p + ND.PGEN] = pg / S * 4;
            n[p + ND.QGEN] = qg / S * 8;
            n[p + ND.PINJ] = (pg - st.pd[s] * (1 - st.shed[s])) / S * 4;
            n[p + ND.HAS_DISP] = hasD ? 1 : -1;
            n[p + ND.HAS_RENEW] = hasR ? 1 : -1;
            n[p + ND.IS_SLACK] = net.gen[net.slackGen].bus === s ? 1 : -1;
            let deg = 0, locMax = 0, locN1 = 0;
            for (const e of net.subs[s].elems) {
                if (e.kind !== 'br') continue;
                deg++;
                if (!st.status[e.ref]) continue;
                if (dt.load[e.ref] > locMax) locMax = dt.load[e.ref];
                if (this.n1.perBranch[e.ref] > locN1) locN1 = this.n1.perBranch[e.ref];
            }
            n[p + ND.DEG] = deg / 4 - 1;
            n[p + ND.SPLIT] = nd2 >= 0 ? 1 : -1;
            n[p + ND.SUB_CD] = st.subCd[s] / SIM.SUB_CD * 2 - 1;
            n[p + ND.MAX_LOAD] = Math.min(2, locMax) - 1;
            n[p + ND.N1_LOCAL] = Math.min(2.5, locN1) - 1;
            n[p + ND.HEAD_UP] = Math.min(1, hUp / Math.max(1, S * 0.1)) * 2 - 1;
            n[p + ND.HEAD_DN] = Math.min(1, hDn / Math.max(1, S * 0.1)) * 2 - 1;
            n[p + ND.RENEW_NOW] = rNow / S * 4;
            n[p + ND.IS_HV] = net.bus[s].baseKV >= 150 ? 1 : -1;
            n[p + ND.SHED] = st.shed[s] * 2 - 1;
            n[p + ND.SENS_WORST] = clamp(sens.node[s] * 30, -1.5, 1.5);
        }

        // --- per directed branch end -----------------------------------------
        for (let b = 0; b < net.nBranch; b++) {
            const br = net.branch[b];
            const live = st.status[b] ? 1 : 0;
            const relief = live ? clamp((maxLd - this.n1.perOutage[b]) * 3, -1.5, 1.5) * (urgency > 0 ? 1 : 0.15) : 0;
            const wouldIsland = this._wouldIsland(b);
            for (let side = 0; side < 2; side++) {
                const d = (b * 2 + side) * EDGE_CH;
                const e = o.edge;
                const near = side === 0 ? br.f : br.t;
                const far = side === 0 ? br.t : br.f;
                const sgn = side === 0 ? 1 : -1;
                const p = side === 0 ? dt.pf[b] : dt.pt[b];
                const q = side === 0 ? dt.qf[b] : dt.qt[b];
                e[d + ED.IN_SERVICE] = live ? 1 : -1;
                e[d + ED.LOADING] = live ? Math.min(2, dt.load[b]) - 1 : -1;
                e[d + ED.P_FLOW] = clamp(p / Math.max(1, br.rate), -1.6, 1.6);
                e[d + ED.Q_FLOW] = clamp(q / Math.max(1, br.rate), -1.6, 1.6);
                e[d + ED.RATE] = clamp(br.rate / S * 3, 0, 3) - 1;
                e[d + ED.X] = clamp(br.x * 4, 0, 3) - 1;
                e[d + ED.R_OVER_X] = clamp(br.r / Math.max(1e-4, br.x) * 3, 0, 2) - 1;
                e[d + ED.IS_XFMR] = br.kind === 'xfmr' ? 1 : -1;
                e[d + ED.HEAT] = st.heat[b] * 2 - 1;
                e[d + ED.COOLDOWN] = Math.min(1, st.cd[b] / SIM.LINE_TRIP_CD) * 2 - 1;
                e[d + ED.N1_ON_ME] = Math.min(2.5, this.n1.perBranch[b]) - 1;
                e[d + ED.N1_BY_ME] = Math.min(2.5, this.n1.perOutage[b]) - 1;
                e[d + ED.VM_OTHER] = (st.vm[far] - 1) * 8;
                e[d + ED.DANGLE] = clamp((st.va[near] - st.va[far]) * sgn * 3, -1.5, 1.5);
                e[d + ED.SPLIT_OTHER] = res.subNode2[far] >= 0 ? 1 : -1;
                e[d + ED.LEN] = clamp(br.len * 3, 0, 2) - 1;
                e[d + ED.LOSS] = live ? clamp((dt.pf[b] + dt.pt[b]) / Math.max(1, br.rate) * 12, 0, 2) - 1 : -1;
                e[d + ED.WOULD_ISLAND] = wouldIsland ? 1 : -1;
                e[d + ED.DEG_OTHER] = 0;
                e[d + ED.RELIEF] = relief;
            }
        }
        for (let b = 0; b < net.nBranch; b++) {
            const br = net.branch[b];
            let df = 0, dtg = 0;
            for (const e of net.subs[br.f].elems) if (e.kind === 'br' && st.status[e.ref]) df++;
            for (const e of net.subs[br.t].elems) if (e.kind === 'br' && st.status[e.ref]) dtg++;
            o.edge[(b * 2) * EDGE_CH + ED.DEG_OTHER] = dtg / 4 - 1;
            o.edge[(b * 2 + 1) * EDGE_CH + ED.DEG_OTHER] = df / 4 - 1;
        }

        // --- per generator ----------------------------------------------------
        for (let gi = 0; gi < net.nGen; gi++) {
            const gen = net.gen[gi], p = gi * GEN_CH, a = o.gen;
            a[p + GN.P] = st.pg[gi] / Math.max(1, gen.pmax) * 2 - 1;
            a[p + GN.PMAX] = clamp(gen.pmax / S * 3, 0, 3) - 1;
            a[p + GN.PMIN_FRAC] = gen.pmin / Math.max(1, gen.pmax) * 2 - 1;
            a[p + GN.COST] = clamp(gen.cost / 70, 0, 2) - 1;
            a[p + GN.RAMP_FRAC] = clamp(gen.ramp / Math.max(1, gen.pmax) * 6, 0, 2) - 1;
            a[p + GN.IS_RENEW] = gen.renew ? 1 : -1;
            a[p + GN.AVAIL] = gen.renew
                ? (st.renewAvail[gi] / Math.max(1, gen.pmax) * 2 - 1)
                : (st.genOn[gi] ? 1 : -1);
            a[p + GN.ON] = st.genOn[gi] ? 1 : -1;
            const up = gen.renew ? Math.max(0, st.renewAvail[gi] * (1 - st.curtail[gi]) - st.pg[gi])
                : Math.min(gen.ramp, gen.pmax - st.pg[gi]);
            const dn = gen.renew ? st.pg[gi] : Math.min(gen.ramp, st.pg[gi] - gen.pmin);
            a[p + GN.HEAD_UP] = clamp(up / Math.max(1, gen.ramp), 0, 2) - 1;
            a[p + GN.HEAD_DN] = clamp(dn / Math.max(1, gen.ramp), 0, 2) - 1;
            a[p + GN.Q_USE] = 0;
            const sv = sens.gen[gi];
            a[p + GN.SENS] = clamp(sv * 30, -1.5, 1.5);
            a[p + GN.RELIEF] = clamp(sv * 30 * urgency, -1.5, 1.5);
        }

        this.sens = sens;
        this.worstBranch = worstB;
        this.urgency = urgency;
    }

    // Per-element busbar features, built on demand. A controller looks at one
    // substation's elements at most once per interval - it can only reconfigure
    // one - so filling every substation's table every interval was pure waste.
    fillElem(s) {
        const net = this.net, st = this.st, o = this.obs, dt = this.flows;
        const S = this.scaleMW;
        {
            const elems = net.subs[s].elems, arr = o.elem[s];
            for (let i = 0; i < elems.length; i++) {
                const e = elems[i], p = i * ELEM_CH;
                arr[p + EL.IS_BRANCH] = e.kind === 'br' ? 1 : -1;
                arr[p + EL.IS_GEN] = e.kind === 'gen' ? 1 : -1;
                arr[p + EL.IS_LOAD] = e.kind === 'load' ? 1 : -1;
                arr[p + EL.ON_BUS2] = st.topo[s][i] === 2 ? 1 : -1;
                if (e.kind === 'br') {
                    const b = e.ref;
                    const pflow = e.side === 0 ? dt.pf[b] : dt.pt[b];
                    arr[p + EL.P_FLOW] = clamp(pflow / S * 4, -2, 2);
                    arr[p + EL.S_MAG] = clamp(dt.sMax[b] / S * 4, 0, 2) - 1;
                    arr[p + EL.LOADING] = st.status[b] ? Math.min(2, dt.load[b]) - 1 : -1;
                    arr[p + EL.IS_XFMR] = net.branch[b].kind === 'xfmr' ? 1 : -1;
                    arr[p + EL.OUT] = st.status[b] ? -1 : 1;
                    arr[p + EL.SIZE] = clamp(net.branch[b].rate / S * 3, 0, 2) - 1;
                } else if (e.kind === 'gen') {
                    arr[p + EL.P_FLOW] = clamp(st.pg[e.ref] / S * 4, -2, 2);
                    arr[p + EL.S_MAG] = clamp(st.pg[e.ref] / S * 4, 0, 2) - 1;
                    arr[p + EL.LOADING] = -1;
                    arr[p + EL.IS_XFMR] = -1;
                    arr[p + EL.OUT] = st.genOn[e.ref] ? -1 : 1;
                    arr[p + EL.SIZE] = clamp(net.gen[e.ref].pmax / S * 3, 0, 2) - 1;
                } else {
                    const pl = st.pd[s] * (1 - st.shed[s]);
                    arr[p + EL.P_FLOW] = clamp(-pl / S * 4, -2, 2);
                    arr[p + EL.S_MAG] = clamp(pl / S * 4, 0, 2) - 1;
                    arr[p + EL.LOADING] = -1;
                    arr[p + EL.IS_XFMR] = -1;
                    arr[p + EL.OUT] = st.shed[s] > 0.5 ? 1 : -1;
                    arr[p + EL.SIZE] = clamp(st.pd[s] / S * 3, 0, 2) - 1;
                }
            }
        }
        return o.elem[s];
    }

    _worstBranch(maxLd) {
        const st = this.st, dt = this.flows;
        let best = -1, bl = -1;
        for (let b = 0; b < this.net.nBranch; b++) {
            if (!st.status[b]) continue;
            // Under normal conditions the binding constraint is the worst N-1
            // case, not the worst flow now. Once something is actually over its
            // limit, that becomes the constraint.
            const v = maxLd > 1 ? dt.load[b] : Math.max(dt.load[b], this.n1.perBranch[b] * 0.85);
            if (v > bl) { bl = v; best = b; }
        }
        return best;
    }

    // d(loading of the binding line) / d(MW injected here), per MW. This is the
    // number a control room reads off its sensitivity display, and it is what
    // makes the redispatch problem tractable at all: without it the controller
    // would have to discover the PTDF matrix by trial and error, one blackout at
    // a time.
    _sensitivities(worstB) {
        const net = this.net, res = this.res;
        if (!this._sensBuf || this._sensBuf.node.length !== net.nBus) {
            this._sensBuf = { node: new Float64Array(net.nBus), gen: new Float64Array(net.nGen) };
        }
        const out = this._sensBuf;
        out.node.fill(0); out.gen.fill(0);
        if (worstB < 0 || !this.dcs || !this.dcs.length) return out;
        const rate = Math.max(1, net.branch[worstB].rate);
        const sgn = this.flows.pf[worstB] >= 0 ? 1 : -1;
        for (const dc of this.dcs) {
            const li = dc.liveOfBr[worstB];
            if (li < 0) continue;
            for (let s = 0; s < net.nBus; s++) {
                const nd = res.loadNode[s];
                const p = dc.ptdf[li * dc.n + nd];
                if (p) out.node[s] = -sgn * p / rate;
            }
            for (let g = 0; g < net.nGen; g++) {
                const nd = res.genNode[g];
                const p = dc.ptdf[li * dc.n + nd];
                if (p) out.gen[g] = -sgn * p / rate;
            }
            break;
        }
        return out;
    }

    _wouldIsland(b) {
        if (!this.dcs) return false;
        for (const dc of this.dcs) {
            const li = dc.liveOfBr[b];
            if (li >= 0) return !!dc.splits[li];
        }
        return false;
    }
}

function poisson(rng, lambda, cap) {
    if (lambda <= 0) return 0;
    let p = Math.exp(-lambda), cum = p, u = rng(), k = 0;
    while (u > cum && k < cap) { k++; p *= lambda / k; cum += p; }
    return k;
}

if (typeof module !== 'undefined') {
    module.exports = { SIM, World, makeObs, poisson };
}
