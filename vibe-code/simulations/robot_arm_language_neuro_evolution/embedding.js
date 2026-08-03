/* embedding.js — hands the network a fixed vector for an instruction.
 *
 * Load order matters: task_embeddings.js (generated) must be loaded BEFORE this
 * file. If it is present and its corpus hash matches the task bank, every task
 * gets its baked Qwen3 vector. If it is absent — a fresh checkout that has not
 * run the bake yet — a deterministic bag-of-words surrogate stands in so the
 * simulation still runs.
 *
 * The surrogate is NOT a quiet substitute for the real thing and the UI says so
 * in as many words. It is a hashed unigram+bigram sketch: it can separate
 * "green" from "yellow" because those are different tokens, but it has no idea
 * that "leave one behind" and "hold one back" mean the same thing, which is the
 * exact generalisation the held-out split tests. A brain evolved on the
 * surrogate will look fine on training phrasings and collapse on unseen ones,
 * and that result would be an artefact of the fallback, not a finding.
 */
"use strict";

const SURROGATE_DIM = 24;

const Embedding = (function () {
    const baked = (typeof TASK_EMB !== "undefined") ? TASK_EMB : null;
    const meta = (typeof EMB_META !== "undefined") ? EMB_META : null;
    const ids = (typeof TASK_EMB_IDS !== "undefined") ? TASK_EMB_IDS : null;

    let mode = "surrogate", dim = SURROGATE_DIM, byId = null, warning = null;

    if (baked && meta && ids) {
        const want = corpusHash();
        if (meta.corpusHash !== want) {
            warning = `task_embeddings.js was baked from corpus ${meta.corpusHash} but the task bank is now ${want}. ` +
                `Re-run: node embed_tasks.js --model ${meta.model}`;
        } else if (baked.length !== TASKS.length) {
            warning = `task_embeddings.js has ${baked.length} vectors, the bank has ${TASKS.length}.`;
        } else {
            byId = Object.create(null);
            for (let i = 0; i < ids.length; i++) byId[ids[i]] = baked[i];
            dim = (typeof EMB_DIM !== "undefined") ? EMB_DIM : baked[0].length;
            mode = "qwen";
        }
    }

    /* ---------------------------------------------------------- surrogate */
    function hash32(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        return h >>> 0;
    }
    const surrogateCache = Object.create(null);
    function surrogate(text) {
        if (surrogateCache[text]) return surrogateCache[text];
        const v = new Float32Array(SURROGATE_DIM);
        const toks = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
        const bump = (tok, w) => {
            const h = hash32(tok);
            v[h % SURROGATE_DIM] += ((h >>> 8) & 1 ? 1 : -1) * w;
        };
        for (let i = 0; i < toks.length; i++) {
            bump(toks[i], 1);
            if (i + 1 < toks.length) bump(toks[i] + "_" + toks[i + 1], 0.7);
        }
        let n = 0;
        for (let i = 0; i < SURROGATE_DIM; i++) n += v[i] * v[i];
        n = Math.sqrt(n) || 1;
        for (let i = 0; i < SURROGATE_DIM; i++) v[i] = Math.tanh(v[i] / n * 3);
        surrogateCache[text] = v;
        return v;
    }

    /* --------------------------------------------------------------- api */
    const zeros = new Float32Array(dim);
    function forTask(task) {
        if (mode === "qwen") {
            const v = byId[task.id];
            if (v) return v;
            return zeros;
        }
        return surrogate(task.text);
    }

    /* The projection basis is half a megabyte and only the "type your own
     * instruction" box needs it, so it lives in its own file and is fetched the
     * first time someone actually uses that box. */
    let basisPromise = null;
    function ensureBasis() {
        if (typeof EMB_BASIS !== "undefined") return Promise.resolve(true);
        if (typeof document === "undefined") return Promise.resolve(false);
        if (!basisPromise) {
            basisPromise = new Promise((resolve, reject) => {
                const s = document.createElement("script");
                s.src = "task_embeddings_basis.js";
                s.onload = () => resolve(true);
                s.onerror = () => reject(new Error("task_embeddings_basis.js failed to load"));
                document.body.appendChild(s);
            });
        }
        return basisPromise;
    }

    /* Project a fresh embedding vector (native model dimension) into exactly the
     * space the brain was evolved in. Used by the browser's "type your own
     * instruction" box when a local Ollama is reachable. */
    function encodeLive(vec) {
        if (mode !== "qwen" || typeof EMB_BASIS === "undefined") return null;
        if (vec.length !== EMB_MEAN.length) return null;
        let n = 0;
        for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
        n = Math.sqrt(n) || 1;
        const out = new Float32Array(dim);
        for (let k = 0; k < dim; k++) {
            const b = EMB_BASIS[k];
            let s = 0;
            for (let i = 0; i < vec.length; i++) s += b[i] * (vec[i] / n - EMB_MEAN[i]);
            out[k] = Math.tanh(s / EMB_SD[k] * 0.7);
        }
        return out;
    }

    return {
        get mode() { return mode; },
        get dim() { return dim; },
        get meta() { return meta; },
        get warning() { return warning; },
        get nativeDim() { return meta ? meta.nativeDim : 0; },
        forTask, encodeLive, ensureBasis
    };
})();

if (typeof module !== "undefined") module.exports = { Embedding, SURROGATE_DIM };
