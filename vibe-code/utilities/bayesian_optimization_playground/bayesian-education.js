/* =========================================================
 *  Bayesian Optimization Playground – bayesian-education.js
 *  Step-synced educational narration & concept cards
 *  v2 – More phases, comparison insights, custom fn tips
 * ========================================================= */

"use strict";

const BayesEdu = (() => {
  let container = null;
  let currentPhase = 0;
  let stepCount = 0;

  /* ---------- EDUCATIONAL PHASES ---------- */
  const phases = [
    {
      title: "Prior Belief",
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
      title: "Initial Samples",
      trigger: step => step === 0,
      html: `
        <p>We start with a few <span class="highlight">random samples</span> to give the GP
        some initial evidence. These points are shown as <span style="color:#fbbf24">●</span> amber dots.</p>
        <p>Notice how the GP confidence band <span class="highlight">narrows near sampled points</span> but
        stays wide in unexplored regions. This is key to Bayesian reasoning — we're honest about what we don't know.</p>
      `
    },
    {
      title: "Acquisition Function",
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
      title: "Expected Improvement",
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
      title: "Posterior Update",
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
      title: "Kernel Choice Matters",
      trigger: step => step === 5,
      html: `
        <p>The <span class="highlight">kernel function</span> determines what kinds of
        functions the GP considers plausible:</p>
        <ul style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li><strong style="color:var(--cyan)">RBF</strong> — infinitely smooth (very aggressive extrapolation)</li>
          <li><strong style="color:var(--purple)">Matern 3/2</strong> — once-differentiable (rougher, more realistic)</li>
          <li><strong style="color:var(--green)">Matern 5/2</strong> — twice-differentiable (balanced choice)</li>
          <li><strong style="color:var(--amber)">Periodic</strong> — captures repeating patterns</li>
        </ul>
        <p>Try switching kernels and observe how the GP's predictions and confidence change!</p>
      `
    },
    {
      title: "Length Scale",
      trigger: step => step === 7,
      html: `
        <p>The <span class="highlight">length scale</span> controls how far correlations
        reach between points:</p>
        <ul style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li><strong>Small l</strong> — wiggly, fits local patterns closely</li>
          <li><strong>Large l</strong> — smooth, captures global trends</li>
        </ul>
        <p>Drag the length scale slider to see the effect live. Too small = overfitting.
        Too large = underfitting. The right value captures the true function's variability.</p>
        <p class="math">k(x,x') = exp(-|x-x'|² / 2l²)</p>
      `
    },
    {
      title: "Regret & Efficiency",
      trigger: step => step === 8,
      html: `
        <p>The <span class="highlight">simple regret</span> measures the gap between the
        true optimum and our best observed value:</p>
        <p class="math">r(t) = f* − max{y₁, ..., yₜ}</p>
        <p>Watch this value in the stats bar — it should shrink toward zero as BO finds better points.
        Turn on <span class="highlight">Compare mode</span> (press C) to see how BO beats random search!</p>
      `
    },
    {
      title: "Exploration vs Exploitation",
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
      title: "Thompson Sampling",
      trigger: step => step === 12,
      html: `
        <p><span class="highlight">Thompson Sampling</span> offers a different approach — instead of
        computing a deterministic acquisition function, it <em>draws a random function</em> from
        the GP posterior and optimizes that.</p>
        <p>This naturally balances exploration and exploitation through randomness:
        uncertain regions have wider posteriors, so random draws sometimes suggest exploring there.</p>
        <p>Try switching to Thompson Sampling in the acquisition dropdown and watch how the
        next-sample diamond jumps around more randomly!</p>
      `
    },
    {
      title: "Log Marginal Likelihood",
      trigger: step => step === 14,
      html: `
        <p>The <span class="highlight">log marginal likelihood</span> (Log ML in the stats bar)
        tells you how well the GP model explains the data:</p>
        <p class="math">log p(y|X,θ) = -½y'K⁻¹y - ½log|K| - n/2·log(2π)</p>
        <p>It balances <strong>data fit</strong> (how well predictions match observations) against
        <strong>model complexity</strong> (how flexible the kernel is). Higher is better.</p>
        <p>Try different kernels and length scales — watch how Log ML responds!</p>
      `
    },
    {
      title: "Convergence",
      trigger: step => step === 15,
      html: `
        <p>The convergence plot (in the Details panel) tracks the <span class="highlight">best
        observed value</span> over time.</p>
        <p>A good optimizer shows rapid improvement early on, then gradually plateaus
        as it narrows in on the optimum. Compare this to random search — BO typically
        finds better solutions in <span class="highlight">far fewer evaluations</span>.</p>
        <p>The dashed line shows the true optimum. How close did you get?</p>
      `
    },
    {
      title: "Custom Functions",
      trigger: step => step === 18,
      html: `
        <p>Ready to experiment? Select <span class="highlight">"Custom f(x)"</span> from
        the objective dropdown to define your own function!</p>
        <p>Use standard math notation:</p>
        <ul style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li><span class="math">sin(3*PI*x) + cos(7*x)</span></li>
          <li><span class="math">exp(-10*(x-0.3)^2) + 0.5</span></li>
          <li><span class="math">x * sin(1/(x+0.01))</span></li>
        </ul>
        <p>Shorthand like sin, cos, exp, PI, and ^ all work. Press <span class="highlight">E</span> to focus the input.</p>
      `
    },
    {
      title: "Deep Understanding",
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
        <p>Try different objectives, kernels, and settings to deepen your intuition.
        Each function presents unique challenges — sharp peaks, many modes,
        or deceptive plateaus.</p>
        <p style="color:var(--cyan);font-weight:600;margin-top:12px;">
        You're now a Bayesian Optimization practitioner!</p>
      `
    },
    {
      title: "Advanced: Noise Effects",
      trigger: step => step === 25,
      html: `
        <p>Observation <span class="highlight">noise</span> (σ slider) models real-world
        measurement uncertainty. With higher noise:</p>
        <ul style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li>The GP relies less on individual observations</li>
          <li>The mean function becomes smoother</li>
          <li>More samples are needed to resolve the optimum</li>
          <li>The confidence interval stays wider longer</li>
        </ul>
        <p>Crank noise to 0.2+ and watch the GP struggle to pin down the function — then
        increase the number of samples and see it recover!</p>
      `
    },
    {
      title: "Mastery: Diagnostics",
      trigger: step => step === 30,
      html: `
        <p>Expert practitioners monitor several diagnostics:</p>
        <ul style="padding-left:1.2em;margin:8px 0;color:var(--text-dim);font-size:0.8rem;">
          <li><strong style="color:var(--rose)">Regret → 0</strong>: approaching the true optimum</li>
          <li><strong style="color:var(--purple)">Log ML</strong>: model quality — if it drops after kernel change, revert!</li>
          <li><strong style="color:var(--green)">Acq. Max → 0</strong>: no region is expected to improve much — convergence</li>
          <li><strong style="color:var(--cyan)">CI band width</strong>: overall uncertainty reduction</li>
        </ul>
        <p>You've unlocked all educational content. Keep experimenting!</p>
      `
    }
  ];

  /* ---------- TIPS (shown contextually) ---------- */
  const tips = [
    { trigger: s => s === 4, text: "Tip: Press Space to quickly step through iterations." },
    { trigger: s => s === 6, text: "Tip: Toggle 'Truth' off to experience optimizing a truly unknown function!" },
    { trigger: s => s === 9, text: "Tip: Press C to compare Bayesian optimization against random search." },
    { trigger: s => s === 11, text: "Tip: Try the Rastrigin function — its many local optima make optimization tricky." },
    { trigger: s => s === 16, text: "Tip: Press U to undo steps and try different exploration parameters." },
    { trigger: s => s === 19, text: "Tip: Switch to Thompson Sampling for a stochastic acquisition strategy." },
    { trigger: s => s === 22, text: "Tip: Export your results as CSV or PNG using the buttons in the toolbar." },
    { trigger: s => s === 28, text: "Tip: Try the Periodic kernel on the Sine Mixture function!" },
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
      const progress = ((currentPhase + 1) / phases.length * 100).toFixed(0);
      html += `
        <div style="text-align:center;padding:var(--sp-md);color:var(--text-muted);font-size:0.75rem;">
          <div style="background:rgba(255,255,255,0.06);height:4px;border-radius:2px;margin-bottom:8px;overflow:hidden;">
            <div style="width:${progress}%;height:100%;background:var(--cyan);border-radius:2px;transition:width 0.5s ease;"></div>
          </div>
          ${progress}% complete · Next insight at step ${nextStep}
        </div>
      `;
    } else if (currentPhase >= phases.length - 1) {
      html += `
        <div style="text-align:center;padding:var(--sp-md);color:var(--cyan);font-size:0.8rem;font-weight:500;">
          All concepts unlocked! Keep experimenting.
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
