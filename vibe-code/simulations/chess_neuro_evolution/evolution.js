// Neuroevolution driver: observation encoding, greedy one-ply move selection,
// paired self-play matches, fitness aggregation, and the genetic algorithm
// (elitism, rank selection, blended crossover, Gaussian mutation, immigrants,
// stagnation-adaptive mutation). No gradients, no value functions.
'use strict';

const MAX_PLIES = 140;
const WIN_REWARD = 10000;
const FEAT_LEN = 401; // 6 piece planes * 64 squares + 17 engineered features

const GA = {
    elites: 4,
    champVariantFrac: 0.08,
    crossoverFrac: 0.55,
    mutantFrac: 0.25,
    immigrantFrac: 0.12,
    selectionPressure: 2.0,
    baseMutationRate: 0.08,
    baseMutationStrength: 0.15,
    baseResetProb: 0.001,
    stagnationThreshold: 12
};

const _feat = new Float64Array(FEAT_LEN);

// Encode the position from `side`'s perspective. `oppMoves` are the opponent's
// last two committed moves (may contain nulls).
function encodeFeatures(game, side, oppMoves, ply) {
    const f = _feat;
    const b = game.board;
    // 6 signed one-hot piece planes (P,N,B,R,Q,K): +1 own piece, -1 opponent
    // piece on that square. Own home rank is always at the bottom (rank-flip
    // for black), so both colors perceive positions identically.
    f.fill(0, 0, 384);
    for (let r = 0; r < 8; r++) {
        const rank = side === 1 ? r : 7 - r;
        for (let file = 0; file < 8; file++) {
            const p = b[rank * 16 + file];
            if (p === 0) continue;
            f[(Math.abs(p) - 1) * 64 + r * 8 + file] = Math.sign(p) * side;
        }
    }
    let k = 384;
    // castling rights: own K/Q, opponent K/Q
    const cr = game.castling;
    const ownK = side === 1 ? 1 : 4, ownQ = side === 1 ? 2 : 8;
    f[k++] = (cr & ownK) ? 1 : 0;
    f[k++] = (cr & ownQ) ? 1 : 0;
    f[k++] = (cr & (side === 1 ? 4 : 1)) ? 1 : 0;
    f[k++] = (cr & (side === 1 ? 8 : 2)) ? 1 : 0;
    // material balance, own perspective, clamped to [-1, 1]
    const mat = game.material() * side;
    f[k++] = Math.max(-1, Math.min(1, mat / 12));
    // pawn advancement: fraction of own pawns past midline, same for opponent
    let ownPawns = 0, ownAdv = 0, oppPawns = 0, oppAdv = 0;
    for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (Math.abs(p) !== 1) continue;
        const rank = sq >> 4;
        if (Math.sign(p) === side) {
            ownPawns++;
            if (side === 1 ? rank >= 4 : rank <= 3) ownAdv++;
        } else {
            oppPawns++;
            if (side === 1 ? rank <= 3 : rank >= 4) oppAdv++;
        }
    }
    f[k++] = ownPawns ? ownAdv / ownPawns : 0;
    f[k++] = oppPawns ? oppAdv / oppPawns : 0;
    // opponent's last two moves: from/to file & rank in [0, 1], rank-flipped
    for (let i = 0; i < 2; i++) {
        const m = oppMoves[i];
        if (!m) { f[k++] = 0; f[k++] = 0; f[k++] = 0; f[k++] = 0; continue; }
        for (const sq of [m.from, m.to]) {
            const rank = side === 1 ? (sq >> 4) : 7 - (sq >> 4);
            f[k++] = (sq & 7) / 7;
            f[k++] = rank / 7;
        }
    }
    // opponent in check right now
    f[k++] = game.inCheck(-side) ? 1 : 0;
    // game progress
    f[k++] = Math.min(1, ply / MAX_PLIES);
    // safety: clamp + scrub invalid values
    for (let i = 0; i < FEAT_LEN; i++) {
        const v = f[i];
        if (!Number.isFinite(v)) f[i] = 0;
        else if (v > 1) f[i] = 1;
        else if (v < -1) f[i] = -1;
    }
    return f;
}

// One-ply greedy policy: try every legal move, score the resulting position
// with the genome's network, play the argmax. `noise` adds a little score
// jitter for early exploration. Returns the chosen move or null (game over).
function chooseMove(game, genome, noise, rng, record) {
    const moves = game.moves();
    if (moves.length === 0) return null;
    const side = game.turn;
    const lm = game.lastMoves;
    // opponent's last two committed moves (most recent first)
    const oppMoves = [lm.length >= 1 ? lm[lm.length - 1] : null,
                      lm.length >= 3 ? lm[lm.length - 3] : null];
    let best = null, bestScore = -Infinity, bestFeatRecord = null;
    for (const m of moves) {
        const undo = game._make(m);
        const feats = encodeFeatures(game, side, oppMoves, game.ply + 1);
        const wantRecord = record ? [] : null;
        let score = forward(genome, feats, wantRecord);
        game._unmake(m, undo);
        if (noise > 0) score += gaussian(rng) * noise;
        if (score > bestScore) { bestScore = score; best = m; bestFeatRecord = wantRecord; }
    }
    if (record && bestFeatRecord) {
        record.layers = bestFeatRecord;
        record.score = bestScore;
    }
    return best;
}

