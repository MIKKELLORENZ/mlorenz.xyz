// Neuroevolution driver: move selection from the dual-head policy, opening
// diversity, self-play plus a scripted opponent ladder, fitness aggregation and
// the genetic algorithm. No gradients, no backpropagation, no value targets.
//
// Three things here matter as much as the network does:
//
//  * Openings. Every game starts from a different position (book line or a
//    short random prefix). Without this, two similar genomes play the exact
//    same game every time and a whole generation produces one bit of signal.
//
//  * The ladder. Pure self-play has no absolute yardstick - a population can
//    happily go round in circles beating itself. Every genome also plays a
//    scripted opponent whose strength is fixed forever, so fitness means the
//    same thing in generation 900 as it did in generation 9.
//
//  * A validated champion. A new best-of-generation only takes the crown after
//    winning a head-to-head duel against the sitting champion. Otherwise the
//    crown tracks luck in an 8-game sample, and the archive fills with noise.
'use strict';

const WIN_POINTS = 1, DRAW_POINTS = 0.5;

const GA = {
    elites: 3,
    champVariantFrac: 0.10,
    crossoverFrac: 0.50,
    mutantFrac: 0.22,
    rowMutantFrac: 0.08,
    immigrantFrac: 0.08,
    selectionPressure: 1.9,
    baseMutationRate: 0.07,
    baseMutationStrength: 0.14,
    baseResetProb: 0.0008,
    stagnationThreshold: 14,
    gauntletOpponents: 2,
    hofSize: 10,
    duelGames: 6,
    // A challenger must beat the incumbent by a margin, not merely draw the
    // duel. At 6 games a 3.5-2.5 happens by luck often enough that a bare
    // "> 50%" rule hands the crown around every generation and the archive
    // fills with genomes that were never better than what they replaced.
    duelMargin: 0.58,
    benchGames: 4,
    cloneDistance: 0.012
};

// Weights on a game's points, by how hard the opponent is. Beating the material
// bot has to be worth more than beating a random mover, or a population can
// farm the easy rungs forever.
const OPP_WEIGHT = { self: 1.0, random: 0.5, capture: 0.85, careless: 1.1, greedy: 1.45, hof: 1.15 };

// --------------------------------------------------------------- opponents --
const _bAtkW = new Int8Array(128), _bAtkB = new Int8Array(128);

// Static evaluation used only by the scripted ladder bots: material, minus
// what is hanging. Never used by an evolved brain.
function staticEval(game, side) {
    game.attackMaps(_bAtkW, _bAtkB);
    const own = side === 1 ? _bAtkW : _bAtkB;
    const opp = side === 1 ? _bAtkB : _bAtkW;
    const b = game.board;
    let score = 0;
    for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (p === 0) continue;
        const ap = p > 0 ? p : -p;
        const val = MAT_VAL[ap] / 10;
        const mine = (p > 0 ? 1 : -1) === side;
        score += mine ? val : -val;
        if (ap === K) continue;
        if (mine && opp[sq] > 0 && own[sq] === 0) score -= val * 0.9;
        else if (!mine && own[sq] > 0 && opp[sq] === 0) score += val * 0.5;
    }
    return score;
}

function pickMateIn1(game, moves) {
    const side = game.turn;
    for (const m of moves) {
        const undo = game._make(m);
        let mate = false;
        const ks = game.kingSq(-side);
        if (ks >= 0 && game.isAttacked(ks, side)) mate = game.moves().length === 0;
        game._unmake(m, undo);
        if (mate) return m;
    }
    return null;
}

function botRandom(game, rng) {
    const ms = game.moves();
    return ms.length ? ms[Math.floor(rng() * ms.length)] : null;
}

function botCapture(game, rng) {
    const ms = game.moves();
    if (!ms.length) return null;
    const mate = pickMateIn1(game, ms);
    if (mate) return mate;
    if (rng() < 0.8) {
        let best = null, bv = 0;
        for (const m of ms) {
            const v = m.capture !== 0 ? MAT_VAL[Math.abs(m.capture)] : 0;
            if (v > bv) { bv = v; best = m; }
        }
        if (best) return best;
    }
    return ms[Math.floor(rng() * ms.length)];
}

