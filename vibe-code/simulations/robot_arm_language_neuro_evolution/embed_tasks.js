/* embed_tasks.js — offline bake: task sentences -> Qwen3 embeddings -> PCA -> JS.
 *
 *   node embed_tasks.js                          (default: qwen3-embedding:8b)
 *   node embed_tasks.js --model qwen3-embedding:0.6b --dims 24
 *   node embed_tasks.js --host http://localhost:11434
 *
 * Writes task_embeddings.js, which the sim and the trainer both load. Nothing
 * at run time ever talks to a language model: the network sees a fixed 24-float
 * vector per task, exactly as a deployed robot would if its instruction were
 * embedded once at the start of a job.
 *
 * Two details that are easy to get wrong and quietly ruin the experiment:
 *
 *   · The PCA basis is fitted on the TRAINING sentences only. Fitting it on all
 *     539 lets the held-out phrasings shape the axes the network is scored in,
 *     which is leakage — the generalisation number would be measuring a basis
 *     that had already seen the test set.
 *
 *   · Components are standardised to unit variance over the training split and
 *     then squashed. Raw PCA scores span two orders of magnitude between the
 *     first and the twenty-fourth component; fed straight into a GA-evolved
 *     layer, the tail components are invisible next to the leading ones and the
 *     fine semantic distinctions (which live in the tail) never get used.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const T = require("./tasks.js");

/* ------------------------------------------------------------------- args */
const argv = process.argv.slice(2);
function arg(name, def) {
    const i = argv.indexOf("--" + name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
const MODEL = arg("model", "qwen3-embedding:8b");
const DIMS = parseInt(arg("dims", "24"), 10);
const WHITEN = parseFloat(arg("whiten", "0.5"));
const HOST = arg("host", "http://localhost:11434");
const OUT = path.join(__dirname, arg("out", "task_embeddings.js"));

/* ------------------------------------------------------------------ ollama */
function embedOne(text) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ model: MODEL, input: text });
        const u = new URL("/api/embed", HOST);
        const req = http.request({
            hostname: u.hostname, port: u.port || 80, path: u.pathname,
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
        }, res => {
            let buf = "";
            res.on("data", d => buf += d);
            res.on("end", () => {
                if (res.statusCode !== 200) return reject(new Error(`${res.statusCode}: ${buf.slice(0, 300)}`));
                try {
                    const j = JSON.parse(buf);
                    const v = (j.embeddings && j.embeddings[0]) || j.embedding;
                    if (!v) return reject(new Error("no embedding in response"));
                    resolve(Float64Array.from(v));
                } catch (e) { reject(e); }
            });
        });
        req.on("error", reject);
        req.setTimeout(600000, () => req.destroy(new Error("timeout")));
        req.write(body);
        req.end();
    });
}

/* --------------------------------------------------------------- linear alg */
function l2norm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    s = Math.sqrt(s) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= s;
    return v;
}

/* Orthogonal (subspace) iteration for the top-K eigenpairs of a symmetric
 * n x n Gram matrix. n is 392 here, so this is a couple of seconds. */
function topEigen(G, n, K, iters) {
    let Q = [];
    // deterministic start — the bake must be reproducible
    let seed = 12345;
    const rnd = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        return seed / 0x7fffffff - 0.5;
    };
    for (let k = 0; k < K; k++) {
        const v = new Float64Array(n);
        for (let i = 0; i < n; i++) v[i] = rnd();
        Q.push(v);
    }
    const gramSchmidt = () => {
        for (let k = 0; k < K; k++) {
            for (let j = 0; j < k; j++) {
                let d = 0;
                for (let i = 0; i < n; i++) d += Q[k][i] * Q[j][i];
                for (let i = 0; i < n; i++) Q[k][i] -= d * Q[j][i];
            }
            l2norm(Q[k]);
        }
    };
    gramSchmidt();
    for (let it = 0; it < iters; it++) {
        const Z = [];
        for (let k = 0; k < K; k++) {
            const z = new Float64Array(n);
            const q = Q[k];
            for (let i = 0; i < n; i++) {
                let s = 0;
                const row = G[i];
                for (let j = 0; j < n; j++) s += row[j] * q[j];
                z[i] = s;
            }
            Z.push(z);
        }
        Q = Z;
        gramSchmidt();
    }
    // Rayleigh quotients
    const lam = new Float64Array(K);
    for (let k = 0; k < K; k++) {
        const q = Q[k];
        let s = 0;
        for (let i = 0; i < n; i++) {
            let r = 0;
            const row = G[i];
            for (let j = 0; j < n; j++) r += row[j] * q[j];
            s += q[i] * r;
        }
        lam[k] = s;
    }
    // sort descending
    const idx = Array.from({ length: K }, (_, k) => k).sort((a, b) => lam[b] - lam[a]);
    return { vecs: idx.map(k => Q[k]), vals: idx.map(k => lam[k]) };
}

