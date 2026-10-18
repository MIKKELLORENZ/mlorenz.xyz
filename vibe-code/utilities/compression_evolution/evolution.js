/* evolution.js — the genetic algorithm. DOM-free; the caller supplies `evaluate`,
   which turns a batch of genomes into compressed sizes (in workers, or inline).

   Fitness is DETERMINISTIC — the same design always compresses the same sample to
   the same number of bytes — so nothing is ever evaluated twice (cache), elites
   are never re-tested, and there is no winner's curse to guard against. What a
   deterministic, elitist search does suffer from is premature convergence: the
   first half-decent lineage floods the population and every other architecture
   dies untuned. So:

     niches    designs are grouped by skeleton (direct / predict / predict-16 /
               sort-first, see genome.js). Every living species keeps its own
               seats and a breeding quota, and is raced against ITS OWN weakest
               survivor, so four architectures are tuned side by side and the
               page can show what each family looks like at its best.
     extinction a niche that has had time, has stopped improving and is still far
               behind the leader loses its quota — the search should not pay for
               16-bit audio prediction on a photograph for ever.
     racing    a candidate is compared with its niche's weakest survivor at
               25/50/75 % of the sample and abandoned early if clearly behind —
               most mutations are harmful, and finishing them is where the time
               would otherwise go. */

