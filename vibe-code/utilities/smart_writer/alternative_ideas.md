# Research Brief: Building "Smart Writer" — a No-Build, Local-First Message-Drafting App for Overthinkers

## TL;DR
- **Build a zero-dependency vanilla-JS static app whose real product is *psychological*: it converts an overthinker's rumination into a bounded, satisficing workflow** — a notebook of paragraph "blocks," each holding a *small, capped* set of variations (cap at 3–4, never unlimited), a lock that acts as a commitment device, and a strict two-way side-by-side compare. The stack constraint (vanilla JS/HTML/CSS, no build, GitHub Pages) is fully achievable and is actually an asset for the privacy niche.
- **Ship AI as a tiered, optional add-on, defaulting to OFF.** Tier 0 (zero-AI) and Tier 1 (tiny in-browser rule-based NLP: compromise.js + retext + a hedging/apology counter) are the durable core. Tier 2 (WebLLM/Transformers.js, WebGPU) and Tier 3 (bring-your-own-key) are opt-in and lazy-loaded. OpenAI/OpenRouter/Google allow direct browser calls; Anthropic requires the `anthropic-dangerous-direct-browser-access: true` header.
- **The biggest risk is the coding agent inventing a build step, adding npm deps, or breaking paths on the `/repo-name/` GitHub Pages subpath.** The prompt must hard-forbid those and specify relative paths only, `.nojekyll`, ES modules from CDN, a plan-first workflow, and a semantic-token theming system built on `light-dark()`.

## Key Findings

### A. Psychology of the target user (overthinkers / introverts / anxious writers)

**Choice overload is real and directly governs the variation feature.** The canonical result is Iyengar & Lepper's field experiment at Draeger's Market in Menlo Park, CA, published as *"When Choice Is Demotivating: Can One Desire Too Much of a Good Thing?"* (Journal of Personality and Social Psychology, 2000): only **3% (4 customers) at the 24-jam display used a $1 coupon to buy, versus 30% (34 customers) at the 6-jam display** — a ~10x collapse in follow-through from *more* options. Schwartz's *Paradox of Choice* distinguishes **maximizers** (must find the best option; examine everything; more regret) from **satisficers** (accept "good enough"; stop when a threshold is met). Schwartz's summary: "Maximizers make good decisions and end up feeling bad about them. Satisficers make good decisions and end up feeling good." Critically, Schwartz's own maximizer diagnostic includes the item: *"I find that writing is very difficult... because it's so hard to word things just right. I often do several drafts of even simple things."* — the target user **IS** the maximizer, so this tool must actively convert them toward satisficing, not feed maximizing. Dar-Nimrod et al. (2009) found maximizers are less willing to commit to their choices — the mechanism the "lock" feature is designed to counteract.

**Design implication: cap variations low.** Evidence points to a small sweet spot; going past ~6 begins to hurt, and each option here is expensive to evaluate (you must read a whole paragraph). The practical cap should be **3–4 variations per block**, with the UI gently discouraging more.

**Communication apprehension (CA)** is McCroskey's construct, defined in McCroskey (1977, *Human Communication Research*, p. 78) as *"an individual's level of fear or anxiety associated with either real or anticipated communication with another person or persons."* It has trait and state forms and a written form (WCA), and correlates with introversion, low self-esteem, and shyness. Computer-mediated communication reduces apprehension because the absence of face-to-face cues and the asynchrony "may also diminish concerns about negative evaluation from others" — precisely why an anxious person prefers drafting a text to making a call, and why a careful drafting tool fits this group.

**Rereading/editing compulsively makes anxiety worse, not better — the single most important design constraint.** The OCD/anxiety literature on **excessive reassurance seeking (ERS)** and **compulsive checking** shows these behaviors provide only temporary relief and are negatively reinforced, "preventing the reassurance seeker from learning that they can tolerate anxiety and uncertainty." Rachman's (2002) cognitive model: reassurance "doesn't resolve obsessions — it fuels them. The more you check or ask, the more uncertain you feel over time." Relationship-anxiety research explicitly names **"rereading messages"** as a checking compulsion, and even *rumination* is described as "auto-reassurance-seeking." The evidence-based counter is the DEAF pattern (Distinguish doubt from danger, Embrace uncertainty, Avoid reassurance, Float and let time pass).

