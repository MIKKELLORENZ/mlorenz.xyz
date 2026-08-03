/* probe_pick_bias.js — is the brain we picked actually better, or did it just
 * win the bank it was picked on?
 *
 *   node probe_pick_bias.js training/champion_gen29*.json
 *
 * "Best of the last five generations" chosen by TRAINING FITNESS is a lottery
 * ticket — this project has measured an 18.7x fitness swing on an unchanged
 * brain, and in the first six-candidate run the highest-fitness brain (5994)
 * placed fourth while the lowest (4845) placed first. So the pick is made on a
 * held-out bank instead.
 *
 * That fixes one bias and introduces another. Taking the MAX over N candidates
 * on one bank means part of the winner, every time, is its luck on those
 * particular missions. The only way to price that is a SECOND disjoint bank
 * scored for every candidate — and the first time this was run the ranking did
 * not survive it at all: a 0.70-1.40 wp spread on the pick bank collapsed to
 * 0.90-1.00 on the fresh one.
 *
 * Read the two columns together:
 *   · FRESH spread is wide          -> the candidates really do differ; take the best.
 *   · FRESH spread is flat          -> they are one walker; take the most recent.
 *   · cohort FRESH << cohort PICK   -> that gap is the inflation, and it is what
 *                                      you would have over-claimed by quoting PICK.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const MODEL = HUMANOID;
const STAGE = +(process.env.STAGE || 2);

/* Both banks are held out of training. PICK is the one exam.js uses, so its
 * numbers stay comparable with every other exam in this project; FRESH is
 * disjoint from it and from each other's noise. Ten missions each, because the
 * same brain read 0.50 wp on an 8-seed subset and 1.00 wp on the full 10 — under
 * about ten missions the bank says almost nothing. */
const PICK = [900, 907, 913, 921, 934, 947, 955, 962, 969, 976];
const FRESH = [983, 990, 1003, 1017, 1031, 1042, 1055, 1068, 1079, 1090];

function bankScore(brain, bank) {
    let arrivals = 0, metres = 0, upright = 0;
    for (const mi of bank) {
        const w = new World(MODEL, [brain], { stage: STAGE, terrainId: "varied",
            missionSeed: 1 + mi * 37, noiseSeed: 5000 + mi * 13, noise: true, groundFrac: 0 });
        let t = 0;
        while (!w.isOver() && t++ < 140 * 500) w.step();
        const x = w.walkers[0];
        arrivals += x.arrivals; metres += x.progressM; upright += x.uprightTime;
    }
    const n = bank.length;
    return { wp: arrivals / n, m: metres / n, up: upright / n };
}

let files = process.argv.slice(2);
if (!files.length) { console.error("usage: node probe_pick_bias.js <champion.json> ..."); process.exit(2); }
files = files.filter(f => fs.existsSync(f));
if (!files.length) { console.error("none of those files exist"); process.exit(2); }

const out = [];
for (const f of files) {
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    const brain = Net.fromJSON(s.net || s);
    if (brain.sizes.join() !== NET_SIZES.join()) {
        console.error(`skipping ${path.basename(f)}: ${brain.sizes.join("-")} brain, this build is ${NET_SIZES.join("-")}`);
        continue;
    }
    out.push({ gen: s.gen, fit: Math.round(s.fitness || 0), file: f,
               p: bankScore(brain, PICK), q: bankScore(brain, FRESH) });
}
out.sort((a, b) => a.gen - b.gen);

console.log(`stage ${STAGE}, ${PICK.length} missions per bank, both held out of training\n`);
console.log("  gen     trainFit      PICK bank                 FRESH bank (disjoint)");
for (const r of out)
    console.log(`  ${String(r.gen).padEnd(7)} ${String(r.fit).padStart(7)}   ` +
        `${(r.p.wp.toFixed(2) + " wp  " + r.p.m.toFixed(2) + " m  " + r.p.up.toFixed(1) + "s").padEnd(26)}` +
        `${r.q.wp.toFixed(2)} wp  ${r.q.m.toFixed(2)} m  ${r.q.up.toFixed(1)}s`);
const av = f => out.reduce((s, r) => s + f(r), 0) / out.length;
console.log(`  cohort           ` +
    `${(av(r => r.p.wp).toFixed(2) + " wp  " + av(r => r.p.m).toFixed(2) + " m  " + av(r => r.p.up).toFixed(1) + "s").padEnd(26)}` +
    `${av(r => r.q.wp).toFixed(2)} wp  ${av(r => r.q.m).toFixed(2)} m  ${av(r => r.q.up).toFixed(1)}s`);

/* THE PICK IS MADE ON THE POOLED 20, not on either bank alone.
 *
 * Both banks are held out of training, so there is no reason to spend one of
 * them as a mere audit of the other — pooling halves the variance, and with two
 * ten-mission banks disagreeing by up to 0.8 wp on the same brain that variance
 * is the thing actually deciding the ranking. Pooling does not abolish the
 * order-statistic inflation (taking the max over N still buys some luck), it
 * just makes it smaller, and the per-bank columns above stay printed so the
 * disagreement is visible rather than averaged into silence.
 *
 * Ties break toward the LATER generation: when the cohort is flat, recency is
 * the only signal left that is not noise. */
const pooled = r => ({ wp: (r.p.wp + r.q.wp) / 2, m: (r.p.m + r.q.m) / 2, up: (r.p.up + r.q.up) / 2 });
const spread = k => Math.max(...out.map(r => r.q[k])) - Math.min(...out.map(r => r.q[k]));
console.log(`\n  pooled over both banks (${PICK.length + FRESH.length} held-out missions):`);
for (const r of [...out].sort((a, b) => { const x = pooled(a), y = pooled(b); return (y.wp - x.wp) || (y.m - x.m) || (b.gen - a.gen); })) {
    const t = pooled(r);
    console.log(`    gen ${String(r.gen).padEnd(6)} ${t.wp.toFixed(2)} wp  ${t.m.toFixed(2)} m  ${t.up.toFixed(1)}s upright`);
}
console.log(`\n  between-bank disagreement on the same brain: up to ${spread("wp").toFixed(2)} wp`);
console.log(`  inflation (cohort PICK - cohort FRESH): ${(av(r => r.p.wp) - av(r => r.q.wp)).toFixed(2)} wp, ` +
    `${(av(r => r.p.m) - av(r => r.q.m)).toFixed(2)} m`);
const best = [...out].sort((a, b) => { const x = pooled(a), y = pooled(b); return (y.wp - x.wp) || (y.m - x.m) || (b.gen - a.gen); })[0];
const second = [...out].sort((a, b) => { const x = pooled(a), y = pooled(b); return (y.wp - x.wp) || (y.m - x.m) || (b.gen - a.gen); })[1];
console.log(`  PICK: gen ${best.gen} -> ${best.file}`);
if (second && pooled(best).wp - pooled(second).wp < 0.25)
    console.log(`  ...margin over gen ${second.gen} is ${(pooled(best).wp - pooled(second).wp).toFixed(2)} wp, inside the noise floor.\n` +
                "     Treat them as indistinguishable; recency is the tiebreak.");