function botGreedy(game, rng) {
    const ms = game.moves();
    if (!ms.length) return null;
    const mate = pickMateIn1(game, ms);
    if (mate) return mate;
    const side = game.turn;
    let best = null, bestScore = -Infinity;
    for (const m of ms) {
        const undo = game._make(m);
        let s = staticEval(game, side);
        game._unmake(m, undo);
        s += rng() * 0.08;
        if (s > bestScore) { bestScore = s; best = m; }
    }
    return best;
}

// Half greedy, half capture-grabber. The gap between "grabs whatever is free"
// and "never leaves anything hanging" is enormous - a population that has
// mastered the first scores zero against the second, and a rung nobody can
// take a point off contributes no selection signal at all. This is the step in
// between, and it is where most of the useful pressure comes from.
function botCareless(game, rng) {
    return rng() < 0.5 ? botGreedy(game, rng) : botCapture(game, rng);
}

const LADDER = [
    { name: 'random', label: 'random mover', fn: botRandom, weight: OPP_WEIGHT.random },
    { name: 'capture', label: 'capture grabber', fn: botCapture, weight: OPP_WEIGHT.capture },
    { name: 'careless', label: 'careless bot', fn: botCareless, weight: OPP_WEIGHT.careless },
    { name: 'greedy', label: 'material bot', fn: botGreedy, weight: OPP_WEIGHT.greedy }
];

// ----------------------------------------------------------------- openings --
// Coordinate notation, applied by matching moveStr(). Short mainlines only -
// the point is a spread of sane, structurally different middlegame starts.
const OPENING_BOOK = [
    'e2e4 e7e5 g1f3 b8c6 f1b5',
    'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6',
    'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4',
    'e2e4 e7e6 d2d4 d7d5 b1c3',
    'e2e4 c7c6 d2d4 d7d5 e4e5',
    'd2d4 d7d5 c2c4 e7e6 b1c3',
    'd2d4 d7d5 c2c4 c7c6 g1f3',
    'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7',
    'd2d4 g8f6 c2c4 e7e6 g1f3 b7b6',
    'c2c4 e7e5 b1c3 g8f6',
    'g1f3 d7d5 g2g3 g8f6 f1g2',
    'e2e4 d7d5 e4d5 d8d5 b1c3',
    'e2e4 g8f6 e4e5 f6d5 d2d4',
    'd2d4 f7f5 g2g3 g8f6 f1g2',
    'e2e4 e7e5 f1c4 f8c5 d1h5',
    'e2e4 e7e5 b1c3 g8f6 f2f4'
].map(s => s.split(' '));

// Deterministic opening from a seed, so a colour-swapped rematch replays the
// exact same starting position and the pair is a fair comparison.
function applyOpening(game, seed) {
    const rng = makeRng(seed >>> 0);
    const roll = rng();
    if (roll < 0.15) return;                      // straight from the initial position
    if (roll < 0.50) {
        const line = OPENING_BOOK[Math.floor(rng() * OPENING_BOOK.length)];
        const depth = 2 + Math.floor(rng() * (line.length - 1));
        for (let i = 0; i < Math.min(depth, line.length); i++) {
            const ms = game.moves();
            const m = ms.find(x => game.moveStr(x) === line[i]);
            if (!m || game.result()) return;
            game.push(m);
        }
        return;
    }
    const depth = 2 + 2 * Math.floor(rng() * 3);  // 2, 4 or 6 random plies
    for (let i = 0; i < depth; i++) {
        const ms = game.moves();
        if (!ms.length || game.result()) return;
        game.push(ms[Math.floor(rng() * ms.length)]);
    }
}

// ------------------------------------------------------------ move selection --
// Scratch for grouping legal moves by their (perspective) origin square.
const _fromBuckets = [];
for (let i = 0; i < 64; i++) _fromBuckets.push([]);
const _usedFrom = [];
const _cand = { move: [], score: [] };
const PROMO_ORDER = [Q, R, B, N];

// Board index (white's point of view, rank*8+file) for a perspective index.
function boardIdx(pi, side) {
    const pr = pi >> 3, file = pi & 7;
    return (side === 1 ? pr : 7 - pr) * 8 + file;
}