**Several intuitively "helpful" features are therefore active anti-features for this group:**
- **Infinite undo history / unlimited versions** → feeds endless second-guessing and checking.
- **A "confidence score" or live "tone meter"** → becomes a new object to obsess over (scrupulosity). Grammarly's tone detector has documented downsides: it "can only mention the existence of a problem; however, it cannot detect where the error lies," and a UW-Madison writing-center critique notes correction software "sparked great anxiety and linguistic insecurity." A live sentiment/tone gauge is a reassurance-seeking slot machine.
- **Ambiguous feedback** → for high-anxiety users, ambiguous reassurance ("It'll probably be fine!") can *increase* anxiety.

**Anti-rumination patterns that DO help (build these):** time-boxing (Pomodoro-style constraints), "good enough" thresholds, pre-commitment to a version (the lock), forced decisions, and length ceilings ("the shortest version is usually right"). Concrete, non-patronizing feature ideas grounded in the literature: a **cooling-off timer** that hides the draft for N minutes (interrupts the checking loop); a **decision log / "you already decided this" record** (counters re-litigating settled blocks); **blind A/B self-comparison** that hides which variant is which to defeat anchoring; a **"read as the recipient" mode**; and objective, non-judgmental counters (e.g., "you apologized 4 times," "3 hedges") rather than a subjective score.

### B. UX patterns for block editors, variations, and locking

**Notebook/block editors (Jupyter, Notion, Obsidian, Craft, Coda):** the established interaction vocabulary is a focused block with a left **drag handle**, a **`/` slash-command** menu to insert/transform blocks, block-level toolbars on hover/selection, keyboard-first navigation (arrow/enter/backspace to merge), and drag-to-reorder. Reuse these conventions to avoid teaching new muscle memory.

**Prior art for variation management:** **Scrivener Snapshots** is the strongest reference — a camera icon takes a titled snapshot of a section; you can list snapshots, roll back, and **Compare**. It is explicitly section-scoped ("when you take a snapshot, you are only grabbing what has been written in the section you are actively working on"), which maps cleanly onto per-block variations. **Wordtune's** Rewrite shows a *list of alternative phrasings to pick from* per sentence; a featured testimonial captures the exact mental model: "It's like having 10 friends all willing to suggest alternatives to a sentence I'm writing, and I can pick the best one." The gap that defines this app's niche: **no mainstream or open-source tool persists multiple competing versions of the same paragraph side-by-side and lets you toggle between them.**

**Lock metaphor:** the lock is a *psychological commitment device*, not a technical ACL. Good visual references: Figma/Photoshop layer locks (padlock icon, dimmed/desaturated, non-interactive), spreadsheet frozen cells, and Git "staged/committed." The visual language should say "this is settled, stop fiddling": a **filled padlock**, subtle **desaturation/reduced opacity of the block's *controls*** (not the text — text stays readable), a calm accent border, and removal of the variation-cycling affordances while locked. Unlocking should be a **deliberate, slightly effortful** action (not a one-click toggle you fat-finger) — the friction is the point.

**Prose diff / side-by-side:** for a message-writing tool, **word-level diff on a split (two-column) view with synchronized scrolling** is the right default, highlighting only meaningful changes. No-build JS options:
- **jsdiff (`diff`, kpdecker/jsdiff)** — BSD-licensed, the de facto standard; `diffWords`, `diffSentences`, `diffLines`; as of v9 targets Baseline "widely available" browsers; loadable as ESM via `https://esm.sh/diff` or cdnjs. **Recommended** (word/sentence granularity reads best for prose).
- **fast-diff (jhchen/fast-diff)** — tiny stripped diff-match-patch (Myers algorithm), returns tuples like `[[-1,"Goo"],[1,"Ba"],[0,"d dog"]]`; character-level; use if size is paramount.
- **diff-match-patch** — Google's original (Apache-2.0), powerful but heavier.

**Keyboard-first conventions to reuse:** command palette (`Cmd/Ctrl-K`), focus mode, and standard block navigation. Invent as little as possible; document any variation-cycling/lock shortcuts you add.

### C. In-browser, no-build AI options

**Honest headline: in-browser LLMs are a "nice-to-have," not the core.** WebGPU support is real but not universal, download sizes are large, and first-load UX is heavy. Build the product so it is fully useful with **zero AI**.

