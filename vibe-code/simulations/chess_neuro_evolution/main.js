// UI, rendering, and the training/play loops.
'use strict';

(function () {
    const $ = id => document.getElementById(id);

    // ---------- state ----------
    const SPEED_PLIES = [2, 6, 16, 40, 100, 250, 600];
    const SPEED_LABELS = ['0.25x', '1x', '2x', '5x', '12x', '30x', 'max'];
    let ev = new Evolution(64, (Math.random() * 0xffffffff) >>> 0);
    let paused = false;
    let mode = 'train'; // 'train' | 'play'
    let headless = false; // visuals + animation are the default

    // play mode state
    let playGame = null;
    let humanSide = 1;
    let playGenome = null;
    let playOver = null;
    let selectedSq = -1;
    let legalTargets = [];
    let aiThinking = false;
    const playRng = makeRng((Math.random() * 0xffffffff) >>> 0);

    // perf counter
    let plyCounter = 0, lastMpsTime = performance.now(), mps = 0;

    // ---------- board rendering ----------
    const boardCanvas = $('board');
    const bctx = boardCanvas.getContext('2d');
    // filled glyphs for both sides; color distinguishes them
    const GLYPHS_B = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };

    function sizeBoard() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const px = Math.round(boardCanvas.clientWidth * dpr);
        if (boardCanvas.width !== px) { boardCanvas.width = px; boardCanvas.height = px; }
    }

    function sqToScreen(sq, orientation) {
        const rank = sq >> 4, file = sq & 7;
        return [
            orientation === 1 ? file : 7 - file,
            orientation === 1 ? 7 - rank : rank
        ];
    }

    // orientation: 1 = white at bottom, -1 = black at bottom
    // animInfo: {move, piece, t} - draw `piece` interpolated between move.from
    // and move.to at progress t instead of resting on move.to
    function drawBoard(game, orientation, lastMove, highlights, animInfo) {
        sizeBoard();
        const size = boardCanvas.width;
        const cell = size / 8;
        const light = getComputedStyle(document.documentElement).getPropertyValue('--sq-light').trim() || '#b8c4d6';
        const dark = getComputedStyle(document.documentElement).getPropertyValue('--sq-dark').trim() || '#4a5a74';
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const rank = orientation === 1 ? 7 - r : r;
                const file = orientation === 1 ? f : 7 - f;
                const sq = rank * 16 + file;
                bctx.fillStyle = (rank + file) % 2 === 0 ? dark : light;
                bctx.fillRect(f * cell, r * cell, cell, cell);
                if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
                    bctx.fillStyle = 'rgba(255, 190, 107, 0.38)';
                    bctx.fillRect(f * cell, r * cell, cell, cell);
                }
                if (sq === selectedSq && mode === 'play') {
                    bctx.fillStyle = 'rgba(154, 214, 255, 0.45)';
                    bctx.fillRect(f * cell, r * cell, cell, cell);
                }
            }
        }
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
            const glyph = GLYPHS_B[Math.abs(p)];
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

    // Stacked bars per generation: checkmates (orange, bottom), material
    // adjudications (blue), draws (gray, top).
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

    // Champion-vs-random-mover score on a fixed 0..100% scale with a 50%
    // guide line: the "is it actually learning" chart.
    function drawBenchChart(canvas, bench) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const yFor = v => h - 4 - v * (h - 10);
        ctx.strokeStyle = 'rgba(146,167,199,0.3)';
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
        if (bench.length === 0) return;
        ctx.strokeStyle = 'rgba(255,190,107,0.95)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < bench.length; i++) {
            const x = bench.length === 1 ? w / 2 : (i / (bench.length - 1)) * (w - 4) + 2;
            i === 0 ? ctx.moveTo(x, yFor(bench[i])) : ctx.lineTo(x, yFor(bench[i]));
        }
        ctx.stroke();
    }

    function drawBrain(canvas, record) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        if (!record || !record.layers) {
            ctx.fillStyle = 'rgba(147,161,184,0.6)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('waiting for leader activity…', w / 2, h / 2);
            return;
        }
        const layers = [record.layers[1] || [], record.layers[2] || [], record.layers[3] || []];
        const rows = layers.length;
        layers.forEach((acts, li) => {
            const y = 18 + li * ((h - 30) / (rows - 1 || 1));
            const n = acts.length;
            const r = li === rows - 1 ? 8 : Math.min(5, (w - 20) / n / 2.4);
            for (let i = 0; i < n; i++) {
                const x = n === 1 ? w / 2 : 12 + (i / (n - 1)) * (w - 24);
                const a = Math.max(-1, Math.min(1, acts[i]));
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = a >= 0
                    ? `rgba(154, 214, 255, ${0.15 + 0.85 * a})`
                    : `rgba(255, 143, 107, ${0.15 + 0.85 * -a})`;
                ctx.fill();
            }
        });
        ctx.fillStyle = 'rgba(235,242,255,0.85)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`position score ${record.score.toFixed(3)}`, w / 2, h - 2);
    }

    // ---------- stats panel ----------
    function updateStats() {
        $('stat-gen').textContent = ev.gen;
        $('stat-round').textContent = `${Math.floor(ev.round / 2) + 1}${ev.round % 2 ? 'b' : 'a'} / 2`;
        $('stat-games').textContent = `${ev.gamesDone} / ${ev.matches.length}`;
        $('stat-mps').textContent = mps;
        if (ev.champion) {
            $('stat-champ-wins').textContent = `${ev.champion.wins} / 4`;
            $('stat-champ-fit').textContent = Math.round(ev.champion.aggregate);
            $('champion-note').textContent =
                `Champion from generation ${ev.champion.gen} — ${ev.champion.wins}/4 wins, ` +
                `fitness ${Math.round(ev.champion.aggregate)}.`;
        }
        const mut = ev.effectiveMutation();
        $('stat-mut-rate').textContent = `${(mut.rate * 100).toFixed(1)}%`;
        $('stat-stagnation').textContent = ev.stagnantGens;
        const bench = ev.history.bench;
        $('stat-bench').textContent = bench.length
            ? `${Math.round(bench[bench.length - 1] * 100)}%` : '–';
        const draws = ev.history.draws;
        $('stat-draws').textContent = draws.length
            ? `${Math.round(draws[draws.length - 1] * 100)}%` : '–';
        $('stat-diversity').textContent = ev.diversity ? ev.diversity.toFixed(2) : '–';
        $('stat-noise').textContent = ev.noise.toFixed(2);
    }

    function updateCaption() {
        if (mode === 'play') {
            $('caption-main').textContent = ev.champion
                ? `Playing champion (gen ${ev.champion.gen})` : 'Playing current best';
            $('caption-sub').textContent = '';
            return;
        }
        $('caption-main').textContent = `Generation ${ev.gen}`;
        const lm = ev.leaderMatch();
        if (lm) {
            const side = lm.white === ev.leaderIdx ? 'white' : 'black';
            const status = lm.done
                ? (lm.outcome.winner === 0 ? `draw (${lm.outcome.reason})`
                    : `${lm.outcome.winner === 1 ? 'white' : 'black'} wins (${lm.outcome.reason})`)
                : `move ${Math.ceil((lm.game.ply + 1) / 2)}`;
            $('caption-sub').textContent = `leader plays ${side} · ${status}`;
        } else {
            $('caption-sub').textContent = '';
        }
    }

    // ---------- training loop ----------
    function frame() {
        if (mode === 'train' && !paused) {
            if (headless) {
                // headless: no rendering cost, spend most of the frame training
                const t0 = performance.now();
                while (performance.now() - t0 < 40) plyCounter += ev.step(100);
            } else {
                // plies-per-frame pacing, but never blow the frame budget
                const budget = SPEED_PLIES[+$('speed').value];
                const t0 = performance.now();
                let done = 0;
                while (done < budget && performance.now() - t0 < 24) {
                    done += ev.step(Math.min(50, budget - done));
                }
                plyCounter += done;
            }
        }
        const now = performance.now();
        if (now - lastMpsTime > 1000) {
            mps = Math.round(plyCounter * 1000 / (now - lastMpsTime));
            plyCounter = 0;
            lastMpsTime = now;
        }
        render();
        requestAnimationFrame(frame);
    }

    // Slide the most recent move's piece from its old square to the new one.
    // Only used at low speeds / play mode - at high speeds moves arrive faster
    // than any animation could play out.
    const ANIM_MS = 170;
    let anim = null; // {game, move, piece, start}
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
                    drawBoard(lm.game, 1, last, null, animInfoFor(lm.game, animatable));
                    updateEvalBar(lm.game);
                }
            }
        } else if (playGame) {
            const last = playGame.lastMoves[playGame.lastMoves.length - 1] || null;
            drawBoard(playGame, humanSide, last, legalTargets, animInfoFor(playGame, !playOver));
            updateEvalBar(playGame);
        }
        updateCaption();
        if (++chartTick % 15 === 0) {
            updateStats();
            drawBenchChart($('chart-bench'), ev.history.bench);
            drawLineChart($('chart-fitness'), [ev.history.best, ev.history.median],
                ['rgba(255,190,107,0.95)', 'rgba(154,214,255,0.8)']);
            drawOutcomeChart($('chart-outcomes'), ev.history);
            if (mode === 'train' && !headless) drawBrain($('chart-net'), ev.leaderRecord);
        }
    }

    // ---------- play mode ----------
    function startPlayGame(side) {
        humanSide = side;
        playGame = new Chess();
        playOver = null;
        selectedSq = -1;
        legalTargets = [];
        playGenome = ev.champion ? cloneGenome(ev.champion.genome) : cloneGenome(ev.pop[0].genome);
        $('play-status').textContent = side === 1 ? 'Your move.' : 'Champion thinking…';
        if (side === -1) scheduleAiMove();
    }

    function scheduleAiMove() {
        aiThinking = true;
        setTimeout(() => {
            aiThinking = false;
            if (!playGame || playGame.result()) return;
            if (playGame.turn === humanSide) return;
            const m = chooseMove(playGame, playGenome, 0, playRng, null);
            if (m) playGame.push(m);
            checkPlayResult();
            if (!playOver) $('play-status').textContent = 'Your move.';
        }, 350);
    }

    function checkPlayResult() {
        const res = playGame.result();
        if (!res) return;
        playOver = res;
        const msg = res.winner === 0 ? `Draw — ${res.reason}.`
            : res.winner === humanSide ? `You win — ${res.reason}!`
            : `Champion wins — ${res.reason}.`;
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
                // auto-queen on promotion
                const move = candidates.find(m => Math.abs(m.promo) === 5) || candidates[0];
                playGame.push(move);
                selectedSq = -1;
                legalTargets = [];
                checkPlayResult();
                if (!playOver) {
                    $('play-status').textContent = 'Champion thinking…';
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
        $('btn-pause').textContent = paused ? 'Resume' : 'Pause';
    });

    $('btn-reset').addEventListener('click', () => {
        if (!confirm('Reset training and start a fresh random population?')) return;
        ev = new Evolution(+$('pop').value, (Math.random() * 0xffffffff) >>> 0);
        ev.recordLeader = !headless;
        $('champion-note').textContent = 'No champion yet — train at least one generation.';
        $('stat-champ-wins').textContent = '–';
        $('stat-champ-fit').textContent = '–';
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
        $('board-overlay').classList.toggle('hidden', !headless || mode === 'play');
    });

    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            mode = tab.dataset.mode;
            const playing = mode === 'play';
            $('play-controls').classList.toggle('hidden', !playing);
            $('board-overlay').classList.toggle('hidden', playing || !headless);
            if (playing && !playGame) startPlayGame(1);
        });
    });

    $('btn-play-white').addEventListener('click', () => startPlayGame(1));
    $('btn-play-black').addEventListener('click', () => startPlayGame(-1));
    $('btn-play-resign').addEventListener('click', () => startPlayGame(humanSide));

    const LS_KEY = 'chess-ne-champion';
    $('btn-save-champion').addEventListener('click', () => {
        if (!ev.champion) { $('champion-note').textContent = 'Nothing to save yet.'; return; }
        localStorage.setItem(LS_KEY, serializeGenome(ev.champion.genome, {
            gen: ev.champion.gen, wins: ev.champion.wins, aggregate: ev.champion.aggregate
        }));
        $('champion-note').textContent = `Saved champion from generation ${ev.champion.gen} to this browser.`;
    });

    $('btn-load-champion').addEventListener('click', () => {
        const raw = localStorage.getItem(LS_KEY);
        const loaded = raw && deserializeGenome(raw);
        if (!loaded) { $('champion-note').textContent = 'No valid saved champion found.'; return; }
        ev.champion = {
            genome: loaded.genome,
            wins: loaded.meta.wins || 0,
            aggregate: loaded.meta.aggregate || 0,
            gen: loaded.meta.gen || 0
        };
        // seed it straight into the current population so it competes now
        ev.pop[0].genome = cloneGenome(loaded.genome);
        $('champion-note').textContent =
            `Loaded champion from generation ${loaded.meta.gen || '?'} — it now plays in the population.`;
    });

    // ---------- boot ----------
    $('speed-label').textContent = SPEED_LABELS[+$('speed').value];
    $('pop-label').textContent = $('pop').value;
    window.addEventListener('resize', sizeBoard);
    sizeBoard();
    requestAnimationFrame(frame);
})();
