/* =========================================================
 *  Bayesian Optimization Playground – bayesian-education.js
 *  Step-synced educational narration & concept cards
 * ========================================================= */

"use strict";

const BayesEdu = (() => {
  let container = null;
  let currentPhase = 0;
  let stepCount = 0;

  /* ---------- EDUCATIONAL PHASES ---------- */
  const phases = [
    {
      title: "🎯 Prior Belief",
      trigger: step => step === 0,
      html: `
        <p>Before any data, the <span class="highlight">Gaussian Process (GP)</span> assumes the
        function could be anything. The shaded band shows a wide <span class="highlight">95% confidence interval</span> — maximum uncertainty everywhere.</p>
        <p class="math">μ(x) = 0, σ²(x) = k(x,x)</p>
        <p>The GP prior is defined entirely by its <span class="highlight">kernel function</span>,
        which encodes our assumptions about the function's smoothness and correlation structure.</p>
      `
    },
    {
      title: "📍 Initial Samples",
      trigger: step => step === 0,
      html: `
        <p>We start with a few <span class="highlight">random samples</span> to give the GP
        some initial evidence. These points are shown as <span style="color:#fbbf24">●</span> amber dots.</p>
        <p>Notice how the GP confidence band <span class="highlight">narrows near sampled points</span> but
        stays wide in unexplored regions. This is key to Bayesian reasoning — we're honest about what we don't know.</p>
      `
    },
    {
      title: "🔍 Acquisition Function",
      trigger: step => step === 1,
      html: `
        <p>The <span class="highlight">acquisition function</span> (green area below the main chart)
        scores how promising each location is for the next sample.</p>
        <p>It balances two competing goals:</p>
        <ul style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li><strong style="color:var(--green)">Exploitation</strong> — sample where the GP predicts high values</li>
          <li><strong style="color:var(--purple)">Exploration</strong> — sample where uncertainty is high</li>
        </ul>
        <p>The <span style="color:#fb7185">◆</span> diamond marker shows where the acquisition function peaks — that's our next sample.</p>
      `
    },
    {
      title: "🔬 Expected Improvement",
      trigger: step => step === 2,
      html: `
        <p>When using <span class="highlight">Expected Improvement (EI)</span>, we compute the
        expected gain over the current best value:</p>
        <p class="math">EI(x) = (μ(x) − f* − ξ) · Φ(Z) + σ(x) · ϕ(Z)</p>
        <p>where <span class="math">Z = (μ(x) − f* − ξ) / σ(x)</span></p>
        <p>The parameter <span class="highlight">ξ</span> controls exploration — larger values
        encourage sampling uncertain regions even if the mean is lower.</p>
      `
    },
    {
      title: "🔄 Posterior Update",
      trigger: step => step === 3,
      html: `
        <p>Each new sample triggers a <span class="highlight">posterior update</span>.
        The GP adjusts its predictions by incorporating the new evidence.</p>
        <p>Watch how the cyan mean line bends toward new observations, and the confidence
        band tightens. This is <span class="highlight">Bayesian conditioning</span> in action —
        turning prior beliefs into informed posterior estimates.</p>
        <p class="math">μ*(x) = k(x,X)·(K + σ²I)⁻¹·y</p>
      `
    },
    {
      title: "📐 Kernel Choice Matters",
      trigger: step => step === 5,
      html: `
        <p>The <span class="highlight">kernel function</span> determines what kinds of
        functions the GP considers plausible:</p>
        <ul style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li><strong style="color:var(--cyan)">RBF</strong> — infinitely smooth (very aggressive extrapolation)</li>
          <li><strong style="color:var(--purple)">Matérn 3/2</strong> — once-differentiable (rougher, more realistic)</li>
          <li><strong style="color:var(--green)">Matérn 5/2</strong> — twice-differentiable (balanced choice)</li>
        </ul>
        <p>Try switching kernels and observe how the GP's predictions and confidence change!</p>
      `
    },
    {
      title: "📏 Length Scale",
      trigger: step => step === 7,
      html: `
        <p>The <span class="highlight">length scale</span> controls how far correlations
        reach between points:</p>
        <ul style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li><strong>Small ℓ</strong> — wiggly, fits local patterns closely</li>
          <li><strong>Large ℓ</strong> — smooth, captures global trends</li>
        </ul>
        <p>Drag the length scale slider to see the effect live. Too small → overfitting.
        Too large → underfitting. The right value captures the true function's variability.</p>
      `
    },
    {
      title: "⚖️ Exploration vs Exploitation",
      trigger: step => step === 10,
      html: `
        <p>This is the central dilemma in optimization:</p>
        <p><strong style="color:var(--green)">Exploit</strong> what you know —
        sample near the current best to refine it.<br>
        <strong style="color:var(--purple)">Explore</strong> the unknown —
        sample in uncertain regions to discover potentially better optima.</p>
        <p>The ξ/κ slider controls this balance. Watch how low values focus
        samples near the best point, while high values spread them out.</p>
        <p>Good optimization requires both: explore early, exploit later.</p>
      `
    },
    {
      title: "📈 Convergence",
      trigger: step => step === 15,
      html: `
        <p>The convergence plot (in the Details panel) tracks the <span class="highlight">best
        observed value</span> over time.</p>
        <p>A good optimizer shows rapid improvement early on, then gradually plateaus
        as it narrows in on the optimum. Compare this to random search — BO typically
        finds better solutions in <span class="highlight">far fewer evaluations</span>.</p>
        <p>This is the whole point: efficient optimization when each function evaluation is expensive.</p>
      `
    },
    {
      title: "🏆 Deep Understanding",
      trigger: step => step === 20,
      html: `
        <p>By now you've seen the full Bayesian optimization loop:</p>
        <ol style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li>Build a GP surrogate from available data</li>
          <li>Compute an acquisition function over the domain</li>
          <li>Sample where acquisition is maximized</li>
          <li>Update the GP with the new observation</li>
          <li>Repeat until budget exhausted</li>
        </ol>
        <p>Try different objectives and settings to deepen your intuition.
        Each function presents unique challenges — sharp peaks, many modes,
        or deceptive plateaus.</p>
        <p style="color:var(--cyan);font-weight:600;margin-top:12px;">
        🎓 You're now a Bayesian Optimization practitioner!</p>
      `
    }
  ];

  /* ---------- TIPS (shown contextually) ---------- */
  const tips = [
    { trigger: s => s === 4, text: "💡 Tip: Press Space to quickly step through iterations." },
    { trigger: s => s === 8, text: "💡 Tip: Toggle 'Truth' off to experience optimizing a truly unknown function!" },
    { trigger: s => s === 12, text: "💡 Tip: Try the Rastrigin function — its many local optima make optimization tricky." },
    { trigger: s => s === 18, text: "💡 Tip: Switch to UCB acquisition for a different exploration strategy." },
    { trigger: s => s === 25, text: "💡 Tip: Use Auto-Run to watch 50 iterations unfold automatically." },
  ];

  /* ---------- RENDER ---------- */
  function render() {
    if (!container) return;

    let html = "";

    // Render all unlocked phases
    for (let i = 0; i <= currentPhase && i < phases.length; i++) {
      const p = phases[i];
      const isActive = i === currentPhase;
      html += `
        <div class="edu-step ${isActive ? "active" : ""}">
          <div class="edu-step-num">${i + 1}</div>
          <h4>${p.title}</h4>
          ${p.html}
        </div>
      `;
    }

    // Check for tips
    for (const tip of tips) {
      if (tip.trigger(stepCount) && !tip._shown) {
        tip._shown = true;
        html += `
          <div class="edu-step" style="border-color:var(--amber);background:rgba(251,191,36,0.05);">
            <p style="color:var(--amber);font-size:0.82rem;">${tip.text}</p>
          </div>
        `;
      }
    }

    // Progress indicator
    if (currentPhase < phases.length - 1) {
      const nextPhase = phases[currentPhase + 1];
      const nextTrigger = nextPhase.trigger.toString().match(/step\s*===?\s*(\d+)/);
      const nextStep = nextTrigger ? parseInt(nextTrigger[1]) : "?";
      html += `
        <div style="text-align:center;padding:var(--sp-md);color:var(--text-muted);font-size:0.75rem;">
          Next insight at step ${nextStep} · Keep iterating!
        </div>
      `;
    } else if (currentPhase >= phases.length - 1) {
      html += `
        <div style="text-align:center;padding:var(--sp-md);color:var(--cyan);font-size:0.8rem;font-weight:500;">
          ✨ All concepts unlocked! Keep experimenting.
        </div>
      `;
    }

    container.innerHTML = html;

    // Scroll to latest active step
    const activeEl = container.querySelector(".edu-step.active");
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  /* ---------- PUBLIC API ---------- */
  function init(state, containerEl) {
    container = containerEl;
    stepCount = state.iteration;
    currentPhase = 0;
    // Unlock initial phases (step 0)
    advancePhases(0);
    render();
  }

  function advancePhases(step) {
    for (let i = currentPhase; i < phases.length; i++) {
      if (phases[i].trigger(step)) {
        currentPhase = i;
      } else {
        break;
      }
    }
    // Also check non-sequential unlocks
    for (let i = 0; i < phases.length; i++) {
      if (phases[i].trigger(step) && i > currentPhase) {
        currentPhase = i;
      }
    }
  }

  function onStep(state) {
    stepCount = state.iteration;
    advancePhases(stepCount);
    render();
  }

  function reset(state) {
    stepCount = 0;
    currentPhase = 0;
    tips.forEach(t => t._shown = false);
    advancePhases(0);
    render();
  }

  return { init, onStep, reset };
})();