**Tier 2a — WebLLM (mlc-ai/web-llm):** purpose-built for LLM inference on WebGPU, loadable via ESM (`import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm"`). Realistic small-model download/VRAM figures from the live MLC prebuilt config (`src/config.ts`; GitHub issue #683 model table):
- **SmolLM2-360M-Instruct** — q4f16_1 = **376 MB** VRAM (low-resource-friendly), q4f32_1 = **580 MB**, q0f16 = **872 MB**.
- **Qwen2.5-0.5B-Instruct** — ~**945 MB** VRAM (q4f16_1).
- **Llama-3.2-1B-Instruct** — WebLLM's documented default is **Llama-3.2-1B-Instruct-q4f32_1-MLC**; ~700 MB–1.1 GB depending on quantization.
- **TinyLlama-1.1B-Chat** ≈ 675 MB; **gemma-2-2b** ≈ 2 GB; **Llama-3.2-3B-Instruct** ≈ 2.2 GB; **Qwen2.5-1.5B** ≈ 1–1.9 GB; **Phi-3.5-mini** ≈ 2.5 GB+.

Models cache after first download (Cache API / OPFS) and then work offline. Requires **WebGPU** (Chrome/Edge 113+ stable; Firefox and Safari still partial/flagged as of 2026). Sensible default: recommend Llama-3.2-1B on capable machines, fall back to SmolLM2-360M on low-memory devices (`navigator.deviceMemory <= 4`).

**Tier 2b — Transformers.js (@huggingface/transformers, v3):** ESM via `https://cdn.jsdelivr.net/npm/@huggingface/transformers`. Best for smaller NLP/embedding/classification; WebGPU via `device:'webgpu'` with graceful WASM/CPU fallback. Use it for classification/feature-extraction; WebLLM wins for chat-scale generation.

**GitHub Pages / cross-origin isolation blocker (critical):** GitHub Pages **cannot set COOP/COEP headers** — confirmed by the open GitHub community discussion #13309 ("Allow setting COOP and COEP headers in GitHub Pages"), which remains unresolved with "No ETA at the moment," and by hosting guides noting "Static hosts that do not allow custom headers: GitHub Pages, classic Netlify rewrites, and S3-only origins cannot set COOP or COEP." Therefore anything requiring `SharedArrayBuffer` / `crossOriginIsolated` (e.g., **wllama multi-threaded**, threaded WASM) will not work out-of-the-box. A `coi-serviceworker` shim exists but adds fragility. **WebLLM (WebGPU) and single-threaded Transformers.js do NOT require COOP/COEP**, so they are safe on GitHub Pages. Flag wllama-multithread and WASM-SIMD-threads as blockers to avoid.

**Tier 1 — Tiny rule-based NLP (the real sweet spot for this persona):** small, dependable, no WebGPU, works everywhere:
- **compromise.js (nlp/compromise)** — MIT, in-browser NLP via CDN (`https://unpkg.com/compromise` or `import nlp from "https://cdn.skypack.dev/compromise"`). Tokenization, POS, tense, matching — great for detecting hedges, apologies, and sentence stats.
- **retext / unified plugins** — ESM-only, loadable via `https://esm.sh/retext-passive@5?bundle`: **retext-passive** (passive voice), **retext-simplify**, **retext-intensify**, **retext-equality** (insensitive language), **retext-readability**. These map directly onto overthinker pain-points.
- **Readability scores** (Flesch-Kincaid, Gunning Fog) via text-readability; **sentiment** via AFINN/VADER JS ports.
- A tiny custom **hedging/apology/qualifier counter** ("just," "I think," "sorry," "maybe," "I'm not sure") — a few dozen lines, no dependency. This is the highest-value, lowest-risk AI-ish feature: objective counts, not judgmental scores.

**Tier 3 — Bring-your-own-key (BYO-key):** Reputable static apps (e.g., Simon Willison's client-side "Haiku" app) ask the user to paste their own key, store it in `localStorage`, and call the provider directly. CORS realities from the browser:
- **OpenAI, Google, OpenRouter** allow direct browser calls.
- **Anthropic** requires the header `anthropic-dangerous-direct-browser-access: true` (and the SDK flag `dangerouslyAllowBrowser: true`); without it the API returns `401 CORS requests must set 'anthropic-dangerous-direct-browser-access' header`.
- **Local Ollama / LM Studio** via `http://localhost:11434` works if the user configures allowed origins/CORS.

Security: the key lives only in the user's browser (never committed, never sent anywhere except the provider); the honest tradeoff is XSS risk — a compromised page could read `localStorage`. Because this app is static, single-origin, and dependency-light, that surface is small but must be disclosed. Prefer `localStorage` (persists) with a clear "your key stays in your browser" note and a one-click "forget key."

### D. Persistence, data model, portability

**Local persistence:** For documents with many sections and variations, **IndexedDB via idb-keyval** (tiny, MIT, `https://esm.sh/idb-keyval`) is the right default — async, non-blocking, structured-clone (no JSON date issues), and far larger quota than localStorage's ~5 MB. Use plain **localStorage only for small prefs** (theme, last-open doc id). Dexie is overkill unless you need indexed queries. Warn users that browsers may **evict** best-effort storage under pressure; call `navigator.storage.persist()` to request durability and `navigator.storage.estimate()` to display usage.

**File System Access API** (`showSaveFilePicker`/`showOpenFilePicker`): MDN (page last modified Jan 25, 2026) labels it **"Limited availability… not Baseline"** and "Experimental." **Chrome/Edge/Opera desktop 86+: yes. Firefox: no** (Mozilla flagged the disk pickers as harmful in its standards position). **Safari (macOS/iOS/iPadOS): no. All mobile browsers: no.** It requires a **secure context (HTTPS)** ("This feature is available only in secure contexts") and **transient user activation** ("The user has to interact with the page… in order for this feature to work") — GitHub Pages is HTTPS, so it works there in Chromium. It does **NOT** require COOP/COEP. **Fallback for Firefox/Safari:** download-blob via `<a download>` + `<input type="file">` for opening (exactly what Google's browser-fs-access library does). Recommendation: implement the download+input fallback as the *primary* path (works everywhere) and progressively enhance with `showSaveFilePicker` where available.

**Import/export:** a single self-describing **JSON document format** (versioned schema) as the canonical save; plus export to **Markdown / plain text**; plus **clipboard with formatting** for pasting into Gmail/Slack. The rich-copy pattern: build a `ClipboardItem` with **both** `text/html` and `text/plain` **Blobs** and call `navigator.clipboard.write([item])` — Chrome throws `DOMString is not supported` unless both parts are Blobs, and the spec only mandates `text/plain`, `text/html`, `image/png`. Must be triggered by a user gesture.

**Sharing/permalinks with no backend:** encode the doc into the **URL hash with LZ-string** (`compressToEncodedURIComponent`/`decompressFromEncodedURIComponent`, MIT, `https://esm.sh/lz-string`). Honest verdict: this is a **trap for this app.** (1) URLs have practical length limits (~2k–8k safe; varies by browser/server) that a multi-block doc will overflow; (2) **privacy** — sensitive personal messages in a URL leak into history, referrer headers, and chat link-previews. Recommendation: **omit URL-sharing from MVP**; if wanted later, gate it behind an explicit warning and only for small docs. This aligns with the local-first, privacy-first positioning.

**Autosave / recovery / undo:** autosave to IndexedDB on a debounce (~500 ms–1 s). For undo, deliberately choose a **bounded, block-scoped undo** (command pattern with a small ring buffer, e.g., last 20 actions) rather than infinite history — Section A shows infinite undo feeds checking. Crash recovery = "restore last autosave" on load.

### E. Modern sleek UI with no framework/build

**2026 CSS is more than enough to look premium with little code.** Safe-to-use (Baseline "widely/newly available" in 2026):
- **`light-dark()`** — one-line light/dark values; Baseline newly available across all engines as of 2026. Pair with `color-scheme`.
- **OKLCH color** + **`color-mix()`** — ~87–89% support mid-2026; perceptually uniform, ideal for generating hover/surface tints from one accent. Provide sRGB fallbacks first.
- **Relative color syntax** (`oklch(from var(--accent) calc(l * 0.9) c h)`) for deriving scales.
- **CSS nesting**, **`@layer`**, **`:has()`**, **container queries** — all Baseline in 2026.
- **`<dialog>`** and the **`popover`** attribute for modals/menus (command palette, slash menu) — native, accessible, no library.
- **`field-sizing: content`** for auto-growing textareas (Chromium; provide a JS auto-resize fallback elsewhere).
- **View Transitions API** and **`@starting-style`** for sub-200ms motion — enhancement only, degrade gracefully.
- **`@function`** and **`contrast-color()`** are newer/limited (Chrome 139+) — progressive enhancement only, don't depend on them.

**Dark/light done right:** system preference (`prefers-color-scheme`/`color-scheme`) + **manual override** + **persisted choice** in localStorage; **prevent flash-of-wrong-theme** with a tiny inline `<script>` in `<head>` that sets `data-theme` before first paint. Use **semantic design tokens** (CSS custom properties), not raw colors. Recommended token scheme: `--bg`, `--bg-subtle`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-contrast`, `--danger`, plus state tokens derived via `color-mix()`. Ensure **WCAG AA** contrast in both modes.

**Typography for a writing app:** self-host **woff2** with `font-display: swap` in the repo (privacy — avoids Google Fonts CDN leaking user IPs). Strong open-source choices: **iA Writer Quattro/Duo** (SIL OFL 1.1, from `iaolo/iA-Fonts` — the reference "writing" feel, a modification of IBM Plex), **Inter** and **Geist** (UI/sans), **Source Serif 4** / **Newsreader** (serif for long-form composition), **JetBrains Mono** (mono). There is a real argument for a **serif in the composition area** (calmer, more "letter-like," less UI-like) with a sans UI chrome. Use a fluid type scale with `clamp()`, a **measure of ~60–75ch**, generous line-height (~1.6), and generous whitespace.

**The "sleek/modern" feel is nameable and cheap:** restraint in color (one accent), generous whitespace, **subtle borders over heavy shadows**, motion under ~200ms, a focus mode, and calm defaults — the aesthetic of iA Writer, Bear, Linear, Raycast, Things 3, and Lex.

**`contenteditable` reality check:** raw `contenteditable` rich-text is notoriously buggy (inconsistent DOM across browsers, paste-sanitization hell, selection/caret bugs, undo chaos). Since each block is a **paragraph-sized plain-text chunk**, the pragmatic, robust choice is a **plain `<textarea>` per block with `field-sizing: content`** (auto-grow), falling back to a tiny JS auto-resize. This sidesteps the entire contenteditable minefield, keeps data as clean strings (trivial to diff, store, and copy), and is more accessible. Do **not** let the agent reach for a rich-text editor library.

### F. Prompt engineering for the coding agent

Anthropic's official Claude Code guidance (2025–2026) is directly applicable:
- **Plan before implementing.** "Planning Before Implementation is Non-Negotiable… 'Vibe coding' works for throwaway MVPs, but production code requires structured thinking." Have the agent produce a plan / `SPEC.md` first, then execute in a fresh session.
- **Avoid over-engineering — newer models tend to over-build.** Anthropic's prompt-engineering docs warn that recent Opus/Sonnet models "have a tendency to overengineer by creating extra files, adding unnecessary abstractions, or building in flexibility that wasn't requested," and recommend explicit guidance: "Only make changes that are directly requested or clearly necessary. Keep solutions simple and focused… Don't add error handling, fallbacks, or validation for scenarios that can't happen."
- **CLAUDE.md should be short and concrete.** "A 50-line CLAUDE.md that covers architecture, conventions, and commands beats a 500-line essay." Over-specified files get ignored ("important rules get lost in the noise").
- **Phase-wise gated plan with tests per phase**; assume zero context; give specific, actionable project context, not platitudes ("We value quality" tells the agent nothing).
- **Definition of done + acceptance criteria** per milestone; let the agent choose implementation details *within* the hard constraints.

### G. Competitive landscape

- **Lex (lex.page)** — AI word processor by **Nathan Baschez**, incubated in **Every**, spun out in 2023, with a **$2.75M seed round led by True Ventures** (PR Newswire, Aug 23, 2023; "led by early stage venture capital firm True Ventures," with Natasha Sharma leading for the firm). Baschez's positioning: "AI doesn't just have to be about decreasing the cost of writing… it can help increase the quality." Inline AI via `++`, an AI feedback feature that critiques arguments, version history, multi-model. Freemium (free tier caps AI uses ~15/mo per reviews). Cloud + account required.
- **Wordtune** (AI21 Labs) — highlight → **Rewrite** → a list of alternative phrasings to pick from; tone toggles; free plan capped (~10 rewrites/day). Cloud + account.
- **Difficult-conversation apps** — a nascent cluster (Clarity Coach, AstuteTalk, Hard Talk Roleplay Coach, Difficult Conversation Planner) explicitly for pre-conversation message prep, but almost all are **cloud, AI-account, mobile, subscription, roleplay-oriented.** **Yoodli / Poised** own *spoken* delivery coaching, not written drafting.
- **Open-source prior art for "variations per paragraph":** none found that does exactly this. Adjacent projects: **berkdurmus/prose-diff** (semantic prose diff), editor.js block tooling, and local-first editors (FocusWriter, ghostwriter, Manuskript). The building blocks exist separately; the combination is open.
- **The defensible niche:** a **personal, local-first, no-account, no-subscription, privacy-first** tool that (1) keeps sensitive text in the browser, (2) persists **multiple competing versions per paragraph side-by-side**, (3) needs **no AI to be useful** (no caps, no keys), and (4) applies "hard conversation" framing to *written* messages. Every incumbent misses at least three of these.

## Recommended Feature Set

### Must-have MVP
1. **Notebook of blocks.** Each block = one section/paragraph. Add, delete, reorder (drag handle), keyboard nav. Plain `<textarea>` per block with auto-grow (`field-sizing: content`).
2. **Variations per block, capped at 3–4.** Add/cycle (next/prev)/delete variation. A visible cap with a gentle nudge when the user tries to exceed it ("More options rarely means a better message"). Only the *active* variation contributes to the assembled message.
3. **Lock / unlock (commitment device).** Filled padlock; locked blocks desaturate *controls*, hide variation-cycling, and are excluded from further fiddling. Unlock requires a deliberate action. A per-document count of locked blocks ("6 of 8 settled").
4. **Assembled message view + rich copy.** One-click **Copy** writing both `text/html` and `text/plain` (formatting survives into Gmail/Slack). Also Copy-as-Markdown and Copy-as-plain-text.
5. **Two-version side-by-side compare.** Pick two full assembled versions (or two variations of one block); split view, word-level **jsdiff**, synchronized scroll, meaningful-changes highlight.
6. **Local persistence + autosave** to IndexedDB (idb-keyval), with `navigator.storage.persist()` and a usage indicator. Crash recovery on load.
7. **Save/Open to file:** download-blob JSON + `<input type=file>` (works everywhere), progressively enhanced with File System Access API in Chromium.
8. **Sleek dark/light UI** with `light-dark()`, semantic tokens, no flash, self-hosted iA Writer / serif composition font, one accent, sub-200ms motion.
9. **Message-type presets** (work email, Slack, difficult personal, dating/social, pitch/proposal, investor outreach) — light scaffolding (suggested block structure), not rigid templates.

### High-value additions (post-MVP, opt-in)
- **Tier 1 local NLP panel:** objective, non-judgmental counters — apology/hedge/qualifier counts, passive-voice flags (retext-passive), reading level, length. Off by default; toggle per document.
- **Cooling-off timer:** hide the draft for N minutes; "come back with fresh eyes."
- **Blind A/B compare:** hide which variant is A/B to defeat anchoring.
- **"Read as the recipient" mode:** renders the assembled message as a received email/DM.
- **Decision log:** a quiet record of locked choices ("you already decided this") to stop re-litigating.
- **Tier 2 AI (WebLLM/Transformers.js):** opt-in, WebGPU-gated, "generate an alternative phrasing" for one block. Default OFF.
- **Tier 3 BYO-key:** opt-in, provider dropdown (OpenAI/Anthropic/OpenRouter/Ollama), key in localStorage with "forget key," clear privacy note.

### Explicitly OUT of scope (and why)
- **A live tone/sentiment/"confidence" meter** — becomes an obsession object; feeds scrupulosity; Grammarly's tone detector is the cautionary tale. **Anti-feature.**
- **Infinite undo / unlimited version history** — feeds compulsive checking. Use bounded, block-scoped undo.
- **Unlimited variations** — reintroduces choice overload; cap at 3–4.
- **URL-hash sharing of documents** — privacy risk (sensitive text in history/referrers) and length limits; contradicts local-first positioning.
- **Accounts, cloud sync, backend** — violates constraints and the privacy niche.
- **Rich-text contenteditable editor** — buggy and unnecessary for paragraph-sized plain text.
- **A build step, bundler, npm install, or framework** — hard-forbidden by constraints.

## Recommended Technical Architecture

**File layout (flat, no build):**
```
/ (repo root, served at https://user.github.io/smart_writer/)
  index.html            <!-- single entry; inline anti-FOUC theme script in <head> -->
  .nojekyll             <!-- bypass Jekyll processing -->
  /css
    tokens.css          <!-- design tokens: light-dark(), OKLCH, @layer -->
    app.css
  /js
    main.js             <!-- app bootstrap, ES module -->
    store.js            <!-- IndexedDB via idb-keyval, autosave, schema/versioning -->
    model.js            <!-- document data model + pure functions (no DOM) -->
    blocks.js           <!-- block render/edit/reorder -->
    variations.js       <!-- variation cycling + cap logic -->
    compare.js          <!-- jsdiff split view -->
    clipboard.js        <!-- ClipboardItem html+plain -->
    files.js            <!-- FS Access API + download/input fallback -->
    nlp.js              <!-- optional Tier 1: compromise/retext, lazy-loaded -->
    ai.js               <!-- optional Tier 2/3: WebLLM / BYO-key, lazy-loaded -->
  /fonts                <!-- self-hosted woff2 (iA Writer Quattro/Duo, serif) -->
  /vendor               <!-- optional: vendored ESM copies if not using CDN -->
  README.md
  CLAUDE.md             <!-- <=50 lines: constraints, conventions, DoD -->
```
All AI/NLP modules are **dynamically imported on demand** so the base app loads instantly with zero AI weight.

**Data model (JSON, versioned):**
```json
{
  "schema": 1,
  "id": "uuid",
  "title": "Message to landlord",
  "type": "difficult-personal",
  "createdAt": 0, "updatedAt": 0,
  "blocks": [
    {
      "id": "uuid",
      "label": "Opening",
      "locked": false,
      "activeVariation": 0,
      "variations": [
        { "id": "uuid", "text": "Hi Sam, ...", "note": "" }
      ]
    }
  ],
  "namedVersions": [
    { "id": "uuid", "name": "Warmer", "blockChoices": { "blockId": "variationId" } }
  ]
}
```
The assembled message = concatenation of each block's active variation, in order. "Named versions" store a *set of choices* (which variation per block) so compare/side-by-side operates on full assemblies without duplicating text.

**Module boundaries:** pure model functions (no DOM) in `model.js`; rendering reads the model and emits events; the store persists on debounced change. **Theming:** tokens as CSS custom properties, `data-theme` on `<html>`, `light-dark()` for values, inline head script to avoid FOUC. **Persistence:** IndexedDB (idb-keyval) for docs; localStorage for prefs.

## Concrete UX Specifics to Write Into the Prompt

- **Keyboard shortcuts (document them in-app):** `Cmd/Ctrl-K` command palette; `Enter` new block, `Backspace` at empty block merges up; `Alt-↑/↓` reorder block; `Cmd/Ctrl-Enter` add variation; `[`/`]` or `Alt-←/→` cycle variation; `Cmd/Ctrl-L` lock/unlock focused block; `Cmd/Ctrl-Shift-C` copy assembled message; `Esc` exits focus mode.
- **Lock visuals:** unlocked = open padlock outline, variation controls visible; locked = filled padlock, controls desaturated/opacity-reduced, calm accent left-border, cycling hidden. Unlock = click padlock → subtle confirm (not instant) so it's a deliberate act.
- **Variation cycling:** small "2 / 3" counter with ‹ › arrows on the block; adding a 5th variation triggers the gentle nudge, not a hard block (respect autonomy, but discourage).
- **Compare view:** two columns, version pickers at top, jsdiff word-level highlight (added/removed/unchanged in token colors from the theme), synced scroll, and a "these are 90% identical — pick one and move on" satisficing nudge when diffs are tiny.
- **Empty state:** a single focused block with a calm prompt ("What do you need to say?") and message-type presets; not a blank void.
- **Onboarding:** a 3-step inline coach (not a modal wall): "1 message = a stack of blocks → each block can hold a few variations → lock a block when it's good enough." Emphasize "good enough" to reinforce satisficing.
- **Microcopy tone:** calm, permission-giving, anti-perfectionist ("Good enough is good enough," "The shortest version is usually right," "You already settled this"). Never a score, never "your message sounds anxious."

## GitHub Pages Gotchas (preempt in the prompt)

1. **Project sites live at `/repo-name/`.** Absolute paths beginning with `/` (e.g. `/css/app.css`) resolve to the domain root and **404**. **Use relative paths only** (`css/app.css`, `./js/main.js`) — no leading slash. This is the #1 failure mode.
2. **Add an empty `.nojekyll`** at repo root so GitHub Pages doesn't run Jekyll (which drops files/folders starting with `_` and can mangle output). Publish files as-is.
3. **ES module CDN:** `import` from a CDN (esm.sh/jsdelivr/unpkg) works over HTTPS; use `<script type="module">`. If vendoring, keep relative paths.
4. **No COOP/COEP headers possible** → no `SharedArrayBuffer`-dependent features (wllama-multithread, threaded WASM). WebLLM (WebGPU) and single-thread Transformers.js are fine.
5. **Case-sensitive paths** on GitHub's servers (works on macOS/Windows locally, breaks live) — match filename case exactly.
6. **No SPA server routing** — a static single page with hash or no routing avoids 404-on-refresh entirely. Keep it single-page; no History API deep links.

## What the User's Original Draft Got Wrong (and what to say instead)

1. **"A bit like a Jupyter notebook" undersells the psychology.** The single most important addition is the **anti-rumination stance**: cap variations (3–4), make the lock a commitment device, use bounded undo, and forbid tone/confidence meters. Without this, the agent will build a maximizer's playground that makes an overthinker *worse*.
2. **"Compare different versions side by side" is under-specified.** Say: two-way word-level diff (jsdiff), split view, synced scroll, and a satisficing nudge when versions are nearly identical.
3. **"Look extremely sleek and modern with dark and light mode" will produce generic output unless specified.** Name the aesthetic (iA Writer/Linear/Raycast restraint), the token system, `light-dark()`, a no-FOUC inline script, one accent, serif composition font, sub-200ms motion, WCAG AA.
4. **The draft says nothing about stack constraints.** The agent will likely reach for React/Vite/npm. The prompt must **hard-forbid build steps, bundlers, npm, and frameworks**, mandate relative paths + `.nojekyll`, and specify ES-modules-from-CDN.
5. **"AI assistance" is left vague and will balloon.** Specify the **tiered** model: default OFF, Tier 1 tiny rule-based counters as the useful core, Tier 2/3 opt-in and lazy-loaded, WebGPU/CORS-gated, BYO-key with privacy disclosure.
6. **No persistence/portability plan.** Specify IndexedDB autosave + JSON export + rich-clipboard copy, and explicitly **drop URL-sharing** for privacy.
7. **The Windows path (`\....\vibe-code\...`) is just a working directory** — fine, but the prompt should also state the deploy target (GitHub Pages project site) so the agent designs for the `/repo-name/` subpath from the start.

## Recommendations (staged)

**Stage 1 — write the spec with a plan-first instruction.** Have the agent read a short `CLAUDE.md` (≤50 lines: hard constraints, file layout, definition of done) and produce a `SPEC.md`/plan before coding. Benchmark to proceed: the plan uses vanilla JS only, relative paths, and the block/variation/lock/compare model.

**Stage 2 — build MVP (features 1–9) with zero AI.** Definition of done: loads on GitHub Pages at `/smart_writer/` with no 404s; add/reorder/lock blocks; variations capped at 4; rich-copy works into Gmail; two-way diff compare; autosave survives reload; dark/light with no FOUC. Threshold to advance: all DoD items pass in Chrome + Firefox + Safari (except FS Access, which is Chromium-only with the fallback verified elsewhere).

**Stage 3 — add high-value anti-rumination features** (Tier 1 NLP counters, cooling-off timer, blind A/B, read-as-recipient). Threshold: none introduces a score/meter; all are off-by-default and non-judgmental.

**Stage 4 — optional AI** (Tier 2 WebLLM, then Tier 3 BYO-key), lazy-loaded and WebGPU/CORS-gated. Threshold to ship AI: the base app remains fully functional with AI disabled and network offline.

**What would change these recommendations:** if the user later wants multi-device sync, that breaks the no-backend constraint and would require a minimal serverless component. If in-browser LLM quality proves too low for useful rewrites at 0.5–1B sizes, prioritize Tier 3 BYO-key over Tier 2. If users don't engage with variations at all, simplify toward a single-draft + snapshots model (Scrivener-style).

## Caveats
- **In-browser LLM specifics move fast.** VRAM/size figures (SmolLM2-360M q4f16_1 = 376 MB; Llama-3.2-1B ~700 MB–1.1 GB; gemma-2-2b ~2 GB; Llama-3.2-3B ~2.2 GB) come from the MLC prebuilt config / issue #683 and vary by quantization; re-verify against the live list at build time. WebGPU support in Firefox/Safari is still partial in 2026.
- **File System Access API** is explicitly non-Baseline and Chromium-only; the download/input fallback is the reliable path. One secondary blog claimed "Safari 15.4+" support — this conflates OPFS with the disk pickers and is inaccurate per MDN.
- **Psychology sources** mix primary research (Iyengar & Lepper 2000; Schwartz; McCroskey 1977; Rachman 2002; Salkovskis ERS literature) with reputable secondary summaries. The *direction* of effects (choice overload harms follow-through; checking/reassurance feeds anxiety) is well-established, but the exact "3–4 variations" cap is a reasoned design inference, not a measured optimum for this specific task.
- **Lex pricing/feature figures** come from third-party review sites and vary ($8–$18/mo; ~15 free AI uses/mo); the $2.75M/True Ventures seed and Baschez positioning are confirmed via PR Newswire (Aug 23, 2023). Verify current pricing on the official lex.page page.
- **Some cited pages are marketing or aggregator sources;** the load-bearing technical facts (CSS Baseline-2026, MDN File System Access status, GitHub Pages COOP/COEP limitation, Anthropic CORS header, Clipboard API behavior) are anchored to primary/authoritative sources (MDN, web.dev, GitHub community, Anthropic docs).