/* ui.js — panel wiring. Every knob lives in CFG; main.js reads it each frame. */
"use strict";

const CFG = {
    popSize: 24,
    episodes: 3,
    /* Measured on stage 1 (gridsearch.js). Top-quartile deliveries:
     *   all-heads 0.20/0.15 -> 0.075     modular 0.20/0.15 -> 0.125
     *   modular   0.30/0.20 -> 0.125     modular 0.12/0.20 -> 0.250
     * The two knobs interact. With all three heads mutating, a LOWER rate was
     * strictly worse (0.06/0.12 scored 0.000) because nothing ever escaped.
     * Once only one head moves per child, low rate becomes refinement rather
     * than paralysis and wins by 3.3x over the original default. */
    mutRate: 0.12,
    mutSigma: 0.20,
    gracePeriod: 3,
    immZeroFit: 1800,
    childZeroFit: 6000,
    stageLock: 0,
    speed: 1,
    paused: false,
    showBenches: 12,
    soloView: false,
    focus: 0,
    split: "train",          // which phrasing pool the episodes draw from
    pinnedTaskId: null,      // a specific sentence, pinned by the user
    liveTask: null,          // a sentence the user typed, embedded via local Ollama
    liveEmbedding: null,
    showcaseSpin: 0
};

const UI = {};
function $(id) { return document.getElementById(id); }
let H = {};
let baked = null;
let lastGenRec = null;

