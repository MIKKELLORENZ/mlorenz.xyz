/* autobake.js — keep default_brain.js pointed at the best brain the training
 * node has actually produced.
 *
 *   node autobake.js --once            # one check, then exit
 *   node autobake.js --every 15        # check every 15 minutes until stopped
 *   node autobake.js --host my-training-box --remote-dir '~/walk3d'
 *
 * The host is required and has no default: it is whatever you call the training
 * machine in your own ~/.ssh/config. Pass --host, or set WALK3D_HOST.
 *
 * The interesting decision here is what "better" means. It is NOT training
 * fitness: this project has had three separate occasions where the training log
 * claimed a waypoint rate the held-out exam demolished (1.00 -> 0.17,
 * 1.33 -> 0.33), because `best` in the log is an order statistic — the luckiest
 * of ~960 brains on the handful of missions they were scored against. So a
 * candidate is ranked by running the twelve held-out missions no generation
 * trains on, and comparing mean waypoints reached, with metres walked as the
 * tie-break. Both are counted behaviours, not ledger quantities, so they stay
 * comparable even if the reward changes underneath.
 *
 * The exam runs ON the training node. It is one extra thread on 128 cores, and
 * it avoids copying a 400 KB brain across the wire just to reject it. Only a
 * candidate that WINS is fetched and baked.
 *
 * Determinism note: the missions are fixed and the exam runs on the same
 * machine every time, so two brains are compared under identical conditions.
 * Cross-machine comparison would not be safe — the same brain scores slightly
 * differently on the laptop, because a contact simulation amplifies
 * floating-point differences over a two-minute episode.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith("--")) return true;
    return isNaN(+v) ? v : +v;
}

const CFG = {
    host: arg("host", process.env.WALK3D_HOST || ""),
    remoteDir: arg("remote-dir", "~/walk3d"),
    remoteNode: arg("remote-node", "~/opt/node/bin/node"),
    every: arg("every", 0),                     // minutes; 0 = run once
    stage: arg("stage", 2),
    once: !!arg("once", false)
};

/* Fail here rather than letting ssh fail with an empty host argument, which
 * produces a usage dump from ssh itself and reads like the tool is broken. */
if (!CFG.host) {
    console.error("autobake: no training host. Pass --host <ssh-alias>, or set WALK3D_HOST.");
    process.exit(2);
}

const DIR = __dirname;
const LEDGER = path.join(DIR, "training", "baked_score.json");
const LOG = path.join(DIR, "training", "autobake.log");

function say(msg) {
    const line = `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG, line + "\n"); } catch (e) { /* log is best-effort */ }
}

function ssh(command, timeoutMs) {
    return execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=25", CFG.host, command],
        { encoding: "utf8", timeout: timeoutMs || 120000, maxBuffer: 1 << 24 });
}

function readLedger() {
    try { return JSON.parse(fs.readFileSync(LEDGER, "utf8")); }
    catch (e) { return null; }
}

/* Ask the node to score its current champion. Returns null on any failure —
 * an unreachable host or a half-written champion file must leave the baked
 * brain alone, never overwrite it with something unverified. */
function scoreRemoteChampion() {
    const remote = `${CFG.remoteDir}/training/champion.json`;
    let meta;
    try {
        /* `cd` first, then require through process.cwd(). require() will not
         * expand a leading ~, which is why this used to rebuild the remote path
         * as /home/<user>/... locally and had to know the account name. The shell
         * on the far side expands ~ for free, so the username never appears. */
        meta = ssh(`cd ${CFG.remoteDir} && ${CFG.remoteNode} -e 'const d=require(process.cwd()+"/training/champion.json");` +
            `console.log(JSON.stringify({gen:d.gen,fitness:d.fitness,sizes:d.net.sizes}))'`);
    } catch (e) {
        say(`could not read the remote champion (${String(e.message).split("\n")[0]}) — leaving the baked brain as it is`);
        return null;
    }
    let info;
    try { info = JSON.parse(meta.trim().split("\n").pop()); }
    catch (e) { say("remote champion metadata was not JSON — skipping this round"); return null; }

    let out;
    try {
        ssh(`cp ${remote} /tmp/champ_candidate.json`);
        out = ssh(`cd ${CFG.remoteDir} && ${CFG.remoteNode} exam.js /tmp/champ_candidate.json ${CFG.stage}`, 1800000);
    } catch (e) {
        say(`the exam did not complete (${String(e.message).split("\n")[0]}) — skipping this round`);
        return null;
    }
    // "  ---- mean 1.17 waypoints, 4.06 m · reached >=1 on 5/12 · reached >=2 on 4/12"
    const m = out.match(/mean\s+([\d.]+)\s+waypoints,\s+([\d.]+)\s+m.*?>=2 on (\d+)\/(\d+)/);
    if (!m) { say("could not parse the exam summary — skipping this round"); return null; }
    return {
        gen: info.gen, fitness: info.fitness, sizes: info.sizes,
        waypoints: +m[1], metres: +m[2], twoPlus: +m[3], missions: +m[4]
    };
}

/* Strictly better on waypoints, or equal on waypoints and further on distance.
 * Equal-and-equal does not re-bake: rewriting an identical brain would churn
 * the file and lose the record of which generation earned the score. */