(function (root) {
'use strict';
const CE = root.CE = root.CE || {};
const codec = CE.codec, G = CE.genome;

const DEFAULTS = {
    popSize: 40, survivors: 12, nicheSeats: 2, nicheShare: 0.12, maxExperts: 8, parsimony: 0.0004,
    crossover: 0.15, immigrants: 0.03, racing: true, seed: 1,
    extinctAfter: 30, extinctStale: 18, extinctRatio: 1.5
};
// how far behind its niche's weakest survivor a candidate may be at checkpoint j of m
function raceTol(j, m) { return 0.035 + 0.085 * (1 - j / Math.max(1, m - 1)); }

function Evolution(opts) {
    this.o = Object.assign({}, DEFAULTS, opts || {});
    this.ctx = this.o.ctx;
    this.evaluate = this.o.evaluate;
    this.rng = G.makeRng(this.o.seed);
    this.lim = { maxExperts: this.o.maxExperts };
    this.pop = [];
    this.gen = 0;
    this.evals = 0; this.aborted = 0; this.cacheHits = 0; this.evalMs = 0;
    this.cache = new Map();
    this.niche = new Map();            // species -> { born, best, bestGen, extinct, extinctGen }
    this.champion = null;
    this.stagnant = 0;
    this.history = [];                 // per generation: { gen, best, species: {key: bestSize} }
    this.onChampion = this.o.onChampion || null;
    this.onExtinct = this.o.onExtinct || null;
}

Evolution.prototype.fitOf = function (genome, size) { return size * (1 + this.o.parsimony * G.complexity(genome)); };

Evolution.prototype._make = function (genome, note, parent) {
    return { genome, key: codec.genomeKey(genome), species: G.species(genome), note: note || '', parentSize: parent ? parent.size : null, parentSpecies: parent ? parent.species : null, born: this.gen, size: Infinity, fit: Infinity, cum: null, ms: 0, aborted: false };
};

Evolution.prototype._score = async function (inds, capsBySpecies) {
    const todo = [];
    for (const ind of inds) {
        const hit = this.cache.get(ind.key);
        if (hit) { this.cacheHits++; ind.size = hit.size; ind.cum = hit.cum; ind.ms = hit.ms; ind.aborted = hit.aborted; ind.fit = hit.aborted ? Infinity : this.fitOf(ind.genome, hit.size); }
        else todo.push(ind);
    }
    if (!todo.length) return;
    // the note rides along for whoever watches designs come back; the pool ignores it
    const res = await this.evaluate(todo.map(ind => ({ genome: ind.genome, caps: (capsBySpecies && capsBySpecies.get(ind.species)) || null, note: ind.note })));
    for (let i = 0; i < todo.length; i++) {
        const ind = todo[i], r = res[i] || { aborted: true };
        this.evals++; this.evalMs += r.ms || 0;
        ind.aborted = !!r.aborted; ind.ms = r.ms || 0; ind.cum = r.cum || null;
        ind.size = r.aborted ? Infinity : r.size;
        ind.fit = r.aborted ? Infinity : this.fitOf(ind.genome, r.size);
        if (r.aborted) this.aborted++;
        if (this.cache.size > 60000) this.cache.clear();
        this.cache.set(ind.key, { size: ind.size, cum: ind.cum, ms: ind.ms, aborted: ind.aborted });
    }
};

Evolution.prototype.seed = function (genomes) { this._seeds = genomes; };

Evolution.prototype.init = async function () {
    const o = this.o, seen = new Set(), first = [];
    const add = (g, note) => { const ind = this._make(codec.normalize(g), note, null); if (!seen.has(ind.key)) { seen.add(ind.key); first.push(ind); } };
    // Generation 0 is ONE design: count which byte values are common, nothing else.
    // Everything on the chart after that was found, not given. (o.founders restores
    // the old head start — a few simple members of every family plus random designs.)
    // a design carried in may be larger than the cap: the cap yields, or every child of
    // it would be a truncated copy and the seed could never be improved on
    for (const s of this._seeds || []) this.lim.maxExperts = Math.max(this.lim.maxExperts, codec.normalize(s).experts.length);
    add(G.minimal(), 'the starting point: just count which byte values are common');
    for (const s of this._seeds || []) add(s, o.seedNote || 'a design carried over from a saved run');
    if (o.founders) {
        for (const sp of G.SPECIES_ORDER) for (let k = 0; k < 3; k++) add(G.founder(sp, this.rng, this.ctx, this.lim), 'founder of the “' + G.SPECIES[sp].short + '” family');
        for (let guard = 0; first.length < o.popSize && guard < o.popSize * 20; guard++) add(G.random(this.rng, this.ctx, this.lim), 'random first attempt');
    }
    await this._score(first, null);
    this.pop = first;
    this._afterGeneration();
};

// survivors per niche; the leader's niche takes every seat the others leave
Evolution.prototype._select = function () {
    const o = this.o, alive = this.pop.filter(i => i.fit < Infinity).sort((a, b) => a.fit - b.fit), groups = new Map();
    for (const ind of alive) { if (!groups.has(ind.species)) groups.set(ind.species, []); groups.get(ind.species).push(ind); }
    if (!alive.length) return { survivors: [], groups, leader: null };
    const leader = alive[0].species, survivors = [], keys = new Set();
    for (const [sp, list] of groups) {
        if (sp === leader) continue;
        const st = this.niche.get(sp);
        if (st && st.extinct) continue;
        for (let k = 0; k < o.nicheSeats && k < list.length; k++) { survivors.push(list[k]); keys.add(list[k].key); }
    }
    for (const ind of alive) { if (survivors.length >= o.survivors) break; if (!keys.has(ind.key)) { survivors.push(ind); keys.add(ind.key); } }
    survivors.sort((a, b) => a.fit - b.fit);
    return { survivors, groups, leader };
};

Evolution.prototype._tournament = function (list) {
    const a = this.rng.pick(list), b = this.rng.pick(list);
    return a.fit <= b.fit ? a : b;
};

Evolution.prototype._child = function (parent, mates, hyper) {
    let genome = parent.genome, note = '';
    if (mates.length > 1 && this.rng.chance(this.o.crossover)) {
        const mate = this._tournament(mates);
        if (mate.key !== parent.key) { genome = G.crossover(parent.genome, mate.genome, this.rng); note = 'crossed two designs'; }
    }
    const rounds = hyper && this.rng.chance(0.35) ? this.rng.int(2, 4) : 1;
    for (let k = 0; k < rounds; k++) {
        const m = G.mutate(genome, this.rng, this.ctx, this.lim);
        if (m) { genome = m.genome; note = note ? note + '; ' + m.note : m.note; }
    }
    if (!note || genome.experts.length > this.lim.maxExperts) return null;
    return this._make(genome, note, parent);
};

Evolution.prototype.step = async function () {
    if (!this.pop.length) { await this.init(); return; }
    this.gen++;
    const o = this.o, { survivors, leader } = this._select();
    if (!survivors.length) { this.pop = []; await this.init(); return; }
    const keys = new Set(survivors.map(s => s.key)), kids = [], want = o.popSize - survivors.length;
    const push = ind => { if (ind && !keys.has(ind.key)) { keys.add(ind.key); kids.push(ind); return true; } return false; };
    const bySp = new Map();
    for (const s of survivors) { if (!bySp.has(s.species)) bySp.set(s.species, []); bySp.get(s.species).push(s); }
    const hyper = this.stagnant > 25;
    // breeding quota of every non-leading niche
    for (const [sp, list] of bySp) {
        if (sp === leader) continue;
        const quota = Math.max(3, Math.round(want * o.nicheShare));
        for (let k = 0, tries = 0; k < quota && tries < quota * 8; tries++) if (push(this._child(this._tournament(list), list, hyper))) k++;
    }
    // families nobody has tried yet get a founder — blind variation would find them
    // eventually, this just keeps the four-way comparison from depending on luck
    for (const sp of G.SPECIES_ORDER) if (!this.niche.has(sp) && this.gen >= 2 && this.gen <= 40 && this.gen % 2 === 0) push(this._make(G.founder(sp, this.rng, this.ctx, this.lim), 'first member of the “' + G.SPECIES[sp].short + '” family', null));
    for (let guard = 0; kids.length < want && guard < want * 30; guard++) {
        if (this.rng.chance(o.immigrants)) { push(this._make(G.random(this.rng, this.ctx, this.lim), 'fresh random design', null)); continue; }
        const list = bySp.get(leader) || survivors;
        push(this._child(this._tournament(list), list, hyper));
    }
    // race each child against the weakest survivor of the niche it landed in
    let caps = null;
    if (o.racing) {
        caps = new Map();
        for (const [sp, list] of bySp) {
            const worst = list[list.length - 1];
            if (list.length >= 2 && worst.cum && worst.cum.length) caps.set(sp, worst.cum.map((c, j) => Math.ceil(c * (1 + raceTol(j, worst.cum.length))) + 64));
        }
    }
    await this._score(kids, caps);
    this.pop = survivors.concat(kids);
    this._afterGeneration();
};

Evolution.prototype._afterGeneration = function () {
    const o = this.o, alive = this.pop.filter(i => i.fit < Infinity).sort((a, b) => a.fit - b.fit);
    if (!alive.length) return;
    const best = alive[0];
    if (!this.champion || best.fit < this.champion.fit - 1e-9) {
        const prev = this.champion;
        this.champion = best; this.stagnant = 0;
        if (this.onChampion) this.onChampion(best, prev, this.gen);
    } else this.stagnant++;
    const sp = {};
    for (const ind of alive) {
        if (ind.species in sp) continue;
        sp[ind.species] = ind.size;
        let st = this.niche.get(ind.species);
        if (!st) { st = { born: this.gen, best: Infinity, bestGen: this.gen, extinct: false, extinctGen: 0, leader: null }; this.niche.set(ind.species, st); }
        if (ind.size < st.best) { st.best = ind.size; st.bestGen = this.gen; st.leader = ind; if (st.extinct) st.extinct = false; }
    }
    for (const [key, st] of this.niche) {
        if (st.extinct || key === best.species) continue;
        if (this.gen - st.born >= o.extinctAfter && this.gen - st.bestGen >= o.extinctStale && st.best > best.size * o.extinctRatio) {
            st.extinct = true; st.extinctGen = this.gen;
            if (this.onExtinct) this.onExtinct(key, st, this.gen);
        }
    }
    this.history.push({ gen: this.gen, best: best.size, species: sp, alive: alive.length, total: this.pop.length });
};

// every niche ever seen, leader first: { species, best (individual), bestSize, count, extinct, … }
Evolution.prototype.speciesLeaders = function () {
    const counts = new Map();
    for (const ind of this.pop) if (ind.fit < Infinity) counts.set(ind.species, (counts.get(ind.species) || 0) + 1);
    const out = [];
    for (const [key, st] of this.niche) out.push({ species: key, best: st.leader, bestSize: st.best, count: counts.get(key) || 0, extinct: st.extinct, extinctGen: st.extinctGen, born: st.born, bestGen: st.bestGen });
    return out.sort((a, b) => a.bestSize - b.bestSize);
};

CE.Evolution = Evolution;
if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof self !== 'undefined' ? self : globalThis);