// A single game between two population members.
class Match {
    constructor(whiteIdx, blackIdx) {
        this.white = whiteIdx;
        this.black = blackIdx;
        this.game = new Chess();
        this.done = false;
        this.outcome = null; // {winner: 1|-1|0, reason}
    }

    // Advance one ply. Returns true if the game just finished.
    step(pop, noise, rng, record) {
        if (this.done) return false;
        const g = this.game;
        const idx = g.turn === 1 ? this.white : this.black;
        const move = chooseMove(g, pop[idx].genome, noise, rng, record);
        if (move === null) {
            this._finish(g.result() || { winner: 0, reason: 'stalemate' });
            return true;
        }
        g.push(move);
        const res = g.result();
        if (res) { this._finish(res); return true; }
        if (g.ply >= MAX_PLIES) {
            const mat = g.material();
            const winner = mat >= 2 ? 1 : mat <= -2 ? -1 : 0;
            this._finish({ winner, reason: 'adjudicated' });
            return true;
        }
        return false;
    }

    _finish(outcome) {
        this.done = true;
        this.outcome = outcome;
    }

    // Fitness for one player. Wins dominate everything; material, survival and
    // speed are small shaping terms only.
    fitnessFor(side) {
        const mat = Math.max(-10, Math.min(10, this.game.material() * side));
        const plies = this.game.ply;
        if (this.outcome.winner === side) return WIN_REWARD + (MAX_PLIES - plies) * 5 + mat * 20;
        if (this.outcome.winner === 0) return 1000 + mat * 40;
        return -1000 + mat * 40 + plies * 2;
    }
}

class Evolution {
    constructor(popSize, seed) {
        this.popSize = Math.max(16, popSize - (popSize % 2));
        this.seed = seed >>> 0;
        this.rng = makeRng(this.seed);
        this.gen = 1;
        this.stagnantGens = 0;
        this.bestEver = { wins: -1, aggregate: -Infinity };
        this.champion = null; // {genome, wins, aggregate, gen}
        // per-generation series for the UI:
        //   best/median  aggregate fitness (median = population as a whole)
        //   bench        champion score vs a random-mover baseline (0..1)
        //   mates/adjWins/draws  outcome fractions of all games that generation
        this.history = { best: [], median: [], bench: [], mates: [], adjWins: [], draws: [] };
        this.diversity = 0;
        this.leaderIdx = 0;
        this.recordLeader = true; // UI turns this off in headless mode
        this.pop = [];
        for (let i = 0; i < this.popSize; i++) {
            this.pop.push(this._newIndividual(randomGenome(this.rng)));
        }
        this._startGeneration();
    }

    _newIndividual(genome) {
        return { genome, fitnesses: [], wins: 0, draws: 0, losses: 0, aggregate: 0, score: 0 };
    }

    effectiveMutation() {
        const s = Math.min(this.stagnantGens / GA.stagnationThreshold, 1);
        const lerp = (a, b) => a + (b - a) * s;
        return {
            rate: GA.baseMutationRate * lerp(1, 1.8),
            strength: GA.baseMutationStrength * lerp(1, 2.2),
            resetProb: GA.baseResetProb * lerp(1, 3.0),
            scale: s
        };
    }

    _startGeneration() {
        for (const ind of this.pop) {
            ind.fitnesses = [];
            ind.wins = 0; ind.draws = 0; ind.losses = 0; ind.score = 0;
        }
        this._genOutcomes = { mate: 0, adj: 0, draw: 0, total: 0 };
        this.round = 0;       // 0..3: R1 colors A, R1 colors B, R2 A, R2 B
        this.noise = Math.max(0, 0.15 * (1 - this.gen / 25));
        this._round1Pairs = this._shufflePairs();
        this._startWave();
    }

    _shufflePairs() {
        const order = [...Array(this.popSize).keys()];
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        const pairs = [];
        for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
        return pairs;
    }

    _scorePairs() {
        // Swiss-style: rank by in-generation results so far, pair neighbours.
        const order = [...Array(this.popSize).keys()].sort((a, b) => {
            const A = this.pop[a], B = this.pop[b];
            return (B.wins - A.wins) || (B.score - A.score);
        });
        const pairs = [];
        for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
        return pairs;
    }

