/* browser_train.js — run the whole recipe from a URL, with no Node toolchain.
 *
 *   index.html?train&gens=3000&pop=64&episodes=4&sync
 *
 * Everything the headless trainer does — the task curriculum, the difficulty
 * ratchet, the held-out exam that decides the champion — is the same code the
 * page already runs; this file only drives it and then bakes the winner out.
 *
 * WHAT IT CANNOT DO. There is no imitation stage here. `imitate.js` needs
 * gradients across a worker pool and it is what gives the Node pipeline its
 * head start, so a browser run starts from random weights and has to discover
 * from scratch what the Node run was handed. Expect thousands of generations
 * rather than hundreds, and expect it to plateau below the shipped brain. Start
 * from the shipped brain instead with `&resume=default` if what you want is to
 * push it further rather than to watch it start from nothing.
 *
 * ONE LOOP, NOT TWO. The generation loop below calls `stepOnce()` and
 * `endEpisode()` — the exact functions the animation loop calls. It would be
 * easier to write a self-contained trainer here and it would be wrong: a second
 * implementation of the training loop is a second thing to keep correct, and
 * the one bug this project has hit twice is a "fast path" that quietly did
 * something different from the real one.
 */
"use strict";

(function () {
    const Q = new URLSearchParams(location.search);
    if (!Q.has("train")) return;

    const num = (k, d) => { const v = parseFloat(Q.get(k)); return Number.isFinite(v) ? v : d; };
    const T = {
        gens: num("gens", 500),
        pop: num("pop", 48),
        episodes: num("episodes", 4),
        mutRate: num("mutrate", 10) / 100,
        mutSigma: num("mutsigma", 35) / 100,
        grace: num("grace", 3),
        stageLock: Q.has("stage") ? num("stage", -1) : -1,
        maxLevel: num("maxlevel", N_LEVELS - 1),
        seed: num("seed", 0) | 0,
        // How often the held-out exam runs, and over how many fixed seeds per
        // task. Every check is real work — one brain over every unlocked task —
        // so it is deliberately not every generation.
        examEvery: num("examevery", 10),
        examSeeds: num("examseeds", 3),
        promoteFit: num("promote", 0.85),
        anchorFit: num("anchor", 0.85),
        promoteHold: num("promotehold", 3),
        sync: Q.has("sync"),
        resume: Q.get("resume")
    };

    /* ------------------------------------------------------------- the exam */
    /* Fixed seeds the population never trains on, spread ACROSS the unlocked
     * difficulty rungs rather than run on the top one only, and scored with the
     * same fixed scale of 40 the Node trainer uses so the numbers printed here
     * mean the same thing as the numbers in a run log.
     *
     * The seeds being fixed is what makes this a paired comparison: two brains
     * differing by one mutation are ranked on their difference rather than on
     * which machine each happened to draw. */
    function examBrain(net, stage, seeds, maxLevel) {
        const list = stageOpts(stage).tasks;
        const L = Math.max(0, maxLevel | 0);
        const rows = [];
        let i = 0;
        for (const tid of list) {
            for (let k = 0; k < seeds; k++) {
                const level = i++ % (L + 1);
                const r = runEpisode(mac, net, tid, {
                    missionSeed: 770001 + k * 9173, noise: true, randomise: true, level
                });
                rows.push({ level, fit: normalizeFitness(r.fitness, 40), survival: r.survival, err: r.boundaryErr });
            }
        }
        const mean = (rs, f) => rs.length ? rs.reduce((a, b) => a + f(b), 0) / rs.length : 0;
        const byLevel = {};
        for (const r of rows) (byLevel[r.level] || (byLevel[r.level] = [])).push(r);
        return {
            fit: mean(rows, r => r.fit), survival: mean(rows, r => r.survival), err: mean(rows, r => r.err),
            level: Object.fromEntries(Object.entries(byLevel).map(([k, rs]) => [k, mean(rs, r => r.fit)]))
        };
    }

    /* --------------------------------------------------------------- state */
    const S = { best: null, bestFit: -1e18, bestGen: 0, bestEx: null, promoteRun: 0, checks: 0, t0: 0 };

    function setup() {
        CFG.popSize = T.pop;
        CFG.episodes = T.episodes;
        CFG.mutRate = T.mutRate;
        CFG.mutSigma = T.mutSigma;
        CFG.gracePeriod = T.grace;
        CFG.stageLock = T.stageLock;
        CFG.taskLock = -1;
        CFG.level = 0;                 // the ratchet raises this; see episodePlan
        CFG.headless = true;           // visuals off — every millisecond to the search
        CFG.comparePid = false;        // the baseline costs an extra plasma per episode
        CFG.exhibition = false;
        // The animation loop must not also advance the world: this file drives
        // it. Without this both loops step the same plasmas and a "generation"
        // is whatever the two happened to interleave.
        CFG.paused = true;
        // The intro modal is a mode switcher and this URL has already chosen a
        // mode. Leaving it up would cover a run that is already going.
        const intro = document.getElementById("intro");
        if (intro) intro.classList.add("hidden");
        rebuild(true);

        if (T.resume === "default" && window.DEFAULT_BRAIN) {
            const src = window.DEFAULT_BRAIN.net || window.DEFAULT_BRAIN;
            if (JSON.stringify(src.sizes) === JSON.stringify(NET_SIZES)) {
                // Seed the whole population from the champion and let mutation
                // spread it back out, exactly as train.js --resume does. The
                // first few generations score below the checkpoint because the
                // diversity of the original run is gone; that is expected.
                const champ = Net.fromJSON(src);
                for (let i = 0; i < evolution.brains.length; i++) {
                    evolution.brains[i] = i === 0 ? champ.clone()
                        : champ.clone().mutate(CFG.mutRate, CFG.mutSigma, evolution.rng);
                }
                evolution.champion = champ.clone();
                log(`resumed from the built-in champion — mutation σ ${CFG.mutSigma.toFixed(2)}`);
            } else {
                log(`resume ignored: built-in brain is ${src.sizes.join("×")}, this run is ${NET_SIZES.join("×")}`);
            }
        }
        S.t0 = performance.now();
        log(`headless browser training — pop ${T.pop}, ${T.episodes} episodes/gen, ` +
            `${T.gens} generations, exam every ${T.examEvery} on ${T.examSeeds} held-out seeds/task`);
    }

    function log(s) { if (typeof uiLog === "function") uiLog(`<span class="evt">${s}</span>`); }

    /* One generation, driven through the page's own loop. */
    function oneGeneration() {
        const g = evolution.gen;
        let guard = 0;
        // 20 M control steps is ~40× the longest generation this can legally
        // run; it exists so a physics bug cannot turn the run into a hang.
        while (evolution.gen === g && guard++ < 20000000) {
            stepOnce();
            if (world.isOver()) endEpisode();
        }
    }

    function maybeExam() {
        const stage = stageFor(evolution.gen, evolution.history, { stageLock: CFG.stageLock });
        /* Examine the top THREE brains of the generation, not just the one that
         * won the training episodes. Under a wide mutation the training winner
         * is usually a lucky draw rather than a real improvement, so examining
         * only it means the title stops moving — measured in the Node runs as a
         * champion frozen for fifty generations while training best climbed. */
        const ranked = evolution.brains.slice(0, 3);
        let bestHere = null;
        for (const b of ranked) {
            const ex = examBrain(b, stage, T.examSeeds, CFG.level);
            if (!bestHere || ex.fit > bestHere.ex.fit) bestHere = { net: b, ex };
        }
        S.checks++;
        if (bestHere && bestHere.ex.fit > S.bestFit) {
            S.bestFit = bestHere.ex.fit;
            S.best = bestHere.net.clone();
            S.bestGen = evolution.gen - 1;
            S.bestEx = bestHere.ex;
            evolution.champion = S.best.clone();
        }

        /* THE RATCHET. Promote only when the champion is strong on the hardest
         * unlocked rung AND has not gone backwards on rung 0, held for several
         * consecutive checks. Both halves matter: without the rung-0 anchor the
         * population buys skill on the savage machine by forgetting the nominal
         * one, and a single good check is noise. */
        const ex = bestHere ? bestHere.ex : null;
        const top = ex ? ex.level[CFG.level] : null;
        const anchor = ex ? ex.level[0] : null;
        /* The ladder may only climb once the TASK curriculum has finished
         * unlocking. Two reasons, one of principle and one of arithmetic:
         * raising the difficulty of "hold a circular plasma" before the harder
         * tasks even exist is the wrong axis to spend progress on, and the exam
         * at stage 0 is a single task, so with only a few seeds it has no
         * episode on the upper rungs at all and `top` would be undefined
         * forever. Gating on the stage says that out loud instead of stalling
         * silently. */
        const atFinalStage = stage === STAGES.length - 1;
        const ready = CFG.level < T.maxLevel && atFinalStage && top != null && anchor != null &&
            top >= T.promoteFit && anchor >= T.anchorFit;
        S.promoteRun = ready ? S.promoteRun + 1 : 0;
        if (S.promoteRun >= T.promoteHold) {
            CFG.level++;
            S.promoteRun = 0;
            // Scores are not comparable across machines, so the running best
            // has to be re-earned on the new mix rather than defended with a
            // number from an easier one.
            S.bestFit = -1e18;
            const d = DIFFICULTY[CFG.level];
            log(`── difficulty ${CFG.level - 1} → ${CFG.level} (${d.label}): κ×${(1 + d.kappaGain).toFixed(2)} ` +
                `above round, wall ×${d.wall.toFixed(2)}, noise ×${d.noise.toFixed(1)}`);
            const dg = document.getElementById("diff-group");
            if (dg) [...dg.children].forEach((c, i) => c.classList.toggle("on", i === CFG.level));
        }
        return bestHere ? bestHere.ex : null;
    }

    function progress(ex) {
        const secs = (performance.now() - S.t0) / 1000;
        const rate = secs > 0 ? (evolution.gen - 1) / secs : 0;
        const h = evolution.history;
        const tr = h.length ? h[h.length - 1] : null;
        const line = `gen ${evolution.gen - 1}/${T.gens}  L${CFG.level}/${T.maxLevel} ` +
            `${DIFFICULTY[CFG.level].label}  train best ${tr ? tr.best.toFixed(3) : "—"}  ` +
            `| EXAM ${ex ? ex.fit.toFixed(3) : "—"} err ${ex ? (ex.err * 100).toFixed(2) + "cm" : "—"}  ` +
            `| best ${S.bestFit > -1e17 ? S.bestFit.toFixed(3) : "—"} @gen ${S.bestGen}  ` +
            `[${secs.toFixed(0)}s, ${rate.toFixed(2)} gen/s]`;
        log(line);
        document.title = `TRAIN gen=${evolution.gen - 1}/${T.gens} L=${CFG.level} ` +
            `exam=${S.bestFit > -1e17 ? S.bestFit.toFixed(3) : "-"}`;
    }

    /* -------------------------------------------------------------- output */
    /* Byte-identical in shape to what `train.js --bake` writes, so the file can
     * be dropped straight over default_brain.js. */
    function bakeText(net, gen, examFit) {
        return "/* default_brain.js — generated by browser_train.js. Drop-in champion.\n" +
            ` * mode ${OBS_MODE_CURRENT()} · generation ${gen} · exam score ` +
            `${examFit != null ? examFit.toFixed(3) : "?"} */\n` +
            "window.DEFAULT_BRAIN = " + JSON.stringify({
                format: "tokamak-brain-v1", mode: OBS_MODE_CURRENT(),
                gen, exam: examFit, sizes: net.sizes, net: net.toJSON()
            }) + ";\n";
    }

    function finish() {
        // Nothing beat the opening exam only if no exam ever ran; fall back to
        // the population's best so a very short run still produces a file.
        const net = S.best || evolution.champion || evolution.brains[0];
        const text = bakeText(net, S.bestGen || evolution.gen - 1, S.bestFit > -1e17 ? S.bestFit : null);
        let pre = document.getElementById("bake-out");
        if (!pre) {
            pre = document.createElement("pre");
            pre.id = "bake-out";
            pre.style.display = "none";
            document.body.appendChild(pre);
        }
        pre.textContent = text;
        window.BAKE_OUT = text;
        // A download link, for the ordinary browser case where there is no
        // --dump-dom to scrape the <pre> out of.
        const blob = new Blob([text], { type: "text/javascript" });
        const a = document.getElementById("bake-link") || document.createElement("a");
        a.id = "bake-link";
        a.href = URL.createObjectURL(blob);
        a.download = "default_brain.js";
        a.textContent = "download default_brain.js";
        a.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:99;background:#ff9f5a;" +
            "color:#0b1220;padding:8px 14px;border-radius:8px;font:600 13px sans-serif;text-decoration:none";
        if (!a.parentNode) document.body.appendChild(a);

        const secs = ((performance.now() - S.t0) / 1000).toFixed(0);
        log(`DONE — ${T.gens} generations in ${secs}s. Champion from generation ${S.bestGen}, ` +
            `exam ${S.bestFit > -1e17 ? S.bestFit.toFixed(3) : "?"}, ${S.checks} exams run. ` +
            `Bake file ready (button, bottom left).`);
        document.title = `DONE gen=${S.bestGen} exam=${S.bestFit > -1e17 ? S.bestFit.toFixed(3) : "-"} bake=ready`;
        CFG.headless = false;
    }

    /* ---------------------------------------------------------- the driver */
    function runSync() {
        for (let i = 0; i < T.gens; i++) {
            oneGeneration();
            const due = (evolution.gen - 1) % T.examEvery === 0;
            const ex = due ? maybeExam() : null;
            if (due) progress(ex);
        }
        if (!S.best) { maybeExam(); }
        finish();
    }

    /* Chunked, for a real browser: a slice of generations per timer tick so the
     * tab stays responsive and the log updates as it goes. `sync` exists because
     * headless Chrome's --dump-dom fires as soon as loading finishes and its
     * virtual clock does not advance inside a script task, so a chunked run
     * would be dumped before it had done anything. */
    function runChunked() {
        let done = 0;
        const slice = () => {
            const t0 = performance.now();
            while (done < T.gens && performance.now() - t0 < 250) {
                oneGeneration();
                done++;
                if ((evolution.gen - 1) % T.examEvery === 0) progress(maybeExam());
            }
            if (done < T.gens) setTimeout(slice, 0);
            else { if (!S.best) maybeExam(); finish(); }
        };
        setTimeout(slice, 0);
    }

    setup();
    if (T.sync) runSync(); else runChunked();
})();
