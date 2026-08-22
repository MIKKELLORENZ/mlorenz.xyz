/* sync_champion.js — keep a LIBRARY of champions, not just the latest one.
 *
 *   node sync_champion.js [training/best_holdout.json]
 *
 * Every champion the trainer produces is archived under `training/champions/`
 * by its own identity and never overwritten, and the best few are baked into
 * `brain_library.js`, which is what the page loads. That file is a plain script
 * assignment rather than something to be fetched, because these simulations are
 * expected to work from a `file://` URL with no server and no network.
 *
 * THE IDENTITY IS AN 8-HEX FNV HASH OF THE WEIGHTS THEMSELVES, not a counter.
 * Two consequences worth having: re-running this after a champion has already
 * been archived is a no-op rather than a duplicate, and a brain in the browser
 * can be matched against a file on the training box by eye. Generation numbers
 * cannot do either — runs restart, and the same generation number means
 * different things in different runs.
 *
 * WEIGHTS ARE BASE64 FLOAT32, NOT JSON NUMBERS. A 39 082-weight genome written
 * as decimal text is 780 kB; the same bytes in base64 are 208 kB. With a dozen
 * champions in the library that is the difference between a page that loads and
 * one that does not.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const NN = require("./nn.js");

const SRC = process.argv[2] || path.join("training", "best_holdout.json");
const ARCHIVE = path.join("training", "champions");
const LIB = "brain_library.js";
/* How many make it into the page. The archive keeps everything; this is only
 * about how much the browser has to download and hold. */
const KEEP = Number(process.env.KEEP || 10);

if (!fs.existsSync(SRC)) {
    console.error(`sync_champion: ${SRC} does not exist — has the trainer written a champion yet?`);
    process.exit(1);
}
const incoming = JSON.parse(fs.readFileSync(SRC, "utf8"));
if (!incoming.brain) { console.error("sync_champion: no brain in " + SRC); process.exit(1); }

fs.mkdirSync(ARCHIVE, { recursive: true });

/* ---------------------------------------------------------------- archive */
const brain = NN.Brain.fromJSON(incoming.brain);
const id = brain.hash();                       // 8 hex chars, from the weights
const dest = path.join(ARCHIVE, id + ".json");

let added = false;
if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, JSON.stringify({
        id,
        gen: incoming.gen,
        exam: incoming.exam,
        live: incoming.live,          // mean over the TRAINED stages; the ranking number
        stages: incoming.stages,
        worst: incoming.worst,
        caught: incoming.caught,
        safe: incoming.safe,
        tally: incoming.tally,
        perStage: incoming.perStage,
        arch: incoming.arch, act: incoming.act,
        archived: new Date().toISOString(),
        brain: incoming.brain
    }));
    added = true;
}

/* ------------------------------------------------------------- the library */
const entries = [];
for (const f of fs.readdirSync(ARCHIVE)) {
    if (!f.endsWith(".json")) continue;
    try { entries.push(JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8"))); }
    catch (e) { console.warn("  (skipping unreadable " + f + ")"); }
}
/* A BRAIN WHOSE INPUT COUNT NO LONGER MATCHES THE SENSORS CANNOT FLY, AND MUST
 * NOT BE SHIPPED. The observation grew from 200 to 209 inputs when the audit
 * added the capture-box, pin-velocity and roll channels. Five archived
 * champions predate that, and because they were ranked by a stale `exam`
 * number they sorted ABOVE the current one — so the page, which loads best
 * first, would have handed the viewer a genome that cannot be fed the
 * observation the simulation now produces. The archive keeps them; the library
 * does not carry them. */
const N_IN = require("./sensors.js").N_INPUT;
const live = entries.filter(e => {
    const n = (e.brain.sizes && e.brain.sizes[0]) || (e.brain.spec && e.brain.spec.nin);
    if (n === N_IN) return true;
    console.warn(`  (excluding ${e.id}: ${n} inputs, sensors now produce ${N_IN})`);
    return false;
});

/* RANKED BY A SCORE THAT MEANS THE SAME THING FOR EVERY ENTRY. `exam` is the
 * mean over ALL SEVEN stages, and while the diet is stage 0 only, five of those
 * are untrained noise — ranking on it is the same defect that let a run crown a
 * champion which lost to doing nothing. `rank` below prefers the trained-stage
 * mean recorded by the trainer (`live`), falling back to `exam` for entries
 * archived before that field existed. */
const rankOf = (e) => (e.live != null ? e.live : e.exam);
live.sort((a, b) => (rankOf(b) - rankOf(a)) || (b.gen - a.gen));
entries.length = 0;
entries.push(...live);

const b64 = (arr) => Buffer.from(Float32Array.from(arr).buffer).toString("base64");

const chosen = entries.slice(0, KEEP);
const lines = chosen.map((e, i) => {
    const w = e.brain.weights.map(b64);
    return "  " + JSON.stringify({
        id: e.id,
        rank: i + 1,
        gen: e.gen,
        exam: +Number(e.exam).toFixed(4),
        live: e.live != null ? +Number(e.live).toFixed(4) : null,
        worst: +Number(e.worst).toFixed(3),
        caught: e.caught || 0,
        safe: e.safe || 0,
        tally: e.tally || {},
        archived: (e.archived || "").slice(0, 19) + "Z",
        spec: e.brain.spec,
        act: e.brain.act || "tanh",
        sizes: e.brain.sizes,
        scales: e.brain.scales,
        w
    });
});

const header =
    `/* brain_library.js — GENERATED by sync_champion.js. Do not edit by hand.\n` +
    ` *\n` +
    ` * Every champion this project has produced, best first by CANONICAL held-out
 * score on the trained stages. Entries whose input count no longer matches the
 * sensors are excluded — they cannot be fed the current observation.\n` +
    ` * Weights are base64-encoded little-endian Float32; main.js decodes them.\n` +
    ` * The 8-hex id is an FNV hash of the weights, so it identifies the genome\n` +
    ` * itself and matches the filename in training/champions/.\n` +
    ` *\n` +
    ` * archive holds ${entries.length}, page carries ${chosen.length}\n` +
    chosen.map(e => ` *   ${e.id}  gen ${String(e.gen).padStart(5)}  ` +
        `score ${(e.live != null ? Number(e.live) : Number(e.exam)).toFixed(4).padStart(8)}  ` +
        `caught ${e.caught || 0}  safe ${e.safe || 0}  ${(e.brain.sizes || [])[0] || "?"} in`).join("\n") + "\n" +
    ` */\n`;

fs.writeFileSync(LIB, header + "window.BRAIN_LIBRARY = [\n" + lines.join(",\n") + "\n];\n");

const kb = (fs.statSync(LIB).size / 1024).toFixed(0);
console.log(`sync_champion: ${added ? "archived NEW champion " + id : "champion " + id + " already archived"}` +
    ` (gen ${incoming.gen}, exam ${Number(incoming.exam).toFixed(4)}, ${incoming.caught || 0} catches)`);
console.log(`sync_champion: library has ${chosen.length} of ${entries.length} archived · ${kb} kB · best ` +
    `${chosen.length ? chosen[0].id + " @ " + Number(chosen[0].exam).toFixed(4) : "none"}`);