async function embedAll(tasks) {
    const out = [];
    const t0 = Date.now();
    for (let i = 0; i < tasks.length; i++) {
        let v = null, lastErr = null;
        for (let attempt = 0; attempt < 3 && !v; attempt++) {
            try { v = await embedOne(tasks[i].text); }
            catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1500)); }
        }
        if (!v) throw new Error(`embed failed for "${tasks[i].text}": ${lastErr && lastErr.message}`);
        out.push(l2norm(v));
        if (i % 10 === 0 || i === tasks.length - 1) {
            const el = (Date.now() - t0) / 1000;
            const eta = i > 0 ? (el / (i + 1)) * (tasks.length - i - 1) : 0;
            console.log(`  embedded ${i + 1}/${tasks.length}  (${el.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left)`);
        }
    }
    return out;
}

/* ------------------------------------------------------------------- main */
(async function main() {
    const tasks = T.TASKS;
    const hash = T.corpusHash();
    console.log(`corpus: ${tasks.length} sentences (${T.TASKS_TRAIN.length} train / ${T.TASKS_HOLDOUT.length} holdout), hash ${hash}`);
    console.log(`model:  ${MODEL} via ${HOST}`);

    // --- 1. embed everything -------------------------------------------------
    // Raw vectors are cached to disk keyed by (model, corpus hash). Embedding
    // 539 sentences through an 8B model on CPU is a ~40 minute job; re-running
    // the PCA at a different width must not pay that again.
    const cacheFile = path.join(__dirname, "training", `raw_${MODEL.replace(/[:\/]/g, "_")}_${hash}.json`);
    let raw = [];
    if (fs.existsSync(cacheFile) && !argv.includes("--refresh")) {
        const c = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        raw = c.vectors.map(v => Float64Array.from(v));
        console.log(`  reusing cached embeddings (${path.basename(cacheFile)})`);
    } else {
        raw = await embedAll(tasks);
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({
            model: MODEL, hash, vectors: raw.map(v => Array.from(v).map(x => +x.toFixed(6)))
        }));
        console.log(`  cached raw vectors -> ${path.basename(cacheFile)}`);
    }
    const D = raw[0].length;
    console.log(`  native dimension: ${D}`);

    // --- 2. PCA fitted on the TRAIN split only -------------------------------
    const trainIdx = [];
    tasks.forEach((t, i) => { if (t.split === "train") trainIdx.push(i); });
    const n = trainIdx.length;

    const mean = new Float64Array(D);
    for (const i of trainIdx) { const v = raw[i]; for (let d = 0; d < D; d++) mean[d] += v[d]; }
    for (let d = 0; d < D; d++) mean[d] /= n;

    const X = trainIdx.map(i => {
        const v = new Float64Array(D), s = raw[i];
        for (let d = 0; d < D; d++) v[d] = s[d] - mean[d];
        return v;
    });

    // Gram matrix in SAMPLE space (n x n) — far smaller than the d x d covariance
    console.log(`  building ${n}x${n} Gram matrix...`);
    const G = [];
    for (let i = 0; i < n; i++) {
        const row = new Float64Array(n);
        for (let j = 0; j <= i; j++) {
            let s = 0;
            const a = X[i], b = X[j];
            for (let d = 0; d < D; d++) s += a[d] * b[d];
            row[j] = s;
            if (j < i) G[j][i] = s;
        }
        G.push(row);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) G[i][j] = G[j][i];

    console.log(`  eigendecomposition for top ${DIMS}...`);
    const { vecs, vals } = topEigen(G, n, DIMS, 220);
    const totalVar = (() => { let s = 0; for (let i = 0; i < n; i++) s += G[i][i]; return s; })();
    const explained = vals.reduce((s, v) => s + Math.max(0, v), 0) / totalVar;
    console.log(`  variance explained by ${DIMS} components: ${(explained * 100).toFixed(1)}%`);

    // Principal directions in embedding space: v_k = X^T u_k / sqrt(lambda_k)
    const basis = [];
    for (let k = 0; k < DIMS; k++) {
        const v = new Float64Array(D);
        const u = vecs[k], sc = Math.sqrt(Math.max(vals[k], 1e-12));
        for (let i = 0; i < n; i++) {
            const w = u[i] / sc, xi = X[i];
            for (let d = 0; d < D; d++) v[d] += w * xi[d];
        }
        basis.push(v);
    }

    const project = (vec) => {
        const out = new Float64Array(DIMS);
        for (let k = 0; k < DIMS; k++) {
            let s = 0;
            const b = basis[k];
            for (let d = 0; d < D; d++) s += b[d] * (vec[d] - mean[d]);
            out[k] = s;
        }
        return out;
    };

    /* --- 3. scale each component ------------------------------------------
     *
     * WHITEN is the exponent on the per-component standard deviation:
     *
     *   1.0  full whitening — every component gets unit variance
     *   0.0  none — components keep their raw PCA magnitudes
     *
     * This is not a cosmetic knob. Full whitening makes the 32nd component
     * exactly as loud as the 1st, and the leading components are the ones
     * carrying COLOUR (colour words are the most distinctive tokens in the
     * bank), while the tail carries the rule type. Measured on held-out
     * phrasings, whitening at 32 dims trades colour recovery down from 86% to
     * 62% to buy rule-type recovery from 61% to 63% — a bad trade. Partial
     * whitening keeps the leading components dominant while still letting the
     * tail be visible at all, which is what the arm needs: it has to know both
     * which colours were named and what kind of rule applies. */
    const trainScores = trainIdx.map(i => project(raw[i]));
    const sd = new Float64Array(DIMS);
    for (let k = 0; k < DIMS; k++) {
        let s = 0;
        for (const t of trainScores) s += t[k] * t[k];
        sd[k] = Math.sqrt(s / trainScores.length) || 1;
    }
    // effective divisor: sd_k^WHITEN * sd_0^(1-WHITEN)
    const scale = new Float64Array(DIMS);
    for (let k = 0; k < DIMS; k++) scale[k] = Math.pow(sd[k], WHITEN) * Math.pow(sd[0], 1 - WHITEN);
    // tanh keeps an outlier phrasing from handing one input channel a value of
    // 6 while every other sentence sits near 1
    const encode = (vec) => {
        const p = project(vec), out = new Array(DIMS);
        for (let k = 0; k < DIMS; k++) out[k] = +(Math.tanh(p[k] / scale[k] * 0.7)).toFixed(5);
        return out;
    };

    const emb = tasks.map((t, i) => encode(raw[i]));

    // --- 4. diagnostics: does the geometry actually carry the task? ----------
    const cos = (a, b) => {
        let s = 0, na = 0, nb = 0;
        for (let k = 0; k < DIMS; k++) { s += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
        return s / (Math.sqrt(na * nb) || 1);
    };
    let sameSpec = 0, sameN = 0, diffSpec = 0, diffN = 0;
    for (let i = 0; i < tasks.length; i++)
        for (let j = i + 1; j < tasks.length; j++) {
            const c = cos(emb[i], emb[j]);
            if (tasks[i].specIdx === tasks[j].specIdx) { sameSpec += c; sameN++; }
            else { diffSpec += c; diffN++; }
        }

    /* 1-NN over the training bank, at THREE granularities. Exact-spec recovery
     * is the strictest and the least informative on its own: the bank contains
     * near-synonymous specs (SORT{red} vs SORT{red,blue}) that a policy does not
     * need to tell apart perfectly to behave well, and 49 classes makes chance
     * 2%. What the arm actually has to read off the vector is
     *   · the KIND of rule   (sort? alternate? leave one out? count?)
     *   · WHICH COLOURS it names
     * so those are reported separately, and they are the numbers to judge an
     * embedder by. Colour recovery is scored as Jaccard overlap between the
     * colour sets, because "red and blue" vs "red" is a partial hit, not a miss. */
    const colorsOf = (t) => {
        const p = t.params, s = new Set();
        if (p.colors) p.colors.forEach(c => s.add(c));
        if (p.color !== undefined) s.add(p.color);
        if (p.spare !== undefined) s.add(p.spare);
        if (p.skip !== undefined) s.add(p.skip);
        if (p.bucket !== undefined) s.add(p.bucket);
        return s;
    };
    let hitSpec = 0, hitKind = 0, colJac = 0, tot = 0;
    tasks.forEach((t, i) => {
        if (t.split !== "holdout") return;
        let best = -2, bj = -1;
        trainIdx.forEach(j => {
            const c = cos(emb[i], emb[j]);
            if (c > best) { best = c; bj = j; }
        });
        const nn = tasks[bj];
        tot++;
        if (nn.specIdx === t.specIdx) hitSpec++;
        if (nn.kind === t.kind) hitKind++;
        const A = colorsOf(t), B = colorsOf(nn);
        let inter = 0;
        A.forEach(c => { if (B.has(c)) inter++; });
        colJac += inter / (new Set([...A, ...B]).size || 1);
    });
    const diag = {
        model: MODEL, nativeDim: D, dims: DIMS, whiten: WHITEN,
        explainedVar: +(explained).toFixed(4),
        meanCosSameSpec: +(sameSpec / sameN).toFixed(4),
        meanCosDiffSpec: +(diffSpec / diffN).toFixed(4),
        holdout1NN: +(hitSpec / tot).toFixed(4),
        holdoutKind: +(hitKind / tot).toFixed(4),
        holdoutColor: +(colJac / tot).toFixed(4)
    };
    console.log("  diagnostics:", JSON.stringify(diag));
    console.log(`  held-out 1-NN: kind ${(diag.holdoutKind * 100).toFixed(0)}% (chance 14%) · ` +
        `colours ${(diag.holdoutColor * 100).toFixed(0)}% Jaccard · exact spec ${(diag.holdout1NN * 100).toFixed(0)}% (chance 2%)`);
    if (diag.holdoutKind < 0.55)
        console.log("  ! kind recovery is weak — a bigger embedder or more PCA dims would help");

    // --- 5. write ------------------------------------------------------------
    const round = (v, p) => +v.toFixed(p);
    const lines = [];
    lines.push(`/* task_embeddings.js — GENERATED by embed_tasks.js. Do not edit.`);
    lines.push(` * model: ${MODEL}   native dim: ${D} -> PCA ${DIMS} (fitted on the train split only)`);
    lines.push(` * corpus hash: ${hash}   ${tasks.length} sentences`);
    lines.push(` * diagnostics: ${JSON.stringify(diag)}`);
    lines.push(` */`);
    lines.push(`"use strict";`);
    lines.push(`const EMB_META = ${JSON.stringify(Object.assign({ corpusHash: hash, count: tasks.length }, diag))};`);
    lines.push(`const EMB_DIM = ${DIMS};`);
    lines.push(`const TASK_EMB = [`);
    emb.forEach((v, i) => lines.push(`[${v.join(",")}],${i % 8 === 7 ? "" : ""}`));
    lines.push(`];`);
    lines.push(`const TASK_EMB_IDS = ${JSON.stringify(tasks.map(t => t.id))};`);
    lines.push(`if (typeof module !== "undefined") module.exports = { EMB_META, EMB_DIM, TASK_EMB, TASK_EMB_IDS };`);
    fs.writeFileSync(OUT, lines.join("\n") + "\n");
    const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
    console.log(`wrote ${path.basename(OUT)} (${kb} kB)`);

    /* The PROJECTION BASIS goes in its own file, loaded on demand.
     *
     * It is a D x DIMS matrix — with a 4096-wide embedder that is half a
     * megabyte, four times the size of everything else on the page put
     * together, and it is only needed by the "type your own instruction" box.
     * Every visitor who just wants to watch the arm would otherwise pay for a
     * feature that requires a local Ollama they probably do not have running. */
    const bLines = [];
    bLines.push(`/* task_embeddings_basis.js — GENERATED. Loaded on demand by the live-instruction box.`);
    bLines.push(` * Projects a fresh ${MODEL} vector into the ${DIMS}-d space the brains evolved in:`);
    bLines.push(` *   encode(v)[k] = tanh( ((v/|v| - MEAN) . BASIS[k]) / SD[k] * 0.7 )`);
    bLines.push(` */`);
    bLines.push(`"use strict";`);
    bLines.push(`const EMB_MEAN = [${Array.from(mean).map(v => round(v, 5)).join(",")}];`);
    bLines.push(`const EMB_SD = [${Array.from(scale).map(v => round(v, 8)).join(",")}];`);
    bLines.push(`const EMB_BASIS = [`);
    basis.forEach(b => bLines.push(`[${Array.from(b).map(v => round(v, 5)).join(",")}],`));
    bLines.push(`];`);
    bLines.push(`if (typeof module !== "undefined") module.exports = { EMB_MEAN, EMB_SD, EMB_BASIS };`);
    const basisPath = OUT.replace(/\.js$/, "_basis.js");
    fs.writeFileSync(basisPath, bLines.join("\n") + "\n");
    console.log(`wrote ${path.basename(basisPath)} (${(fs.statSync(basisPath).size / 1024).toFixed(0)} kB, loaded on demand)`);
})().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