/* ------------------------------------------------------------------ setup */
function initUI(handlers) {
    H = handlers;

    // ---- embedding provenance -------------------------------------------
    const badge = $("emb-badge");
    if (Embedding.mode === "qwen") {
        badge.textContent = `${Embedding.meta.model} · ${Embedding.nativeDim}→${Embedding.dim}`;
        badge.className = "pill good";
        $("emb-detail").innerHTML =
            `Sentences were embedded offline by <b>${Embedding.meta.model}</b> and projected onto the ` +
            `first <b>${Embedding.dim}</b> principal components — a basis fitted on the <i>training</i> ` +
            `phrasings only. Held-out 1-NN recovers the rule type ` +
            `<b>${(Embedding.meta.holdoutKind * 100).toFixed(0)}%</b> of the time and the named colours ` +
            `<b>${(Embedding.meta.holdoutColor * 100).toFixed(0)}%</b> (Jaccard).`;
    } else {
        badge.textContent = "surrogate (not baked)";
        badge.className = "pill warn";
        $("emb-detail").innerHTML =
            `<b>No baked vectors found.</b> Running on a hashed bag-of-words stand-in so the sim still ` +
            `works. It separates different words but knows nothing about meaning, so held-out phrasings ` +
            `are hopeless by construction. Run <code>node embed_tasks.js</code> to bake the real ones.`;
    }
    if (Embedding.warning) {
        $("emb-detail").innerHTML += `<br><span class="bad">${Embedding.warning}</span>`;
    }

    // ---- task picker -----------------------------------------------------
    const kindSel = $("sel-kind");
    const KINDS = ["(any)", "SORT", "ALTERNATE", "LEAVE_ONE", "COUNT", "ORDER", "EXCLUDE", "ALL_TO_ONE"];
    KINDS.forEach(k => {
        const o = document.createElement("option");
        o.value = k === "(any)" ? "" : k;
        o.textContent = k === "(any)" ? "any goal type" : k.toLowerCase().replace(/_/g, " ");
        kindSel.appendChild(o);
    });
    const refreshPhrases = () => {
        const sel = $("sel-phrase");
        sel.innerHTML = "";
        const none = document.createElement("option");
        none.value = ""; none.textContent = "— rotate through the pool —";
        sel.appendChild(none);
        const kind = kindSel.value;
        const pool = TASKS.filter(t => (!kind || t.kind === kind) && t.split === CFG.split);
        pool.slice(0, 400).forEach(t => {
            const o = document.createElement("option");
            o.value = t.id;
            o.textContent = (t.split === "holdout" ? "★ " : "") + t.text;
            sel.appendChild(o);
        });
        $("phrase-count").textContent = `${pool.length} sentences`;
    };
    kindSel.onchange = refreshPhrases;
    $("sel-phrase").onchange = (e) => {
        CFG.pinnedTaskId = e.target.value || null;
        CFG.liveTask = null; CFG.liveEmbedding = null;
    };
    document.querySelectorAll("input[name=split]").forEach(r => {
        r.onchange = () => {
            CFG.split = r.value;
            CFG.pinnedTaskId = null;
            refreshPhrases();
            $("split-note").textContent = CFG.split === "holdout"
                ? "★ These sentences were never used during evolution. This is the real test."
                : "The 392 phrasings evolution is scored on.";
        };
    });
    refreshPhrases();

    // ---- live instruction box -------------------------------------------
    $("btn-live").onclick = () => embedLive($("live-text").value.trim());
    $("live-text").addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); embedLive(e.target.value.trim()); }
    });

    // ---- curriculum ------------------------------------------------------
    const track = $("stage-track");
    STAGES.forEach(s => {
        const d = document.createElement("div");
        d.className = "stage-pip";
        d.innerHTML = `<b>${s.id}</b>${s.name}`;
        d.title = s.desc;
        track.appendChild(d);
    });
    bindSlider("sl-stagelock", "lb-stagelock", v => {
        CFG.stageLock = v;
        return v === 0 ? "auto" : String(v);
    });

    // ---- evolution knobs -------------------------------------------------
    bindSlider("sl-pop", "lb-pop", v => { CFG.popSize = v; return String(v); });
    bindSlider("sl-eps", "lb-eps", v => { CFG.episodes = v; return String(v); });
    bindSlider("sl-mut", "lb-mut", v => { CFG.mutRate = v / 100; return (v / 100).toFixed(2); });
    bindSlider("sl-sig", "lb-sig", v => { CFG.mutSigma = v / 100; return (v / 100).toFixed(2); });
    bindSlider("sl-grace", "lb-grace", v => { CFG.gracePeriod = v; return v === 0 ? "off" : String(v); });
    bindSlider("sl-benches", "lb-benches", v => { CFG.showBenches = v; return String(v); });

    // ---- top actions -----------------------------------------------------
    const speeds = [["½", 0.5], ["1×", 1], ["4×", 4], ["16×", 16], ["max", 0]];
    const sg = $("speed-group");
    speeds.forEach(([label, v]) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.onclick = () => {
            CFG.speed = v;
            [...sg.children].forEach(c => c.classList.toggle("on", c === b));
        };
        if (v === 1) b.classList.add("on");
        sg.appendChild(b);
    });
    $("btn-pause").onclick = () => {
        CFG.paused = !CFG.paused;
        $("btn-pause").textContent = CFG.paused ? "Resume" : "Pause";
        $("btn-pause").classList.toggle("primary", !CFG.paused);
    };
    let dark = false;
    $("btn-theme").onclick = () => {
        dark = !dark;
        H.setTheme(dark ? "dark" : "light");
        $("btn-theme").textContent = dark ? "Light" : "Dark";
        document.body.classList.toggle("dark", dark);
    };
    $("btn-solo").onclick = () => {
        CFG.soloView = !CFG.soloView;
        $("btn-solo").classList.toggle("on", CFG.soloView);
        $("btn-solo").textContent = CFG.soloView ? "Grid view" : "Solo view";
    };
    $("btn-export").onclick = exportChampion;
    $("btn-restart").onclick = () => H.restart({});
    $("btn-reference").onclick = () => H.restart({ reference: true, showcase: false });

    // ---- intro -----------------------------------------------------------
    $("intro-watch").onclick = () => {
        if (!baked) return;
        hideIntro();
        H.restart({ showcase: true, brain: Brain.fromJSON(baked.brain), fitness: baked.fitness });
    };
    $("intro-scratch").onclick = () => { hideIntro(); H.restart({}); };
    $("intro-continue").onclick = () => {
        if (!baked) return;
        hideIntro();
        H.restart({ seedBrain: Brain.fromJSON(baked.brain) });
    };
    $("intro-explore").onclick = () => { hideIntro(); H.restart({}); };
}

function hideIntro() { $("intro").classList.add("hidden"); }

function bindSlider(id, labelId, fn) {
    const el = $(id), lb = $(labelId);
    const apply = () => { lb.textContent = fn(parseFloat(el.value)); };
    el.oninput = apply;
    apply();
}

