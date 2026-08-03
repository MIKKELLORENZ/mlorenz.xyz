/* bake_bridge.js — the local half of the dashboard's "send to browser" button.
 *
 *   node bake_bridge.js            then leave it running
 *
 * THE PROBLEM IT SOLVES. The dashboard runs on the training node and its server
 * cannot write to this laptop, so a button there cannot by itself replace
 * default_brain.js. But the dashboard PAGE runs in the browser here, and a page
 * can talk to localhost. So the transfer goes:
 *
 *   dashboard page  --GET /api/champion-->  training node   (the genome)
 *   dashboard page  --POST /bake--------->  this bridge     (writes the file)
 *
 * One click, no scp, no manual bake. The bridge only ever writes one file, in
 * one directory, and only accepts a body that parses as a network of exactly the
 * shape this build expects — a brain of the wrong width would load, run, score
 * plausibly and be wired to the wrong sensors, which is a failure this project
 * has shipped before and does not intend to ship again.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const PORT = +(process.argv[2] || 8914);
const DIR = __dirname;

/* Load the sim so the incoming genome can be checked against THIS build's
 * layout before anything is overwritten. */
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js"])
    vm.runInThisContext(fs.readFileSync(path.join(DIR, f), "utf8"), { filename: f });
const EXPECT = NET_SIZES.join("-");

function bake(saved) {
    const sizes = (saved.net || saved).sizes;
    if (!sizes) throw new Error("that JSON has no network in it");
    if (sizes.join("-") !== EXPECT)
        throw new Error(`that brain is ${sizes.join("-")} but this build expects ${EXPECT} — ` +
            `it is from a different sensor layout and would be wired to the wrong inputs`);
    /* Written through a temp file in the same directory, then renamed. A
     * half-written default_brain.js is a page that throws on load, and the
     * rename is atomic on the same filesystem. */
    const gen = saved.gen || 0;
    const tmp = path.join(DIR, "training", `_incoming_gen${gen}.json`);
    fs.mkdirSync(path.join(DIR, "training"), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(saved));
    const keep = path.join(DIR, "training", `champion_gen${gen}.json`);
    fs.renameSync(tmp, keep);
    // Reuse the real baker rather than reimplementing its format here.
    const out = execFileSync(process.execPath, [path.join(DIR, "bake_brain.js"), keep],
        { cwd: DIR, encoding: "utf8" });
    /* The id is read back out of what was actually written, not computed from
     * what we meant to write. That is the difference between reporting a transfer
     * and confirming one: if the baker rounded, refused or wrote something else,
     * this reports the file on disk. */
    const baked = fs.readFileSync(path.join(DIR, "default_brain.js"), "utf8");
    const idm = /"id"\s*:\s*"([^"]+)"/.exec(baked);
    return { gen, fitness: saved.fitness || 0, sizes: sizes.join("-"), id: idm ? idm[1] : null,
             saved: path.basename(keep), log: out.trim() };
}

const server = http.createServer((req, res) => {
    const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, GET, OPTIONS"
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.url === "/ping") {
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, expects: EXPECT, dir: DIR }));
    }
    if (req.method !== "POST" || req.url !== "/bake") {
        res.writeHead(404, { ...cors, "content-type": "text/plain" });
        return res.end("POST /bake with a champion.json body");
    }
    let body = "";
    req.on("data", c => {
        body += c;
        if (body.length > 64 * 1024 * 1024) { req.destroy(); }   // a genome is ~2 MB
    });
    req.on("end", () => {
        try {
            const info = bake(JSON.parse(body));
            console.log(`baked gen ${info.gen} (fitness ${Math.round(info.fitness)}) -> default_brain.js`);
            res.writeHead(200, { ...cors, "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, ...info }));
        } catch (e) {
            console.error("refused:", e.message);
            res.writeHead(400, { ...cors, "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e.message }));
        }
    });
});
server.listen(PORT, "127.0.0.1", () => {
    console.log(`bake bridge on http://127.0.0.1:${PORT}  writing into ${DIR}`);
    console.log(`this build expects a ${EXPECT} brain`);
    console.log(`leave this running, then press "Send to browser" on the dashboard.`);
});