// The policy in one call: encode, run both heads, score every legal move as
// FROM[origin] + TO[origin][destination], then take the argmax (or sample from
// a softmax while exploring). No search, no lookahead - the single exception is
// an immediate checkmate, which a policy with no search could never learn to
// recognise as final rather than merely aggressive.
function chooseMove(game, genome, temp, rng, record) {
    const moves = game.moves();
    if (moves.length === 0) return null;
    const side = game.turn;

    if (moves.length > 1) {
        const mate = pickMateIn1(game, moves);
        if (mate) {
            if (record) { record.mate = true; record.move = mate; record.side = side; }
            return mate;
        }
    }

    const feats = encodePosition(game, side, moves);
    const pol = forwardPolicy(genome, feats);

    _usedFrom.length = 0;
    for (let i = 0; i < moves.length; i++) {
        const pi = perspIdx(moves[i].from, side);
        if (_fromBuckets[pi].length === 0) _usedFrom.push(pi);
        _fromBuckets[pi].push(moves[i]);
    }

    _cand.move.length = 0;
    _cand.score.length = 0;
    for (let u = 0; u < _usedFrom.length; u++) {
        const pi = _usedFrom[u];
        const bucket = _fromBuckets[pi];
        const toLog = toLogitsFor(genome, pi);
        const fromScore = pol.fromLogit[pi];
        for (let i = 0; i < bucket.length; i++) {
            const m = bucket[i];
            let s = fromScore + toLog[perspIdx(m.to, side)];
            if (m.promo !== 0) s += pol.promo[PROMO_ORDER.indexOf(Math.abs(m.promo))];
            _cand.move.push(m);
            _cand.score.push(s);
        }
        bucket.length = 0;
    }

    let chosen = 0;
    if (temp > 0) {
        // Softmax sampling. Exploration has to happen in move space: a genome
        // that always plays its argmax explores only when its weights change.
        let max = -Infinity;
        for (const s of _cand.score) if (s > max) max = s;
        let sum = 0;
        const w = _cand.score.map(s => { const e = Math.exp((s - max) / temp); sum += e; return e; });
        let t = rng() * sum;
        for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) { chosen = i; break; } }
    } else {
        let best = -Infinity;
        for (let i = 0; i < _cand.score.length; i++) {
            if (_cand.score[i] > best) { best = _cand.score[i]; chosen = i; }
        }
    }

    const move = _cand.move[chosen];
    if (record) {
        record.mate = false;
        record.side = side;
        record.move = move;
        record.score = _cand.score[chosen];
        record.trunk = Array.from(pol.h);
        // Head activity, redrawn on the board. Softmax over the squares that
        // actually have a legal move, so the picture is a real distribution.
        const fromProb = new Float64Array(64), toProb = new Float64Array(64);
        let fmax = -Infinity;
        for (const pi of _usedFrom) if (pol.fromLogit[pi] > fmax) fmax = pol.fromLogit[pi];
        let fsum = 0;
        const fExp = new Map();
        for (const pi of _usedFrom) { const e = Math.exp(pol.fromLogit[pi] - fmax); fExp.set(pi, e); fsum += e; }
        for (const pi of _usedFrom) fromProb[boardIdx(pi, side)] = fExp.get(pi) / fsum;

        const chosenFrom = perspIdx(move.from, side);
        const toLog = toLogitsFor(genome, chosenFrom);
        const targets = moves.filter(m => m.from === move.from);
        let tmax = -Infinity;
        for (const m of targets) { const v = toLog[perspIdx(m.to, side)]; if (v > tmax) tmax = v; }
        let tsum = 0;
        const tExp = targets.map(m => { const e = Math.exp(toLog[perspIdx(m.to, side)] - tmax); tsum += e; return e; });
        targets.forEach((m, i) => { toProb[boardIdx(perspIdx(m.to, side), side)] = tExp[i] / tsum; });

        record.fromProb = fromProb;
        record.toProb = toProb;
        record.legalCount = moves.length;
    }
    return move;
}

// ------------------------------------------------------------------ players --
function netPlayer(genome, popIdx, protectedPlay) {
    return { type: 'net', genome, popIdx, kind: 'self', label: 'genome', protectedPlay: !!protectedPlay };
}
function botPlayer(rung) {
    return { type: 'bot', fn: rung.fn, popIdx: -1, kind: rung.name, label: rung.label };
}
function hofPlayer(genome, gen) {
    return { type: 'net', genome, popIdx: -1, kind: 'hof', label: `champion g${gen}`, protectedPlay: true };
}