/* --------------------------------------------------------------- live text */
async function embedLive(text) {
    const out = $("live-status");
    if (!text) { out.textContent = ""; return; }
    if (Embedding.mode !== "qwen") {
        out.innerHTML = `<span class="bad">Needs baked vectors — the surrogate has no basis to project onto.</span>`;
        return;
    }
    out.textContent = "embedding…";
    try {
        // half a megabyte of projection basis, fetched only now that it is needed
        if (!await Embedding.ensureBasis()) throw new Error("projection basis unavailable");
        const res = await fetch("http://localhost:11434/api/embed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: Embedding.meta.model, input: text })
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const j = await res.json();
        const vec = (j.embeddings && j.embeddings[0]) || j.embedding;
        const enc = Embedding.encodeLive(vec);
        if (!enc) throw new Error("wrong dimension from the model");
        // The referee still needs a machine-readable goal, and the point of the
        // exercise is that the ARM reads the sentence — so the rule is taken
        // from whichever pinned goal the user selected, while the vector the
        // brain sees comes from what they typed. Mismatches are the interesting
        // case: the arm does what the sentence says, and the scoreboard judges
        // it against what was selected.
        const ref = TASKS.find(t => t.id === CFG.pinnedTaskId) || TASKS_TRAIN[0];
        CFG.liveTask = { id: "live", kind: ref.kind, params: ref.params, text, specIdx: -1, split: "live" };
        CFG.liveEmbedding = enc;
        out.innerHTML = `<span class="good">embedded ✓</span> — scored against the pinned rule ` +
            `<b>${ref.kind.toLowerCase().replace(/_/g, " ")}</b>`;
    } catch (e) {
        out.innerHTML = `<span class="bad">no local Ollama (${e.message}).</span> ` +
            `Start it with <code>ollama serve</code> and make sure <code>${Embedding.meta.model}</code> is pulled.`;
    }
}

/* ------------------------------------------------------------- callbacks */
UI.setBaked = (b) => {
    baked = b;
    const ok = !!b;
    $("intro-watch").disabled = !ok;
    $("intro-continue").disabled = !ok;
    if (!ok) {
        $("intro-watch").querySelector("small").textContent =
            "No default_brain.js in this folder — train one with train.js first";
        $("intro-continue").querySelector("small").textContent = "Needs a trained brain";
    } else {
        $("intro-watch").querySelector("small").textContent =
            `Generation ${b.gen} champion · fitness ${Math.round(b.fitness)}`;
        if (b.corpusHash && b.corpusHash !== corpusHash()) {
            $("intro-note").innerHTML =
                `<span class="bad">The saved brain was evolved against a different task bank ` +
                `(${b.corpusHash} vs ${corpusHash()}). It will behave, but not as trained.</span>`;
        }
    }
};

UI.onRestart = (evo, showcase, reference) => {
    $("stat-mode").textContent = reference ? "scripted reference" : showcase ? "champion showcase" : "evolving";
    $("stat-mode").className = "tstat badge" + (reference ? " alt" : "");
    $("btn-export").disabled = showcase || reference;
    lastGenRec = null;
    $("gen-log").innerHTML = "";
};

UI.onEpisode = (task, stage, world) => {
    $("instruction").textContent = "“" + task.text + "”";
    $("instr-kind").textContent = task.kind.toLowerCase().replace(/_/g, " ");
    $("instr-split").textContent = task.split === "holdout" ? "★ never trained on"
        : task.split === "live" ? "typed live" : "training phrasing";
    $("instr-split").className = "pill " + (task.split === "train" ? "" : "good");
    const counts = [0, 0, 0, 0];
    world.stations[0].balls.forEach(b => counts[b.color]++);
    $("scene-balls").innerHTML = counts.map((n, c) =>
        n ? `<span class="chip" style="--c:#${COLOR_HEX[c].toString(16).padStart(6, "0")}">${n} ${COLORS[c]}</span>` : ""
    ).join("");
    $("stat-stage").textContent = `stage ${stage.id} · ${stage.name}`;
    $("stage-desc").textContent = stage.desc;
    [...$("stage-track").children].forEach((p, i) =>
        p.classList.toggle("on", STAGES[i].id === stage.id));
};

UI.onGeneration = (evo, rec, stage) => {
    lastGenRec = rec;
    $("stat-gen").textContent = evo.gen;
    $("stat-best").textContent = Math.round(rec.best);
    $("stat-balls").textContent = `${rec.bestDel.toFixed(1)} / ${rec.avgDel.toFixed(1)}`;
    $("stat-done").textContent = `${Math.round(rec.complete * 100)}%`;
    const line = document.createElement("div");
    line.className = "logline";
    line.innerHTML = `<b>gen ${evo.gen - 1}</b> best ${Math.round(rec.best)} · ` +
        `balls ${rec.bestDel.toFixed(1)} · done ${Math.round(rec.complete * 100)}%` +
        (evo.graceEvent ? ` <i>${evo.graceEvent}</i>` : "");
    const log = $("gen-log");
    log.insertBefore(line, log.firstChild);
    while (log.children.length > 60) log.removeChild(log.lastChild);
    drawHistory(evo.history);
};

let frameSkip = 0;
UI.onFrame = (world, simTime, leader) => {
    if (frameSkip++ % 4) return;
    const focus = Math.min(CFG.focus, world.stations.length - 1);
    const s = world.stations[focus];
    $("stat-time").textContent = simTime.toFixed(1) + "s";
    $("focus-idx").textContent = `bench ${focus + 1}${focus === leader ? " (leading)" : ""}`;
    $("focus-fit").textContent = Math.round(s.fitness);
    $("focus-clock").textContent = Math.max(0, s.clock).toFixed(1) + "s";
    $("focus-del").textContent = `${s.delivered} / ${s.evalr.target}`;

    // what the pointer heads are pointing at, right now
    const sb = s.sel.ball;
    const tb = (sb >= 0 && sb < s.balls.length) ? s.balls[sb] : null;
    const valid = tb && !tb.lost && tb.inBucket < 0;
    $("focus-pick").innerHTML = valid
        ? `<span class="chip" style="--c:#${COLOR_HEX[tb.color].toString(16).padStart(6, "0")}">${COLORS[tb.color]}</span>`
        : `<span class="muted">nothing (empty slot)</span>`;
    $("focus-pick-conf").textContent = (s.sel.conf * 100).toFixed(0) + "%";
    $("focus-bucket").innerHTML =
        `<span class="chip" style="--c:#${COLOR_HEX[s.selBucket.idx].toString(16).padStart(6, "0")}">${COLORS[s.selBucket.idx]}</span>`;

    // what the RULE says it should be doing — the honest comparison
    const o = s.oracle();
    $("focus-should").innerHTML = o.ball
        ? `<span class="chip" style="--c:#${COLOR_HEX[o.ball.color].toString(16).padStart(6, "0")}">${COLORS[o.ball.color]}</span>` +
        ` <span class="muted">→ ${COLORS[o.bucket] || "—"}</span>`
        : `<span class="muted">nothing — the rule is satisfied</span>`;
    const agrees = valid && o.ball && tb.id === o.ball.id;
    $("focus-agree").textContent = o.ball ? (agrees ? "obeying" : "off target") : "—";
    $("focus-agree").className = "pill " + (o.ball ? (agrees ? "good" : "warn") : "");

    const ev = $("focus-log");
    if (s.log.length !== +ev.dataset.n) {
        ev.dataset.n = s.log.length;
        ev.innerHTML = s.log.slice(-8).reverse()
            .map(e => `<div class="logline"><b>${e.t.toFixed(1)}s</b> ${e.s}</div>`).join("");
    }
};

/* --------------------------------------------------------------- history */
function drawHistory(hist) {
    const c = $("chart");
    const ctx = c.getContext("2d");
    const w = c.width = c.clientWidth * 2, h = c.height = c.clientHeight * 2;
    ctx.clearRect(0, 0, w, h);
    if (hist.length < 2) return;
    const N = Math.min(hist.length, 300);
    const data = hist.slice(-N);
    const maxD = Math.max(1, ...data.map(d => d.bestDel));
    const line = (key, color, max) => {
        ctx.beginPath();
        data.forEach((d, i) => {
            const x = (i / (N - 1)) * w;
            const y = h - (d[key] / max) * h * 0.92 - h * 0.04;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
    };
    line("bestDel", "#35b6ff", maxD);
    line("avgDel", "#4fe0a8", maxD);
    line("complete", "#ffc94d", 1);
    $("chart-max").textContent = maxD.toFixed(1);
}

/* ---------------------------------------------------------------- export */
function exportChampion() {
    const evo = H.getEvo();
    if (!evo || !evo.champion) return;
    const blob = new Blob([JSON.stringify({
        gen: evo.gen - 1, fitness: evo.championFit, championGen: evo.championGen,
        embDim: Embedding.dim,
        embModel: Embedding.meta ? Embedding.meta.model : "surrogate",
        corpusHash: corpusHash(),
        brain: evo.champion.toJSON()
    })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `arm_champion_gen${evo.gen - 1}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}