function isBetter(cand, cur) {
    // A missing or zeroed ledger used to mean "anything wins", which is only
    // right when nothing is baked yet. It is dangerously wrong when a brain IS
    // baked and merely its score has been lost: the next candidate replaces a
    // measured 4.50-waypoint champion regardless of quality. That happened —
    // a hand reset of the ledger disarmed the ratchet while default_brain.js
    // still held a good brain. If there is a brain but no score for it, decline
    // to bake and say what is needed, rather than overwrite it blind.
    if (!cur || !(cur.waypoints > 0)) {
        if (fs.existsSync(path.join(DIR, "default_brain.js"))) {
            say("a brain is baked but its score is missing — refusing to replace it blind. " +
                "Re-baseline by exam-ing the baked brain and writing training/baked_score.json, " +
                "or delete default_brain.js to start fresh.");
            return false;
        }
        return true;
    }
    if (cand.waypoints > cur.waypoints + 1e-9) return true;
    if (cand.waypoints < cur.waypoints - 1e-9) return false;
    return cand.metres > cur.metres + 1e-9;
}

/* Mirror the node's own held-out winner.
 *
 * autoselect.sh already exams every champion on the node and keeps the best in
 * training/best_holdout.json with its score beside it. Re-scoring champion.json
 * from here duplicated that work and was strictly worse: champion quality swings
 * violently between generations (0.17, 2.50, 2.58 waypoints against an incumbent
 * of 4.67), so sampling whichever champion happened to be current found an
 * improvement only by luck. Reading the node's ledger finds it every time, and
 * costs one small file transfer instead of a 66-episode exam. */
function readRemoteBest() {
    let raw;
    try {
        raw = ssh(`cat ${CFG.remoteDir}/training/best_holdout_score.json 2>/dev/null || true`);
    } catch (e) {
        say(`could not reach the node (${String(e.message).split("\n")[0]}) — leaving the baked brain alone`);
        return null;
    }
    const txt = (raw || "").trim();
    if (!txt) return null;                      // autoselect has not picked one yet
    try {
        const d = JSON.parse(txt.split("\n").pop());
        if (!(d.waypoints > 0)) return null;
        return { gen: d.gen, fitness: 0, sizes: null, waypoints: d.waypoints, metres: d.metres,
                 twoPlus: d.twoPlus, missions: d.missions || 12, remote: "training/best_holdout.json" };
    } catch (e) { say("the node's best-brain score was not JSON — skipping"); return null; }
}

function round() {
    const cur = readLedger();
    const cand = readRemoteBest() || scoreRemoteChampion();
    if (!cand) return;

    const held = cur
        ? `incumbent gen ${cur.gen}: ${cur.waypoints.toFixed(2)} wp / ${cur.metres.toFixed(2)} m`
        : "no incumbent recorded";
    if (!isBetter(cand, cur)) {
        say(`gen ${cand.gen} scored ${cand.waypoints.toFixed(2)} wp / ${cand.metres.toFixed(2)} m — not better than the ${held}; keeping the baked brain`);
        return;
    }

    // Only now is it worth moving 400 KB across the wire.
    const local = path.join(DIR, "training", `champion_gen${cand.gen}_node.json`);
    // Mirrored winners live at a stable path on the node; a locally-scored
    // candidate was staged in /tmp during the exam.
    const remotePath = cand.remote ? `${CFG.remoteDir}/${cand.remote}` : "/tmp/champ_candidate.json";
    try {
        execFileSync("scp", ["-q", "-o", "BatchMode=yes",
            `${CFG.host}:${remotePath}`, local], { timeout: 180000 });
    } catch (e) {
        say(`fetch failed (${String(e.message).split("\n")[0]}) — baked brain untouched`);
        return;
    }
    try {
        const out = execFileSync(process.execPath, [path.join(DIR, "bake_brain.js"), local],
            { encoding: "utf8", timeout: 120000 });
        say(out.trim().split("\n").pop());
    } catch (e) {
        // bake_brain refuses a brain whose shape does not match this build; that
        // is a guard doing its job, not a failure to paper over.
        say(`bake refused (${String(e.stderr || e.message).split("\n")[0]}) — baked brain untouched`);
        return;
    }
    fs.writeFileSync(LEDGER, JSON.stringify({
        gen: cand.gen, fitness: cand.fitness, sizes: cand.sizes,
        waypoints: cand.waypoints, metres: cand.metres,
        twoPlus: cand.twoPlus, missions: cand.missions,
        bakedAt: new Date().toISOString(), source: path.basename(local)
    }, null, 2));
    say(`BAKED gen ${cand.gen}: ${cand.waypoints.toFixed(2)} wp / ${cand.metres.toFixed(2)} m ` +
        `· reached >=2 waypoints on ${cand.twoPlus}/${cand.missions} held-out missions (was ${held})`);
}

if (CFG.once || !CFG.every) {
    round();
} else {
    say(`watching ${CFG.host} every ${CFG.every} min — will bake only a brain that beats the incumbent on the held-out exam`);
    round();
    setInterval(round, CFG.every * 60000);
}