// -------------------------------------------------------------------- match --
class Match {
    // `opts.noOpening` starts from the initial position instead of a book line
    // or random prefix - used by the page's watch mode, where a viewer wants to
    // see a game from move one.
    constructor(white, black, openingSeed, opts) {
        this.white = white;
        this.black = black;
        this.game = new Chess();
        if (!(opts && opts.noOpening)) applyOpening(this.game, openingSeed);
        // Private RNG seeded from the scenario, not shared with the rest of the
        // generation. A capture bot that flips its coin the same way in every
        // genome's copy of the same game is the other half of common random
        // numbers: without it, two genomes facing "the same" opponent from the
        // same opening still get different games.
        this.rng = makeRng((openingSeed ^ 0xA53C9E17) >>> 0);
        this.done = false;
        this.outcome = this.game.result() || null;
        if (this.outcome) this.done = true;
    }

    step(temp, rng, record) {
        if (this.done) return false;
        const g = this.game;
        const p = g.turn === 1 ? this.white : this.black;
        const r = this.rng || rng;
        let move;
        if (p.type === 'bot') {
            move = p.fn(g, r);
        } else {
            const t = p.protectedPlay ? 0 : temp;
            move = chooseMove(g, p.genome, t, r, record);
        }
        if (move === null) {
            this._finish(g.result() || { winner: 0, reason: 'stalemate' });
            return true;
        }
        g.push(move);
        const res = g.result();
        if (res) { this._finish(res); return true; }
        if (g.ply >= MAX_PLIES) {
            const mat = g.material();
            const winner = mat >= 1.5 ? 1 : mat <= -1.5 ? -1 : 0;
            this._finish({ winner, reason: winner === 0 ? 'balanced' : 'adjudicated' });
            return true;
        }
        return false;
    }

    _finish(outcome) {
        this.done = true;
        this.outcome = outcome;
    }

    pointsFor(side) {
        if (this.outcome.winner === side) return WIN_POINTS;
        if (this.outcome.winner === 0) return DRAW_POINTS;
        return 0;
    }
}

// ---------------------------------------------------------------- evolution --
class Evolution {
    constructor(popSize, seed, opts) {
        opts = opts || {};
        this.popSize = Math.max(16, popSize - (popSize % 2));
        this.seed = seed >>> 0;
        this.rng = makeRng(this.seed);
        this.gen = 1;
        this.stagnantGens = 0;
        this.bestEver = -Infinity;
        this.champion = null;   // {genome, fitness, points, gen}
        this.hof = [];          // past champions, oldest first
        this.tier = 1;          // how far up the scripted ladder we currently play
        this.diversity = 0;
        this.leaderIdx = 0;
        this.recordLeader = true;
        this.leaderRecord = null;
        this._protected = new Set();
        this.history = {
            best: [], median: [], ladder: [],
            bench: LADDER.map(() => []), // one series per ladder rung
            mates: [], adjWins: [], draws: []
        };
        this.pop = [];
        for (let i = 0; i < this.popSize; i++) {
            this.pop.push(this._newIndividual(randomGenome(this.rng)));
        }
        if (opts.seedGenome) {
            // Warm start: the built-in champion plus a spread of variants.
            const base = opts.seedGenome;
            this.pop[0].genome = cloneGenome(base);
            for (let i = 1; i < Math.min(this.popSize, 12); i++) {
                this.pop[i].genome = mutate(cloneGenome(base), 0.12, 0.18, 0.001, this.rng);
            }
            this.champion = { genome: cloneGenome(base), fitness: 0, points: 0, gen: 0 };
        }
        this._startGeneration();
    }

    _newIndividual(genome) {
        return {
            genome, games: [], wsum: 0, psum: 0, points: 0,
            wins: 0, draws: 0, losses: 0, matWins: 0, fitness: 0,
            matSum: 0, mateCount: 0, repDraws: 0
        };
    }

    effectiveMutation() {
        const s = Math.min(this.stagnantGens / GA.stagnationThreshold, 1);
        const lerp = (a, b) => a + (b - a) * s;
        return {
            rate: GA.baseMutationRate * lerp(1, 1.9),
            strength: GA.baseMutationStrength * lerp(1, 2.4),
            resetProb: GA.baseResetProb * lerp(1, 3.0),
            scale: s
        };
    }

    // Which scripted rungs are in play this generation.
    activeLadder() {
        return LADDER.slice(0, Math.min(this.tier, LADDER.length));
    }