    _startWave() {
        const pairs = this.round < 2 ? this._round1Pairs : (this._round2Pairs ||= this._scorePairs());
        const swap = this.round % 2 === 1;
        this.matches = pairs.map(([a, b]) => swap ? new Match(b, a) : new Match(a, b));
        this._cursor = 0;
        this.gamesDone = 0;
    }

    // Advance up to `budget` plies across active games. Returns plies made.
    step(budget) {
        let made = 0;
        while (made < budget) {
            if (this.gamesDone >= this.matches.length) {
                this._endWave();
                made++; // count transitions so the loop always terminates
                continue;
            }
            const m = this.matches[this._cursor];
            this._cursor = (this._cursor + 1) % this.matches.length;
            if (m.done) continue;
            const isLeader = this.recordLeader &&
                (m.white === this.leaderIdx || m.black === this.leaderIdx);
            const record = isLeader ? {} : null;
            const finished = m.step(this.pop, this.noise, this.rng, record);
            if (record && record.layers) this.leaderRecord = record;
            made++;
            if (finished) {
                this.gamesDone++;
                this._applyResult(m);
            }
        }
        return made;
    }

    _applyResult(m) {
        const w = this.pop[m.white], b = this.pop[m.black];
        const fw = m.fitnessFor(1), fb = m.fitnessFor(-1);
        w.fitnesses.push(fw); b.fitnesses.push(fb);
        w.score += fw; b.score += fb;
        const win = m.outcome.winner;
        if (win === 1) { w.wins++; b.losses++; }
        else if (win === -1) { b.wins++; w.losses++; }
        else { w.draws++; b.draws++; }
        const o = this._genOutcomes;
        if (win === 0) o.draw++;
        else if (m.outcome.reason === 'checkmate') o.mate++;
        else o.adj++;
        o.total++;
    }

    _endWave() {
        this.round++;
        if (this.round < 4) { this._startWave(); return; }
        this._finishGeneration();
    }

    _finishGeneration() {
        // Robust aggregate: mean * 0.58 + median * 0.27 + worst * 0.15
        for (const ind of this.pop) {
            const fs = ind.fitnesses.slice().sort((a, b) => a - b);
            const mean = fs.reduce((s, v) => s + v, 0) / fs.length;
            const median = fs.length % 2 ? fs[(fs.length - 1) / 2]
                : (fs[fs.length / 2 - 1] + fs[fs.length / 2]) / 2;
            ind.aggregate = mean * 0.58 + median * 0.27 + fs[0] * 0.15;
        }
        // Lexicographic rank: wins first, then aggregate fitness
        const ranked = this.pop.slice().sort((a, b) =>
            (b.wins - a.wins) || (b.aggregate - a.aggregate));

        const best = ranked[0];
        const o = this._genOutcomes;
        this.history.best.push(best.aggregate);
        this.history.median.push(ranked[Math.floor(ranked.length / 2)].aggregate);
        this.history.mates.push(o.total ? o.mate / o.total : 0);
        this.history.adjWins.push(o.total ? o.adj / o.total : 0);
        this.history.draws.push(o.total ? o.draw / o.total : 0);

        // Champion update: champion plays every generation, so compare on
        // current results only.
        if (!this.champion || best.wins > this.champion.wins ||
            (best.wins === this.champion.wins && best.aggregate >= this.champion.aggregate) ||
            best.genome === this.champion.genome) {
            this.champion = {
                genome: cloneGenome(best.genome),
                wins: best.wins, aggregate: best.aggregate, gen: this.gen
            };
        } else {
            // refresh champion's current-generation stats if it is in the pop
            const champInd = this.pop.find(i => i.genome === this._champRef);
            if (champInd) { this.champion.wins = champInd.wins; this.champion.aggregate = champInd.aggregate; }
        }

        // Stagnation tracking (meaningful improvement only)
        const improved = best.wins > this.bestEver.wins ||
            (best.wins === this.bestEver.wins &&
             best.aggregate > this.bestEver.aggregate + Math.abs(this.bestEver.aggregate) * 0.005 + 1);
        if (improved) {
            this.bestEver = { wins: best.wins, aggregate: best.aggregate };
            this.stagnantGens = 0;
        } else {
            this.stagnantGens++;
        }

        this._benchmarkChampion();
        this._breed(ranked);
        this._estimateDiversity();
        for (const key of Object.keys(this.history)) {
            if (this.history[key].length > 400) this.history[key].shift();
        }
        this.gen++;
        this._round2Pairs = null;
        this._startGeneration();
    }

