/* probe_hold.js — why does the champion press hold on nearly every piece?
 *
 * probe_vanish.js showed 32 hold swaps per 40 placed pieces: the brain holds
 * almost every piece it is given. Hold is legal, but 0.8 holds per placement is a
 * habit, not a plan, and habits that survive selection are usually being paid for
 * something. The suspect is `_spawn()` resetting `pieceTicks`, which is what the
 * engine's anti-dithering slam counts — so a hold hands the brain a *fresh* time
 * budget for the same placement.
 *
 * Four conditions, same champion, same 60 unseen sequences:
 *
 *   normal        as shipped
 *   no-hold       the hold output is forced to 0 — the key is unplugged
 *   ticks-carry   hold no longer resets the slam budget (the proposed fix)
 *   both          no hold and no reset, for reference
 *
 *   node probe_hold.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "configs.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const BASE_R = Object.assign({}, R);

const raw = fs.readFileSync(path.join(__dirname, "default_brain.js"), "utf8");
const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
applyConfig(json.config, BASE_R);
const champ = netFromJSON(json);

/* A brain wrapper that pins one output to zero — the actuator equivalent of
 * unplugging a key, with the network itself untouched. */
function withoutKey(net, idx) {
    const buf = new Float32Array(7);
    return {
        forward(input) {
            const o = net.forward(input);
            for (let i = 0; i < 7; i++) buf[i] = o[i];
            buf[idx] = 0;
            return buf;
        },
    };
}

const SEEDS = [];
for (let i = 0; i < 60; i++) SEEDS.push(900001 + i * 7919);

function play(brain, opts) {
    let pieces = 0, lines = 0, score = 0, holds = 0, buried = 0, placements = 0, ticks = 0;
    const m = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
    for (const s of SEEDS) {
        const ag = new Agent(brain, s, DEFAULT_CFG);
        const game = ag.game;
        const realHold = game._holdSwap.bind(game);
        game._holdSwap = function () {
            const carried = this.pieceTicks;
            const ok = realHold();
            if (ok) { holds++; if (opts.ticksCarry) this.pieceTicks = carried; }
            return ok;
        };
        let prev = 0;
        while (ag.alive) {
            const ev = ag.step(400);
            if (ev && ev.locked) {
                const bm = boardMetrics(game.grid, m);
                buried += Math.max(0, bm.totalHoles - prev); prev = bm.totalHoles; placements++;
            }
        }
        pieces += ag.pieces; lines += ag.lines; score += game.score; ticks += game.tick;
    }
    const n = SEEDS.length;
    return {
        pieces: pieces / n, lines: lines / n, score: score / n,
        holds: holds / n, buried: buried / Math.max(1, placements),
        ticksPerPiece: ticks / Math.max(1, pieces),
        skill: pieces / n + 25 * (lines / n),
    };
}

const rows = [
    ["normal (as shipped)", play(champ, {})],
    ["no-hold (key unplugged)", play(withoutKey(champ, 6), {})],
    ["ticks-carry (proposed fix)", play(champ, { ticksCarry: true })],
    ["both", play(withoutKey(champ, 6), { ticksCarry: true })],
];

console.log(`champion ${json.configName} · ${champ.contract()} · gen ${json.gen}, ` +
    `${SEEDS.length} unseen sequences\n`);
console.log("condition                     skill  pieces  lines  buried/piece  holds/game  ticks/piece");
for (const [name, r] of rows) {
    console.log(`${name.padEnd(28)}${r.skill.toFixed(1).padStart(6)}  ` +
        `${r.pieces.toFixed(1).padStart(6)}  ${r.lines.toFixed(2).padStart(5)}  ` +
        `${r.buried.toFixed(2).padStart(12)}  ${r.holds.toFixed(1).padStart(10)}  ` +
        `${r.ticksPerPiece.toFixed(1).padStart(11)}`);
}