    _startGeneration() {
        for (const ind of this.pop) {
            ind.games = []; ind.wsum = 0; ind.psum = 0; ind.points = 0;
            ind.wins = 0; ind.draws = 0; ind.losses = 0;
            ind.matSum = 0; ind.mateCount = 0; ind.repDraws = 0;
        }
        this._genOutcomes = { mate: 0, adj: 0, draw: 0, total: 0 };
        this.wave = 0;
        // Exploration temperature: high early, effectively off once the
        // population is doing something deliberate.
        this.temp = Math.max(0, 0.55 * (1 - this.gen / 60));
        this._selfPairs = this._shufflePairs();
        this._gauntlet = this._drawGauntlet();
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
        const order = [...Array(this.popSize).keys()].sort((a, b) =>
            (this.pop[b].psum - this.pop[a].psum));
        const pairs = [];
        for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
        return pairs;
    }

    // ONE bank of opponents for the whole generation, shared by every genome.
    //
    // This is the single most important variance reduction in the run. Drawing
    // a different opponent and a different opening for each individual means
    // two genomes are graded on two different exams, and with only a handful of
    // games each the ranking measures the draw at least as much as it measures
    // skill. Same opponents, same openings, same bot decisions - then a
    // difference in score is a difference in play. The bank is redrawn every
    // generation, so nothing gets to overfit to it.
    _drawGauntlet() {
        const rungs = this.activeLadder();
        const bank = [];
        for (let k = 0; k < GA.gauntletOpponents; k++) {
            if (this.hof.length && this.rng() < 0.3) {
                const h = this.hof[Math.floor(this.rng() * this.hof.length)];
                bank.push({ player: hofPlayer(h.genome, h.gen), weight: OPP_WEIGHT.hof });
                continue;
            }
            // Always a taste of the next rung up. A hard gate means the
            // population only ever meets opponents it has already half-beaten,
            // and the top rung can end up never unlocking at all.
            const next = LADDER[this.tier];
            const r = (next && this.rng() < 0.25) ? next
                : (this.rng() < 0.6 ? rungs[rungs.length - 1]
                                    : rungs[Math.floor(this.rng() * rungs.length)]);
            bank.push({ player: botPlayer(r), weight: r.weight });
        }
        return bank;
    }

    _openingSeed(waveGroup, idx) {
        return (Math.imul(this.seed ^ Math.imul(this.gen, 0x9E3779B1), 0x85EBCA6B) ^
                Math.imul(waveGroup * 977 + idx, 0xC2B2AE35)) >>> 0;
    }

    _startWave() {
        const w = this.wave;
        this.matches = [];
        if (w < 4) {
            const pairs = w < 2 ? this._selfPairs : (this._round2Pairs ||= this._scorePairs());
            const swap = w % 2 === 1;
            pairs.forEach(([a, b], i) => {
                const seed = this._openingSeed(w < 2 ? 0 : 1, i);
                const A = netPlayer(this.pop[a].genome, a, this._protected.has(a));
                const B = netPlayer(this.pop[b].genome, b, this._protected.has(b));
                this.matches.push(swap ? new Match(B, A, seed) : new Match(A, B, seed));
            });
        } else {
            const asWhite = w === 4;
            for (let i = 0; i < this.popSize; i++) {
                this._gauntlet.forEach((opp, k) => {
                    // Same opening and the same scripted opponent for every
                    // genome in the population - only the genome differs. The
                    // seed deliberately ignores the wave, so wave 4 and wave 5
                    // are the same game with the colours swapped.
                    const seed = this._openingSeed(2 + k, 0);
                    const me = netPlayer(this.pop[i].genome, i, this._protected.has(i));
                    const flip = k % 2 === 1; // second opponent gets the other colour
                    const meWhite = asWhite !== flip;
                    const m = meWhite ? new Match(me, opp.player, seed) : new Match(opp.player, me, seed);
                    m.weight = opp.weight;
                    this.matches.push(m);
                });
            }
        }
        for (const m of this.matches) if (m.weight === undefined) m.weight = OPP_WEIGHT.self;
        this._cursor = 0;
        this.gamesDone = this.matches.filter(m => m.done).length;
        for (const m of this.matches) if (m.done) this._applyResult(m);
    }

