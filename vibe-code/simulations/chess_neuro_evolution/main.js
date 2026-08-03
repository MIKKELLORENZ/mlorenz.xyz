// UI, rendering, and the training / play loops.
'use strict';

(function () {
    const $ = id => document.getElementById(id);

    // ---------- state ----------
    const SPEED_PLIES = [2, 6, 16, 40, 100, 250, 900];
    const SPEED_LABELS = ['0.25x', '1x', '2x', '5x', '12x', '30x', 'max'];
    const BUILT_IN = (typeof DEFAULT_BRAIN !== 'undefined' && DEFAULT_BRAIN)
        ? deserializeGenome(DEFAULT_BRAIN) : null;

    let ev = newEvolution(48, false);
    let paused = false;
    let mode = 'train'; // 'train' | 'watch' | 'play'
    let headless = false;
    let showHeat = true;

    function newEvolution(pop, warm) {
        const seed = (Math.random() * 0xffffffff) >>> 0;
        return new Evolution(pop, seed, warm && BUILT_IN ? { seedGenome: BUILT_IN.genome } : {});
    }

    // watch mode state
    let watchMatch = null;
    let watchRecord = null;
    let watchPaused = false;
    let watchNextAt = 0;
    let watchSide = 1;      // which colour the chosen brain has this game
    let watchGameNo = 0;
    let watchLabels = { brain: '', opponent: '' };
    const watchRng = makeRng((Math.random() * 0xffffffff) >>> 0);

    // play mode state
    let playGame = null;
    let humanSide = 1;
    let playGenome = null;
    let playLabel = 'the champion';
    let playOver = null;
    let selectedSq = -1;
    let legalTargets = [];
    let aiThinking = false;
    let playRecord = null;
    const playRng = makeRng((Math.random() * 0xffffffff) >>> 0);

    // perf counter
    let plyCounter = 0, lastMpsTime = performance.now(), mps = 0;

    // ---------- board rendering ----------
    const boardCanvas = $('board');
    const bctx = boardCanvas.getContext('2d');
    const GLYPHS = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };

    // The board is the largest square that fits what the row has left after the
    // caption, the legend and the control dock have taken their share. Doing it
    // here rather than in CSS is deliberate: "square, bounded by both the
    // remaining width and the remaining height" over-constrains aspect-ratio and
    // silently produces a non-square box.
    let lastBoardSize = 0;
    function sizeBoard() {
        const row = $('board-row');
        const h = row.clientHeight;
        const w = row.clientWidth - ($('board-side').offsetWidth || 0) - 14;
        const size = Math.max(160, Math.min(h || 480, w || 480, 640));
        if (size !== lastBoardSize) {
            lastBoardSize = size;
            const wrap = $('board-wrap');
            wrap.style.width = size + 'px';
            wrap.style.height = size + 'px';
            $('eval-bar-wrap').style.height = size + 'px';
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const px = Math.round((boardCanvas.clientWidth || size) * dpr);
        if (px > 0 && boardCanvas.width !== px) { boardCanvas.width = px; boardCanvas.height = px; }
    }

    function sqToScreen(sq, orientation) {
        const rank = sq >> 4, file = sq & 7;
        return [
            orientation === 1 ? file : 7 - file,
            orientation === 1 ? 7 - rank : rank
        ];
    }

    // The two heads, painted straight onto the squares they refer to. `record`
    // holds board-indexed (rank*8+file) probabilities, so it renders the same
    // way whichever colour is at the bottom.
    function drawHeads(record, orientation, cell) {
        if (!record || !record.fromProb) return;
        let fmax = 0, tmax = 0;
        for (let i = 0; i < 64; i++) {
            if (record.fromProb[i] > fmax) fmax = record.fromProb[i];
            if (record.toProb[i] > tmax) tmax = record.toProb[i];
        }
        for (let i = 0; i < 64; i++) {
            const rank = i >> 3, file = i & 7;
            const r = orientation === 1 ? 7 - rank : rank;
            const f = orientation === 1 ? file : 7 - file;
            const fp = fmax > 0 ? record.fromProb[i] / fmax : 0;
            const tp = tmax > 0 ? record.toProb[i] / tmax : 0;
            if (fp > 0.02) {
                bctx.fillStyle = `rgba(120, 190, 255, ${0.10 + 0.42 * fp})`;
                bctx.fillRect(f * cell, r * cell, cell, cell * 0.5);
            }
            if (tp > 0.02) {
                bctx.fillStyle = `rgba(255, 176, 84, ${0.10 + 0.45 * tp})`;
                bctx.fillRect(f * cell, r * cell + cell * 0.5, cell, cell * 0.5);
            }
        }
    }

    // orientation: 1 = white at bottom, -1 = black at bottom
    function drawBoard(game, orientation, lastMove, highlights, animInfo, record) {
        sizeBoard();
        const size = boardCanvas.width;
        const cell = size / 8;
        const css = getComputedStyle(document.documentElement);
        const light = css.getPropertyValue('--sq-light').trim() || '#b8c4d6';
        const dark = css.getPropertyValue('--sq-dark').trim() || '#4a5a74';
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const rank = orientation === 1 ? 7 - r : r;
                const file = orientation === 1 ? f : 7 - f;
                const sq = rank * 16 + file;
                bctx.fillStyle = (rank + file) % 2 === 0 ? dark : light;
                bctx.fillRect(f * cell, r * cell, cell, cell);
                if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
                    bctx.fillStyle = 'rgba(255, 190, 107, 0.34)';
                    bctx.fillRect(f * cell, r * cell, cell, cell);
                }
                if (sq === selectedSq && mode === 'play') {
                    bctx.fillStyle = 'rgba(154, 214, 255, 0.45)';
                    bctx.fillRect(f * cell, r * cell, cell, cell);
                }
            }
        }
        if (showHeat) drawHeads(record, orientation, cell);
        if (mode === 'play' && highlights) {
            bctx.fillStyle = 'rgba(154, 214, 255, 0.8)';
            for (const sq of highlights) {
                const rank = sq >> 4, file = sq & 7;
                const r = orientation === 1 ? 7 - rank : rank;
                const f = orientation === 1 ? file : 7 - file;
                bctx.beginPath();
                bctx.arc((f + 0.5) * cell, (r + 0.5) * cell, cell * 0.12, 0, Math.PI * 2);
                bctx.fill();
            }
        }
        if (!game) return;
        bctx.textAlign = 'center';
        bctx.textBaseline = 'middle';
        bctx.font = `${cell * 0.78}px "Segoe UI Symbol", serif`;
        const drawPiece = (p, fx, fy) => {
            const x = (fx + 0.5) * cell, y = (fy + 0.53) * cell;
            if (p > 0) {
                bctx.fillStyle = '#f5f7fb';
                bctx.strokeStyle = 'rgba(20, 26, 40, 0.9)';
            } else {
                bctx.fillStyle = '#1a2130';
                bctx.strokeStyle = 'rgba(200, 214, 235, 0.55)';
            }
            bctx.lineWidth = Math.max(1, cell * 0.02);
            const glyph = GLYPHS[Math.abs(p)];
            bctx.strokeText(glyph, x, y);
            bctx.fillText(glyph, x, y);
        };
        for (let sq = 0; sq < 128; sq++) {
            if (sq & 0x88) { sq += 7; continue; }
            const p = game.board[sq];
            if (p === 0) continue;
            if (animInfo && sq === animInfo.move.to) continue; // in flight
            const [f, r] = sqToScreen(sq, orientation);
            drawPiece(p, f, r);
        }
        if (animInfo) {
            const [f0, r0] = sqToScreen(animInfo.move.from, orientation);
            const [f1, r1] = sqToScreen(animInfo.move.to, orientation);
            const t = animInfo.t;
            drawPiece(animInfo.piece, f0 + (f1 - f0) * t, r0 + (r1 - r0) * t);
        }
    }

    function updateEvalBar(game) {
        if (!game) return;
        const mat = Math.max(-10, Math.min(10, game.material()));
        $('eval-bar').style.height = `${50 + mat * 4.5}%`;
    }

    // ---------- charts ----------
    function drawLineChart(canvas, seriesList, colors) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        let min = Infinity, max = -Infinity;
        for (const s of seriesList) for (const v of s) { if (v < min) min = v; if (v > max) max = v; }
        if (!isFinite(min)) { min = 0; max = 1; }
        if (max - min < 1e-9) { max = min + 1; }
        ctx.strokeStyle = 'rgba(146,167,199,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5);
        ctx.stroke();
        seriesList.forEach((s, si) => {
            if (s.length < 2) return;
            ctx.strokeStyle = colors[si];
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            for (let i = 0; i < s.length; i++) {
                const x = (i / (s.length - 1)) * (w - 4) + 2;
                const y = h - 4 - ((s[i] - min) / (max - min)) * (h - 10);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        });
    }

    function drawOutcomeChart(canvas, hist) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const n = hist.mates.length;
        if (n === 0) return;
        const barW = Math.max(1, (w - 4) / n);
        for (let i = 0; i < n; i++) {
            const x = 2 + i * barW, bw = Math.max(1, barW - 1);
            let y = h - 3;
            const seg = (frac, color) => {
                const sh = frac * (h - 6);
                ctx.fillStyle = color;
                ctx.fillRect(x, y - sh, bw, sh);
                y -= sh;
            };
            seg(hist.mates[i], 'rgba(255, 190, 107, 0.9)');
            seg(hist.adjWins[i], 'rgba(154, 214, 255, 0.75)');
            seg(hist.draws[i], 'rgba(146, 167, 199, 0.28)');
        }
    }

    // One line per rung, dim for the easy end and bright for the hard end, all
    // on one 0..100% scale with a 50% guide. Rising lines here are the only
    // unambiguous evidence of progress.
    const RUNG_COLORS = ['rgba(146,167,199,0.6)', 'rgba(154,214,255,0.75)',
                         'rgba(180,225,150,0.85)', 'rgba(255,190,107,0.95)'];
    const rungColor = i => RUNG_COLORS[i] || RUNG_COLORS[RUNG_COLORS.length - 1];

    function drawBenchChart(canvas, hist) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const yFor = v => h - 4 - v * (h - 12);
        ctx.strokeStyle = 'rgba(146,167,199,0.28)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yFor(0.5)); ctx.lineTo(w, yFor(0.5));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(146,167,199,0.55)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('50%', 3, yFor(0.5) - 3);
        for (let s = 0; s < hist.bench.length; s++) {
            const data = hist.bench[s];
            if (!data.length) continue;
            ctx.strokeStyle = rungColor(s);
            ctx.lineWidth = 1.7;
            ctx.beginPath();
            for (let i = 0; i < data.length; i++) {
                const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * (w - 4) + 2;
                i === 0 ? ctx.moveTo(x, yFor(data[i])) : ctx.lineTo(x, yFor(data[i]));
            }
            ctx.stroke();
        }
    }

    function drawTrunk(canvas, record) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        if (!record || !record.trunk) {
            ctx.fillStyle = 'rgba(147,161,184,0.6)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('waiting for leader activity…', w / 2, h / 2);
            return;
        }
        const acts = record.trunk;
        const bw = (w - 8) / acts.length;
        const mid = h / 2;
        for (let i = 0; i < acts.length; i++) {
            const a = Math.max(-1, Math.min(1, acts[i]));
            const bh = Math.abs(a) * (h / 2 - 6);
            ctx.fillStyle = a >= 0 ? 'rgba(154, 214, 255, 0.85)' : 'rgba(255, 143, 107, 0.85)';
            ctx.fillRect(4 + i * bw, a >= 0 ? mid - bh : mid, Math.max(1, bw - 1), bh);
        }
        ctx.strokeStyle = 'rgba(146,167,199,0.25)';
        ctx.beginPath();
        ctx.moveTo(0, mid); ctx.lineTo(w, mid);
        ctx.stroke();
    }

    // ---------- stats panel ----------
    const PHASE_NAMES = ['self-play 1a', 'self-play 1b', 'self-play 2a', 'self-play 2b',
                         'ladder a', 'ladder b'];
    const pct = v => `${Math.round(v * 100)}%`;

    // The ladder readout and its legend are built from LADDER itself, so adding
    // or removing a rung needs no edit here or in index.html.
    const ladderRows = LADDER.map((rung, i) => {
        const row = document.createElement('div');
        row.className = 'ladder-row locked';
        const dot = document.createElement('i');
        dot.className = 'dot';
        dot.style.background = rungColor(i);
        const name = document.createElement('span');
        name.className = 'ladder-name';
        name.textContent = rung.label;
        const value = document.createElement('span');
        value.className = 'ladder-value';
        value.textContent = '–';
        row.append(dot, name, value);
        $('ladder-stats').appendChild(row);
        return { row, value };
    });
    $('bench-legend').textContent = 'champion score against each fixed opponent, easiest first';

    function updateStats() {
        const h = ev.history;
        const last = a => a.length ? a[a.length - 1] : null;
        $('stat-gen').textContent = ev.gen;
        $('stat-round').textContent = PHASE_NAMES[ev.wave] || '–';
        $('stat-games').textContent = `${ev.gamesDone} / ${ev.matches.length}`;
        $('stat-mps').textContent = mps;
        $('stat-tier').textContent = `${ev.tier} / ${LADDER.length}`;
        $('stat-champ-gen').textContent = ev.champion ? `gen ${ev.champion.gen}` : '–';
        LADDER.forEach((rung, i) => {
            const v = last(h.bench[i]);
            ladderRows[i].value.textContent = v === null ? '–' : pct(v);
            ladderRows[i].row.classList.toggle('locked', i >= ev.tier);
        });
        const d = last(h.draws);
        $('stat-draws').textContent = d === null ? '–' : pct(d);
        const mut = ev.effectiveMutation();
        $('stat-mut-rate').textContent = `${(mut.rate * 100).toFixed(1)}%`;
        $('stat-stagnation').textContent = ev.stagnantGens;
        $('stat-diversity').textContent = ev.diversity ? ev.diversity.toFixed(2) : '–';
        $('stat-noise').textContent = ev.temp.toFixed(2);
        if (ev.champion) {
            const bits = [`Champion crowned in generation ${ev.champion.gen}`];
            const l = last(h.ladder);
            if (l !== null) bits.push(`${pct(l)} across the ladder`);
            bits.push(`${ev.hof.length} in the archive`);
            $('champion-note').textContent = bits.join(' · ') + '.';
        }
    }

    function updateCaption() {
        if (mode === 'watch') {
            $('caption-main').textContent = watchLabels.brain
                ? `Watching ${watchLabels.brain}` : 'Watch mode';
            $('caption-sub').textContent = watchMatch
                ? (watchPaused ? 'paused' : `game ${watchGameNo}`) : '';
            return;
        }
        if (mode === 'play') {
            $('caption-main').textContent = playGenome
                ? `Playing ${playLabel}` : 'Playing current best';
            $('caption-sub').textContent = playGame ? `move ${Math.ceil((playGame.ply + 1) / 2)}` : '';
            return;
        }
        $('caption-main').textContent = `Generation ${ev.gen}`;
        const lm = ev.leaderMatch();
        if (lm) {
            const side = lm.white.popIdx === ev.leaderIdx ? 'white' : 'black';
            const opp = lm.white.popIdx === ev.leaderIdx ? lm.black : lm.white;
            const oppName = opp.popIdx >= 0 ? 'a rival genome' : opp.label;
            const status = lm.done
                ? (lm.outcome.winner === 0 ? `draw (${lm.outcome.reason})`
                    : `${lm.outcome.winner === 1 ? 'white' : 'black'} wins (${lm.outcome.reason})`)
                : `move ${Math.ceil((lm.game.ply + 1) / 2)}`;
            $('caption-sub').textContent = `leader plays ${side} vs ${oppName} · ${status}`;
        } else {
            $('caption-sub').textContent = '';
        }
    }

    // ---------- training loop ----------
    function frame() {
        if (mode === 'train' && !paused) {
            // Both loops are bounded by an iteration count as well as by the
            // clock. Under a headless browser's virtual time performance.now()
            // does not advance during synchronous JS, so a purely
            // wall-clock-bounded loop never exits and the page hangs.
            if (headless) {
                const t0 = performance.now();
                let guard = 0;
                while (performance.now() - t0 < 40 && guard++ < 400) plyCounter += ev.step(200);
            } else {
                const budget = SPEED_PLIES[+$('speed').value];
                const t0 = performance.now();
                let done = 0, guard = 0;
                while (done < budget && performance.now() - t0 < 22 && guard++ < 200) {
                    done += ev.step(Math.min(60, budget - done));
                }
                plyCounter += done;
            }
        }
        if (mode === 'watch') stepWatch(performance.now());
        const now = performance.now();
        if (now - lastMpsTime > 1000) {
            mps = Math.round(plyCounter * 1000 / (now - lastMpsTime));
            plyCounter = 0;
            lastMpsTime = now;
        }
        render();
        requestAnimationFrame(frame);
    }

    const ANIM_MS = 170;
    let anim = null;
    function animInfoFor(game, animatable) {
        const last = game.lastMoves[game.lastMoves.length - 1] || null;
        if (!last || !animatable) { anim = null; return null; }
        if (!anim || anim.game !== game || anim.move !== last) {
            anim = { game, move: last, piece: game.board[last.to], start: performance.now() };
        }
        const t = (performance.now() - anim.start) / ANIM_MS;
        if (t >= 1) return null;
        return { move: anim.move, piece: anim.piece, t: t * (2 - t) }; // ease-out
    }

    let chartTick = 0;
    function render() {
        if (mode === 'train') {
            if (!headless) {
                const lm = ev.leaderMatch();
                if (lm) {
                    const last = lm.game.lastMoves[lm.game.lastMoves.length - 1] || null;
                    const animatable = +$('speed').value <= 1 && !lm.done;
                    drawBoard(lm.game, 1, last, null, animInfoFor(lm.game, animatable), ev.leaderRecord);
                    updateEvalBar(lm.game);
                }
            }
        } else if (mode === 'watch') {
            if (watchMatch) {
                const g = watchMatch.game;
                const last = g.lastMoves[g.lastMoves.length - 1] || null;
                const animatable = +$('watch-pace').value >= 300 && !watchMatch.done;
                // Board is drawn from the watched brain's side, so the heatmaps
                // read the way that brain sees them.
                drawBoard(g, watchSide, last, null, animInfoFor(g, animatable), watchRecord);
                updateEvalBar(g);
                $('watch-status').textContent = watchStatusText();
            }
        } else if (playGame) {
            const last = playGame.lastMoves[playGame.lastMoves.length - 1] || null;
            drawBoard(playGame, humanSide, last, legalTargets, animInfoFor(playGame, !playOver), playRecord);
            updateEvalBar(playGame);
        }
        updateCaption();
        if (++chartTick % 15 === 0) {
            updateStats();
            drawBenchChart($('chart-bench'), ev.history);
            drawLineChart($('chart-fitness'), [ev.history.best, ev.history.median],
                ['rgba(255,190,107,0.95)', 'rgba(154,214,255,0.8)']);
            drawOutcomeChart($('chart-outcomes'), ev.history);
            drawTrunk($('chart-net'),
                mode === 'play' ? playRecord : mode === 'watch' ? watchRecord : ev.leaderRecord);
            if (mode === 'watch') { syncBrainSelect($('watch-brain')); syncOpponentSelect($('watch-opponent')); }
            if (mode === 'play') syncBrainSelect($('play-brain'));
        }
    }

    // ---------- brains you can watch or play ----------
    // Rebuilt on every use: the champion changes as training runs, so a list
    // captured once would quietly go stale.
    const MIKKEL_AI = "Mikkel's AI";
    function brainChoices() {
        const out = [];
        // Mikkel's AI first: it is the strongest brain that exists here, evolved
        // offline over hundreds of generations. A champion crowned in the second
        // generation of a fresh browser run is not competition for it, and
        // listing it first would make it the default opponent.
        if (BUILT_IN) {
            out.push({ id: 'builtin', label: MIKKEL_AI, genome: BUILT_IN.genome });
        }
        if (ev.champion) {
            out.push({ id: 'champion', label: `your champion (gen ${ev.champion.gen})`, genome: ev.champion.genome });
        }
        out.push({ id: 'leader', label: 'current generation leader', genome: ev.pop[ev.leaderIdx].genome });
        for (let i = ev.hof.length - 1; i >= 0 && out.length < 8; i--) {
            const h = ev.hof[i];
            if (ev.champion && h.genome === ev.champion.genome) continue;
            out.push({ id: 'hof' + i, label: `your archive (gen ${h.gen})`, genome: h.genome });
        }
        return out;
    }

    function resolveBrain(select) {
        const choices = brainChoices();
        return choices.find(c => c.id === select.value) || choices[0];
    }

    // Keep a <select> in sync with the brains that currently exist, without
    // throwing away what the user picked.
    function syncBrainSelect(select) {
        const choices = brainChoices();
        const sig = choices.map(c => c.id + '|' + c.label).join(',');
        if (select.dataset.sig === sig) return;
        const wanted = select.value;
        select.textContent = '';
        for (const c of choices) {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.label;
            select.appendChild(opt);
        }
        select.dataset.sig = sig;
        if (choices.some(c => c.id === wanted)) select.value = wanted;
    }

    // Opponents you can set the champion against: every scripted rung, plus
    // itself and any other evolved brain on the list.
    function opponentChoices() {
        const out = LADDER.map((rung, i) => ({ id: 'bot' + i, label: `the ${rung.label}`, rung }));
        out.push({ id: 'mirror', label: 'itself (mirror match)', mirror: true });
        for (const b of brainChoices()) out.push({ id: 'brain:' + b.id, label: b.label, brainId: b.id });
        return out;
    }

    function syncOpponentSelect(select) {
        const choices = opponentChoices();
        const sig = choices.map(c => c.id + '|' + c.label).join(',');
        if (select.dataset.sig === sig) return;
        const wanted = select.value;
        select.textContent = '';
        for (const c of choices) {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.label;
            select.appendChild(opt);
        }
        select.dataset.sig = sig;
        select.value = choices.some(c => c.id === wanted) ? wanted : 'bot' + (LADDER.length - 1);
    }

    // ---------- watch mode ----------
    function startWatchGame() {
        const brain = resolveBrain($('watch-brain'));
        const choices = opponentChoices();
        const oppPick = choices.find(c => c.id === $('watch-opponent').value) || choices[0];

        const me = { type: 'net', genome: brain.genome, popIdx: -1, protectedPlay: true, label: brain.label };
        let opp;
        if (oppPick.rung) {
            opp = botPlayer(oppPick.rung);
        } else if (oppPick.mirror) {
            opp = { type: 'net', genome: brain.genome, popIdx: -1, protectedPlay: true, label: brain.label };
        } else {
            const other = brainChoices().find(b => b.id === oppPick.brainId) || brain;
            opp = { type: 'net', genome: other.genome, popIdx: -1, protectedPlay: true, label: other.label };
        }

        watchGameNo++;
        watchSide = watchGameNo % 2 === 1 ? 1 : -1; // alternate colours game to game
        watchLabels = { brain: brain.label, opponent: oppPick.label };
        const seed = (Math.random() * 0xffffffff) >>> 0;
        const noOpening = !$('chk-watch-openings').checked;
        watchMatch = watchSide === 1
            ? new Match(me, opp, seed, { noOpening })
            : new Match(opp, me, seed, { noOpening });
        watchRecord = null;
        watchNextAt = 0;
        anim = null;
    }

    const WATCH_LOOP_DELAY = 2200;
    function stepWatch(now) {
        if (!watchMatch || watchPaused) return;
        if (watchMatch.done) {
            if ($('chk-watch-loop').checked && now >= watchNextAt) startWatchGame();
            return;
        }
        const pace = +$('watch-pace').value;
        if (pace > 0 && now < watchNextAt) return;
        const rec = {};
        // The Match plays this exactly the way training does - same adjudication
        // at MAX_PLIES, same rules - so what you watch is what gets selected.
        const finished = watchMatch.step(0, watchRng, rec);
        if (rec.fromProb) watchRecord = rec;
        watchNextAt = now + (pace > 0 ? pace : 0);
        if (finished) watchNextAt = now + WATCH_LOOP_DELAY;
    }

    function watchStatusText() {
        if (!watchMatch) return '';
        const g = watchMatch.game;
        const colour = watchSide === 1 ? 'white' : 'black';
        const head = `${watchLabels.brain} plays ${colour} vs ${watchLabels.opponent}`;
        if (!watchMatch.done) {
            const last = g.lastMoves[g.lastMoves.length - 1];
            return `${head} · move ${Math.ceil((g.ply + 1) / 2)}` +
                (last ? ` · last ${g.moveStr(last)}` : '');
        }
        const o = watchMatch.outcome;
        const verdict = o.winner === 0 ? `draw by ${o.reason}`
            : o.winner === watchSide ? `the brain wins by ${o.reason}`
            : `the brain loses by ${o.reason}`;
        return `${head} · ${verdict} after ${Math.ceil(g.ply / 2)} moves`;
    }

    // ---------- play mode ----------
    function currentBrain() {
        const picked = resolveBrain($('play-brain'));
        return picked ? cloneGenome(picked.genome) : cloneGenome(ev.pop[0].genome);
    }

    function startPlayGame(side) {
        humanSide = side;
        playGame = new Chess();
        playOver = null;
        selectedSq = -1;
        legalTargets = [];
        playRecord = null;
        const picked = resolveBrain($('play-brain'));
        playLabel = picked ? picked.label : 'the current best';
        playGenome = currentBrain();
        $('play-status').textContent = side === 1 ? 'Your move.' : `${playLabel} is thinking…`;
        if (side === -1) scheduleAiMove();
    }

    function scheduleAiMove() {
        aiThinking = true;
        setTimeout(() => {
            aiThinking = false;
            if (!playGame || playGame.result()) return;
            if (playGame.turn === humanSide) return;
            const rec = {};
            const m = chooseMove(playGame, playGenome, 0, playRng, rec);
            if (rec.fromProb) playRecord = rec;
            if (m) playGame.push(m);
            checkPlayResult();
            if (!playOver) $('play-status').textContent = 'Your move.';
        }, 320);
    }

    function checkPlayResult() {
        const res = playGame.result();
        if (!res && playGame.ply < MAX_PLIES) return;
        playOver = res || { winner: 0, reason: 'move limit' };
        const msg = playOver.winner === 0 ? `Draw — ${playOver.reason}.`
            : playOver.winner === humanSide ? `You win — ${playOver.reason}!`
            : `${playLabel} wins — ${playOver.reason}.`;
        $('play-status').textContent = msg;
    }

    boardCanvas.addEventListener('click', e => {
        if (mode !== 'play' || !playGame || playOver || aiThinking) return;
        if (playGame.turn !== humanSide) return;
        const rect = boardCanvas.getBoundingClientRect();
        const cell = rect.width / 8;
        const f = Math.floor((e.clientX - rect.left) / cell);
        const r = Math.floor((e.clientY - rect.top) / cell);
        if (f < 0 || f > 7 || r < 0 || r > 7) return;
        const file = humanSide === 1 ? f : 7 - f;
        const rank = humanSide === 1 ? 7 - r : r;
        const sq = rank * 16 + file;
        const moves = playGame.moves();
        if (selectedSq >= 0) {
            const candidates = moves.filter(m => m.from === selectedSq && m.to === sq);
            if (candidates.length > 0) {
                const move = candidates.find(m => Math.abs(m.promo) === Q) || candidates[0];
                playGame.push(move);
                selectedSq = -1;
                legalTargets = [];
                checkPlayResult();
                if (!playOver) {
                    $('play-status').textContent = `${playLabel} is thinking…`;
                    scheduleAiMove();
                }
                return;
            }
        }
        const p = playGame.board[sq];
        if (p !== 0 && Math.sign(p) === humanSide) {
            selectedSq = sq;
            legalTargets = moves.filter(m => m.from === sq).map(m => m.to);
        } else {
            selectedSq = -1;
            legalTargets = [];
        }
    });

    // ---------- controls ----------
    $('btn-pause').addEventListener('click', () => {
        paused = !paused;
        autoPaused = false; // an explicit choice; stop second-guessing it
        $('btn-pause').textContent = paused ? 'Resume' : 'Pause';
    });

    $('btn-reset').addEventListener('click', () => {
        const warm = $('chk-warm').checked && BUILT_IN;
        const what = warm ? MIKKEL_AI : 'a fresh random population';
        if (!confirm(`Reset training and start from ${what}?`)) return;
        ev = newEvolution(+$('pop').value, warm);
        ev.recordLeader = !headless;
        $('champion-note').textContent = warm
            ? `Warm start from ${MIKKEL_AI} — it is the champion until something beats it.`
            : 'No champion yet — train at least one generation.';
    });

    $('speed').addEventListener('input', () => {
        $('speed-label').textContent = SPEED_LABELS[+$('speed').value];
    });

    $('pop').addEventListener('input', () => {
        $('pop-label').textContent = $('pop').value;
    });

    $('chk-headless').addEventListener('change', () => {
        headless = $('chk-headless').checked;
        ev.recordLeader = !headless;
        $('speed').disabled = headless;
        $('board-overlay').classList.toggle('hidden', !headless || mode !== 'train');
    });

    $('chk-heat').addEventListener('change', () => { showHeat = $('chk-heat').checked; });

    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            mode = tab.dataset.mode;
            const playing = mode === 'play';
            const watching = mode === 'watch';
            $('play-controls').classList.toggle('hidden', !playing);
            $('watch-controls').classList.toggle('hidden', !watching);
            $('heat-legend').classList.toggle('hidden', headless && mode === 'train');
            // The headless "no rendering" curtain only makes sense while training.
            $('board-overlay').classList.toggle('hidden', playing || watching || !headless);
            if (watching) {
                syncBrainSelect($('watch-brain'));
                syncOpponentSelect($('watch-opponent'));
                if (!watchMatch) startWatchGame();
            }
            if (playing) {
                syncBrainSelect($('play-brain'));
                if (!playGame) startPlayGame(1);
            }
            // Training was only paused to keep it out of the way while you were
            // elsewhere, so opening the Train tab starts it. A pause you asked
            // for yourself is left alone.
            if (mode === 'train' && autoPaused) {
                paused = false;
                autoPaused = false;
                $('btn-pause').textContent = 'Pause';
            }
            sizeBoard();
        });
    });

    $('btn-watch-new').addEventListener('click', () => {
        watchPaused = false;
        $('btn-watch-pause').textContent = 'Pause';
        startWatchGame();
    });

    $('btn-watch-pause').addEventListener('click', () => {
        watchPaused = !watchPaused;
        $('btn-watch-pause').textContent = watchPaused ? 'Resume' : 'Pause';
        if (!watchPaused) watchNextAt = 0;
    });

    // Changing either side mid-game means the rest of the game would be played
    // by someone else, so start a fresh one.
    for (const id of ['watch-brain', 'watch-opponent']) {
        $(id).addEventListener('change', () => {
            watchPaused = false;
            $('btn-watch-pause').textContent = 'Pause';
            startWatchGame();
        });
    }
    $('watch-pace').addEventListener('change', () => { watchNextAt = 0; });

    $('play-brain').addEventListener('change', () => startPlayGame(humanSide));
    $('btn-play-white').addEventListener('click', () => startPlayGame(1));
    $('btn-play-black').addEventListener('click', () => startPlayGame(-1));
    $('btn-play-resign').addEventListener('click', () => startPlayGame(humanSide));

    const LS_KEY = 'chess-ne-champion-v3';
    $('btn-save-champion').addEventListener('click', () => {
        if (!ev.champion) { $('champion-note').textContent = 'Nothing to save yet.'; return; }
        try {
            localStorage.setItem(LS_KEY, serializeGenome(ev.champion.genome, {
                gen: ev.champion.gen, fitness: Math.round(ev.champion.fitness)
            }));
            $('champion-note').textContent = `Saved the generation ${ev.champion.gen} champion to this browser.`;
        } catch (e) {
            $('champion-note').textContent = 'Could not save — this browser refused the write.';
        }
    });

    $('btn-load-champion').addEventListener('click', () => {
        let raw = null;
        try { raw = localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
        const loaded = raw && deserializeGenome(raw);
        if (!loaded) { $('champion-note').textContent = 'No valid saved champion found.'; return; }
        ev.champion = {
            genome: loaded.genome, fitness: loaded.meta.fitness || 0,
            points: 0, gen: loaded.meta.gen || 0
        };
        ev.inject([loaded.genome]);
        $('champion-note').textContent =
            `Loaded the generation ${loaded.meta.gen || '?'} champion — it is back in the population.`;
    });

    $('btn-export-champion').addEventListener('click', () => {
        if (!ev.champion) { $('champion-note').textContent = 'Nothing to export yet.'; return; }
        const blob = new Blob([serializeGenome(ev.champion.genome, { gen: ev.champion.gen })],
            { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chess-champion-gen${ev.champion.gen}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    // ---------- startup screen ----------
    // Training is held paused behind the modal. Someone who came here to play a
    // game should not have every core burning through generations behind the
    // board, and someone who came to train wants generation 1 to start when
    // they say so, not while they are still reading.
    let autoPaused = false;

    function selectMode(name) {
        const tab = Array.from(document.querySelectorAll('.mode-tab'))
            .find(t => t.dataset.mode === name);
        if (tab) tab.click();
    }

    function dismissStartup() {
        $('startup').classList.add('hidden');
        sizeBoard();
    }

    function startPlayingMikkelsAI() {
        paused = true;
        autoPaused = true;
        $('btn-pause').textContent = 'Resume';
        dismissStartup();
        selectMode('play');
        syncBrainSelect($('play-brain'));
        if (BUILT_IN) $('play-brain').value = 'builtin';
        startPlayGame(1);
    }

    function startTrainingFresh() {
        paused = false;
        autoPaused = false;
        $('btn-pause').textContent = 'Pause';
        dismissStartup();
        selectMode('train');
    }

    $('btn-start-play').addEventListener('click', startPlayingMikkelsAI);
    $('btn-start-train').addEventListener('click', startTrainingFresh);

    if (!BUILT_IN) {
        $('btn-start-play').disabled = true;
        $('startup-note').textContent =
            'No trained brain is bundled with this copy of the page — run bake_brain.js to add one.';
    } else {
        $('startup-note').textContent =
            'You can switch between training, watching and playing at any time from the tabs.';
    }

    // ---------- boot ----------
    // Hold training until the startup screen is answered.
    paused = true;
    autoPaused = true;
    $('btn-pause').textContent = 'Resume';

    // ?bench=N trains N plies synchronously before the first frame. Screenshot
    // and headless-assertion runs need a warmed-up page, and they cannot get
    // one from the animation loop: under virtual time requestAnimationFrame
    // barely fires. Bounded by iterations, never by the clock.
    if (typeof location !== 'undefined' && location.search) {
        const params = new URLSearchParams(location.search);
        // Any deep link answers the startup screen for you.
        if (params.get('bench') || params.get('mode') || params.get('start')) {
            dismissStartup();
            if (params.get('start') === 'play') startPlayingMikkelsAI();
            else { paused = false; autoPaused = false; $('btn-pause').textContent = 'Pause'; }
        }
        const bench = Math.min(500000, Math.max(0, +params.get('bench') || 0));
        if (bench) {
            ev.recordLeader = true;
            let done = 0, guard = 0;
            while (done < bench && guard++ < 5000) done += ev.step(1000);
            // Force one full stats + chart pass. The panel normally refreshes
            // every 15th animation frame, and under virtual time there may
            // never be a 15th frame.
            chartTick = 14;
            render();
        }
        if (params.get('heat') === '0') { showHeat = false; $('chk-heat').checked = false; }
        if (params.get('paused') === '1') { paused = true; $('btn-pause').textContent = 'Resume'; }
        // ?mode=watch / ?mode=play deep-links a tab. Runs last, so the mode it
        // opens already has whatever ?bench trained for it.
        const wanted = params.get('mode');
        if (wanted && wanted !== 'train') {
            const tab = Array.from(document.querySelectorAll('.mode-tab'))
                .find(t => t.dataset.mode === wanted);
            if (tab) tab.click();
        }
    }
    $('speed-label').textContent = SPEED_LABELS[+$('speed').value];
    $('pop-label').textContent = $('pop').value;
    if (!BUILT_IN) {
        $('chk-warm').disabled = true;
        $('chk-warm').parentElement.title = `No ${MIKKEL_AI} brain is bundled with this page.`;
    }
    window.addEventListener('resize', sizeBoard);
    sizeBoard();
    requestAnimationFrame(frame);
})();
