/* render.js — all the drawing. Boards, piece previews, the fitness chart.
 * Knows nothing about evolution; hand it a Tetris and it paints it. */
"use strict";

function px(canvas, w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

function cellFill(ctx, x, y, s, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = color;
    const r = Math.max(1, s * 0.14);
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, s - 1, s - 1, r);
    ctx.fill();
    if (s >= 9) {                                  // a little top light, for depth
        ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.28;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.roundRect(x + 1.5, y + 1.5, s - 3, Math.max(1, s * 0.26), r * 0.7);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/* Pieces spawn in hidden rows above the field. Showing the last one as a dimmed
 * "spawn shelf" means a new piece is visible the moment it appears instead of
 * materialising a second later, which reads as a dropped frame. */
const TOP_ROW = BUF - 1;
const ROWS_SHOWN = TH - TOP_ROW;

/* Draws one game. opts: {ghost, grid} */
function drawGame(canvas, game, cell, opts) {
    opts = opts || {};
    const w = BW * cell, h = ROWS_SHOWN * cell;
    const shelf = (BUF - TOP_ROW) * cell;          // y of the top of the real field
    const ctx = px(canvas, w, h);
    ctx.clearRect(0, 0, w, h);

    // well background, dimmer above the field, + faint grid
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, shelf, w, h - shelf);
    ctx.fillStyle = "#050810";
    ctx.fillRect(0, 0, w, shelf);
    if (opts.grid !== false && cell >= 8) {
        ctx.strokeStyle = "#101a2b";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 1; x < BW; x++) { ctx.moveTo(x * cell + 0.5, shelf); ctx.lineTo(x * cell + 0.5, h); }
        for (let y = BUF + 1; y < TH; y++) {
            const py = (y - TOP_ROW) * cell + 0.5;
            ctx.moveTo(0, py); ctx.lineTo(w, py);
        }
        ctx.stroke();
        ctx.strokeStyle = "#1d2b44";
        ctx.beginPath(); ctx.moveTo(0, shelf + 0.5); ctx.lineTo(w, shelf + 0.5); ctx.stroke();
    }

    // locked cells
    for (let y = BUF; y < TH; y++) {
        for (let x = 0; x < BW; x++) {
            const v = game.grid[y * BW + x];
            if (v) cellFill(ctx, x * cell, (y - TOP_ROW) * cell, cell, PIECE_COLORS[v - 1]);
        }
    }

    const p = game.piece;
    if (p && !game.over) {
        const f = PIECES[p.type].flat[p.rot];
        // ghost
        if (opts.ghost !== false) {
            const gy = game.ghostY();
            ctx.strokeStyle = PIECE_COLORS[p.type];
            ctx.globalAlpha = 0.34;
            ctx.lineWidth = Math.max(1, cell * 0.09);
            for (let i = 0; i < 8; i += 2) {
                const cx = p.x + f[i], cy = gy + f[i + 1];
                if (cy < BUF) continue;
                ctx.strokeRect(cx * cell + 1.5, (cy - TOP_ROW) * cell + 1.5, cell - 3, cell - 3);
            }
            ctx.globalAlpha = 1;
        }
        // the piece itself — dimmed while it is still on the spawn shelf
        for (let i = 0; i < 8; i += 2) {
            const cx = p.x + f[i], cy = p.y + f[i + 1];
            if (cy < TOP_ROW) continue;
            cellFill(ctx, cx * cell, (cy - TOP_ROW) * cell, cell,
                PIECE_COLORS[p.type], cy < BUF ? 0.45 : 1);
        }
    }

    if (game.over) {
        ctx.fillStyle = "rgba(6,9,16,0.66)";
        ctx.fillRect(0, 0, w, h);
        if (cell >= 12) {
            ctx.fillStyle = "#ff9aa2";
            ctx.font = `600 ${Math.round(cell * 0.9)}px "Segoe UI", system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText("topped out", w / 2, h / 2);
            ctx.textAlign = "left";
        }
    }
}

/* A single piece in a little box — used for next and hold. */
function drawPreview(canvas, type, cell) {
    const w = 4 * cell, h = 4 * cell;
    const ctx = px(canvas, w, h);
    ctx.clearRect(0, 0, w, h);
    if (type === undefined || type === null || type < 0) return;
    const f = PIECES[type].flat[0], box = PIECES[type].box;
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (let i = 0; i < 8; i += 2) {
        minX = Math.min(minX, f[i]); maxX = Math.max(maxX, f[i]);
        minY = Math.min(minY, f[i + 1]); maxY = Math.max(maxY, f[i + 1]);
    }
    const ox = (w - (maxX - minX + 1) * cell) / 2 - minX * cell;
    const oy = (h - (maxY - minY + 1) * cell) / 2 - minY * cell;
    for (let i = 0; i < 8; i += 2) {
        cellFill(ctx, ox + f[i] * cell, oy + f[i + 1] * cell, cell, PIECE_COLORS[type]);
    }
    void box;
}

/* Fitness history: best and mean on one axis, lines cleared on a second. */
function drawChart(canvas, history) {
    const w = canvas.clientWidth || 280, h = 120;
    const ctx = px(canvas, w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0d1524";
    ctx.fillRect(0, 0, w, h);
    if (history.length < 2) {
        ctx.fillStyle = "#5b6f88";
        ctx.font = '11px "Segoe UI", system-ui, sans-serif';
        ctx.fillText("waiting for generation 2…", 10, h / 2);
        return;
    }
    const pad = 4;
    let lo = Infinity, hi = -Infinity, maxL = 1;
    for (const g of history) {
        lo = Math.min(lo, g.avg, g.best); hi = Math.max(hi, g.best, g.avg);
        maxL = Math.max(maxL, g.bestLines);
    }
    if (hi - lo < 1) hi = lo + 1;
    const X = i => pad + i * (w - 2 * pad) / (history.length - 1);
    const Y = v => h - pad - (v - lo) / (hi - lo) * (h - 2 * pad);
    const YL = v => h - pad - (v / maxL) * (h - 2 * pad);

    // zero line, if it is in view
    if (lo < 0 && hi > 0) {
        ctx.strokeStyle = "#1c2b42"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(w - pad, Y(0)); ctx.stroke();
    }
    const line = (get, color, width, mapper) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        history.forEach((g, i) => {
            const y = mapper(get(g));
            i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y);
        });
        ctx.stroke();
    };
    line(g => g.bestLines, "#ffc94d", 1, YL);
    line(g => g.avg, "#7b8fa8", 1, Y);
    line(g => g.best, "#35c8ff", 1.6, Y);

    ctx.fillStyle = "#5b6f88";
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillText(Math.round(hi).toString(), pad + 2, 11);
    ctx.fillText(Math.round(lo).toString(), pad + 2, h - 4);
}
