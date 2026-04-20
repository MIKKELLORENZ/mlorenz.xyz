/* EverDiff – Document Diff Tool */
(() => {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────
  const state = {
    panes: [],
    activePane: null,
    nextId: 1,
    sequenceSelection: new Set(),
    diffMode: "words",   // words | chars | lines | sentences
  };

  const STORAGE_KEY = "everdiff_session";

  // ── DOM refs ───────────────────────────────────────────────────────
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

  const layoutRoot      = $("#layout-root");
  const menuTrigger     = $("#menu-trigger");
  const menuDropdown    = $("#menu-dropdown");
  const sequencePanel   = $("#sequence-panel");
  const sequenceList    = $("#sequence-list");
  const closeSequence   = $("#close-sequence");
  const diffSelected    = $("#diff-selected");
  const multiDiffBtn    = $("#multi-diff");
  const commandPalette  = $("#command-palette");
  const paletteInput    = $("#palette-input");
  const paletteResults  = $("#palette-results");
  const diffViewer      = $("#diff-viewer");
  const diffTitle       = $("#diff-title");
  const diffContent     = $("#diff-content");
  const diffStats       = $("#diff-stats");
  const closeDiff       = $("#close-diff");
  const copyDiff        = $("#copy-diff");
  const arrowOverlay    = $("#arrow-overlay");
  const importJsonInput = $("#import-json-input");
  const importFileInput = $("#import-file-input");
  const dropOverlay     = $("#drop-overlay");
  const toastContainer  = $("#toast-container");

  // ── Helpers ────────────────────────────────────────────────────────
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function toast(msg, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function getPaneById(id) {
    return state.panes.find(p => p.id === id);
  }

  // ── Persistence ───────────────────────────────────────────────────
  function saveSession() {
    try {
      const data = {
        panes: state.panes.map(p => ({ id: p.id, title: p.title, content: p.content })),
        nextId: state.nextId,
        diffMode: state.diffMode,
        theme: document.body.parentElement.dataset.theme || "dark",
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* quota exceeded, ignore */ }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.panes || !data.panes.length) return false;
      state.panes = data.panes.map(p => ({ id: p.id, title: p.title, content: p.content, element: null }));
      state.nextId = data.nextId || state.panes.length + 1;
      state.diffMode = data.diffMode || "words";
      if (data.theme) document.documentElement.dataset.theme = data.theme;
      // sync diff mode buttons
      $$(".diff-mode-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.diffMode === state.diffMode);
      });
      return true;
    } catch (e) { return false; }
  }

  const debouncedSave = debounce(saveSession, 500);

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── Pane creation ──────────────────────────────────────────────────
  function createPaneData(title, content) {
    const id = state.nextId++;
    return { id, title: title || `Doc ${id}`, content: content || "", element: null };
  }

  function buildPaneElement(pane) {
    const el = document.createElement("div");
    el.className = "pane";
    el.dataset.paneId = pane.id;

    const lineCount = (pane.content || "").split("\n").length;
    const wordCount = (pane.content || "").trim() ? pane.content.trim().split(/\s+/).length : 0;
    const charCount = (pane.content || "").length;

    el.innerHTML = `
      <div class="pane-header">
        <input class="pane-title" value="${escapeAttr(pane.title)}" spellcheck="false" aria-label="Document title">
        <div class="pane-actions">
          <button class="pane-btn split-btn" title="Split right (add pane)">+</button>
          <button class="pane-btn diff-btn" title="Toggle diff with neighbor">⇔</button>
          <button class="pane-btn close-pane-btn" title="Close pane">×</button>
        </div>
      </div>
      <div class="find-bar hidden">
        <input type="text" placeholder="Find..." spellcheck="false" aria-label="Find text">
        <span class="find-count"></span>
        <button title="Previous" class="find-prev">↑</button>
        <button title="Next" class="find-next">↓</button>
        <button title="Close" class="find-close">×</button>
      </div>
      <div class="doc-content">
        <div class="doc-editor-container">
          <div class="editor-wrapper">
            <div class="line-numbers" aria-hidden="true">${generateLineNumbers(lineCount)}</div>
            <textarea class="doc-editor" spellcheck="false" placeholder="Paste or type text here...">${escapeHtml(pane.content)}</textarea>
          </div>
        </div>
      </div>
      <div class="pane-status">
        <div class="pane-status-left">
          <span class="stat-lines">Ln ${lineCount}</span>
          <span class="stat-words">${wordCount} words</span>
          <span class="stat-chars">${charCount} chars</span>
        </div>
        <div class="pane-status-right">
          <span class="stat-encoding">UTF-8</span>
        </div>
      </div>`;

    // Wire events
    const titleInput = $(".pane-title", el);
    const editor     = $(".doc-editor", el);
    const lineNums   = $(".line-numbers", el);
    const splitBtn   = $(".split-btn", el);
    const diffBtn    = $(".diff-btn", el);
    const closeBtn   = $(".close-pane-btn", el);
    const findBar    = $(".find-bar", el);
    const findInput  = $("input", findBar);
    const findCount  = $(".find-count", findBar);

    titleInput.addEventListener("input", () => {
      pane.title = titleInput.value;
      debouncedSave();
    });

    editor.addEventListener("input", () => {
      pane.content = editor.value;
      updateLineNumbers(editor, lineNums);
      updateStatusBar(el, pane);
      updateInlineDiff(pane);
      debouncedSave();
    });

    editor.addEventListener("scroll", () => {
      lineNums.scrollTop = editor.scrollTop;
    });

    editor.addEventListener("focus", () => setActivePane(pane.id));

    // Tab support
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + "\t" + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 1;
        pane.content = editor.value;
        updateLineNumbers(editor, lineNums);
        debouncedSave();
      }
      // Ctrl+F → find
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        findBar.classList.remove("hidden");
        findInput.focus();
        findInput.select();
      }
    });

    splitBtn.addEventListener("click", () => splitPane(pane.id));
    diffBtn.addEventListener("click", () => {
      toggleInlineDiff(pane.id);
      diffBtn.classList.toggle("active", !!$(".side-diff-view", el));
    });
    closeBtn.addEventListener("click", () => removePane(pane.id));

    // Find bar
    let findMatches = [];
    let findIdx = -1;

    findInput.addEventListener("input", () => {
      const q = findInput.value;
      if (!q) { findCount.textContent = ""; findMatches = []; return; }
      const text = editor.value;
      findMatches = [];
      let pos = 0;
      const lq = q.toLowerCase();
      const lt = text.toLowerCase();
      while (true) {
        const idx = lt.indexOf(lq, pos);
        if (idx === -1) break;
        findMatches.push(idx);
        pos = idx + 1;
      }
      findCount.textContent = findMatches.length ? `${findMatches.length} found` : "No results";
      if (findMatches.length) { findIdx = 0; highlightFind(editor, findMatches[0], q.length); }
    });

    $(".find-next", findBar).addEventListener("click", () => {
      if (!findMatches.length) return;
      findIdx = (findIdx + 1) % findMatches.length;
      highlightFind(editor, findMatches[findIdx], findInput.value.length);
    });

    $(".find-prev", findBar).addEventListener("click", () => {
      if (!findMatches.length) return;
      findIdx = (findIdx - 1 + findMatches.length) % findMatches.length;
      highlightFind(editor, findMatches[findIdx], findInput.value.length);
    });

    findInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $(".find-next", findBar).click();
      }
      if (e.key === "Escape") {
        findBar.classList.add("hidden");
        editor.focus();
      }
    });

    $(".find-close", findBar).addEventListener("click", () => {
      findBar.classList.add("hidden");
      editor.focus();
    });

    // Drop on pane
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.style.outline = "2px solid var(--accent)"; });
    el.addEventListener("dragleave", () => { el.style.outline = ""; });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.style.outline = "";
      const files = e.dataTransfer.files;
      if (files.length) {
        const reader = new FileReader();
        reader.onload = () => {
          editor.value = reader.result;
          pane.content = reader.result;
          pane.title = files[0].name.replace(/\.[^.]+$/, "");
          titleInput.value = pane.title;
          updateLineNumbers(editor, lineNums);
          updateStatusBar(el, pane);
          debouncedSave();
          toast(`Loaded "${files[0].name}"`, "success");
        };
        reader.readAsText(files[0]);
      }
    });

    pane.element = el;
    return el;
  }

  function highlightFind(editor, pos, len) {
    editor.focus();
    editor.setSelectionRange(pos, pos + len);
    // Scroll into view — crude but works
    const linesBefore = editor.value.substring(0, pos).split("\n").length;
    const lineH = editor.scrollHeight / editor.value.split("\n").length;
    editor.scrollTop = Math.max(0, linesBefore * lineH - editor.clientHeight / 2);
  }

  function generateLineNumbers(count) {
    let html = "";
    for (let i = 1; i <= count; i++) html += i + "\n";
    return html;
  }

  function updateLineNumbers(editor, lineNums) {
    const count = editor.value.split("\n").length;
    lineNums.textContent = "";
    for (let i = 1; i <= count; i++) lineNums.textContent += i + "\n";
  }

  function updateStatusBar(el, pane) {
    const lines = pane.content.split("\n").length;
    const words = pane.content.trim() ? pane.content.trim().split(/\s+/).length : 0;
    const chars = pane.content.length;
    $(".stat-lines", el).textContent = `Ln ${lines}`;
    $(".stat-words", el).textContent = `${words} words`;
    $(".stat-chars", el).textContent = `${chars} chars`;
  }

  function setActivePane(id) {
    state.panes.forEach(p => p.element?.classList.remove("active"));
    state.activePane = id;
    const pane = getPaneById(id);
    if (pane?.element) pane.element.classList.add("active");
  }

  // ── Layout rendering ──────────────────────────────────────────────
  function renderLayout() {
    layoutRoot.innerHTML = "";

    if (state.panes.length === 0) {
      state.panes.push(createPaneData("Left", ""));
      state.panes.push(createPaneData("Right", ""));
    }

    if (state.panes.length === 1) {
      layoutRoot.appendChild(buildPaneElement(state.panes[0]));
      setActivePane(state.panes[0].id);
      addWelcomeHint();
      return;
    }

    const container = document.createElement("div");
    container.className = "split-container split-horizontal";
    container.style.height = "100%";

    state.panes.forEach((pane, i) => {
      container.appendChild(buildPaneElement(pane));
      if (i < state.panes.length - 1) {
        const bar = document.createElement("div");
        bar.className = "split-bar";
        bar.addEventListener("mousedown", (e) => startResize(e, bar, container));
        container.appendChild(bar);
      }
    });

    layoutRoot.appendChild(container);

    if (!getPaneById(state.activePane)) {
      setActivePane(state.panes[0].id);
    } else {
      setActivePane(state.activePane);
    }

    addWelcomeHint();
    requestAnimationFrame(drawArrows);
  }

  function addWelcomeHint() {
    // Only show if all panes are empty
    const allEmpty = state.panes.every(p => !p.content);
    if (!allEmpty) return;
    const existing = $(".welcome-hint", layoutRoot);
    if (existing) existing.remove();
    const hint = document.createElement("div");
    hint.className = "welcome-hint";
    hint.innerHTML = `
      <span><kbd>Ctrl</kbd>+<kbd>K</kbd> Command palette</span>
      <span><kbd>Ctrl</kbd>+<kbd>N</kbd> New pane</span>
      <span><kbd>Ctrl</kbd>+<kbd>D</kbd> Diff panes</span>
      <span>Drop files onto panes</span>`;
    layoutRoot.appendChild(hint);
  }

  // ── Split / resize ────────────────────────────────────────────────
  function splitPane(afterId) {
    const idx = state.panes.findIndex(p => p.id === afterId);
    const newPane = createPaneData();
    state.panes.splice(idx + 1, 0, newPane);
    renderLayout();
    setActivePane(newPane.id);
    $(".doc-editor", newPane.element).focus();
    debouncedSave();
    toast("Pane added", "success");
  }

  function removePane(id) {
    if (state.panes.length <= 1) {
      toast("Can't remove the last pane", "error");
      return;
    }
    state.panes = state.panes.filter(p => p.id !== id);
    renderLayout();
    debouncedSave();
  }

  function swapPanes() {
    if (state.panes.length < 2) { toast("Need at least 2 panes to swap", "error"); return; }
    // Find two: active + neighbor, or first two
    let a = state.panes.findIndex(p => p.id === state.activePane);
    if (a === -1) a = 0;
    let b = a + 1;
    if (b >= state.panes.length) b = a - 1;
    if (b < 0) return;
    [state.panes[a], state.panes[b]] = [state.panes[b], state.panes[a]];
    renderLayout();
    debouncedSave();
    toast("Panes swapped", "info");
  }

  function startResize(e, bar, container) {
    e.preventDefault();
    const panes = Array.from(container.querySelectorAll(":scope > .pane"));
    const bars  = Array.from(container.querySelectorAll(":scope > .split-bar"));
    const barIndex = bars.indexOf(bar);
    const leftPane  = panes[barIndex];
    const rightPane = panes[barIndex + 1];
    if (!leftPane || !rightPane) return;

    const startX = e.clientX;
    const leftW  = leftPane.offsetWidth;
    const rightW = rightPane.offsetWidth;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev) {
      const dx = ev.clientX - startX;
      leftPane.style.flex  = `0 0 ${Math.max(220, leftW + dx)}px`;
      rightPane.style.flex = `0 0 ${Math.max(220, rightW - dx)}px`;
      requestAnimationFrame(drawArrows);
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── Diff engine ───────────────────────────────────────────────────
  function computeDiff(textA, textB) {
    switch (state.diffMode) {
      case "chars":     return Diff.diffChars(textA, textB);
      case "lines":     return Diff.diffLines(textA, textB);
      case "sentences": return Diff.diffSentences(textA, textB);
      default:          return Diff.diffWords(textA, textB);
    }
  }

  function computeStats(diffResult) {
    let added = 0, removed = 0, unchanged = 0;
    diffResult.forEach(part => {
      const len = part.value.length;
      if (part.added) added += len;
      else if (part.removed) removed += len;
      else unchanged += len;
    });
    const total = added + removed + unchanged;
    const similarity = total ? Math.round((unchanged / total) * 100) : 100;
    return { added, removed, unchanged, similarity };
  }

  function renderDiffHtml(textA, textB, container, title) {
    const diff = computeDiff(textA, textB);
    const stats = computeStats(diff);

    let html = `<div class="diff-text">`;
    if (title) html += `<h4>${escapeHtml(title)}</h4>`;

    if (state.diffMode === "lines") {
      // Line-by-line unified diff view
      diff.forEach(part => {
        const lines = part.value.split("\n");
        lines.forEach((line, i) => {
          // Skip empty trailing line from split
          if (i === lines.length - 1 && line === "") return;
          if (part.added) {
            html += `<span class="diff-line added">+ ${escapeHtml(line)}</span>`;
          } else if (part.removed) {
            html += `<span class="diff-line removed">- ${escapeHtml(line)}</span>`;
          } else {
            html += `<span class="diff-line">  ${escapeHtml(line)}</span>`;
          }
        });
      });
    } else {
      diff.forEach(part => {
        if (part.added) {
          html += `<span class="diff-added">${escapeHtml(part.value)}</span>`;
        } else if (part.removed) {
          html += `<span class="diff-removed">${escapeHtml(part.value)}</span>`;
        } else {
          html += escapeHtml(part.value);
        }
      });
    }

    html += `</div>`;
    container.innerHTML = html;
    return stats;
  }

  function renderStatsBar(stats, container) {
    container.innerHTML = `
      <div class="diff-stat additions"><span class="count">+${stats.added}</span> added</div>
      <div class="diff-stat deletions"><span class="count">-${stats.removed}</span> removed</div>
      <div class="diff-stat similarity">
        <span class="count">${stats.similarity}%</span> similar
        <div class="similarity-bar"><div class="similarity-bar-fill" style="width:${stats.similarity}%"></div></div>
      </div>`;
  }

  // ── Inline diff (side-by-side within pane) ────────────────────────
  function toggleInlineDiff(paneId) {
    const idx = state.panes.findIndex(p => p.id === paneId);
    const pane = state.panes[idx];
    const container = $(".doc-editor-container", pane.element);
    const existing = $(".side-diff-view", container);

    if (existing) {
      existing.remove();
      container.classList.remove("diff-mode");
      return;
    }

    const neighbor = state.panes[idx + 1] || state.panes[idx - 1];
    if (!neighbor) { toast("No adjacent pane to diff against", "error"); return; }

    container.classList.add("diff-mode");
    const diffDiv = document.createElement("div");
    diffDiv.className = "side-diff-view";
    renderDiffHtml(pane.content, neighbor.content, diffDiv,
      `${pane.title} → ${neighbor.title}`);
    container.appendChild(diffDiv);
  }

  function updateInlineDiff(pane) {
    if (!pane.element) return;
    const container = $(".doc-editor-container", pane.element);
    const diffDiv = $(".side-diff-view", container);
    if (!diffDiv) return;

    const idx = state.panes.findIndex(p => p.id === pane.id);
    const neighbor = state.panes[idx + 1] || state.panes[idx - 1];
    if (!neighbor) return;

    renderDiffHtml(pane.content, neighbor.content, diffDiv,
      `${pane.title} → ${neighbor.title}`);
  }

  // ── Diff all adjacent panes ───────────────────────────────────────
  function diffAdjacentPanes() {
    if (state.panes.length < 2) { toast("Need at least 2 panes", "error"); return; }
    // Show in diff viewer
    diffContent.innerHTML = "";
    diffTitle.textContent = state.panes.length === 2
      ? `${state.panes[0].title} → ${state.panes[1].title}`
      : "All Documents Diff";

    let totalStats = { added: 0, removed: 0, unchanged: 0, similarity: 0 };
    let count = 0;

    for (let i = 0; i < state.panes.length - 1; i++) {
      const section = document.createElement("div");
      section.style.marginBottom = "20px";
      const stats = renderDiffHtml(
        state.panes[i].content,
        state.panes[i + 1].content,
        section,
        state.panes.length > 2 ? `${state.panes[i].title} → ${state.panes[i + 1].title}` : null
      );
      totalStats.added += stats.added;
      totalStats.removed += stats.removed;
      totalStats.unchanged += stats.unchanged;
      count++;
      diffContent.appendChild(section);
    }

    const total = totalStats.added + totalStats.removed + totalStats.unchanged;
    totalStats.similarity = total ? Math.round((totalStats.unchanged / total) * 100) : 100;
    renderStatsBar(totalStats, diffStats);
    diffViewer.classList.remove("hidden");
  }

  // ── Sequence panel ────────────────────────────────────────────────
  function toggleSequencePanel() {
    sequencePanel.classList.toggle("hidden");
    if (!sequencePanel.classList.contains("hidden")) renderSequenceList();
  }

  function renderSequenceList() {
    sequenceList.innerHTML = "";
    state.panes.forEach(pane => {
      const sel = state.sequenceSelection.has(pane.id);
      const item = document.createElement("div");
      item.className = "sequence-item" + (sel ? " selected" : "");

      const lines = pane.content.split("\n").length;
      const words = pane.content.trim() ? pane.content.trim().split(/\s+/).length : 0;

      item.innerHTML = `
        <div class="sequence-item-check">${sel ? "✓" : ""}</div>
        <div class="sequence-item-info">
          <div class="sequence-item-title">${escapeHtml(pane.title)}</div>
          <div class="sequence-item-meta">${lines} lines · ${words} words · ${pane.content.length} chars</div>
        </div>`;

      item.addEventListener("click", () => {
        if (state.sequenceSelection.has(pane.id)) {
          state.sequenceSelection.delete(pane.id);
        } else {
          state.sequenceSelection.add(pane.id);
        }
        renderSequenceList();
        diffSelected.disabled = state.sequenceSelection.size < 2;
      });
      sequenceList.appendChild(item);
    });
  }

  function diffSelectedPanes() {
    const ids = [...state.sequenceSelection];
    if (ids.length < 2) return;
    const a = getPaneById(ids[0]);
    const b = getPaneById(ids[1]);
    if (!a || !b) return;
    diffTitle.textContent = `${a.title} → ${b.title}`;
    const stats = renderDiffHtml(a.content, b.content, diffContent, `${a.title} → ${b.title}`);
    renderStatsBar(stats, diffStats);
    diffViewer.classList.remove("hidden");
  }

  function multiDiffAll() {
    diffAdjacentPanes();
  }

  // ── Command palette ───────────────────────────────────────────────
  const commands = [
    { name: "New Pane",              shortcut: "Ctrl+N", action: () => splitPane(state.panes[state.panes.length - 1].id) },
    { name: "Diff Panes",            shortcut: "Ctrl+D", action: diffAdjacentPanes },
    { name: "Swap Panes",            shortcut: "",       action: swapPanes },
    { name: "Toggle Sequence Panel", shortcut: "",       action: toggleSequencePanel },
    { name: "Toggle Theme",          shortcut: "",       action: toggleTheme },
    { name: "Export Active Document", shortcut: "",      action: exportDocument },
    { name: "Export All as ZIP",     shortcut: "",       action: exportAllZip },
    { name: "Import JSON",          shortcut: "",       action: () => importJsonInput.click() },
    { name: "Import Text File",      shortcut: "",       action: () => importFileInput.click() },
    { name: "Clear All Panes",       shortcut: "",       action: clearAllPanes },
    { name: "Close Active Pane",     shortcut: "",       action: () => { if (state.activePane) removePane(state.activePane); } },
    { name: "Find in Pane",          shortcut: "Ctrl+F", action: () => openFindInActivePane() },
  ];

  function togglePalette() {
    commandPalette.classList.toggle("hidden");
    if (!commandPalette.classList.contains("hidden")) {
      paletteInput.value = "";
      renderPaletteResults("");
      paletteInput.focus();
    }
  }

  function renderPaletteResults(query) {
    const q = query.toLowerCase();
    const filtered = q ? commands.filter(c => c.name.toLowerCase().includes(q)) : commands;

    paletteResults.innerHTML = "";
    filtered.forEach((cmd, i) => {
      const item = document.createElement("div");
      item.className = "palette-item" + (i === 0 ? " selected" : "");
      item.innerHTML = `<span>${escapeHtml(cmd.name)}</span>` +
        (cmd.shortcut ? `<span class="shortcut">${cmd.shortcut}</span>` : "");
      item.addEventListener("click", () => {
        cmd.action();
        commandPalette.classList.add("hidden");
      });
      paletteResults.appendChild(item);
    });
  }

  paletteInput.addEventListener("input", () => renderPaletteResults(paletteInput.value));

  paletteInput.addEventListener("keydown", (e) => {
    const items = $$(".palette-item", paletteResults);
    const current = $(".palette-item.selected", paletteResults);
    const idx = Array.from(items).indexOf(current);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (current) current.classList.remove("selected");
      const next = items[Math.min(idx + 1, items.length - 1)];
      if (next) { next.classList.add("selected"); next.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (current) current.classList.remove("selected");
      const prev = items[Math.max(idx - 1, 0)];
      if (prev) { prev.classList.add("selected"); prev.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current) current.click();
    } else if (e.key === "Escape") {
      commandPalette.classList.add("hidden");
    }
  });

  // ── Find in active pane ───────────────────────────────────────────
  function openFindInActivePane() {
    const pane = getPaneById(state.activePane);
    if (!pane?.element) return;
    const findBar = $(".find-bar", pane.element);
    findBar.classList.remove("hidden");
    $("input", findBar).focus();
  }

  // ── Theme ─────────────────────────────────────────────────────────
  function toggleTheme() {
    const current = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = current === "light" ? "dark" : "light";
    debouncedSave();
  }

  // ── Export / Import ───────────────────────────────────────────────
  function exportDocument() {
    const pane = getPaneById(state.activePane);
    if (!pane) { toast("No active pane to export", "error"); return; }
    downloadJSON(`${pane.title}.json`, { title: pane.title, content: pane.content });
    toast(`Exported "${pane.title}"`, "success");
  }

  function exportAllZip() {
    const zip = new JSZip();
    state.panes.forEach(pane => {
      zip.file(`${pane.title}.json`, JSON.stringify({ title: pane.title, content: pane.content }, null, 2));
    });
    zip.generateAsync({ type: "blob" }).then(blob => {
      downloadBlob("everdiff-export.zip", blob);
      toast(`Exported ${state.panes.length} documents as ZIP`, "success");
    });
  }

  function downloadJSON(filename, data) {
    downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  importJsonInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.title && typeof data.content === "string") {
          const pane = createPaneData(data.title, data.content);
          state.panes.push(pane);
          renderLayout();
          debouncedSave();
          toast(`Imported "${data.title}"`, "success");
        }
      } catch (err) {
        toast("Failed to import JSON", "error");
      }
    };
    reader.readAsText(file);
    importJsonInput.value = "";
  });

  importFileInput.addEventListener("change", (e) => {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const title = file.name.replace(/\.[^.]+$/, "");
        const pane = createPaneData(title, reader.result);
        state.panes.push(pane);
        renderLayout();
        debouncedSave();
        toast(`Imported "${file.name}"`, "success");
      };
      reader.readAsText(file);
    });
    importFileInput.value = "";
  });

  function clearAllPanes() {
    state.panes.forEach(p => { p.content = ""; p.title = `Doc ${p.id}`; });
    renderLayout();
    debouncedSave();
    toast("All panes cleared", "info");
  }

  // ── Arrow overlay ─────────────────────────────────────────────────
  function drawArrows() {
    arrowOverlay.querySelectorAll(".arrow-line").forEach(l => l.remove());
    if (state.panes.length < 2) return;

    const appRect = document.getElementById("app").getBoundingClientRect();

    for (let i = 0; i < state.panes.length - 1; i++) {
      const a = state.panes[i].element;
      const b = state.panes[i + 1].element;
      if (!a || !b) continue;

      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.classList.add("arrow-line");
      line.setAttribute("x1", aRect.right - appRect.left);
      line.setAttribute("y1", aRect.top + aRect.height / 2 - appRect.top);
      line.setAttribute("x2", bRect.left - appRect.left);
      line.setAttribute("y2", bRect.top + bRect.height / 2 - appRect.top);
      arrowOverlay.appendChild(line);
    }
  }

  // ── Global drag & drop ────────────────────────────────────────────
  let dragCounter = 0;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer.types.includes("Files")) {
      dropOverlay.classList.remove("hidden");
    }
  });

  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dropOverlay.classList.add("hidden"); dragCounter = 0; }
  });

  document.addEventListener("dragover", (e) => e.preventDefault());

  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add("hidden");
    // Only handle if not caught by a pane
    if (e.target.closest(".pane")) return;
    const files = e.dataTransfer.files;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const title = file.name.replace(/\.[^.]+$/, "");
        const pane = createPaneData(title, reader.result);
        state.panes.push(pane);
        renderLayout();
        debouncedSave();
        toast(`Loaded "${file.name}" into new pane`, "success");
      };
      reader.readAsText(file);
    });
  });

  // ── Toolbar events ────────────────────────────────────────────────
  document.querySelector(".toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case "new-pane":         splitPane(state.panes[state.panes.length - 1].id); break;
      case "diff-adjacent":    diffAdjacentPanes(); break;
      case "swap-panes":       swapPanes(); break;
      case "toggle-sequence":  toggleSequencePanel(); break;
      case "show-palette":     togglePalette(); break;
      case "toggle-theme":     toggleTheme(); break;
    }
  });

  // Diff mode buttons
  $$(".diff-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".diff-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.diffMode = btn.dataset.diffMode;
      debouncedSave();
      // Refresh any open inline diffs
      state.panes.forEach(p => updateInlineDiff(p));
      toast(`Diff mode: ${state.diffMode}`, "info");
    });
  });

  // Overflow menu
  menuTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-dropdown") && !e.target.closest("#menu-trigger")) {
      menuDropdown.classList.add("hidden");
    }
  });

  menuDropdown.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    menuDropdown.classList.add("hidden");
    switch (btn.dataset.action) {
      case "export-doc":  exportDocument(); break;
      case "export-all":  exportAllZip(); break;
      case "import-json": importJsonInput.click(); break;
      case "import-file": importFileInput.click(); break;
      case "clear-all":   clearAllPanes(); break;
    }
  });

  // Sequence panel
  closeSequence.addEventListener("click", () => sequencePanel.classList.add("hidden"));
  diffSelected.addEventListener("click", diffSelectedPanes);
  multiDiffBtn.addEventListener("click", multiDiffAll);

  // Diff viewer
  closeDiff.addEventListener("click", () => diffViewer.classList.add("hidden"));
  copyDiff.addEventListener("click", () => {
    const text = diffContent.innerText;
    navigator.clipboard.writeText(text).then(() => toast("Diff copied to clipboard", "success"));
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === "k") {
      e.preventDefault();
      togglePalette();
    } else if (ctrl && e.key === "n") {
      e.preventDefault();
      splitPane(state.panes[state.panes.length - 1].id);
    } else if (ctrl && e.key === "d") {
      e.preventDefault();
      diffAdjacentPanes();
    } else if (e.key === "Escape") {
      commandPalette.classList.add("hidden");
      diffViewer.classList.add("hidden");
    }
  });

  // ── Window events ─────────────────────────────────────────────────
  window.addEventListener("resize", () => requestAnimationFrame(drawArrows));
  window.addEventListener("beforeunload", saveSession);

  // ── Init ──────────────────────────────────────────────────────────
  const loaded = loadSession();
  if (!loaded) {
    state.panes.push(createPaneData("Left", ""));
    state.panes.push(createPaneData("Right", ""));
  }
  renderLayout();
})();