    // Advance up to `budget` plies across the active wave.
    step(budget) {
        let made = 0;
        while (made < budget) {
            if (this.gamesDone >= this.matches.length) {
                this._endWave();
                made++;
                continue;
            }
            const m = this.matches[this._cursor];
            this._cursor = (this._cursor + 1) % this.matches.length;
            if (m.done) continue;
            const isLeader = this.recordLeader &&
                (m.white.popIdx === this.leaderIdx || m.black.popIdx === this.leaderIdx);
            const record = isLeader ? {} : null;
            const finished = m.step(this.temp, this.rng, record);
            if (record && record.fromProb) this.leaderRecord = record;
            made++;
            if (finished) { this.gamesDone++; this._applyResult(m); }
        }
        return made;
    }

    _applyResult(m) {
        const credit = (player, side) => {
            if (player.popIdx < 0) return;
            const ind = this.pop[player.popIdx];
            const pts = m.pointsFor(side);
            const w = m.weight;
            ind.games.push(pts);
            ind.wsum += w;
            ind.psum += w * pts;
            ind.points += pts;
            if (pts === WIN_POINTS) ind.wins++;
            else if (pts === DRAW_POINTS) ind.draws++;
            else ind.losses++;
            ind.matSum += Math.max(-8, Math.min(8, m.game.material() * side));
            if (m.outcome.reason === 'checkmate' && m.outcome.winner === side) ind.mateCount++;
            if (m.outcome.winner === 0 &&
                (m.outcome.reason === 'repetition' || m.outcome.reason === '50-move')) ind.repDraws++;
        };
        credit(m.white, 1);
        credit(m.black, -1);
        const o = this._genOutcomes;
        if (m.outcome.winner === 0) o.draw++;
        else if (m.outcome.reason === 'checkmate') o.mate++;
        else o.adj++;
        o.total++;
    }

    _endWave() {
        this.wave++;
        if (this.wave < 6) { this._startWave(); return; }
        this._finishGeneration();
    }

    // Fitness. Weighted score against everything faced is the backbone; the
    // shaping terms are small on purpose - they break ties between genomes with
    // identical results, they must never outrank an actual win.
    _score(ind) {
        const n = ind.games.length || 1;
        const rate = ind.wsum ? ind.psum / ind.wsum : 0;
        const mat = ind.matSum / n;
        return 1000 * rate
            + 34 * Math.max(-8, Math.min(8, mat))
            + 110 * (ind.mateCount / n)
            - 45 * (ind.repDraws / n);
    }

    _finishGeneration() {
        for (const ind of this.pop) ind.fitness = this._score(ind);
        const ranked = this.pop.slice().sort((a, b) => b.fitness - a.fitness);
        const best = ranked[0];
        const o = this._genOutcomes;

        this.history.best.push(best.fitness);
        this.history.median.push(ranked[Math.floor(ranked.length / 2)].fitness);
        this.history.mates.push(o.total ? o.mate / o.total : 0);
        this.history.adjWins.push(o.total ? o.adj / o.total : 0);
        this.history.draws.push(o.total ? o.draw / o.total : 0);

        this._updateChampion(best);
        this._benchmark();
        this._updateTier();

        const improved = best.fitness > this.bestEver + Math.abs(this.bestEver) * 0.004 + 2;
        if (improved) { this.bestEver = best.fitness; this.stagnantGens = 0; }
        else this.stagnantGens++;

        this._breed(ranked);
        this._estimateDiversity();
        const trim = a => { if (a.length > 600) a.shift(); };
        for (const key of Object.keys(this.history)) {
            const v = this.history[key];
            if (key === 'bench') v.forEach(trim); else trim(v);
        }
        this.gen++;
        this._round2Pairs = null;
        this._startGeneration();
    }

    // A challenger only becomes champion by beating the incumbent head to head,
    // over openings neither of them trained on this generation.
    _updateChampion(best) {
        if (!this.champion) {
            this.champion = {
                genome: cloneGenome(best.genome), fitness: best.fitness,
                points: best.points, gen: this.gen, duel: 1
            };
            this.hof.push({ genome: cloneGenome(best.genome), gen: this.gen });
            return;
        }
        const duel = this.duel(best.genome, this.champion.genome, GA.duelGames,
            (this.seed ^ Math.imul(this.gen, 0x27D4EB2D)) >>> 0);
        this.lastDuel = duel;
        if (duel >= GA.duelMargin) {
            this.champion = {
                genome: cloneGenome(best.genome), fitness: best.fitness,
                points: best.points, gen: this.gen, duel
            };
            this.hof.push({ genome: cloneGenome(best.genome), gen: this.gen });
            while (this.hof.length > GA.hofSize) this.hof.shift();
        }
    }