    // Interpretable learning signal: the champion plays 4 quick games against
    // a uniformly random legal-move player. Score = (wins + draws/2) / 4.
    // A random genome hovers near 0.5 vs random; real learning pushes this
    // toward 1.0.
    _benchmarkChampion() {
        if (!this.champion) { this.history.bench.push(0.5); return; }
        const rng = makeRng((this.seed ^ Math.imul(this.gen, 2654435761)) >>> 0);
        let score = 0;
        const games = 4;
        for (let gi = 0; gi < games; gi++) {
            const champSide = gi % 2 === 0 ? 1 : -1;
            const g = new Chess();
            while (!g.result() && g.ply < 120) {
                let m;
                if (g.turn === champSide) {
                    m = chooseMove(g, this.champion.genome, 0, rng, null);
                } else {
                    const ms = g.moves();
                    m = ms.length ? ms[Math.floor(rng() * ms.length)] : null;
                }
                if (!m) break;
                g.push(m);
            }
            const res = g.result();
            let winner;
            if (res) winner = res.winner;
            else { const mat = g.material(); winner = mat >= 2 ? 1 : mat <= -2 ? -1 : 0; }
            if (winner === champSide) score += 1;
            else if (winner === 0) score += 0.5;
        }
        this.history.bench.push(score / games);
    }

    // Cheap genome-diversity estimate: mean |gene difference| over sampled
    // pairs. Near zero means the population has converged.
    _estimateDiversity() {
        const n = this.pop.length;
        let sum = 0, count = 0;
        for (let s = 0; s < 12; s++) {
            const a = this.pop[Math.floor(this.rng() * n)].genome;
            const b = this.pop[Math.floor(this.rng() * n)].genome;
            for (let t = 0; t < 40; t++) {
                const i = Math.floor(this.rng() * a.length);
                sum += Math.abs(a[i] - b[i]);
                count++;
            }
        }
        this.diversity = sum / count;
    }

    _breed(ranked) {
        const mut = this.effectiveMutation();
        const next = [];
        // exact elites (deep-cloned so nothing can mutate them in place)
        for (let i = 0; i < Math.min(GA.elites, ranked.length); i++) {
            next.push(this._newIndividual(cloneGenome(ranked[i].genome)));
        }
        // protected global champion (skip if identical to elite #1)
        const champDup = ranked[0].genome === this._champRef;
        if (this.champion && !champDup) {
            next.push(this._newIndividual(cloneGenome(this.champion.genome)));
        }
        this._champRef = next.length > GA.elites ? next[GA.elites].genome : next[0].genome;
        this.leaderIdx = 0; // elites are placed first; slot 0 is last gen's best

        // rank-biased parent sampling
        const nRanked = ranked.length;
        const weights = ranked.map((_, r) => Math.pow(nRanked - r, GA.selectionPressure));
        const totalW = weights.reduce((s, v) => s + v, 0);
        const pickParent = () => {
            let t = this.rng() * totalW;
            for (let i = 0; i < nRanked; i++) { t -= weights[i]; if (t <= 0) return ranked[i]; }
            return ranked[nRanked - 1];
        };

        const free = this.popSize - next.length;
        const nChampVar = Math.round(free * GA.champVariantFrac);
        const nImmigrant = Math.max(1, Math.round(free * GA.immigrantFrac));
        const nCross = Math.round(free * GA.crossoverFrac);

        for (let i = 0; i < nChampVar && next.length < this.popSize; i++) {
            const g = mutate(cloneGenome(this.champion.genome),
                mut.rate * 0.6, mut.strength * 0.5, mut.resetProb, this.rng);
            next.push(this._newIndividual(g));
        }
        for (let i = 0; i < nCross && next.length < this.popSize; i++) {
            let a = pickParent(), b = pickParent(), tries = 0;
            while (b === a && tries++ < 8) b = pickParent();
            const g = mutate(crossover(a.genome, b.genome, this.rng),
                mut.rate, mut.strength, mut.resetProb, this.rng);
            next.push(this._newIndividual(g));
        }
        while (next.length < this.popSize - nImmigrant) {
            const g = mutate(cloneGenome(pickParent().genome),
                mut.rate * 1.4, mut.strength * 1.3, mut.resetProb, this.rng);
            next.push(this._newIndividual(g));
        }
        while (next.length < this.popSize) {
            next.push(this._newIndividual(randomGenome(this.rng))); // fresh immigrants
        }
        // safety net: repair anything invalid rather than crash mid-run
        for (const ind of next) {
            if (!validGenome(ind.genome)) repairGenome(ind.genome);
        }
        this.pop = next;
    }

    leaderMatch() {
        if (!this.matches) return null;
        return this.matches.find(m =>
            (m.white === this.leaderIdx || m.black === this.leaderIdx) && !m.done)
            || this.matches.find(m => m.white === this.leaderIdx || m.black === this.leaderIdx)
            || null;
    }
}

if (typeof module !== 'undefined') {
    module.exports = { Evolution, Match, chooseMove, encodeFeatures, MAX_PLIES, FEAT_LEN, GA };
}
