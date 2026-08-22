/* ui.js — panel wiring for the playback page. Every knob lives in CFG;
 * main.js reads it each frame.
 *
 * Everything here is about the INSTRUCTION and the BENCH. The mutation rates,
 * population sizes and curriculum sliders that used to live in this file went
 * when training left the browser — see the note at the top of main.js.
 */
"use strict";

const CFG = {
    speed: 1,
    paused: false,
    showEyes: false,
    autoDeal: true,
    fill: 2.0,               // how crowded a fresh bench starts
    noise: 0.3,              // sensor and servo noise
    split: "train",          // which phrasing pool the sentence list offers
    pinnedTaskId: null,      // a specific sentence, pinned by the user
    liveTask: null,          // a sentence the user typed, embedded via local Ollama
    liveEmbedding: null
};

const UI = {};
function $(id) { return document.getElementById(id); }
let H = {};
let baked = null;

/* ------------------------------------------------------------------ setup */
function initUI(handlers) {
    H = handlers;

    // ---- embedding provenance -------------------------------------------
    const badge = $("emb-badge");
    if (Embedding.mode === "qwen") {
        badge.textContent = `${Embedding.meta.model} · ${Embedding.nativeDim}→${Embedding.dim}`;
        badge.className = "pill good";
        $("emb-detail").innerHTML =
            `Sentences were embedded offline by <b>${Embedding.meta.model}</b> and projected onto ` +
            `<b>${Embedding.dim}</b> dimensions — a basis fitted on the <i>training</i> phrasings only. ` +
            `Held-out 1-NN recovers the rule type ` +
            `<b>${(Embedding.meta.holdoutKind * 100).toFixed(0)}%</b> of the time and the named colours ` +
            `<b>${(Embedding.meta.holdoutColor * 100).toFixed(0)}%</b> (Jaccard). That last number is the ` +
            `ceiling on this page: the arm cannot obey a sentence it cannot tell apart from another one.`;
    } else {
        badge.textContent = "surrogate (not baked)";
        badge.className = "pill warn";
        $("emb-detail").innerHTML =
            `<b>No baked vectors found.</b> Running on a hashed bag-of-words stand-in so the sim still ` +
            `works. It separates different words but knows nothing about meaning, so held-out phrasings ` +
            `are hopeless by construction. Run <code>node embed_tasks.js</code> to bake the real ones.`;
    }
    if (Embedding.warning) $("emb-detail").innerHTML += `<br><span class="bad">${Embedding.warning}</span>`;

    // ---- instruction picker ----------------------------------------------
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
    kindSel.onchange = () => { refreshPhrases(); pickSentence(""); };
    $("sel-phrase").onchange = (e) => pickSentence(e.target.value);
    document.querySelectorAll("input[name=split]").forEach(r => {
        r.onchange = () => {
            CFG.split = r.value;
            refreshPhrases();
            $("split-note").textContent = CFG.split === "holdout"
                ? "★ These sentences were never used in training. This is the real test."
                : "The 392 phrasings the arm was trained on.";
            pickSentence("");
        };
    });
    refreshPhrases();

    // ---- live instruction box -------------------------------------------
    $("btn-live").onclick = () => embedLive($("live-text").value.trim());
    $("live-text").addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); embedLive(e.target.value.trim()); }
    });

    // ---- bench knobs ------------------------------------------------------
    bindSlider("sl-fill", "lb-fill", v => { CFG.fill = v / 10; return (v / 10).toFixed(1); });
    bindSlider("sl-noise", "lb-noise", v => { CFG.noise = v / 100; return (v / 100).toFixed(2); });
    $("btn-replay").onclick = () => H.deal(true);
    const loopBtn = $("btn-loop");
    loopBtn.onclick = () => {
        CFG.autoDeal = !CFG.autoDeal;
        loopBtn.classList.toggle("on", CFG.autoDeal);
        loopBtn.textContent = CFG.autoDeal ? "Auto-deal" : "Deal once";
    };

    // ---- who is driving ---------------------------------------------------
    $("btn-brain").onclick = () => H.setDriver(false);
    $("btn-reference").onclick = () => H.setDriver(true);

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
    $("btn-scene").onclick = () => H.deal(false);
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
    // Eye-in-hand stereo preview. Off by default: it is a second and third
    // render of the whole scene every frame, which is real cost on a phone.
    const eb = $("btn-eyes");
    if (eb) eb.onclick = () => {
        CFG.showEyes = !CFG.showEyes;
        eb.classList.toggle("on", CFG.showEyes);
        eb.textContent = CFG.showEyes ? "Hide eyes" : "Arm eyes";
    };

    // ---- intro -----------------------------------------------------------
    $("intro-watch").onclick = () => { hideIntro(); H.deal(false); };
    $("intro-explore").onclick = () => { hideIntro(); };
}