    // Head-to-head score for A against B, colours balanced, in [0, 1].
    duel(a, b, games, seed) {
        const rng = makeRng(seed >>> 0);
        let score = 0;
        for (let i = 0; i < games; i++) {
            const openSeed = (seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0;
            const A = { type: 'net', genome: a, popIdx: -1, protectedPlay: true };
            const B = { type: 'net', genome: b, popIdx: -1, protectedPlay: true };
            const aWhite = i % 2 === 0;
            const m = aWhite ? new Match(A, B, openSeed) : new Match(B, A, openSeed);
            let guard = 0;
            while (!m.done && guard++ < MAX_PLIES + 8) m.step(0, rng, null);
            if (!m.done) m._finish({ winner: 0, reason: 'balanced' });
            score += m.pointsFor(aWhite ? 1 : -1);
        }
        return score / games;
    }

    // Absolute yardsticks: the champion against each scripted rung. These
    // numbers mean the same thing in every generation, which is the whole
    // point of having them.
    scoreVsBot(genome, rung, games, seed) {
        const rng = makeRng(seed >>> 0);
        let score = 0;
        for (let i = 0; i < games; i++) {
            const openSeed = (seed ^ Math.imul(i + 7, 0x85EBCA6B)) >>> 0;
            const me = { type: 'net', genome, popIdx: -1, protectedPlay: true };
            const bot = botPlayer(rung);
            const meWhite = i % 2 === 0;
            const m = meWhite ? new Match(me, bot, openSeed) : new Match(bot, me, openSeed);
            let guard = 0;
            while (!m.done && guard++ < MAX_PLIES + 8) m.step(0, rng, null);
            if (!m.done) m._finish({ winner: 0, reason: 'balanced' });
            score += m.pointsFor(meWhite ? 1 : -1);
        }
        return score / games;
    }

    // Every rung is measured every generation, unlocked or not, so the charts
    // show the whole ladder from the start and the gating decision is never
    // made on a series that only began after the gate opened.
    _benchmark() {
        const g = this.champion ? this.champion.genome : this.pop[0].genome;
        const seed = (this.seed ^ Math.imul(this.gen, 2654435761)) >>> 0;
        let sum = 0;
        LADDER.forEach((rung, i) => {
            const s = this.scoreVsBot(g, rung, GA.benchGames, (seed ^ Math.imul(i + 1, 0x2545F491)) >>> 0);
            this.history.bench[i].push(s);
            sum += s;
        });
        // One headline number: how far up the ladder the champion has climbed.
        this.history.ladder.push(sum / LADDER.length);
    }

    // Unlock the next rung once the current top one is comfortably beaten.
    // Each benchmark is only a handful of games, so the gate reads a mean over
    // 8 generations - unlocking on one lucky sample throws the population at an
    // opponent it cannot score against, and a rung nobody ever beats
    // contributes no selection signal at all.
    _updateTier() {
        const GATE = [0.85, 0.78, 0.70];
        const t = this.history.bench[this.tier - 1].slice(-8);
        if (t.length < 8 || this.tier >= LADDER.length) return;
        const mean = t.reduce((s, v) => s + v, 0) / t.length;
        if (mean >= GATE[this.tier - 1]) this.tier++;
    }

    _estimateDiversity() {
        const n = this.pop.length;
        let sum = 0;
        for (let s = 0; s < 14; s++) {
            const a = this.pop[Math.floor(this.rng() * n)].genome;
            const b = this.pop[Math.floor(this.rng() * n)].genome;
            sum += genomeDistance(a, b, this.rng, 60);
        }
        this.diversity = sum / 14;
    }

    _breed(ranked) {
        const mut = this.effectiveMutation();
        const next = [];
        const push = g => { next.push(this._newIndividual(g)); };

        for (let i = 0; i < Math.min(GA.elites, ranked.length); i++) {
            push(cloneGenome(ranked[i].genome));
        }
        // Skip the extra champion copy when an elite already is the champion.
        const champIsElite = this.champion && ranked.slice(0, GA.elites).some(r =>
            genomeDistance(r.genome, this.champion.genome, this.rng, 120) === 0);
        if (this.champion && !champIsElite) push(cloneGenome(this.champion.genome));
        // Elites and the champion play without exploration noise, so their
        // results are their real strength and not a lucky sample.
        this._protected = new Set([...Array(next.length).keys()]);
        this.leaderIdx = 0;

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
        const nCross = Math.round(free * GA.crossoverFrac);
        const nRowMut = Math.round(free * GA.rowMutantFrac);
        const nImmigrant = Math.max(1, Math.round(free * GA.immigrantFrac));

        for (let i = 0; i < nChampVar && next.length < this.popSize; i++) {
            push(mutate(cloneGenome(this.champion.genome),
                mut.rate * 0.55, mut.strength * 0.45, mut.resetProb, this.rng));
        }
        for (let i = 0; i < nCross && next.length < this.popSize; i++) {
            let a = pickParent(), b = pickParent(), tries = 0;
            while (b === a && tries++ < 8) b = pickParent();
            push(mutate(crossover(a.genome, b.genome, this.rng),
                mut.rate, mut.strength, mut.resetProb, this.rng));
        }
        for (let i = 0; i < nRowMut && next.length < this.popSize; i++) {
            push(mutateRows(cloneGenome(pickParent().genome), 2 + Math.floor(this.rng() * 4),
                mut.strength * 3.2, this.rng));
        }
        while (next.length < this.popSize - nImmigrant) {
            push(mutate(cloneGenome(pickParent().genome),
                mut.rate * 1.5, mut.strength * 1.4, mut.resetProb, this.rng));
        }
        while (next.length < this.popSize) push(randomGenome(this.rng));

        // Near-duplicate guard: a population of clones cannot search anything.
        // Anything that collapses onto an elite gets shaken hard instead.
        const guardFrom = this._protected.size;
        for (let i = guardFrom; i < next.length; i++) {
            for (let e = 0; e < guardFrom; e++) {
                if (genomeDistance(next[i].genome, next[e].genome, this.rng, 80) < GA.cloneDistance) {
                    mutate(next[i].genome, 0.3, mut.strength * 2.5, 0.004, this.rng);
                    break;
                }
            }
        }
        for (const ind of next) if (!validGenome(ind.genome)) repairGenome(ind.genome);
        this.pop = next;
    }

    // Drop genomes in from outside (island migration, or a saved brain the user
    // loaded) and restart the current generation so they play a full schedule
    // instead of half of one.
    inject(genomes) {
        let i = this.popSize - 1;
        for (const g of genomes) {
            if (!validGenome(g) || i <= GA.elites) break;
            this.pop[i].genome = cloneGenome(g);
            i--;
        }
        this._startGeneration();
    }

    // Adopt an outside genome as champion, but only if it can prove it.
    adoptChampion(genome, gen) {
        if (!validGenome(genome)) return false;
        if (this.champion) {
            const s = this.duel(genome, this.champion.genome, GA.duelGames,
                (this.seed ^ 0x5bf03635 ^ Math.imul(this.gen, 7)) >>> 0);
            if (s <= 0.5) return false;
        }
        this.champion = { genome: cloneGenome(genome), fitness: 0, points: 0, gen: gen || this.gen };
        this.hof.push({ genome: cloneGenome(genome), gen: gen || this.gen });
        while (this.hof.length > GA.hofSize) this.hof.shift();
        return true;
    }

    leaderMatch() {
        if (!this.matches) return null;
        const has = m => m.white.popIdx === this.leaderIdx || m.black.popIdx === this.leaderIdx;
        return this.matches.find(m => has(m) && !m.done) || this.matches.find(has) || null;
    }

    // Snapshot for the trainer / UI.
    summary() {
        const h = this.history;
        const last = a => a.length ? a[a.length - 1] : 0;
        return {
            gen: this.gen, tier: this.tier, stagnant: this.stagnantGens,
            best: last(h.best), median: last(h.median),
            bench: h.bench.map(last), ladder: last(h.ladder),
            draws: last(h.draws), mates: last(h.mates),
            diversity: this.diversity, hof: this.hof.length,
            championGen: this.champion ? this.champion.gen : 0
        };
    }
}

if (typeof module !== 'undefined') {
    module.exports = {
        Evolution, Match, chooseMove, staticEval, applyOpening, OPENING_BOOK,
        LADDER, botRandom, botCapture, botGreedy, netPlayer, botPlayer, hofPlayer,
        GA, OPP_WEIGHT, boardIdx
    };
}