/* Choosing a sentence re-deals on the SAME seed, so switching wording compares
 * two instructions on one bench instead of on two different draws. */
function pickSentence(id) {
    CFG.pinnedTaskId = id || null;
    CFG.liveTask = null;
    CFG.liveEmbedding = null;
    H.deal(true);
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
        // the projection basis, fetched only now that it is needed
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
        /* The referee still needs a machine-readable goal, and the point of the
         * exercise is that the ARM reads the sentence — so the rule is taken
         * from whichever sentence is currently selected, while the vector the
         * arm sees comes from what was typed. Mismatches are the interesting
         * case: the arm does what it thinks it was told, and the scoreboard
         * judges it against the selected rule. */
        const ref = TASKS.find(t => t.id === CFG.pinnedTaskId) || TASKS.filter(t => t.split === "train")[0];
        CFG.liveTask = { id: "live", kind: ref.kind, params: ref.params, text, specIdx: -1, split: "live" };
        CFG.liveEmbedding = enc;
        out.innerHTML = `<span class="good">embedded ✓</span> — judged against the selected rule ` +
            `<b>${ref.kind.toLowerCase().replace(/_/g, " ")}</b>`;
        H.deal(true);
    } catch (e) {
        out.innerHTML = `<span class="bad">no local Ollama (${e.message}).</span> ` +
            `Start it with <code>ollama serve</code> and make sure <code>${Embedding.meta.model}</code> is pulled.`;
    }
}

/* ------------------------------------------------------------- callbacks */
UI.setBaked = (b) => {
    baked = b;
    const watch = $("intro-watch");
    if (!b) {
        watch.querySelector("small").textContent =
            "No default_brain.js in this folder — train one with distill.js first";
        $("intro-note").innerHTML =
            `<span class="bad">No baked brain. The page will run, but the arm is untrained and will ` +
            `not do anything sensible. Bake one with <code>node distill.js</code> then ` +
            `<code>node bake_brain.js</code>.</span>`;
        return;
    }
    watch.querySelector("small").textContent =
        b.heldOut
            ? `Completes ${(b.heldOut.tasks * 100).toFixed(0)}% of tasks worded in ways it never saw`
            : `The trained arm on a fresh bench`;
    if (b.corpusHash && b.corpusHash !== corpusHash()) {
        $("intro-note").innerHTML =
            `<span class="bad">The saved brain was trained against a different task bank ` +
            `(${b.corpusHash} vs ${corpusHash()}). It will behave, but not as trained.</span>`;
    }
};

UI.onEpisode = (task, world, seed, reference) => {
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
    $("stat-kind").textContent = task.kind.toLowerCase().replace(/_/g, " ");
    $("stat-seed").textContent = seed;
    $("stat-mode").textContent = reference ? "scripted reference" : "trained arm";
    $("stat-mode").className = "tstat badge" + (reference ? " alt" : "");
    /* The driver buttons are painted from the world that was actually built,
     * not from the click that asked for it. `?ref=1` sets the driver without
     * touching a button, and a control showing the opposite of what is on
     * screen is worse than no control at all. */
    $("btn-brain").classList.toggle("on", !reference);
    $("btn-reference").classList.toggle("on", !!reference);
    $("drive-note").textContent = reference
        ? "The hand-written IK controller. It reads the referee's answer directly and never sees the sentence — it is the ceiling on motion, not a solution to the language problem."
        : "The baked brain. It reads the sentence; the scripted controller does not, and is shown only so you can see what the arm is capable of when the language is taken out of the problem.";
    $("focus-log").innerHTML = "";
    $("focus-log").dataset.n = 0;
};

let frameSkip = 0;
UI.onFrame = (world, simTime) => {
    if (frameSkip++ % 4) return;
    const s = world.stations[0];
    const onBench = s.balls.filter(b => !b.lost && b.inBucket < 0 && !b.held).length;
    const lost = s.balls.filter(b => b.lost).length;

    $("stat-time").textContent = simTime.toFixed(1) + "s";
    $("stat-del").textContent = `${s.delivered} / ${s.evalr.target}`;
    $("stat-left").textContent = onBench;
    $("focus-clock").textContent = Math.max(0, s.clock).toFixed(1) + "s";
    $("focus-del").textContent = `${s.delivered} / ${s.evalr.target}`;
    $("focus-left").textContent = onBench;
    $("focus-lost").innerHTML = lost
        ? `<span class="bad">${lost}</span>`
        : `<span class="good">0</span>`;

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
        ev.innerHTML = s.log.slice(-9).reverse()
            .map(e => `<div class="logline"><b>${e.t.toFixed(1)}s</b> ${e.s}</div>`).join("");
    }
};
