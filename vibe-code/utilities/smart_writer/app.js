/* ═══════════════════════════════════════════════════════════════
   Smart Writer — a composer for messages worth getting right.

   Model:  doc.sections[]  — ordered blocks of the message
           section.variants[]  — alternative wordings of that block
           section.locked      — pins the active variant AND freezes the text
           doc.versions[]      — saved snapshots of one whole combination
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const LS_KEY = 'smartwriter.v1';
const VAR_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SWATCHES = ['#8b7cff', '#3ddc97', '#f0a83c', '#56b8ff', '#ff6b81', '#c084fc'];

/* Four options per section, deliberately. Past a handful, re-reading every
   alternative costs more than the better wording is worth — the point of this
   app is to help you decide, not to widen the field forever. */
const MAX_VARIANTS = 4;

/* How long the message must sit untouched before the spelling pass runs. */
const IDLE_PROOFREAD_MS = 30000;

/* ── Utilities ──────────────────────────────────────────────── */
let _seq = 0;
const uid = (p = 'i') => `${p}${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const countWords = (s) => (s.trim().match(/[^\s]+/g) || []).length;

function fmtNum(n) {
    if (!isFinite(n)) return '∞';
    if (n >= 1e15) return n.toExponential(1).replace('e+', '×10^');
    return n.toLocaleString('en-US');
}

function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ICON = {
    check: '<svg viewBox="0 0 16 16"><path d="M3 8.5 6.5 12 13 4.5"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    left: '<svg viewBox="0 0 16 16"><path d="M9.75 3.5 5.25 8l4.5 4.5"/></svg>',
    right: '<svg viewBox="0 0 16 16"><path d="M6.25 3.5 10.75 8l-4.5 4.5"/></svg>',
    grip: '<svg viewBox="0 0 16 16"><circle cx="6" cy="3.5" r="1.05" class="fill"/><circle cx="10" cy="3.5" r="1.05" class="fill"/><circle cx="6" cy="8" r="1.05" class="fill"/><circle cx="10" cy="8" r="1.05" class="fill"/><circle cx="6" cy="12.5" r="1.05" class="fill"/><circle cx="10" cy="12.5" r="1.05" class="fill"/></svg>',
    dots: '<svg viewBox="0 0 16 16"><circle cx="3.2" cy="8" r="1.2" class="fill"/><circle cx="8" cy="8" r="1.2" class="fill"/><circle cx="12.8" cy="8" r="1.2" class="fill"/></svg>',
    lock: '<svg viewBox="0 0 16 16"><rect x="3.2" y="7" width="9.6" height="7" rx="2"/><path class="shackle" d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2"/></svg>',
    copy: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>',
    pen: '<svg viewBox="0 0 20 20"><path d="M3 15.2 4.1 11 12.6 2.5a1.9 1.9 0 0 1 2.7 2.7L6.8 13.7 3 15.2Z"/><path d="M11 4.2 13.6 6.8"/></svg>',
    restore: '<svg viewBox="0 0 16 16"><path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.75M2.5 2.5v3h3"/></svg>',
    spark: '<svg viewBox="0 0 16 16"><path d="M8 1.6 9.5 5.4 13.3 6.9 9.5 8.4 8 12.2 6.5 8.4 2.7 6.9 6.5 5.4 8 1.6Z"/></svg>',
    magic: '<svg viewBox="0 0 16 16"><path d="M9.4 1.8 10.6 4.6 13.4 5.8 10.6 7 9.4 9.8 8.2 7 5.4 5.8 8.2 4.6 9.4 1.8Z"/><path d="M4.2 9.2 4.9 10.9 6.6 11.6 4.9 12.3 4.2 14 3.5 12.3 1.8 11.6 3.5 10.9 4.2 9.2Z"/></svg>',
    spinner: '<svg viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 0 6 6" /></svg>',
    warn: '<svg viewBox="0 0 16 16"><path d="M8 2.5 14.5 13.5h-13z"/><path d="M8 6.5v3M8 11.6v.1"/></svg>',
};

/* ── State ──────────────────────────────────────────────────── */

/* `docs` is the library; `doc` always points at one of its members, so every
   edit made through `doc` is already captured when the library is written. */
let docs = [];

const defaultUI = {
    theme: 'dark',
    view: 'compose',
    sidebar: true,
    sideTab: 'outline',
    previewW: 420,
    font: 'sans',
    compare: ['current'],
    diffOn: true,
    onlyDiff: false,
    blind: false,
    signals: false,
    recipientView: false,
    autofix: false,
    aiModel: '',
};

let doc = null;
let ui = { ...defaultUI };
let focusedSection = null;
const cards = new Map();   // sectionId → card element
let pendingFixes = [];     // proofreader suggestions awaiting a decision
let activeSignal = null;   // which signal is highlighted in the preview

/* ── Sample document ────────────────────────────────────────── */
function sampleDoc() {
    const S = (name, join, variants) => ({
        id: uid('s'), name, join, locked: false, enabled: true, active: 0,
        variants: variants.map(([label, text]) => ({ id: uid('v'), label, text })),
    });
    return {
        id: uid('d'),
        title: 'Intro to Dana — partnership ask',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        brief: {
            recipient: 'Dana',
            relationship: ['Someone I met once'],
            goal: 'Propose a small joint pilot between our two teams',
            followUp: ['Book a call'],
            tone: ['Warm', 'Direct'],
            length: 'Short',
            language: '',
        },
        sections: [
            S('Greeting', 'para', [
                ['warm', 'Hi Dana,'],
                ['neutral', 'Hello Dana,'],
                ['direct', 'Dana —'],
            ]),
            S('Opening hook', 'para', [
                ['shared context', "We met briefly at the Copenhagen design meet-up in March — you were arguing that most onboarding flows apologise for themselves. It stuck with me."],
                ['their work first', "I've been following what your team shipped this quarter, and the new onboarding flow is the first one in a while that doesn't apologise for itself."],
                ['short + blunt', "I'll be brief: I think there's a good reason for our two teams to talk."],
            ]),
            S('The ask', 'para', [
                ['low commitment', "Would you be open to a 20-minute call in the next couple of weeks? No deck, no pitch — I mostly want to test an idea against someone who has actually shipped this."],
                ['specific', "I'd like to propose a small joint pilot: one shared onboarding experiment, four weeks, measured on activation. Happy to do the setup work."],
            ]),
            S('Why you specifically', 'para', [
                ['credibility', "You're one of maybe three people I know who have run this at scale and still talk about it honestly."],
                ['mutual benefit', "You'd get a second set of data on a hypothesis you're clearly already testing, and I'd get to stop guessing."],
            ]),
            S('Close', 'para', [
                ['easy out', "If the timing is wrong, just say so — no hard feelings at all."],
                ['forward motion', "If it sounds worthwhile, send me two windows that work and I'll fit around them."],
                ['minimal', 'Either way, good to be in touch.'],
            ]),
            S('Sign-off', 'para', [
                ['standard', 'Best,\nMikkel'],
                ['warmer', 'Thanks for reading,\nMikkel'],
            ]),
        ],
        versions: [],
    };
}

function blankBrief() {
    return { recipient: '', relationship: [], goal: '', followUp: [], tone: [], length: '', language: '' };
}

function blankDoc() {
    return {
        id: uid('d'),
        title: 'Untitled message',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        brief: blankBrief(),
        sections: [newSection('Opening')],
        versions: [],
    };
}

function newSection(name = '') {
    return {
        id: uid('s'), name, join: 'para', locked: false, enabled: true, active: 0,
        variants: [{ id: uid('v'), label: '', text: '' }],
    };
}

/* ── Persistence ────────────────────────────────────────────── */

/* What the browser holds: the whole library plus the shared interface state.
   `ui` stays at the top level because the anti-flash script in the page head
   reads `ui.theme` before any of this file runs. */
let saveTimer = null;
let lastDocSig = '';

/** Everything about a document except when it was last touched. */
const docSig = (d) => JSON.stringify([d.title, d.brief, d.sections, d.versions]);

function save(immediate = false) {
    clearTimeout(saveTimer);
    const write = () => {
        // Only a real edit moves the document up the recent list — switching
        // theme or dragging the splitter is not an edit to the message.
        if (doc) {
            const sig = docSig(doc);
            if (sig !== lastDocSig) {
                if (lastDocSig) doc.updatedAt = new Date().toISOString();
                lastDocSig = sig;
            }
        }
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({ v: 2, ui, activeId: doc && doc.id, docs }));
            flashSaved();
        } catch (e) {
            toast(`Could not save — the browser's storage for this page is full${docs.length > 1 ? '. Delete a message you no longer need.' : '.'}`, 'warn');
        }
        renderDocsMenu();
    };
    immediate ? write() : (saveTimer = setTimeout(write, 450));
}

function flashSaved() {
    const el = $('#status-saved');
    el.textContent = 'Saved';
    el.classList.add('flash');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => {
        el.classList.remove('flash');
        el.textContent = 'Saved locally';
    }, 900);
}

function load() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed) return false;

        // v1 kept a single document under `doc`; it becomes the library's first.
        const list = Array.isArray(parsed.docs) ? parsed.docs : (parsed.doc ? [parsed.doc] : []);
        const usable = list.filter((d) => d && Array.isArray(d.sections)).map(migrate);
        if (!usable.length) return false;

        docs = usable;
        doc = docs.find((d) => d.id === parsed.activeId) || docs[0];
        ui = { ...defaultUI, ...(parsed.ui || {}) };
        return true;
    } catch (e) {
        return false;
    }
}

/** Tolerate hand-edited or older files. */
function migrate(d) {
    d.id = d.id || uid('d');
    d.title = typeof d.title === 'string' ? d.title : 'Untitled message';
    d.createdAt = d.createdAt || new Date().toISOString();
    d.updatedAt = d.updatedAt || d.createdAt;
    d.versions = Array.isArray(d.versions) ? d.versions : [];
    d.brief = Object.assign(blankBrief(), (d.brief && typeof d.brief === 'object') ? d.brief : {});
    // These became sets when tones stopped being mutually exclusive.
    for (const f of MULTI_FIELDS) d.brief[f] = asList(d.brief[f]);
    d.sections = d.sections.filter(Boolean).map((s) => {
        s.id = s.id || uid('s');
        s.name = typeof s.name === 'string' ? s.name : '';
        s.join = ['para', 'line', 'space'].includes(s.join) ? s.join : 'para';
        s.locked = !!s.locked;
        s.enabled = s.enabled !== false;
        s.variants = (Array.isArray(s.variants) ? s.variants : []).filter(Boolean).map((v) => ({
            id: v.id || uid('v'),
            label: typeof v.label === 'string' ? v.label : '',
            text: typeof v.text === 'string' ? v.text : '',
        }));
        if (!s.variants.length) s.variants = [{ id: uid('v'), label: '', text: '' }];
        s.active = clamp(Number(s.active) || 0, 0, s.variants.length - 1);
        return s;
    });
    if (!d.sections.length) d.sections = [newSection('Opening')];
    return d;
}

/* ═══ LIBRARY ═══════════════════════════════════════════════
   Several messages live side by side. One is open; the rest sit in the
   switcher under the title. Nothing here ever discards a document without
   saying so first — "new", "example" and "import" all *add*.
   ═══════════════════════════════════════════════════════════ */

/** Words in a document that is not currently open (so no card lookups). */
function docWords(d) {
    return countWords(d.sections
        .filter((s) => s.enabled !== false)
        .map((s) => (s.variants[clamp(s.active || 0, 0, s.variants.length - 1)] || {}).text || '')
        .join(' '));
}

/** Most recently edited first — the one you want is almost always near the top. */
const docsByRecency = () => [...docs].sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

function renderDocsMenu() {
    const list = $('#docs-list');
    if (!list) return;
    $('#doc-count').textContent = docs.length;
    $('#doc-count').hidden = docs.length < 2;
    list.innerHTML = docsByRecency().map((d) => {
        const open = d.id === doc.id;
        const v = d.versions.length;
        const meta = [fmtWhen(d.updatedAt || d.createdAt), `${docWords(d)} words`]
            .concat(v ? [`${v} version${v === 1 ? '' : 's'}`] : []).join(' · ');
        return `<div class="doc-row${open ? ' on' : ''}" data-doc="${d.id}">
            <span class="doc-tick">${ICON.check}</span>
            <span class="doc-main">
              <span class="doc-name">${esc(d.title || 'Untitled message')}</span>
              <span class="doc-meta">${esc(meta)}</span>
            </span>
            <button class="icon-btn sm doc-del" data-del="${d.id}"
                    title="${open && docs.length === 1 ? 'This is your only message' : 'Delete this message'}">${ICON.trash}</button>
        </div>`;
    }).join('');
}

/** Forget everything that belonged to the document being closed. */
function resetDocState() {
    cards.clear();
    $('#sections').innerHTML = '';
    focusedSection = null;
    pendingFixes = [];
    activeSignal = null;
    clearTimeout(idleTimer);
    ui.compare = ['current'];
}

function openDoc(d, { announce = '' } = {}) {
    doc = d;
    resetDocState();
    bootDoc();
    closeMenus();
    if (announce) toast(announce, 'ok');
}

function switchDoc(id) {
    if (!id || (doc && id === doc.id)) { closeMenus(); return; }
    const next = docs.find((d) => d.id === id);
    if (!next) return;
    save(true);                       // flush the one being closed
    openDoc(next, { announce: `Opened “${next.title || 'Untitled message'}”` });
}

/** Put a new document into the library and open it. */
function adoptDoc(d, announce) {
    save(true);
    docs.push(migrate(d));
    openDoc(docs[docs.length - 1], { announce });
    return doc;
}

function duplicateDoc() {
    const copy = JSON.parse(JSON.stringify(doc));
    copy.id = uid('d');
    copy.title = /\bcopy\b/i.test(doc.title) ? doc.title : `${doc.title || 'Untitled message'} (copy)`;
    copy.createdAt = copy.updatedAt = new Date().toISOString();
    adoptDoc(copy, 'Duplicated — the original is untouched');
}

async function deleteDoc(id) {
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    const ok = await askConfirm({
        title: 'Delete this message?',
        message: `“${d.title || 'Untitled message'}” — ${docWords(d)} words${d.versions.length
            ? ` and ${d.versions.length} saved version${d.versions.length === 1 ? '' : 's'}` : ''}. This cannot be undone.`,
        confirmLabel: 'Delete it',
    });
    if (!ok) return;

    const wasOpen = doc.id === id;
    docs = docs.filter((x) => x.id !== id);
    if (!docs.length) docs = [blankDoc()];
    if (wasOpen) openDoc(docsByRecency()[0]);
    else { renderDocsMenu(); save(true); }
    toast('Message deleted', 'ok');
}

function exportDoc() {
    download(`${safeName()}.smartwriter.json`,
        JSON.stringify({ app: 'smartwriter', v: 2, doc }, null, 2), 'application/json');
}

/** Accepts a single document, a whole library, or a bare document object. */
function importFiles(files) {
    let opened = null, added = 0, bad = 0;
    let pending = files.length;
    const finish = () => {
        if (--pending) return;
        if (opened) openDoc(opened);
        renderDocsMenu();
        save(true);
        if (added) toast(added === 1 ? 'Message opened' : `${added} messages added`, 'ok');
        if (bad) toast(bad === 1 ? 'One file was not a Smart Writer message' : `${bad} files could not be read`, 'warn');
    };

    for (const f of files) {
        const r = new FileReader();
        r.onload = () => {
            try {
                const parsed = JSON.parse(r.result);
                const incoming = Array.isArray(parsed.docs) ? parsed.docs : [parsed.doc || parsed];
                const usable = incoming.filter((d) => d && Array.isArray(d.sections));
                if (!usable.length) throw new Error('bad shape');
                for (const d of usable) {
                    const clean = migrate(d);
                    // A re-import of something already here must not collide with it.
                    if (docs.some((x) => x.id === clean.id)) clean.id = uid('d');
                    docs.push(clean);
                    added++;
                    if (!opened) opened = clean;
                }
            } catch (err) { bad++; }
            finish();
        };
        r.onerror = () => { bad++; finish(); };
        r.readAsText(f);
    }
}

function docsMenuAction(act) {
    switch (act) {
        case 'new': adoptDoc(blankDoc(), 'New message started'); $('#doc-title').select(); break;
        case 'guide': closeMenus(); openGuide(false, 'new'); break;
        case 'sample': adoptDoc(sampleDoc(), 'Example message opened'); break;
        case 'duplicate': duplicateDoc(); break;
        case 'export': exportDoc(); break;
        case 'import': $('#file-input').click(); break;
    }
}

/* ── Model helpers ──────────────────────────────────────────── */
const getSection = (id) => doc.sections.find((s) => s.id === id);
const activeVariant = (s) => s.variants[clamp(s.active, 0, s.variants.length - 1)];
const activeText = (s) => activeVariant(s).text;
const varKey = (i) => (i < 26 ? VAR_KEYS[i] : `${i + 1}`);
const JOIN_SEP = { para: '\n\n', line: '\n', space: ' ' };

function assembleParts() {
    const parts = [];
    for (const s of doc.sections) {
        if (!s.enabled) continue;
        const text = activeText(s).replace(/\s+$/, '').replace(/^\n+/, '');
        if (!text.trim()) continue;
        parts.push({ section: s, text });
    }
    return parts;
}

function assemble() {
    const parts = assembleParts();
    return parts.map((p, i) => (i === 0 ? p.text : JOIN_SEP[p.section.join] + p.text)).join('');
}

function comboCount() {
    let n = 1;
    for (const s of doc.sections) {
        if (!s.enabled || s.locked) continue;
        n *= Math.max(1, s.variants.length);
        if (n > 1e18) return Infinity;
    }
    return n;
}

/* ═══ RENDERING ═════════════════════════════════════════════ */

/** Rebuild the section list, reusing existing cards so typing is never interrupted. */
function renderSections() {
    const host = $('#sections');
    const seen = new Set();

    // Drop cards for sections that no longer exist.
    for (const [id, el] of cards) {
        if (!doc.sections.some((s) => s.id === id)) { el.remove(); cards.delete(id); }
    }

    doc.sections.forEach((s, i) => {
        seen.add(s.id);
        let el = cards.get(s.id);
        if (!el) { el = buildCard(s); cards.set(s.id, el); }
        if (host.children[i] !== el) host.insertBefore(el, host.children[i] || null);
        syncCard(s);
    });

    renderOutline();
    renderPreview();
    renderStatus();
}

/* ── Section card ───────────────────────────────────────────── */
function buildCard(section) {
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.id = section.id;
    el.innerHTML = `
      <div class="card-head">
        <div class="drag-handle" draggable="true" title="Drag to reorder">${ICON.grip}</div>
        <div class="sec-index"></div>
        <input class="sec-name" placeholder="Untitled section" spellcheck="false" aria-label="Section name">
        <div class="rotator">
          <button class="rot-btn" data-rot="-1" title="Previous variation (Alt+←)">${ICON.left}</button>
          <span class="rot-label"></span>
          <button class="rot-btn" data-rot="1" title="Next variation (Alt+→)">${ICON.right}</button>
        </div>
        <button class="magic-btn" title="Write three alternatives to this paragraph (Alt+M)">${ICON.magic}</button>
        <button class="lock-btn" title="Lock this section (Alt+L)" aria-pressed="false">${ICON.lock}</button>
        <div class="sec-menu-wrap">
          <button class="icon-btn sm sec-menu-btn" title="Section options">${ICON.dots}</button>
        </div>
      </div>
      <div class="var-strip"></div>
      <div class="editor-wrap">
        <textarea class="editor" rows="1" placeholder="Write this part of the message…" spellcheck="true"></textarea>
        <div class="locked-hint"><span>Locked — unlock to edit</span></div>
      </div>
      <div class="card-foot">
        <input class="var-label" placeholder="Label this variation (e.g. warm, direct, short)" spellcheck="false" aria-label="Variation label">
        <span class="foot-stat"></span>
        <button class="foot-btn" data-act="dup-var" title="Duplicate this variation (Alt+D)">${ICON.copy}<span>Duplicate</span></button>
        <button class="foot-btn danger" data-act="del-var" title="Delete this variation">${ICON.trash}</button>
      </div>`;

    const ta = $('.editor', el);
    const id = section.id;

    /* — editing — */
    ta.addEventListener('input', () => {
        const s = getSection(id);
        if (!s || s.locked) return;
        activeVariant(s).text = ta.value;
        autosize(ta);
        updatePill(s);
        $('.foot-stat', el).textContent = statLine(ta.value);
        renderPreview();
        renderOutline();
        renderStatus();
        save();
        // Any keystroke invalidates the pending suggestions and restarts the wait.
        if (pendingFixes.length) { pendingFixes = []; renderFixChip(); }
        touchIdleTimer();
    });
    ta.addEventListener('focus', () => setFocused(id));
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) return; // let tab move on
    });

    $('.sec-name', el).addEventListener('input', (e) => {
        const s = getSection(id); if (!s) return;
        s.name = e.target.value;
        renderOutline(); renderStatus(); save();
    });
    $('.sec-name', el).addEventListener('focus', () => setFocused(id));

    $('.var-label', el).addEventListener('input', (e) => {
        const s = getSection(id); if (!s) return;
        activeVariant(s).label = e.target.value;
        updatePill(s); save();
    });
    $('.var-label', el).addEventListener('focus', () => setFocused(id));

    /* — rotation & lock — */
    $$('.rot-btn', el).forEach((b) => b.addEventListener('click', () => {
        rotate(id, Number(b.dataset.rot));
    }));
    $('.lock-btn', el).addEventListener('click', () => toggleLock(id));
    $('.magic-btn', el).addEventListener('click', () => magicVariations(id));

    /* — variant strip — */
    $('.var-strip', el).addEventListener('click', (e) => {
        const pill = e.target.closest('.var-pill');
        const add = e.target.closest('.var-add');
        const s = getSection(id); if (!s) return;
        if (add) { addVariant(id); return; }
        if (pill) {
            if (s.locked) { bumpLock(el); return; }
            selectVariant(id, Number(pill.dataset.i));
        }
    });

    /* — footer actions — */
    $('.card-foot', el).addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'dup-var') duplicateVariant(id);
        if (b.dataset.act === 'del-var') deleteVariant(id);
    });

    /* — options menu — */
    $('.sec-menu-btn', el).addEventListener('click', (e) => {
        e.stopPropagation();
        openSectionMenu(id, $('.sec-menu-wrap', el));
    });

    /* — focus ring & drag — */
    el.addEventListener('mousedown', () => setFocused(id), true);
    wireDrag(el, id);

    return el;
}

function statLine(text) {
    const w = countWords(text);
    return `${w} word${w === 1 ? '' : 's'} · ${text.length}`;
}

function syncCard(s) {
    const el = cards.get(s.id); if (!el) return;
    const i = doc.sections.indexOf(s);

    el.classList.toggle('locked', s.locked);
    el.classList.toggle('muted', !s.enabled);
    el.classList.toggle('focused', focusedSection === s.id);

    $('.sec-index', el).textContent = i + 1;
    const nameEl = $('.sec-name', el);
    if (nameEl.value !== s.name && document.activeElement !== nameEl) nameEl.value = s.name;

    const many = s.variants.length > 1;
    $('.rot-label', el).textContent = `${varKey(s.active)} / ${s.variants.length}`;
    $$('.rot-btn', el).forEach((b) => { b.disabled = s.locked || !many; });

    const lockBtn = $('.lock-btn', el);
    lockBtn.setAttribute('aria-pressed', String(s.locked));
    lockBtn.title = s.locked ? 'Unlock this section (Alt+L)' : 'Lock this section (Alt+L)';

    const ta = $('.editor', el);
    const v = activeVariant(s);
    if (ta.value !== v.text) { ta.value = v.text; }
    ta.readOnly = s.locked;
    autosize(ta);

    const lab = $('.var-label', el);
    if (document.activeElement !== lab) lab.value = v.label || '';
    lab.readOnly = s.locked;

    $('.foot-stat', el).textContent = statLine(v.text);
    $('[data-act="del-var"]', el).disabled = s.variants.length <= 1;
    $('[data-act="del-var"]', el).style.opacity = s.variants.length <= 1 ? .3 : '';

    renderVarStrip(s, el);
}

function renderVarStrip(s, el) {
    const strip = $('.var-strip', el);
    strip.innerHTML =
        s.variants.map((v, i) => {
            const preview = (v.label || v.text.replace(/\s+/g, ' ').trim()).slice(0, 34);
            const empty = !v.label && !v.text.trim();
            // `fresh` is set once, by the model, so the new pill announces itself.
            const isNew = v.fresh; if (isNew) delete v.fresh;
            return `<button class="var-pill${i === s.active ? ' active' : ''}${isNew ? ' fresh' : ''}" data-i="${i}"
                      title="${esc(v.label || v.text.slice(0, 140) || 'Empty variation')}">
                      <span class="vp-key">${varKey(i)}</span>
                      <span class="vp-text${empty ? ' vp-empty' : ''}">${esc(empty ? 'empty' : preview)}</span>
                    </button>`;
        }).join('') +
        (s.variants.length < MAX_VARIANTS
            ? `<button class="var-add" title="Add a variation (Alt+N)">${ICON.plus}</button>`
            : '') +
        `<span class="var-strip-spacer"></span>` +
        `<span class="var-count">${s.variants.length} of ${MAX_VARIANTS}</span>`;
}

function updatePill(s) {
    const el = cards.get(s.id); if (!el) return;
    renderVarStrip(s, el);
}

function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(40, ta.scrollHeight) + 'px';
}

function setFocused(id) {
    if (focusedSection === id) return;
    const prev = focusedSection;
    focusedSection = id;
    if (prev && cards.get(prev)) cards.get(prev).classList.remove('focused');
    if (cards.get(id)) cards.get(id).classList.add('focused');
    renderOutline();
}

function bumpLock(el) {
    const b = $('.lock-btn', el);
    b.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
        { duration: 240, easing: 'ease-in-out' }
    );
}

/* ── Section operations ─────────────────────────────────────── */
function rotate(id, dir) {
    const s = getSection(id); if (!s || s.locked || s.variants.length < 2) return;
    const next = (s.active + dir + s.variants.length) % s.variants.length;
    selectVariant(id, next, true);
}

function selectVariant(id, index, animate = false) {
    const s = getSection(id); if (!s || s.locked) return;
    if (index === s.active) return;
    s.active = clamp(index, 0, s.variants.length - 1);

    const el = cards.get(id);
    if (el && animate) {
        const wrap = $('.editor-wrap', el);
        wrap.classList.add('swap');
        setTimeout(() => { syncCard(s); wrap.classList.remove('swap'); }, 140);
    } else if (el) {
        syncCard(s);
    }
    renderPreview(); renderOutline(); renderStatus(); save();
}

function toggleLock(id) {
    const s = getSection(id); if (!s) return;
    s.locked = !s.locked;
    syncCard(s); renderOutline(); renderPreview(); renderStatus(); save();
    toast(s.locked ? `"${s.name || 'Section'}" locked to ${varKey(s.active)}` : `"${s.name || 'Section'}" unlocked`, s.locked ? 'lock' : 'ok');
}

/** A locked section is settled: nothing about it changes until you unlock it. */
function refuseIfLocked(s) {
    if (!s.locked) return false;
    const el = cards.get(s.id);
    if (el) bumpLock(el);
    toast('That section is locked — unlock it first', 'lock');
    return true;
}

function atCap(s) {
    if (s.variants.length < MAX_VARIANTS) return false;
    toast(`${MAX_VARIANTS} is plenty — more options rarely means a better message`, 'warn');
    return true;
}

function addVariant(id, text = '', label = '') {
    const s = getSection(id); if (!s) return;
    if (refuseIfLocked(s)) return;
    if (atCap(s)) return;
    s.variants.push({ id: uid('v'), label, text });
    s.active = s.variants.length - 1;
    syncCard(s); renderOutline(); renderPreview(); renderStatus(); save();
    const el = cards.get(id);
    if (el) { const ta = $('.editor', el); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function duplicateVariant(id) {
    const s = getSection(id); if (!s) return;
    const v = activeVariant(s);
    addVariant(id, v.text, v.label ? `${v.label} (copy)` : '');
}

function deleteVariant(id) {
    const s = getSection(id); if (!s || s.variants.length <= 1) return;
    if (refuseIfLocked(s)) return;
    s.variants.splice(s.active, 1);
    s.active = clamp(s.active, 0, s.variants.length - 1);
    syncCard(s); renderOutline(); renderPreview(); renderStatus(); save();
}

function addSection(afterId = null, focus = true) {
    const s = newSection('');
    const at = afterId ? doc.sections.findIndex((x) => x.id === afterId) + 1 : doc.sections.length;
    doc.sections.splice(at, 0, s);
    renderSections(); save();
    if (focus) {
        const el = cards.get(s.id);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        $('.sec-name', el).focus();
        setFocused(s.id);
    }
    return s;
}

function deleteSection(id) {
    const i = doc.sections.findIndex((s) => s.id === id);
    if (i < 0) return;
    if (doc.sections.length === 1) { toast('A message needs at least one section', 'warn'); return; }
    const [removed] = doc.sections.splice(i, 1);
    if (focusedSection === id) focusedSection = null;
    renderSections(); save();
    toast(`Removed "${removed.name || 'section'}"`, 'ok');
}

function moveSection(id, dir) {
    const i = doc.sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= doc.sections.length) return;
    const [s] = doc.sections.splice(i, 1);
    doc.sections.splice(j, 0, s);
    renderSections(); save();
    cards.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function reorder(dragId, targetId, after) {
    if (dragId === targetId) return;
    const from = doc.sections.findIndex((s) => s.id === dragId);
    if (from < 0) return;
    const [s] = doc.sections.splice(from, 1);
    let to = doc.sections.findIndex((x) => x.id === targetId);
    if (to < 0) to = doc.sections.length - 1;
    doc.sections.splice(to + (after ? 1 : 0), 0, s);
    renderSections(); save();
}

function rerollUnlocked() {
    let changed = 0;
    for (const s of doc.sections) {
        if (s.locked || !s.enabled || s.variants.length < 2) continue;
        let next = s.active;
        while (next === s.active) next = Math.floor(Math.random() * s.variants.length);
        s.active = next;
        changed++;
        const el = cards.get(s.id);
        if (el) {
            const wrap = $('.editor-wrap', el);
            wrap.classList.add('swap');
            setTimeout(() => { syncCard(s); wrap.classList.remove('swap'); }, 140);
        }
    }
    renderPreview(); renderOutline(); renderStatus(); save();
    toast(changed ? `Rerolled ${changed} section${changed === 1 ? '' : 's'}` : 'Nothing to reroll — everything is locked or single-variation', changed ? 'ok' : 'warn');
}

function setAllLocks(locked) {
    doc.sections.forEach((s) => { s.locked = locked; syncCard(s); });
    renderOutline(); renderStatus(); save();
    toast(locked ? 'All sections locked' : 'All sections unlocked', locked ? 'lock' : 'ok');
}

/* ═══ PROOFREADER ═══════════════════════════════════════════
   Deliberately rule-based, not model-based. A language model asked to "fix
   typos" will quietly rewrite sentences you chose on purpose; these rules only
   ever touch mechanics, so applying them is safe and reversible by eye.
   ═══════════════════════════════════════════════════════════ */

const MISSPELLINGS = {
    teh: 'the', adn: 'and', taht: 'that', thta: 'that', wich: 'which', recieve: 'receive',
    recieved: 'received', seperate: 'separate', seperated: 'separated', definately: 'definitely',
    occured: 'occurred', occuring: 'occurring', thier: 'their', freind: 'friend', wierd: 'weird',
    untill: 'until', becuase: 'because', beleive: 'believe', beleived: 'believed', greatful: 'grateful',
    buisness: 'business', sucessful: 'successful', succesful: 'successful', embarass: 'embarrass',
    neccessary: 'necessary', necessarry: 'necessary', accomodate: 'accommodate', acommodate: 'accommodate',
    publically: 'publicly', arguement: 'argument', independant: 'independent', occassion: 'occasion',
    apparant: 'apparent', rythm: 'rhythm', sincerly: 'sincerely', tommorow: 'tomorrow', tommorrow: 'tomorrow',
    calender: 'calendar', adress: 'address', appologise: 'apologise', gaurd: 'guard',
    goverment: 'government', enviroment: 'environment', existance: 'existence', maintainance: 'maintenance',
    perseverence: 'perseverance', priviledge: 'privilege', questionaire: 'questionnaire', refered: 'referred',
    relevent: 'relevant', responsability: 'responsibility', seige: 'siege', supercede: 'supersede',
    threshhold: 'threshold', truely: 'truly', unfortunatly: 'unfortunately', wheras: 'whereas',
    writting: 'writing', yeild: 'yield', alot: 'a lot', infact: 'in fact', inspite: 'in spite',
};

/** Every rule returns {index, from, to, why} matches against one text. */
function scanText(text) {
    const found = [];
    const add = (index, from, to, why) => { if (from !== to) found.push({ index, from, to, why }); };

    // Repeated spaces inside a line
    for (const m of text.matchAll(/[^\S\n]{2,}/g)) add(m.index, m[0], ' ', 'double space');

    // Space before , . ! ? ; :
    for (const m of text.matchAll(/[^\S\n]+([,.!?;:])/g)) add(m.index, m[0], m[1], 'stray space');

    // Missing space after , ; : — and after . ! ? when a capitalised word follows.
    for (const m of text.matchAll(/([,;:])(?=[A-Za-z])/g)) add(m.index, m[1], m[1] + ' ', 'missing space');
    for (const m of text.matchAll(/([.!?])(?=[A-Z][a-z])/g)) add(m.index, m[1], m[1] + ' ', 'missing space');

    // Doubled word
    for (const m of text.matchAll(/\b(\w+)(\s+)\1\b/gi)) {
        if (/^(had|that|is|the)$/i.test(m[1])) continue;   // "had had", "that that" can be correct
        add(m.index, m[0], m[1], 'repeated word');
    }

    // Standalone lowercase i
    for (const m of text.matchAll(/\bi\b(?!\.[a-z])/g)) add(m.index, 'i', 'I', 'capitalise I');

    // Known misspellings, preserving the original capitalisation
    for (const m of text.matchAll(/\b[A-Za-z]{2,}\b/g)) {
        const fix = MISSPELLINGS[m[0].toLowerCase()];
        if (!fix) continue;
        const cased = /^[A-Z]/.test(m[0]) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix;
        add(m.index, m[0], cased, 'spelling');
    }

    // Sentence starting lowercase (skip the very start of a paragraph run-on)
    for (const m of text.matchAll(/([.!?]\s+)([a-z])/g)) {
        add(m.index + m[1].length, m[2], m[2].toUpperCase(), 'capitalise sentence');
    }

    // Trailing spaces at the end of a line
    for (const m of text.matchAll(/[^\S\n]+$/gm)) add(m.index, m[0], '', 'trailing space');

    // Overlapping rules would corrupt each other on apply — keep the first per index.
    found.sort((a, b) => a.index - b.index || b.from.length - a.from.length);
    const kept = [];
    let end = -1;
    for (const f of found) {
        if (f.index < end) continue;
        kept.push(f);
        end = f.index + f.from.length;
    }
    return kept;
}

/** Scan the whole document. Locked sections are settled, so they are skipped. */
function proofreadDoc() {
    const fixes = [];
    for (const s of doc.sections) {
        if (s.locked || !s.enabled) continue;
        const v = activeVariant(s);
        for (const f of scanText(v.text)) {
            fixes.push({ ...f, sectionId: s.id, variantId: v.id, sectionName: s.name || 'Untitled' });
        }
    }
    return fixes;
}

function applyFix(fix) {
    const s = getSection(fix.sectionId); if (!s || s.locked) return false;
    const v = s.variants.find((x) => x.id === fix.variantId); if (!v) return false;
    if (v.text.substr(fix.index, fix.from.length) !== fix.from) return false;  // text moved under us
    v.text = v.text.slice(0, fix.index) + fix.to + v.text.slice(fix.index + fix.from.length);
    return true;
}

function applyFixes(list) {
    // Right to left within each variant, so earlier offsets stay valid.
    const byVariant = new Map();
    for (const f of list) {
        if (!byVariant.has(f.variantId)) byVariant.set(f.variantId, []);
        byVariant.get(f.variantId).push(f);
    }
    let n = 0;
    for (const group of byVariant.values()) {
        group.sort((a, b) => b.index - a.index);
        for (const f of group) if (applyFix(f)) n++;
    }
    if (n) {
        doc.sections.forEach(syncCard);
        renderPreview(); renderOutline(); renderStatus(); save();
    }
    return n;
}

let idleTimer = null;
function touchIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(runProofread, IDLE_PROOFREAD_MS);
}

function runProofread(manual = false) {
    const fixes = proofreadDoc();

    if (ui.autofix && fixes.length && !manual) {
        const n = applyFixes(fixes);
        pendingFixes = [];
        renderFixChip();
        if (n) toast(`Quietly fixed ${n} thing${n === 1 ? '' : 's'}`, 'ok');
        return;
    }

    pendingFixes = fixes;
    renderFixChip();
    if (manual) {
        if (!fixes.length) toast('Nothing to fix — the spelling and spacing look clean', 'ok');
        else openFixPanel();
    }
}

function renderFixChip() {
    const chip = $('#fix-chip');
    const n = pendingFixes.length;
    chip.hidden = n === 0;
    $('#fix-chip-text').textContent = `${n} fix${n === 1 ? '' : 'es'}`;
    if (!n) $('#fix-panel').hidden = true;
}

function openFixPanel() {
    const panel = $('#fix-panel');
    if (!pendingFixes.length) { panel.hidden = true; return; }
    panel.hidden = false;
    $('#fix-panel-title').textContent = `${pendingFixes.length} suggested fix${pendingFixes.length === 1 ? '' : 'es'}`;
    $('#fix-list').innerHTML = pendingFixes.map((f, i) => `
        <div class="fix-item" data-i="${i}">
          <span class="fix-where" title="In “${esc(f.sectionName)}”">${esc(f.why)}</span>
          <span class="fix-change">
            <span class="fix-from">${esc(showWhitespace(f.from))}</span>
            <span class="fix-arrow">→</span>
            <span class="fix-to">${esc(showWhitespace(f.to))}</span>
          </span>
          <button class="fix-apply" data-apply="${i}">Fix</button>
        </div>`).join('');
    $('#chk-autofix').checked = ui.autofix;
}

const showWhitespace = (s) => s === '' ? '(nothing)' : s.replace(/\n/g, '⏎').replace(/ /g, '·');

/* ═══ SIGNALS ═══════════════════════════════════════════════
   Counts, not scores. The brief is explicit that a tone meter becomes a new
   thing to obsess over; a plain count of how many times you apologised is a
   fact you can act on or ignore.
   ═══════════════════════════════════════════════════════════ */
const SIGNALS = [
    { key: 'apologies', label: 'apologies', one: 'apology', re: /\b(sorry|apologi[sz]e[sd]?|apologies|my (bad|fault)|forgive me)\b/gi },
    { key: 'hedges', label: 'hedges', one: 'hedge', re: /\b(just|maybe|perhaps|possibly|somewhat|kind of|sort of|a bit|slightly|hopefully)\b/gi },
    // "I just think" is a qualifier too, so allow a hedge to sit in the middle.
    { key: 'qualifiers', label: 'qualifiers', one: 'qualifier', re: /\b(?:i\s+(?:just\s+|really\s+|kind of\s+)?(?:think|guess|believe|feel like|wonder)|i'?m not sure|if that'?s (?:ok|okay|alright)|no worries if|feel free to|does that (?:work|make sense))\b/gi },
    { key: 'passive', label: 'passive-ish', one: 'passive-ish', re: /\b(?:was|were|is|are|been|being)\s+\w+(?:ed|en)\b/gi },
];

function countSignals(text) {
    const out = {};
    for (const s of SIGNALS) out[s.key] = (text.match(s.re) || []).length;
    return out;
}

/** Flesch–Kincaid grade — a coarse but honest readability number. */
function readingGrade(text) {
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || [text]).filter((s) => s.trim()).length || 1;
    const words = (text.match(/[A-Za-z']+/g) || []);
    if (!words.length) return 0;
    const syllables = words.reduce((a, w) => a + syllableCount(w), 0);
    return Math.max(1, Math.round(0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59));
}

function syllableCount(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return 1;
    const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
    return groups ? groups.length : 1;
}

/** The signal patterns are English; say so rather than showing a misleading zero. */
function nonEnglish(text) {
    const forced = doc.brief?.language;
    if (forced) return forced !== 'en';
    const guess = detectLanguage(text);
    return !!guess && guess.code !== 'en';
}

/** Shows what the model will be told to write in — click to change it. */
function languageChip(text) {
    const forced = doc.brief?.language && LANG_BY_CODE.get(doc.brief.language);
    const guess = forced ? null : detectLanguage(text);
    const label = forced ? forced.name : (guess ? guess.name : 'language unclear');
    return `<button class="sig-chip lang-chip" data-lang-chip="1"
             title="${forced ? 'Set explicitly' : 'Detected from what you have written'} — click to change">
             ${esc(label)}${forced ? '' : ' <span class="lang-auto">auto</span>'}</button>`;
}

function renderSignals() {
    const strip = $('#signals-strip');
    strip.hidden = !ui.signals;
    $('#btn-signals').classList.toggle('on', ui.signals);
    if (!ui.signals) { if (activeSignal) { activeSignal = null; renderPreview(); } return; }

    const text = assemble();
    const counts = countSignals(text);
    strip.innerHTML =
        SIGNALS.map((s) => `<button class="sig-chip${counts[s.key] ? '' : ' zero'}${activeSignal === s.key ? ' on' : ''}" data-sig="${s.key}">
            <b>${counts[s.key]}</b> ${esc(counts[s.key] === 1 ? s.one : s.label)}</button>`).join('') +
        `<span class="sig-chip zero"><b>${readingGrade(text)}</b> reading grade</span>` +
        languageChip(text) +
        `<span class="sig-note">${nonEnglish(text)
            ? 'Counts, not judgements — but these patterns only recognise English wording, so they read low here.'
            : 'Counts, not judgements. Click one to see where it appears.'}</span>`;
}

/* ═══ GUIDE MODE ════════════════════════════════════════════ */

/* Structures for the message shapes people actually get stuck on. Chosen by
   keyword from the stated goal, and used whether or not the model is running —
   Guide mode has to work with the AI switched off. */
const SCAFFOLDS = [
    {
        key: 'apology', match: /\b(?:apolog\w*|sorry|forgive\w*|mistake|messed up|screwed up|my fault|let (?:you|them) down)\b/i,
        title: 'Apology', sections: ['Greeting', 'What happened', 'Taking responsibility', 'What I am doing about it', 'What I am asking for', 'Sign-off'],
    },
    {
        key: 'date', match: /\b(?:date|dinner|drinks|coffee|ask (?:her|him|them) out|romantic|see you again)\b/i,
        title: 'Invitation', sections: ['Greeting', 'The connection', 'The invitation', 'An easy way to say no', 'Sign-off'],
    },
    {
        key: 'investor', match: /\b(?:invest\w*|vc|funding|pitch|cap table|seed round|series [a-c])\b/i,
        title: 'Investor outreach', sections: ['Greeting', 'The hook', 'What we do', 'Why now', 'The ask', 'Sign-off'],
    },
    {
        key: 'clarify', match: /\b(?:clarif\w*|confus\w*|unclear|understand\w*|explain\w*|what (?:did|do) you mean|question about)\b/i,
        title: 'Request for clarity', sections: ['Greeting', 'The context', 'What I am unsure about', 'My specific question', 'Sign-off'],
    },
    {
        key: 'decline', match: /\b(?:declin\w*|turn(?:ing)? down|say no|reject\w*|pass on|cannot make|can't make|withdraw\w*)\b/i,
        title: 'Declining', sections: ['Greeting', 'Thanks for the offer', 'The answer', 'A short reason', 'Leaving the door open', 'Sign-off'],
    },
    {
        key: 'chase', match: /\b(?:follow(?:ing)? up|chas\w*|remind\w*|still waiting|haven't heard|no reply|nudge)\b/i,
        title: 'Following up', sections: ['Greeting', 'The reminder', 'Why it matters now', 'The specific ask', 'Sign-off'],
    },
    {
        key: 'ask', match: /.*/,
        title: 'The ask', sections: ['Greeting', 'Opening', 'The ask', 'Why you', 'Close', 'Sign-off'],
    },
];

const pickScaffold = (goal) => SCAFFOLDS.find((s) => s.match.test(goal || '')) || SCAFFOLDS[SCAFFOLDS.length - 1];

/* Fields that hold a set rather than a single answer. A message can be warm
   *and* enthusiastic; it cannot be two lengths. */
const MULTI_FIELDS = new Set(['relationship', 'followUp', 'tone']);

const asList = (v) => Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []);

function joinList(arr) {
    const a = asList(arr);
    if (a.length <= 1) return a[0] || '';
    return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

/* These answers are sentence-cased buttons that get dropped mid-sentence, so
   only the opening letter comes down — lowercasing the lot turns "Someone I
   met once" into "someone i met once". */
const softLower = (s) => s ? s.charAt(0).toLowerCase() + s.slice(1) : '';
const joinListSoft = (arr) => joinList(asList(arr).map(softLower));

const GUIDE_STEPS = [
    {
        key: 'recipient',
        q: 'Who are you writing to?',
        hint: 'A first name is enough. It is used to address the message and to show you how it will land.',
        input: { field: 'recipient', placeholder: 'Dana' },
        chips: {
            field: 'relationship', label: 'How do you know them?', multi: true,
            options: ['A colleague', 'My manager', 'A close friend', 'Someone I met once', 'A stranger', 'A client', 'An investor', 'Family', 'An ex'],
        },
        required: 'recipient',
    },
    {
        key: 'goal',
        q: 'What do you need to happen?',
        hint: 'One sentence, in your own words. This is the thing the whole message has to earn.',
        area: { field: 'goal', placeholder: 'Ask them to meet for 20 minutes about a possible pilot' },
        chips: {
            field: 'goal', label: 'Or start from one of these', fills: true,
            options: ['Ask them on a date', 'Request a meeting with an investor', 'Explain a mistake I made',
                'Ask for forgiveness', 'Ask for clarification on something', 'Ask for a raise',
                'Turn down an offer politely', 'Chase a reply I never got'],
        },
        required: 'goal',
    },
    {
        key: 'followUp',
        q: 'How should they follow up?',
        hint: 'Saying this plainly is the single biggest thing that gets messages answered. Pick as many as apply.',
        chips: {
            field: 'followUp', label: 'What you want back', multi: true,
            options: ['Reply whenever they can', 'Reply by a specific date', 'Book a call', 'Just a yes or no',
                'Send me a document', 'Nothing — they just need to know'],
        },
        input: { field: 'followUpNote', placeholder: 'Anything more specific? (optional)' },
    },
    {
        key: 'voice',
        q: 'How should it sound?',
        hint: 'Pick as many tones as you want — a blend of warm and direct is a real thing to aim for.',
        chips: { field: 'tone', label: 'Tone — combine freely', multi: true, options: ['Warm', 'Neutral', 'Direct', 'Apologetic', 'Enthusiastic', 'Formal', 'Playful'] },
        chips2: { field: 'length', label: 'Length — pick one', options: ['Very short', 'Short', 'Medium'] },
        summary: true,
    },
];

let guideDraft = null;
let guideStep = 0;
let guideWantsDraft = false;   // waiting on a model before drafting
let guideMode = 'new';         // 'new' starts a message; 'edit' revises this one

const docHasWords = (d = doc) => d.sections.some((s) => s.variants.some((v) => v.text.trim()));

/**
 * `resume` keeps half-finished answers when the wizard was closed by accident.
 * `mode` decides what the last step offers: opening the wizard on a message you
 * have already written is a request to revise the brief, not to throw it away.
 */
function openGuide(resume = true, mode = null) {
    if (!resume || !guideDraft) {
        guideDraft = Object.assign(blankBrief(), doc.brief || {});
        guideStep = 0;
        guideMode = mode || (docHasWords() ? 'edit' : 'new');
    } else if (mode) {
        guideMode = mode;
    }
    renderGuide();
}

function guideSummary() {
    const b = guideDraft;
    const rows = [
        ['Writing to', b.recipient + (asList(b.relationship).length ? ` · ${joinListSoft(b.relationship)}` : '')],
        ['So that', b.goal],
        ['You want', joinList(b.followUp)],
    ].filter(([, v]) => String(v || '').trim());
    return `<div class="wiz-summary">${rows.map(([k, v]) =>
        `<div class="wiz-sum-row"><span class="wiz-sum-key">${esc(k)}</span><span class="wiz-sum-val">${esc(v)}</span></div>`).join('')}</div>`;
}

function renderGuide() {
    const step = GUIDE_STEPS[guideStep];
    const last = guideStep === GUIDE_STEPS.length - 1;

    const body = document.createElement('div');
    const isOn = (field, o) => MULTI_FIELDS.has(field)
        ? asList(guideDraft[field]).includes(o)
        : guideDraft[field] === o;

    const chipBlock = (cfg) => cfg ? `
        <div class="chip-label">${esc(cfg.label)}</div>
        <div class="chip-row" data-field="${cfg.field}"${cfg.fills ? ' data-fills="1"' : ''}>
          ${cfg.options.map((o) => `<button class="chip${isOn(cfg.field, o) ? ' on' : ''}" data-val="${esc(o)}">${esc(o)}</button>`).join('')}
        </div>` : '';

    body.innerHTML = `
        <div class="wiz-steps">${GUIDE_STEPS.map((_, i) =>
            `<span class="wiz-pip ${i < guideStep ? 'done' : i === guideStep ? 'now' : ''}"></span>`).join('')}</div>
        <div class="wiz-q">${esc(step.q)}</div>
        <div class="wiz-hint">${esc(step.hint)}</div>
        ${step.summary ? guideSummary() : ''}
        ${step.area ? `<textarea class="wiz-area" data-field="${step.area.field}" placeholder="${esc(step.area.placeholder)}">${esc(guideDraft[step.area.field] || '')}</textarea>` : ''}
        ${step.input ? `<input class="wiz-input" data-field="${step.input.field}" placeholder="${esc(step.input.placeholder)}" value="${esc(guideDraft[step.input.field] || '')}">` : ''}
        ${chipBlock(step.chips)}
        ${chipBlock(step.chips2)}`;

    body.addEventListener('input', (e) => {
        const f = e.target.dataset.field;
        if (f) guideDraft[f] = e.target.value;
    });

    body.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip'); if (!chip) return;
        const row = chip.closest('.chip-row');
        const field = row.dataset.field;
        const val = chip.dataset.val;

        if (row.dataset.fills) {
            // These chips seed the textarea rather than being an answer themselves.
            guideDraft[field] = val;
            const area = $('.wiz-area', body);
            if (area) { area.value = val; area.focus(); }
        } else if (MULTI_FIELDS.has(field)) {
            const cur = asList(guideDraft[field]);
            guideDraft[field] = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val];
        } else {
            guideDraft[field] = guideDraft[field] === val ? '' : val;
        }
        $$('.chip', row).forEach((c) => c.classList.toggle('on', isOn(field, c.dataset.val)));
    });

    // Enter moves on from the single-line fields, as in any other form.
    body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('wiz-input')) {
            e.preventDefault();
            // On the last step, Enter takes the option that needs no model.
            const want = !last ? 'next'
                : SmartAI.status === 'ready' ? 'draft'
                    : guideMode === 'edit' ? 'brief' : 'structure';
            $(`[data-a="${want}"]`, foot)?.click();
        }
    });

    const aiReady = SmartAI.status === 'ready';
    const editing = guideMode === 'edit';
    const foot = document.createElement('div');
    foot.innerHTML = `
        ${guideStep > 0 ? '<button class="btn ghost" data-a="back">Back</button>' : ''}
        <span class="spacer"></span>
        ${last
            ? `${editing
                ? '<button class="btn ghost" data-a="brief" title="Keep every word you have written — only the brief changes">Update the brief</button>'
                : '<button class="btn ghost" data-a="structure">Just the structure</button>'}
               <button class="btn primary" data-a="draft" title="${!aiReady
                    ? 'Choose a model first'
                    : editing
                        ? 'Drafts into a new message — this one stays exactly as it is'
                        : 'Write the words with the local model'}">
                 ${aiReady ? (editing ? 'Draft a new message' : 'Write a first draft') : 'Turn on a model & draft'}</button>`
            : '<button class="btn primary" data-a="next">Continue</button>'}`;

    foot.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'back') { guideStep--; renderGuide(); }
        if (a === 'next') {
            if (step.required && !String(guideDraft[step.required] || '').trim()) {
                const el = $(`[data-field="${step.required}"]`, body);
                if (el) { el.focus(); el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 220 }); }
                return;
            }
            guideStep++; renderGuide();
        }
        if (a === 'structure') applyGuide(false);
        if (a === 'brief') applyBriefOnly();
        if (a === 'draft') {
            if (SmartAI.status === 'ready') { applyGuide(true); return; }
            // Never a dead end: hand over to the model picker and come back.
            guideWantsDraft = true;
            toast('Pick a model — your answers are kept', 'ok');
            openAIPanel();
        }
    });

    openModal({ title: 'Guide me', body, foot, wide: true });
    const first = $('.wiz-input, .wiz-area', body);
    if (first) setTimeout(() => first.focus(), 30);
}

/** The answers, tidied into the shape a brief is stored in. */
function settleGuideDraft() {
    const b = guideDraft;
    if (b.followUpNote && b.followUpNote.trim()) {
        b.followUp = [...asList(b.followUp), b.followUpNote.trim()];
    }
    delete b.followUpNote;
    for (const f of MULTI_FIELDS) b[f] = asList(b[f]);
    return b;
}

/** Revising the brief of a message you have already written changes nothing else. */
function applyBriefOnly() {
    doc.brief = settleGuideDraft();
    closeModal();
    guideDraft = null;
    guideStep = 0;
    renderStatus(); renderPreview(); save(true);
    toast('Brief updated — your words are untouched', 'ok');
}

/**
 * Turn the answers into a document — with the model if asked, otherwise a
 * scaffold. Always a *new* document: nothing you have already written is
 * overwritten by asking for a draft.
 */
async function applyGuide(useAI) {
    const b = settleGuideDraft();
    const scaffold = pickScaffold(b.goal);
    const fresh = {
        id: uid('d'),
        title: b.recipient ? `${scaffold.title} — ${b.recipient}` : scaffold.title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        brief: b,
        sections: [],
        versions: [],
    };

    closeModal();

    let parts = null;
    if (useAI && SmartAI.status === 'ready') {
        toast('Writing a first draft…', 'ok');
        setAIStatus('Drafting the message…');
        try {
            parts = await draftFromBrief(b);
        } catch (err) {
            toast(`The model could not draft it: ${err.message}`, 'warn');
        } finally {
            setAIStatus('');
        }
    }

    if (parts && parts.length) {
        fresh.sections = parts.map((p, i) => {
            const s = newSection(p.name || scaffold.sections[i] || `Part ${i + 1}`);
            s.variants[0].text = p.text;
            return s;
        });
    } else {
        fresh.sections = scaffold.sections.map((name) => {
            const s = newSection(name);
            s.variants[0].text = starterLine(name, b);
            return s;
        });
    }

    adoptDoc(fresh);
    guideDraft = null;                    // answers are on the document now
    guideStep = 0;
    guideMode = 'new';
    toast(parts && parts.length ? 'First draft ready — every section is yours to rewrite' : 'Structure ready — fill in each part', 'ok');
}

/** The couple of lines a scaffold can honestly write for you without a model. */
function starterLine(name, b) {
    const n = name.toLowerCase();
    if (n.includes('greeting')) return b.recipient ? `Hi ${b.recipient},` : 'Hi,';
    if (n.includes('sign-off') || n.includes('sign off')) return 'Best,\n';
    if (n.includes('the ask') || n.includes('asking for')) return b.goal ? `${b.goal.charAt(0).toUpperCase()}${b.goal.slice(1)}.` : '';
    return '';
}

/* ═══ LOCAL MODEL ═══════════════════════════════════════════ */

/** The brief, rendered as context the model can actually use. */
function briefContext(brief) {
    const b = brief || doc.brief || {};
    const bits = [];
    const rel = joinListSoft(b.relationship);
    const follow = joinListSoft(b.followUp);
    const tones = asList(b.tone);

    if (b.recipient) bits.push(`The message is addressed to ${b.recipient}${rel ? ` (${rel})` : ''}.`);
    if (b.goal) bits.push(`What the writer needs: ${b.goal}`);
    if (follow) bits.push(`How the reader should respond: ${follow}`);
    if (tones.length === 1) bits.push(`Tone: ${softLower(tones[0])}.`);
    else if (tones.length > 1) bits.push(`Tone: a blend of ${joinListSoft(tones)} — hold all of them at once rather than picking one.`);
    if (b.length) bits.push(`Length: ${softLower(b.length)}.`);
    return bits.join('\n');
}

const WRITER_SYSTEM =
    'You help someone write a short personal message. You write plainly, like a thoughtful human, ' +
    'never like marketing copy. No emoji, no exclamation marks unless the original had them. ' +
    'Reply with the requested text only — no preamble, no explanation, no quotation marks, no labels.';

/* ── Language ───────────────────────────────────────────────────
   Small models answer in English unless you name the language, so it has to be
   detected rather than implied.

   Danish, Norwegian and Swedish share most of their high-frequency words, so
   counting stopwords cannot separate them — "er", "til", "har", "kan", "var"
   carry no information at all. Two things fix that:

   (1) Every word is weighted by how many of these languages use it. A word
       unique to one language counts fully; one shared by three counts for
       almost nothing. That is computed from the tables below rather than
       hand-tuned, so adding a word to two lists automatically neutralises it.
   (2) Orthography votes both ways. "æ/ø" is evidence for Danish and Norwegian
       and evidence *against* Swedish; "ä/ö" the reverse. Norwegian "sjon/kj/øy"
       against Danish "tion/øj" splits the remaining pair.
   ─────────────────────────────────────────────────────────────── */
const LANG_DEFS = [
    {
        code: 'en', name: 'English',
        words: 'the a an and or of to in is it be as at by on we you he she they them this that these those not are was were been have has had do does did can could will would should may might must there here when where how why what who which our your their his her its more most some any all if then than about after before with without from into over under again very really just only also even still back down out up off other same each both few many much such own so no nor too',
        key: 'the you your would because through please thanks hope something anything everything however therefore whether',
    },
    {
        code: 'da', name: 'Danish',
        words: 'og i at det er en til den for med de på der som han ikke var men et har jeg om du ved kan så vi hvor man når nu hun hvis mere ville skulle kunne lige helt bare her selv alle andre altid aldrig fordi sammen igen først sidste gerne rigtig',
        key: 'af mig dig sig hvad meget tak kære venlig hilsen måske jer kun sådan hvordan hvornår tilbage nogle nogen selvom efter gøre spørgsmål hjælp bruge tale sige blev jeres hende ham dette disse fået '
           + 'undskyld haft svaret næste uge møde mødes arbejde arbejder arbejdet travlt øjeblik lejlighed vej nej noget tusind hedder ligesom stadig snakke svare skrive læse tænker synes gerne sagen bogen tage lave godt',
        marks: [[/[æø]/g, 1.5], [/å/g, .5], [/øj/g, 2.5], [/tion/g, 1.2], [/[äö]/g, -2], [/ck/g, -1.2], [/kj/g, -1.8], [/sjon/g, -2.5], [/[üßñãõ]/g, -2]],
    },
    {
        code: 'nb', name: 'Norwegian',
        words: 'og i at det er en til den for med de på der som han ikke var men et har jeg om du ved kan så vi hvor man når nå hun hvis mer ville skulle kunne helt bare her selv alle andre alltid aldri fordi sammen igjen først siste gjerne riktig',
        key: 'av meg deg seg hva mye takk kjære vennlig kanskje dere sånn hvordan tilbake noen etter gjøre spørsmål hjelp bruke si ble deres henne ham dette disse fått '
           + 'unnskyld hatt svart neste uke møte møtes arbeid arbeider arbeidet travelt øyeblikk leilighet vei nei noe tusen heter liksom fortsatt svare skrive lese tenker synes snakke gjerne saken boken ta lage godt',
        marks: [[/[æø]/g, 1.5], [/å/g, .5], [/kj/g, 2.5], [/øy/g, 2.5], [/sjon/g, 2.5], [/skj/g, 1.8], [/[äö]/g, -2], [/ck/g, -1.2], [/øj/g, -2.5], [/[üßñãõ]/g, -2]],
    },
    {
        code: 'sv', name: 'Swedish',
        words: 'i det en den för med de på som han var men ett har om du kan så vi man när nu hon mer helt här själv alla andra alltid aldrig eftersom tillsammans igen först sista gärna riktigt mig dig sig sådan efter',
        key: 'och är att jag inte till vad mycket kanske tack hej från hur några vill ska skulle kunde hälsningar vänlig väldigt göra fråga hjälpa använda tala säga blev ni era henne honom detta dessa fått bara '
           + 'ursäkta svarat nästa vecka möte mötas arbete arbetar arbetet ögonblick lägenhet väg något tusen heter liksom fortfarande svara skriva läsa tycker tänker prata gärna saken boken göra bra',
        marks: [[/[äö]/g, 1.5], [/å/g, .5], [/ck/g, 1.3], [/[æø]/g, -2.4], [/kj/g, -1.8], [/sjon/g, -2], [/[üßñãõ]/g, -2]],
    },
    {
        code: 'de', name: 'German',
        words: 'und der die das ist ich nicht sie mit für ein eine auf dass zu haben sich wir aber noch sehr von den dem im es auch nur schon wenn oder als bei nach über unter wie was wer war werden kann',
        key: 'ich nicht dass sehr danke hallo würde könnte möchte wäre viele grüße liebe weil damit deshalb müssen dürfen gerne freundlichen',
        marks: [[/[äöü]/g, 1], [/ß/g, 2.5], [/[æøå]/g, -2]],
    },
    {
        code: 'nl', name: 'Dutch',
        words: 'en de het een is ik niet dat van met voor op je we maar ook naar zijn hebben aan te bij als er om nog wel dan uit door over',
        key: 'het niet je jij jullie graag alvast groeten hartelijk omdat zodat misschien kunnen zou willen even hoor mij jou',
        marks: [[/ij/g, 1.2], [/[æøåäö]/g, -2]],
    },
    {
        code: 'fr', name: 'French',
        words: 'le la les de et un une est que pour vous je dans pas avec sur ce qui nous mais au du en il elle ils se ne plus par ou son sa ses comme tout',
        key: 'vous nous merci bonjour cordialement parce pourrais serait beaucoup toutefois êtes très aussi déjà chez',
        marks: [[/[àâçéèêëîïôùûœ]/g, 1.1], [/[æøåäöß]/g, -2]],
    },
    {
        code: 'es', name: 'Spanish',
        words: 'el la los las de y un una es que para yo en no con por se pero su al lo me te lo como más este esta muy todo cuando donde',
        key: 'usted gracias hola saludos porque podría sería quizás también aunque estoy están hacer decir hasta desde',
        marks: [[/[ñ]/g, 2], [/[áíóúü]/g, 1], [/[¿¡]/g, 2.5], [/[æøåäöß]/g, -2]],
    },
    {
        code: 'it', name: 'Italian',
        words: 'il la di e un una che per non con sono ho ti ma anche del nel le gli da si come più quando dove questo questa molto tutto',
        key: 'grazie ciao perché però vorrei sarebbe magari cordiali saluti sono essere fare dire buongiorno',
        marks: [[/[àèéìòù]/g, 1.1], [/[æøåäöß]/g, -2]],
    },
    {
        code: 'pt', name: 'Portuguese',
        words: 'o a os as de e um uma que para não com por se mas também do da em no na ao mais como quando onde este esta muito tudo',
        key: 'você obrigado olá porque poderia seria talvez cumprimentos abraço estou estão fazer dizer até desde',
        marks: [[/[ãõ]/g, 2.5], [/[çáéêó]/g, 1], [/[æøåäöß]/g, -2]],
    },
    {
        code: 'pl', name: 'Polish',
        words: 'i w na nie to jest że się z do ale za jak czy oraz od po by już tylko bardzo co ten ta te jeden',
        key: 'dziękuję cześć proszę ponieważ mógłbym byłoby pozdrawiam jestem będzie który która żeby',
        marks: [[/[ąćęłńśźż]/g, 1.6], [/[æøåäöß]/g, -2]],
    },
    {
        code: 'fi', name: 'Finnish',
        words: 'ja on ei se että minä sinä me mutta olen olisi voi kun niin sitä tai jos vain nyt hyvä kaikki',
        key: 'kiitos hei voisitko koska ehkä terveisin paljon oletko sinulle minulle tässä siitä',
        marks: [[/[äö]/g, .8], [/[æøß]/g, -2], [/(?:nen|sta|ssa|lla|tta)\b/g, 1.2]],
    },
];

/* Weight each word by how many of these languages claim it: a word only one
   language uses is worth its full weight, a word three share is worth almost
   nothing. Derived, not hand-tuned, so the tables stay easy to extend. */
const LANGUAGES = (() => {
    const defs = LANG_DEFS.map((d) => ({
        code: d.code, name: d.name,
        words: new Set((d.words || '').trim().split(/\s+/).filter(Boolean)),
        key: new Set((d.key || '').trim().split(/\s+/).filter(Boolean)),
        marks: d.marks || [],
    }));

    const df = new Map();
    for (const L of defs) {
        for (const w of new Set([...L.words, ...L.key])) df.set(w, (df.get(w) || 0) + 1);
    }
    for (const L of defs) {
        L.weights = new Map();
        for (const w of new Set([...L.words, ...L.key])) {
            const base = L.key.has(w) ? 3 : 1;
            L.weights.set(w, base / Math.pow(df.get(w), 1.7));
        }
    }
    return defs;
})();

const LANG_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Best guess at the language of a piece of text, or null if there is too little to go on. */
function detectLanguage(text) {
    const raw = String(text || '');
    const tokens = raw.toLowerCase().match(/[\p{L}'’-]+/gu) || [];
    if (tokens.length < 4) return null;

    const norm = Math.sqrt(tokens.length);
    const scored = LANGUAGES.map((L) => {
        let s = 0;
        for (const t of tokens) s += L.weights.get(t) || 0;
        for (const [re, weight] of L.marks) {
            s += Math.min((raw.toLowerCase().match(re) || []).length, 5) * weight;
        }
        return { lang: L, score: s / norm };
    }).sort((a, b) => b.score - a.score);

    const [best, next] = scored;
    if (best.score < 0.22) return null;                       // nothing convincing
    if (next && next.score > 0 && best.score < next.score * 1.25) return null;
    return { code: best.lang.code, name: best.lang.name, score: best.score };
}

/**
 * The language to generate in: an explicit choice wins; otherwise read the
 * paragraph, and fall back to the whole message when the paragraph is too
 * short to be readable ("Hej Dana," is four words).
 */
function resolveLanguage(text) {
    const forced = doc.brief?.language;
    if (forced) {
        const L = LANG_BY_CODE.get(forced);
        if (L) return { code: L.code, name: L.name, forced: true };
    }
    return detectLanguage(text) || detectLanguage(assemble()) || null;
}

const languageClause = (lang) => lang
    ? `Write your answer in ${lang.name}. Do not translate it into English.`
    : 'Write your answer in exactly the same language as the paragraph above.';

const writerSystem = (lang) => WRITER_SYSTEM + (lang ? ` You write in ${lang.name} and never switch language.` : '');

/* ── Choosing what the alternatives should be ───────────────────
   "Warmer / more direct / shorter" is the right answer for almost nothing.
   A paragraph that apologises four times needs a different set from a sign-off
   or from an ask nobody could act on. So the directions are chosen for the
   paragraph: the model proposes them, and a rule-based reader stands in when
   the model gives nothing usable.
   ─────────────────────────────────────────────────────────────── */

const ANGLES = {
    fewerApologies: { label: 'apologises once', instruction: 'Keep at most one apology. Remove the rest without becoming cold or defensive.' },
    ownIt: { label: 'owns it', instruction: 'Take responsibility plainly, without excuses or self-criticism, and move straight to what happens next.' },
    dehedge: { label: 'no hedging', instruction: 'Remove every hedge and qualifier — "just", "maybe", "I think", "sort of". Say the same thing plainly.' },
    concrete: { label: 'more concrete', instruction: 'Replace anything vague with specifics: what exactly, by when, and what you want them to do.' },
    easierYes: { label: 'easier to say yes', instruction: 'Lower the cost of agreeing. Make the request smaller, more specific and easier to act on immediately.' },
    easyOut: { label: 'gives them an out', instruction: 'Add a genuine, unembarrassing way for them to say no.' },
    shorter: { label: 'shorter', instruction: 'Make it markedly shorter — the shortest version that still does the job.' },
    oneSentence: { label: 'one sentence', instruction: 'Reduce it to a single clear sentence.' },
    warmer: { label: 'warmer', instruction: 'Make it warmer and more personal, as if you know them a little better.' },
    direct: { label: 'more direct', instruction: 'Make it more direct. Put the point in the first line and cut the run-up.' },
    formal: { label: 'more formal', instruction: 'Make it more formal and professional, without becoming stiff or corporate.' },
    casual: { label: 'more casual', instruction: 'Make it sound spoken — the way you would actually say it out loud.' },
    context: { label: 'more context', instruction: 'Add one short sentence of context so they understand why this matters now.' },
    lessSelf: { label: 'less about me', instruction: 'Rewrite it around them rather than around you. Lead with what they get or need.' },
};

/** What this specific paragraph looks like it needs, with no model involved. */
function heuristicAngles(section, text) {
    const words = countWords(text);
    const sig = countSignals(text);
    const name = (section.name || '').toLowerCase();
    const isGreeting = /greet|salut/.test(name) || (words > 0 && words <= 6);
    const isSignoff = /sign.?off|closing|regards|signature/.test(name);
    const isAsk = /\bask\b|request|invit|question/.test(name) || /\?/.test(text) || /\b(could|would|can|will) you\b/i.test(text);
    const iCount = (text.match(/\b(I|my|me|mine)\b/g) || []).length;
    const youCount = (text.match(/\b(you|your|yours)\b/g) || []).length;

    const picked = [];
    const add = (a) => { if (a && !picked.includes(a)) picked.push(a); };

    if (sig.apologies >= 2) add(ANGLES.fewerApologies);
    else if (sig.apologies === 1) add(ANGLES.ownIt);

    if (sig.hedges + sig.qualifiers >= 2) add(ANGLES.dehedge);
    if (isAsk) { add(ANGLES.easierYes); add(ANGLES.easyOut); }
    if (words >= 55) add(ANGLES.shorter);
    if (words >= 90) add(ANGLES.oneSentence);
    if (iCount >= 4 && iCount > youCount * 2) add(ANGLES.lessSelf);
    if (isSignoff) { add(ANGLES.warmer); add(ANGLES.formal); }
    if (isGreeting) { add(ANGLES.warmer); add(ANGLES.casual); add(ANGLES.formal); }
    if (words > 0 && words < 25 && !isGreeting && !isSignoff) add(ANGLES.context);

    // Top up with the generic trio so there is always a full set.
    [ANGLES.warmer, ANGLES.direct, ANGLES.shorter, ANGLES.concrete, ANGLES.casual].forEach(add);
    return picked;
}

const ANGLE_SYSTEM =
    'You read one paragraph and say how it could be improved. You never rewrite it yourself. ' +
    'You answer only in the exact format requested, with no preamble and no extra lines.';

/** Ask the model what this paragraph needs. Returns [] if nothing usable came back. */
async function askModelForAngles(section, source, lang) {
    const raw = await SmartAI.chat([
        { role: 'system', content: ANGLE_SYSTEM },
        {
            role: 'user', content:
                `${briefContext()}\n\n` +
                `This is the "${section.name || 'body'}" paragraph of that message` +
                `${lang ? `, written in ${lang.name}` : ''}:\n\n${source}\n\n` +
                `Suggest three different directions THIS paragraph could be rewritten in. ` +
                `Base them on what this paragraph actually needs — not generic writing advice. ` +
                `Answer with exactly three lines in this format:\n` +
                `label: instruction\n\n` +
                `The label is at most three lowercase words. The instruction is one sentence telling a writer what to change. ` +
                `Write the labels and instructions in English even though the paragraph is not. ` +
                `Do not rewrite the paragraph.`,
        },
    ], { task: 'angles', lang: lang && lang.code, maxTokens: 220, temperature: 0.6 });

    return parseAngles(SmartAI.clean(raw));
}

function parseAngles(text) {
    const out = [];
    for (const raw of String(text).split('\n')) {
        const line = raw.trim()
            .replace(/^[-*•]\s*/, '')
            .replace(/^\d+[.)]\s*/, '')
            .replace(/^\*\*|\*\*/g, '');
        if (!line) continue;

        const m = line.match(/^["'“]?([^:]{2,40}?)["'”]?\s*:\s*(.{8,300})$/)
            || line.match(/^["'“]?([^—–]{2,40}?)["'”]?\s*[—–]\s*(.{8,300})$/);
        if (!m) continue;

        const label = m[1].trim().toLowerCase().replace(/[.*"'“”]/g, '').trim();
        const instruction = m[2].trim().replace(/^["'“]|["'”]$/g, '');
        if (!label || label.split(/\s+/).length > 4) continue;
        if (/^(label|instruction|format|example|direction|option|line)\b/.test(label)) continue;
        if (out.some((a) => a.label === label)) continue;

        out.push({ label, instruction });
        if (out.length === 3) break;
    }
    return out;
}

/**
 * The directions for one round of alternatives: the model's proposal, topped
 * up from the rule-based reader, minus anything this section already has.
 */
async function chooseAngles(section, source, room, lang) {
    const taken = new Set(section.variants.map((v) => (v.label || '').toLowerCase()));
    let proposed = [];
    try {
        proposed = await askModelForAngles(section, source, lang);
    } catch (_) {
        proposed = [];
    }
    const fallback = heuristicAngles(section, source);
    const merged = [];
    for (const a of [...proposed, ...fallback]) {
        if (taken.has(a.label.toLowerCase())) continue;
        if (merged.some((m) => m.label.toLowerCase() === a.label.toLowerCase())) continue;
        merged.push(a);
        if (merged.length === room) break;
    }
    return { angles: merged, fromModel: proposed.length };
}

/**
 * Each variation is requested in its own call, so a section never ends up
 * holding one blob containing all three. A model can still ignore that and
 * answer with a numbered list, so keep only its first item if it does.
 */
const ENUM_LINE = /^\s*(?:\d+\s*[.)\]:]|(?:option|version|variant|alternative|rewrite)\s*\d+\s*[:.)\-–—]|[-*•]\s*(?:option|version|variant)\b)\s*/i;

function firstVariantOnly(text) {
    const lines = String(text).split('\n');
    const marked = lines.map((l) => ENUM_LINE.test(l));
    const first = marked.indexOf(true);
    if (first === -1) return text.trim();

    // Only treat it as a list if there really is more than one item.
    if (marked.filter(Boolean).length < 2) return text.replace(ENUM_LINE, '').trim();

    const out = [];
    for (let i = first; i < lines.length; i++) {
        if (i > first && marked[i]) break;
        out.push(lines[i].replace(ENUM_LINE, ''));
    }
    return out.join('\n').trim();
}

async function magicVariations(id) {
    const s = getSection(id); if (!s) return;
    if (refuseIfLocked(s)) return;

    if (SmartAI.status !== 'ready') { openAIPanel(); return; }

    const room = MAX_VARIANTS - s.variants.length;
    if (room <= 0) { atCap(s); return; }

    const source = activeText(s).trim();
    if (!source) { toast('Write something here first, then ask for alternatives', 'warn'); return; }

    const el = cards.get(id);
    const btn = el && $('.magic-btn', el);
    if (el) el.classList.add('thinking');
    if (btn) btn.classList.add('working');

    let added = 0;
    try {
        setAIStatus(`Reading "${s.name || 'section'}"…`);
        const lang = resolveLanguage(source);
        const { angles, fromModel } = await chooseAngles(s, source, room, lang);
        if (!angles.length) { toast('No new directions left for this section', 'warn'); return; }

        setAIStatus(`Writing${lang ? ` in ${lang.name}` : ''}: ${angles.map((a) => a.label).join(' · ')}`);
        if (!fromModel) toast('Model gave no usable directions — using the built-in reading', 'warn');

        for (const angle of angles) {
            const raw = await SmartAI.chat([
                { role: 'system', content: writerSystem(lang) },
                {
                    role: 'user', content:
                        `${briefContext()}\n\n` +
                        `This paragraph is the "${s.name || 'body'}" part of that message:\n\n${source}\n\n` +
                        `${angle.instruction} Keep the same meaning.\n` +
                        `Return exactly one rewritten paragraph. Do not offer alternatives, ` +
                        `do not number anything, do not add a title.\n` +
                        languageClause(lang),
                },
            ], { task: 'variation', angle: angle.label, lang: lang && lang.code, maxTokens: 260, temperature: 0.75 });

            // Generation takes seconds; the section can be gone, locked or in
            // another document by the time an answer arrives.
            if (getSection(id) !== s || s.locked) return;

            const text = firstVariantOnly(SmartAI.clean(raw));
            // Discard an empty answer, or one the model simply echoed back.
            if (!text || text.toLowerCase() === source.toLowerCase()) continue;
            if (s.variants.length >= MAX_VARIANTS) break;
            s.variants.push({ id: uid('v'), label: angle.label, text, fresh: true });
            added++;
            syncCard(s); renderStatus();
        }
    } catch (err) {
        toast(`The model could not finish: ${err.message}`, 'warn');
    } finally {
        if (el) el.classList.remove('thinking');
        if (btn) btn.classList.remove('working');
        setAIStatus('');
    }

    if (added) {
        s.active = s.variants.length - added;   // land on the first new one
        syncCard(s); renderOutline(); renderPreview(); renderStatus(); save();
        toast(`Added ${added} alternative${added === 1 ? '' : 's'} — cycle through with Alt+→`, 'ok');
    } else {
        toast('The model did not produce anything usable this time', 'warn');
    }
}

/** Ask the model for a whole first draft, split into named sections. */
async function draftFromBrief(brief) {
    const b = brief || doc.brief;
    // Nothing is written yet, so the goal is the only language evidence — and
    // the only part the writer typed themselves. The chip answers are English
    // UI strings and would drag detection towards English.
    const lang = (b.language && LANG_BY_CODE.get(b.language))
        ? { code: b.language, name: LANG_BY_CODE.get(b.language).name }
        : detectLanguage(b.goal || '');

    const raw = await SmartAI.chat([
        { role: 'system', content: writerSystem(lang) },
        {
            role: 'user', content:
                `Write a ${(b.length || 'short').toLowerCase()} message.\n${briefContext(b)}\n\n` +
                `Break it into 4 to 6 short parts. Put each part under a heading written as "## Name of part", ` +
                `for example "## Greeting", "## The ask", "## Sign-off". ` +
                `Write only the message itself under each heading. Do not explain what you are doing.\n` +
                `${lang ? `Write the message in ${lang.name}. The headings stay in English.` : ''}`,
        },
    ], { task: 'sections', lang: lang && lang.code, maxTokens: 520, temperature: 0.7 });

    return parseSections(SmartAI.clean(raw));
}

/**
 * Small models drift from any output format, so parse generously: honour
 * "## Heading" when it appears, and otherwise fall back to paragraph splits.
 */
function parseSections(text) {
    const out = [];
    const lines = String(text).split('\n');
    let current = null;

    for (const line of lines) {
        const heading = line.match(/^\s*(?:#{1,4}|\*\*)\s*([^*#\n]{1,48}?)\s*(?:\*\*)?\s*:?\s*$/);
        if (heading && heading[1].trim()) {
            if (current) out.push(current);
            current = { name: titleCase(heading[1].trim()), text: '' };
        } else if (current) {
            current.text += (current.text ? '\n' : '') + line;
        } else if (line.trim()) {
            current = { name: '', text: line };
        }
    }
    if (current) out.push(current);

    let parts = out
        .map((p) => ({ name: p.name, text: p.text.replace(/^\n+|\s+$/g, '') }))
        .filter((p) => p.text.trim());

    // No headings came back at all — treat blank lines as the section breaks.
    if (parts.length <= 1) {
        const paras = String(text).split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
        if (paras.length > 1) parts = paras.map((t) => ({ name: '', text: t }));
    }
    return parts.slice(0, 8);
}

function titleCase(s) {
    return s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Stand-in for the real model, reachable with ?ai=mock. It exists so the
 * guide → draft → variations → proofread path can be driven end to end on a
 * machine with no WebGPU, and so those flows are covered by the test suite.
 */
async function mockModel(messages, opts = {}) {
    const last = messages[messages.length - 1].content;
    mockModel.lastOpts = opts;                        // the suite inspects these
    mockModel.lastPrompt = last;
    mockModel.lastSystem = messages[0].content;
    (mockModel.calls = mockModel.calls || []).push({ task: opts.task, angle: opts.angle, lang: opts.lang });
    await new Promise((r) => setTimeout(r, 5));

    if (opts.task === 'sections') {
        const name = (last.match(/addressed to ([^\s(,.]+)/) || [, 'there'])[1];
        return [
            `## Greeting`, `Hi ${name},`, '',
            `## Opening`, `I have been meaning to write to you for a while, and I would rather do it badly than keep putting it off.`, '',
            `## The ask`, `Could we find twenty minutes in the next couple of weeks? I would rather talk it through than send a longer email.`, '',
            `## Close`, `If the timing is wrong, just say so — no hard feelings.`, '',
            `## Sign-off`, `Best,`,
        ].join('\n');
    }

    if (opts.task === 'angles') {
        // Pretend to have read the paragraph: the hedge line only appears when
        // there is hedging to cut, so the suite can tell context-sensitivity apart.
        const para = (last.match(/paragraph of that message[^:]*:\n\n([\s\S]*?)\n\n/) || [, ''])[1];
        const lines = [];
        if (countSignals(para).hedges + countSignals(para).qualifiers >= 2) {
            lines.push('cut the hedging: Remove every hedge so the sentence carries its own weight.');
        }
        lines.push('make the ask concrete: Name the specific thing you want and by when.');
        lines.push('one sentence: Reduce it to a single clear sentence.');
        lines.push('warmer: Make it sound like it came from a person who likes them.');
        return lines.slice(0, 3).join('\n');
    }

    const source = (last.match(/part of that message:\n\n([\s\S]*?)\n\n/) || [, ''])[1].trim();
    if (opts.task === 'variation') {
        const label = String(opts.angle || '');
        const first = source.split(/(?<=[.!?])\s+/)[0] || source;
        if (/short|one sentence/.test(label)) return first;
        if (/hedg|direct|concrete/.test(label)) {
            return source.replace(/\b(just|maybe|perhaps|possibly|I think|I guess)\s*/gi, '').replace(/\s{2,}/g, ' ').trim();
        }
        return `${source} I hope that lands the way I mean it.`;
    }
    return source;
}

/** " — Danish" for the auto option, so the guess is visible before you rely on it. */
function autoLangLabel() {
    if (doc.brief?.language) return '';
    const guess = detectLanguage(assemble());
    return guess ? ` — looks like ${guess.name}` : '';
}

/* ── AI panel ───────────────────────────────────────────────── */
function setAIStatus(text) {
    const el = $('#status-ai');
    el.textContent = text;
    el.hidden = !text;
}

function renderAIChip() {
    const s = SmartAI.snapshot();
    const chip = $('#btn-ai');
    chip.dataset.status = s.status;
    const label = {
        off: 'AI off', loading: `Loading ${Math.round((s.progress || 0) * 100)}%`,
        ready: 'AI ready', error: 'AI failed', unsupported: 'No GPU',
    }[s.status] || 'AI off';
    $('.ai-chip-text', chip).textContent = label;
    chip.title = s.status === 'ready'
        ? `Running ${s.modelId} locally — click for options`
        : s.status === 'loading'
            ? `${s.message || 'Loading'} — click to watch or stop`
            : s.status === 'unsupported' || s.status === 'error'
                ? 'The model could not start — click to see why'
                : 'Turn on the local writing model';
}

function openAIPanel() {
    const s = SmartAI.snapshot();
    const dev = SmartAI.device();
    // A device that has been checked and found wanting — or a page served from
    // the filesystem — is as good as no WebGPU: offering models would be a lie.
    const usable = SmartAI.isMock || (SmartAI.supported() && !SmartAI.blocked());

    const body = document.createElement('div');
    const note = usable
        ? `<div class="ai-note">The model runs <strong>entirely inside this browser tab</strong>. Your message is never uploaded anywhere. Turning it on downloads a runtime and the model once — a few hundred megabytes — after which it is cached and works offline. Smart Writer is fully usable without it.</div>`
        : `<div class="ai-note warn">${esc(SmartAI.unsupportedReason()).replace(/\n\n/g, '<br><br>')}<br><br>Everything else in Smart Writer works without it.</div>`;
    const supported = usable;

    // Which row reads as chosen: whatever is running, else whatever would start.
    const busy = s.status === 'loading';
    const live = (s.status === 'ready' || busy) && SmartAI.candidates().some((c) => c.id === s.modelId);
    const current = live ? s.modelId : (ui.aiModel || s.modelId);

    // Saying how big it is turns "nothing is happening" into "this is a big file".
    const loadingMb = busy && (SmartAI.candidates().find((c) => c.id === s.modelId) || {}).mb;
    const loadingSize = loadingMb ? (loadingMb >= 1024 ? `${(loadingMb / 1024).toFixed(1)} GB` : `${loadingMb} MB`) : '';

    const models = SmartAI.candidates().map((m) => {
        const running = s.status === 'ready' && m.id === s.modelId;
        const loading = busy && m.id === s.modelId;
        return `
        <button class="model-opt${m.id === current ? ' on' : ''}${busy ? ' waiting' : ''}" data-model="${esc(m.id)}">
          <span class="model-radio"></span>
          <span>
            <span class="model-name">${esc(m.name)}
              ${running ? '<span class="rl-tag same">running</span>' : ''}
              ${loading ? '<span class="rl-tag diff">loading</span>' : ''}
            </span>
            <span class="model-note">${esc(m.note)}</span>
          </span>
        </button>`;
    }).join('');

    body.innerHTML = `
        ${note}
        ${supported ? `<div class="chip-label">Model</div>
            <div class="model-hint">${busy
                ? `Loading${loadingSize ? ` ${loadingSize}` : ''} — a first load takes minutes, not seconds, and the progress bar
                   can sit still for a while between stages. You can close this and keep writing; the corner chip keeps the count.`
                : 'Pick one to start. The download happens once, then it is cached for good.'}</div>
            <div class="model-list">${models}</div>` : ''}
        ${busy || s.status === 'ready'
            ? `<div class="ai-progress"><div class="ai-bar"><span style="width:${Math.round((s.progress || 0) * 100)}%"></span></div>
               <div class="ai-progress-text">${esc(s.message || '')}</div></div>` : ''}
        ${s.status === 'error' ? `<div class="ai-note warn" style="margin-top:12px">${esc(s.error).replace(/\n\n/g, '<br><br>')}</div>` : ''}
        <div class="chip-label">Write in</div>
        <select class="wiz-input" id="lang-select">
          <option value=""${doc.brief?.language ? '' : ' selected'}>Detect automatically${autoLangLabel()}</option>
          ${LANGUAGES.map((l) => `<option value="${l.code}"${doc.brief?.language === l.code ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
        <div class="model-hint" style="margin-top:6px">Detection reads what you have already written. Set it explicitly if it guesses wrong.</div>
        <label class="switch" style="margin-top:16px">
          <input type="checkbox" id="chk-autofix-2"${ui.autofix ? ' checked' : ''}>
          <span class="switch-track"><span class="switch-thumb"></span></span>
          <span class="switch-label">Apply spelling fixes automatically when I pause</span>
        </label>`;

    // Choosing a model *is* the action — it starts loading and gets out of the way.
    body.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-model]'); if (!opt) return;
        const id = opt.dataset.model;
        const now = SmartAI.snapshot();
        if (now.status === 'loading') return;                       // already busy
        ui.aiModel = id;
        save();
        closeModal();
        if (now.status === 'ready' && now.modelId === id) return;   // already this one
        startModel(id);
    });
    $('#chk-autofix-2', body).addEventListener('change', (e) => {
        ui.autofix = e.target.checked;
        $('#chk-autofix').checked = e.target.checked;
        save();
    });
    $('#lang-select', body).addEventListener('change', (e) => {
        doc.brief = doc.brief || blankBrief();
        doc.brief.language = e.target.value;
        renderSignals(); save();
    });

    const foot = document.createElement('div');
    const running = s.status === 'ready' && !SmartAI.isMock;
    foot.innerHTML = `
        ${running ? `<button class="btn ghost" data-a="stop">Unload model</button>` : ''}
        ${busy ? `<button class="btn ghost" data-a="cancel" title="Nothing is downloaded twice — you can start again later">Give up on this load</button>` : ''}
        <span class="spacer"></span>
        <button class="btn ghost" data-a="close">Done</button>`;

    foot.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'close') closeModal();
        if (a === 'stop') { await SmartAI.disable(); closeModal(); toast('Local model unloaded', 'ok'); }
        if (a === 'cancel') {
            guideWantsDraft = false;
            SmartAI.cancel();
            setAIStatus('');
            closeModal();
            toast('Stopped waiting for the model', 'ok');
        }
    });

    openModal({ title: 'Local writing model', body, foot });

    // The adapter check is a real async call, so the panel opens on what we
    // know and repaints once if the answer turns out to be bad news.
    if (!dev.checked && SmartAI.supported() && !SmartAI.isMock && !SmartAI.blocked()) {
        SmartAI.checkDevice().then((d) => {
            const open = !$('#modal-scrim').hidden && $('#modal-title').textContent === 'Local writing model';
            if (!d.ok && open) openAIPanel();
        });
    }
}

/** Load a model, switching away from any that is already running. */
async function startModel(id) {
    const name = (SmartAI.candidates().find((c) => c.id === id) || {}).name || 'the model';
    if (SmartAI.status === 'ready') await SmartAI.disable();

    toast(`Loading ${name} — watch the chip in the corner`, 'ok');
    const ok = await SmartAI.enable(id);
    setAIStatus('');

    if (ok) {
        toast(`${name} is ready`, 'ok');
        // Someone was waiting on this to draft their message — pick that back up.
        if (guideWantsDraft) { guideWantsDraft = false; applyGuide(true); }
    } else if (SmartAI.status === 'off') {
        // Someone pressed "give up" — they know, and have been told already.
    } else {
        guideWantsDraft = false;
        toast(SmartAI.status === 'unsupported'
            ? 'This machine cannot run the model — here is why'
            : `Could not load ${name}`, 'warn');
        openAIPanel();                       // the panel carries the reason why
    }
}

/* ── Section options menu ───────────────────────────────────── */
let openMenu = null;
function closeMenus() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
    $('#menu-dropdown').hidden = true;
    $('#docs-dropdown').hidden = true;
}

function openSectionMenu(id, anchor) {
    const wasOpen = openMenu && openMenu.dataset.for === id;
    closeMenus();
    if (wasOpen) return;
    const s = getSection(id); if (!s) return;

    const menu = document.createElement('div');
    menu.className = 'dropdown sec-menu';
    menu.dataset.for = id;
    menu.innerHTML = `
      <button data-a="add-after"><span class="dd-ico">+</span>Add section below</button>
      <button data-a="dup"><span class="dd-ico">⧉</span>Duplicate section</button>
      <button data-a="mute"><span class="dd-ico">${s.enabled ? '◎' : '●'}</span>${s.enabled ? 'Exclude from message' : 'Include in message'}</button>
      <div class="dd-sep"></div>
      <button data-a="join-para"><span class="dd-ico">${s.join === 'para' ? '✓' : ''}</span>Join: blank line</button>
      <button data-a="join-line"><span class="dd-ico">${s.join === 'line' ? '✓' : ''}</span>Join: new line</button>
      <button data-a="join-space"><span class="dd-ico">${s.join === 'space' ? '✓' : ''}</span>Join: same line</button>
      <div class="dd-sep"></div>
      <button data-a="up"><span class="dd-ico">↑</span>Move up</button>
      <button data-a="down"><span class="dd-ico">↓</span>Move down</button>
      <div class="dd-sep"></div>
      <button data-a="del" class="danger"><span class="dd-ico">⌫</span>Delete section</button>`;

    menu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        closeMenus();
        if (a === 'add-after') addSection(id);
        else if (a === 'dup') {
            const clone = JSON.parse(JSON.stringify(s));
            clone.id = uid('s');
            clone.name = s.name ? `${s.name} (copy)` : '';
            clone.variants.forEach((v) => (v.id = uid('v')));
            doc.sections.splice(doc.sections.indexOf(s) + 1, 0, clone);
            renderSections(); save();
        } else if (a === 'mute') { s.enabled = !s.enabled; syncCard(s); renderPreview(); renderOutline(); renderStatus(); save(); }
        else if (a.startsWith('join-')) { s.join = a.slice(5); renderPreview(); save(); }
        else if (a === 'up') moveSection(id, -1);
        else if (a === 'down') moveSection(id, 1);
        else if (a === 'del') deleteSection(id);
    });

    anchor.appendChild(menu);
    openMenu = menu;
}

/* ── Drag to reorder ────────────────────────────────────────── */
let dragId = null;
function wireDrag(el, id) {
    const handle = $('.drag-handle', el);
    handle.addEventListener('dragstart', (e) => {
        dragId = id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
        e.dataTransfer.setDragImage(el, 24, 20);
    });
    handle.addEventListener('dragend', () => {
        dragId = null;
        el.classList.remove('dragging');
        $$('.card').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    });
    el.addEventListener('dragover', (e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = el.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        el.classList.toggle('drop-after', after);
        el.classList.toggle('drop-before', !after);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', (e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        reorder(dragId, id, e.clientY > r.top + r.height / 2);
        el.classList.remove('drop-before', 'drop-after');
    });
}

/* ── Outline ────────────────────────────────────────────────── */
function renderOutline() {
    const host = $('#outline-list');
    if (!doc.sections.length) { host.innerHTML = '<div class="side-empty">No sections yet.</div>'; return; }
    host.innerHTML = doc.sections.map((s, i) => {
        const label = s.name || activeText(s).replace(/\s+/g, ' ').trim().slice(0, 26) || 'Untitled section';
        return `<div class="outline-item${s.locked ? ' locked' : ''}${s.enabled ? '' : ' disabled'}${focusedSection === s.id ? ' active' : ''}" data-id="${s.id}" title="${esc(label)}">
            <span class="oi-dot"></span>
            <span class="oi-name">${esc(label)}</span>
            <span class="oi-badge">${s.locked ? varKey(s.active) : `${s.variants.length}`}</span>
        </div>`;
    }).join('');
}

$('#outline-list').addEventListener('click', (e) => {
    const item = e.target.closest('.outline-item'); if (!item) return;
    const el = cards.get(item.dataset.id);
    if (el) {
        setView('compose');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setFocused(item.dataset.id);
        $('.editor', el).focus({ preventScroll: true });
    }
});

/* ── Preview ────────────────────────────────────────────────── */
let previewRaf = null;
function renderPreview() {
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
        previewRaf = null;
        const host = $('#preview-body');
        const parts = assembleParts();
        host.classList.toggle('as-recipient', ui.recipientView);

        if (!parts.length) {
            host.innerHTML = `<div class="pv-empty">Nothing to show yet — write something in a section and it will appear here, assembled in order.</div>`;
        } else {
            const blocks = parts.map((p, i) =>
                `<div class="pv-block j-${i === 0 ? 'first' : p.section.join}${p.section.locked ? ' lk' : ''}" data-id="${p.section.id}">${markSignals(p.text)}</div>`
            ).join('');
            host.innerHTML = ui.recipientView ? recipientFrame(blocks) : blocks;
        }
        const full = assemble();
        const w = countWords(full);
        $('#stat-words').textContent = `${w} word${w === 1 ? '' : 's'}`;
        $('#stat-chars').textContent = `${full.length} character${full.length === 1 ? '' : 's'}`;
        const secs = Math.round((w / 230) * 60);
        $('#stat-read').textContent = secs < 60 ? `${Math.max(1, secs)}s read` : `${Math.round(secs / 60)}m read`;
        renderSignals();
    });
}

/** Escape, then highlight the currently selected signal inside the escaped text. */
function markSignals(text) {
    const safe = esc(text);
    if (!ui.signals || !activeSignal) return safe;
    const sig = SIGNALS.find((s) => s.key === activeSignal);
    if (!sig) return safe;
    return safe.replace(new RegExp(sig.re.source, 'gi'), (m) => `<mark class="sig">${m}</mark>`);
}

/** The draft, dressed as the thing that will land in their inbox. */
function recipientFrame(blocks) {
    const to = (doc.brief?.recipient || '').trim();
    return `<div class="rcp-card">
        <div class="rcp-head">
          <div class="rcp-avatar">Y</div>
          <div class="rcp-meta">
            <div class="rcp-from">You</div>
            <div class="rcp-to">to ${esc(to || 'them')} · just now</div>
          </div>
        </div>
        <div class="rcp-subject">${esc(doc.title || 'No subject')}</div>
        <div class="rcp-body">${blocks}</div>
        <div class="rcp-foot">This is roughly how it will read when it arrives.</div>
      </div>`;
}

$('#preview-body').addEventListener('mouseover', (e) => {
    const b = e.target.closest('.pv-block'); if (!b) return;
    cards.get(b.dataset.id)?.classList.add('focused');
});
$('#preview-body').addEventListener('mouseout', (e) => {
    const b = e.target.closest('.pv-block'); if (!b) return;
    const el = cards.get(b.dataset.id);
    if (el && focusedSection !== b.dataset.id) el.classList.remove('focused');
});
$('#preview-body').addEventListener('click', (e) => {
    const b = e.target.closest('.pv-block'); if (!b) return;
    const el = cards.get(b.dataset.id);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setFocused(b.dataset.id); }
});

/* ── Status bar ─────────────────────────────────────────────── */
function renderStatus() {
    const n = doc.sections.length;
    const locked = doc.sections.filter((s) => s.locked).length;
    const vars = doc.sections.reduce((a, s) => a + s.variants.length, 0);
    $('#status-sections').textContent = `${n} section${n === 1 ? '' : 's'}`;
    $('#status-locked').textContent = `${locked} locked`;
    $('#status-variants').textContent = `${vars} variation${vars === 1 ? '' : 's'}`;
    $('#combo-num').textContent = fmtNum(comboCount());
    $('#ver-count').textContent = doc.versions.length;

    $('#settled-fill').style.width = n ? `${(locked / n) * 100}%` : '0%';
    $('#settled-text').textContent = locked === n && n
        ? `All ${n} settled — you are done deciding`
        : `${locked} of ${n} settled`;

    renderBriefCard();
    renderAIChip();
}

function renderBriefCard() {
    const b = doc.brief || {};
    const card = $('#brief-card');
    if (!b.recipient && !b.goal) { card.hidden = true; return; }
    card.hidden = false;
    const rel = joinListSoft(b.relationship);
    const follow = joinListSoft(b.followUp);
    const tones = joinListSoft(b.tone);
    card.innerHTML = `
        <div class="brief-to">To ${esc(b.recipient || 'someone')}${rel ? ` · ${esc(rel)}` : ''}</div>
        ${b.goal ? `<div class="brief-goal">${esc(b.goal)}</div>` : ''}
        ${follow ? `<div class="brief-follow">Wants: ${esc(follow)}</div>` : ''}
        ${tones ? `<div class="brief-follow">Tone: ${esc(tones)}</div>` : ''}
        <div class="brief-edit">Edit the brief →</div>`;
}

$('#brief-card').addEventListener('click', () => openGuide());

/* ═══ VERSIONS ══════════════════════════════════════════════ */
/** Counting existing versions would reuse a name after a delete. */
function nextVersionName() {
    const used = doc.versions
        .map((v) => Number((/^Version (\d+)$/.exec(v.name) || [])[1]))
        .filter((n) => n > 0);
    return `Version ${(used.length ? Math.max(...used) : 0) + 1}`;
}

function snapshot(name) {
    const v = {
        id: uid('ver'),
        name: name || nextVersionName(),
        at: new Date().toISOString(),
        picks: Object.fromEntries(doc.sections.map((s) => [s.id, activeVariant(s).id])),
        snap: doc.sections.map((s) => ({
            secId: s.id,
            name: s.name,
            text: activeText(s),
            varKey: varKey(s.active),
            varLabel: activeVariant(s).label || '',
            enabled: s.enabled,
            locked: s.locked,
            join: s.join,
        })),
    };
    doc.versions.unshift(v);
    if (!ui.compare.includes(v.id)) {
        ui.compare = [...ui.compare, v.id].slice(-4);
    }
    renderVersions(); renderStatus(); renderCompare(); save(true);
    toast(`Saved "${v.name}"`, 'ok');
    return v;
}

function restoreVersion(id) {
    const v = doc.versions.find((x) => x.id === id); if (!v) return;
    const bySec = new Map(v.snap.map((x) => [x.secId, x]));
    let applied = 0, missing = 0, drifted = 0;

    for (const s of doc.sections) {
        const cell = bySec.get(s.id);
        const wantVar = v.picks[s.id];
        // Whether a section was in the message is part of the combination too.
        if (cell && typeof cell.enabled === 'boolean' && !s.locked) s.enabled = cell.enabled;
        if (!wantVar) { missing++; continue; }
        const i = s.variants.findIndex((x) => x.id === wantVar);
        if (i < 0) { missing++; continue; }
        s.active = i;
        applied++;
        // The variant still exists but its words have moved on since the save.
        if (cell && cell.text !== s.variants[i].text) drifted++;
    }

    doc.sections.forEach(syncCard);
    renderPreview(); renderOutline(); renderStatus(); save();
    setView('compose');

    const notes = [];
    if (missing) notes.push(`${missing} no longer match`);
    if (drifted) notes.push(`${drifted} edited since`);
    toast(notes.length ? `Restored ${applied} sections · ${notes.join(' · ')}` : `Restored “${v.name}”`,
        notes.length ? 'warn' : 'ok');
}

async function deleteVersion(id) {
    const v = doc.versions.find((x) => x.id === id); if (!v) return;
    const ok = await askConfirm({
        title: 'Delete this version?',
        message: `“${v.name}” was saved ${fmtWhen(v.at)}. The draft itself is not touched, but this record of the combination goes for good.`,
        confirmLabel: 'Delete version',
    });
    if (!ok) return;
    doc.versions = doc.versions.filter((x) => x.id !== id);
    ui.compare = ui.compare.filter((c) => c !== id);
    if (!ui.compare.length) ui.compare = ['current'];
    renderVersions(); renderStatus(); renderCompare(); save();
}

function renderVersions() {
    const host = $('#version-list');
    if (!doc.versions.length) {
        host.innerHTML = `<div class="side-empty">No saved versions yet.<br><br>Lock the sections you like, then save the combination as a version you can compare against later.</div>`;
        return;
    }
    host.innerHTML = doc.versions.map((v) => {
        const on = ui.compare.includes(v.id);
        const words = countWords(v.snap.filter((x) => x.enabled !== false).map((x) => x.text).join(' '));
        return `<div class="version-item${on ? ' selected' : ''}" data-id="${v.id}">
            <span class="vi-check" data-a="toggle">${ICON.check}</span>
            <div class="vi-main" data-a="toggle">
              <div class="vi-name">${esc(v.name)}</div>
              <div class="vi-meta">${fmtWhen(v.at)} · ${words} words</div>
            </div>
            <div class="vi-acts">
              <button class="icon-btn sm" data-a="rename" title="Rename">${ICON.pen}</button>
              <button class="icon-btn sm" data-a="restore" title="Restore this combination">${ICON.restore}</button>
              <button class="icon-btn sm" data-a="delete" title="Delete version">${ICON.trash}</button>
            </div>
        </div>`;
    }).join('');
}

$('#version-list').addEventListener('click', (e) => {
    const item = e.target.closest('.version-item'); if (!item) return;
    const id = item.dataset.id;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'toggle') toggleCompare(id);
    else if (a === 'restore') restoreVersion(id);
    else if (a === 'delete') deleteVersion(id);
    else if (a === 'rename') {
        const v = doc.versions.find((x) => x.id === id); if (!v) return;
        askText({ title: 'Rename version', label: 'Version name', value: v.name, confirmLabel: 'Rename' })
            .then((name) => {
                if (!name) return;
                v.name = name;
                renderVersions(); renderCompare(); save();
            });
    }
});

function toggleCompare(id) {
    const on = ui.compare.includes(id);
    if (on) {
        if (ui.compare.length <= 1) { toast('Keep at least one column', 'warn'); return; }
        ui.compare = ui.compare.filter((c) => c !== id);
    } else {
        if (ui.compare.length >= 4) { toast('Up to four columns at a time', 'warn'); return; }
        ui.compare = [...ui.compare, id];
    }
    renderVersions(); renderCompare(); save();
}

/* ═══ COMPARE ═══════════════════════════════════════════════ */

function tokenize(s) { return s.match(/\s+|[^\s]+/g) || []; }

/** Word-level LCS diff → [{t:'eq'|'del'|'ins', v}] */
function diffTokens(a, b) {
    const n = a.length, m = b.length;
    if ((n + 1) * (m + 1) > 1.2e6) return null;
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i * W + j] = a[i] === b[j]
                ? dp[(i + 1) * W + j + 1] + 1
                : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        }
    }
    const out = [];
    const push = (t, v) => {
        const last = out[out.length - 1];
        if (last && last.t === t) last.v += v; else out.push({ t, v });
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { push('eq', a[i]); i++; j++; }
        else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { push('del', a[i]); i++; }
        else { push('ins', b[j]); j++; }
    }
    while (i < n) push('del', a[i++]);
    while (j < m) push('ins', b[j++]);
    return out;
}

const wordCountOf = (s) => (s.match(/[^\s]+/g) || []).length;

/**
 * Two variations of a paragraph are usually *rewrites*, not edits — word-level
 * highlighting there produces unreadable confetti. So only mark up the diff when
 * the texts genuinely share material; otherwise present the text plainly and say
 * it was rewritten.
 */
const REWRITE_THRESHOLD = 0.45;

/** Share of words the two texts have in common, 0–1. */
function similarity(a, b) {
    if (a === b) return 1;
    const parts = diffTokens(tokenize(a), tokenize(b));
    if (!parts) return 0;
    let kept = 0;
    for (const p of parts) if (p.t === 'eq') kept += wordCountOf(p.v);
    const total = wordCountOf(a) + wordCountOf(b);
    return total ? (2 * kept) / total : 1;
}

function diffCell(base, text) {
    if (base === text) return { html: esc(text), kind: 'same' };
    const parts = diffTokens(tokenize(base), tokenize(text));
    if (!parts) return { html: esc(text), kind: 'rewritten' };

    let kept = 0;
    for (const p of parts) if (p.t === 'eq') kept += wordCountOf(p.v);
    const total = wordCountOf(base) + wordCountOf(text);
    const sim = total ? (2 * kept) / total : 1;
    if (sim < REWRITE_THRESHOLD) return { html: esc(text), kind: 'rewritten' };

    const html = parts.map((p) => {
        const h = esc(p.v);
        if (p.t === 'eq') return h;
        if (!p.v.trim()) return p.t === 'del' ? '' : h;   // never highlight bare whitespace
        return p.t === 'ins' ? `<ins class="d">${h}</ins>` : `<del class="d">${h}</del>`;
    }).join('');
    return { html, kind: 'edited' };
}

/** Column view of a version (or the live draft). */
function columnData(id) {
    if (id === 'current') {
        return {
            id: 'current', name: 'Current draft', at: null, live: true,
            map: new Map(doc.sections.map((s) => [s.id, {
                name: s.name, text: activeText(s), varKey: varKey(s.active),
                varLabel: activeVariant(s).label || '', enabled: s.enabled,
            }])),
        };
    }
    const v = doc.versions.find((x) => x.id === id);
    if (!v) return null;
    return {
        id: v.id, name: v.name, at: v.at, live: false,
        map: new Map(v.snap.map((x) => [x.secId, {
            name: x.name, text: x.text, varKey: x.varKey,
            varLabel: x.varLabel, enabled: x.enabled !== false,
        }])),
    };
}

function renderComparePicker() {
    const host = $('#compare-picker');

    // Blind means blind: the picker would give the game away, so it steps aside.
    if (ui.blind) {
        host.innerHTML = `<span class="cmp-hint">Blind comparison — ${ui.compare.length} columns, shuffled and unlabelled.
            Read them, decide, then switch Blind off to see which is which.</span>`;
        return;
    }

    const items = [{ id: 'current', name: 'Current draft' }, ...doc.versions.map((v) => ({ id: v.id, name: v.name }))];
    host.innerHTML = items.map((it) => {
        const i = ui.compare.indexOf(it.id);
        const color = i >= 0 ? SWATCHES[i % SWATCHES.length] : '';
        return `<button class="cmp-chip${i >= 0 ? ' on' : ''}" data-id="${it.id}">
            <span class="swatch"${color ? ` style="background:${color}"` : ''}></span>
            <span>${esc(it.name)}</span>
        </button>`;
    }).join('') + `<span class="cmp-hint">${items.length > 1 ? 'Click to add or remove a column (max 4)' : 'Save a version to compare against'}</span>`;
}

$('#compare-picker').addEventListener('click', (e) => {
    const chip = e.target.closest('.cmp-chip'); if (!chip) return;
    toggleCompare(chip.dataset.id);
});

function renderCompare() {
    renderComparePicker();
    const host = $('#compare-scroll');
    const order = ui.blind && Array.isArray(ui.blindOrder) && ui.blindOrder.length === ui.compare.length
        ? ui.blindOrder
        : ui.compare;
    const cols = order.map(columnData).filter(Boolean);

    if (!cols.length) {
        host.innerHTML = `<div class="compare-empty"><div class="empty-mark">${ICON.copy}</div>
            <h3>Nothing selected</h3><p>Pick at least one column above.</p></div>`;
        return;
    }

    // Row order: live sections first, then any section that only exists in saved versions.
    const rows = doc.sections.map((s) => ({ id: s.id, name: s.name, order: doc.sections.indexOf(s) }));
    const known = new Set(rows.map((r) => r.id));
    for (const c of cols) {
        for (const [secId, cell] of c.map) {
            if (!known.has(secId)) { known.add(secId); rows.push({ id: secId, name: cell.name, gone: true }); }
        }
    }

    const grid = document.createElement('div');
    grid.className = 'cmp-grid';
    grid.style.gridTemplateColumns = `190px repeat(${cols.length}, minmax(300px, 1fr))`;

    let html = `<div class="cmp-cell head rowlab corner"><div class="cmp-title">Sections</div><div class="cmp-sub">${rows.length} rows</div></div>`;

    const colTexts = cols.map(assembleFromColumn);

    cols.forEach((c, i) => {
        const color = SWATCHES[i % SWATCHES.length];
        const text = colTexts[i];
        const name = ui.blind ? `Column ${i + 1}` : c.name;
        const sub = ui.blind ? 'hidden while blind' : (c.live ? 'live · updates as you type' : fmtWhen(c.at));
        html += `<div class="cmp-cell head">
            <div class="cmp-title"><span class="swatch" style="background:${color}"></span>${esc(name)}${i === 0 ? ' <span class="rl-tag">baseline</span>' : ''}</div>
            <div class="cmp-sub">${esc(sub)} · ${countWords(text)} words</div>
            <div class="cmp-head-acts">
              <button class="mini-btn" data-copy="${c.id}">${ICON.copy}Copy</button>
              ${c.live ? '' : `<button class="mini-btn" data-restore="${c.id}">${ICON.restore}Restore</button>`}
            </div>
        </div>`;
    });

    // When the columns are nearly the same message, say so plainly. Choosing
    // between two 95%-identical drafts is not a decision worth agonising over.
    if (cols.length > 1) {
        const sims = colTexts.slice(1).map((t) => similarity(colTexts[0], t));
        const lowest = Math.min(...sims);
        if (lowest >= 0.9) {
            html += `<div class="satisfice">${ICON.check}
                <span><b>These are ${Math.round(lowest * 100)}% the same message.</b>
                Whatever is left will not change how it lands — pick one and send it.</span></div>`;
        }
    }

    let shownRows = 0;
    for (const r of rows) {
        const cells = cols.map((c) => c.map.get(r.id) || null);
        const texts = cells.map((c) => (c && c.enabled !== false ? c.text : null));
        const allSame = texts.every((t) => t === texts[0]);
        if (ui.onlyDiff && allSame) continue;
        shownRows++;

        const label = r.name || cells.find((c) => c && c.name)?.name || 'Untitled section';
        html += `<div class="cmp-cell rowlab">
            <div class="rowlab-name">${esc(label)}</div>
            <div class="rowlab-tags">
              <span class="rl-tag ${allSame ? 'same' : 'diff'}">${allSame ? 'identical' : 'differs'}</span>
              ${r.gone ? '<span class="rl-tag">removed</span>' : ''}
            </div>
        </div>`;

        const baseText = cells[0] ? cells[0].text : '';
        cells.forEach((cell, i) => {
            if (!cell) {
                html += `<div class="cmp-cell"><div class="cmp-text absent">— not in this version —</div></div>`;
                return;
            }
            const off = cell.enabled === false;
            let body = esc(cell.text), kind = null;
            if (i > 0 && ui.diffOn && !allSame) {
                const d = diffCell(baseText, cell.text);
                body = d.html;
                kind = d.kind;
            }
            html += `<div class="cmp-cell${i === 0 ? ' is-base' : ''}${allSame ? ' identical' : ''}">
                <div class="cmp-var"><span class="k">${esc(cell.varKey || '—')}</span>${esc(cell.varLabel || 'no label')}${off ? ' · excluded' : ''}
                  ${kind ? `<span class="rl-tag ${{ same: 'same', rewritten: 'rewrite', edited: 'diff' }[kind]}">${kind === 'same' ? 'matches baseline' : kind}</span>` : ''}
                </div>
                <div class="cmp-text">${body || '<span class="absent">— empty —</span>'}</div>
            </div>`;
        });
    }

    if (!shownRows) {
        html += `<div class="cmp-cell" style="grid-column:1/-1"><div class="cmp-text absent">Every section is identical across these columns.</div></div>`;
    }

    grid.innerHTML = html;
    host.innerHTML = '';
    host.appendChild(grid);
}

function assembleFromColumn(c) {
    const out = [];
    const order = [...doc.sections.map((s) => s.id), ...[...c.map.keys()].filter((k) => !doc.sections.some((s) => s.id === k))];
    for (const id of order) {
        const cell = c.map.get(id);
        if (!cell || cell.enabled === false) continue;
        const t = cell.text.replace(/\s+$/, '');
        if (!t.trim()) continue;
        const sec = getSection(id);
        out.push(out.length === 0 ? t : (JOIN_SEP[sec ? sec.join : 'para'] + t));
    }
    return out.join('');
}

$('#compare-scroll').addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]');
    const rs = e.target.closest('[data-restore]');
    if (cp) {
        const c = columnData(cp.dataset.copy);
        if (c) copyText(assembleFromColumn(c), ui.blind ? 'Copied that column' : `Copied "${c.name}"`);
    }
    if (rs) restoreVersion(rs.dataset.restore);
});

/* ═══ CHROME ════════════════════════════════════════════════ */

function setTheme(t) {
    ui.theme = t;
    document.documentElement.dataset.theme = t;
    save();
}

function setView(v) {
    ui.view = v;
    $('#app').dataset.view = v;
    $('#view-compose').hidden = v !== 'compose';
    $('#view-compare').hidden = v !== 'compare';
    $$('[data-view-btn]').forEach((b) => b.classList.toggle('active', b.dataset.viewBtn === v));
    if (v === 'compare') renderCompare();
    else doc.sections.forEach((s) => { const el = cards.get(s.id); if (el) autosize($('.editor', el)); });
    save();
}

function setSidebar(open) {
    ui.sidebar = open;
    $('#app').classList.toggle('side-hidden', !open);
    save();
}

function setSideTab(tab) {
    ui.sideTab = tab;
    $$('.side-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tab-outline').hidden = tab !== 'outline';
    $('#tab-versions').hidden = tab !== 'versions';
    save();
}

function setFont(f) {
    ui.font = f;
    $('#preview-body').dataset.font = f;
    $$('#font-switch .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.font === f));
    save();
}

/* ── Modal ──────────────────────────────────────────────────── */
let modalOnClose = null;

function openModal({ title, body, foot, wide, onClose = null }) {
    // Anything already waiting on this modal is answered before it is replaced.
    if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
    modalOnClose = onClose;

    $('#modal-title').textContent = title;
    const bodyHost = $('#modal-body');
    bodyHost.innerHTML = '';
    if (typeof body === 'string') bodyHost.innerHTML = body;
    else if (body) bodyHost.appendChild(body);

    const footHost = $('#modal-foot');
    footHost.innerHTML = '';
    if (foot) {
        // The wrapper must not become a flex item itself, or the spacer inside
        // it cannot push buttons to the right.
        foot.style.display = 'contents';
        footHost.appendChild(foot);
        footHost.hidden = false;
    } else footHost.hidden = true;

    $('#modal').classList.toggle('wide', !!wide);
    $('#modal-scrim').hidden = false;
}

function closeModal() {
    $('#modal-scrim').hidden = true;
    const f = modalOnClose;
    modalOnClose = null;
    if (f) f();
}

/* Native prompt() and confirm() are blocked outright in some embedding
   contexts and look nothing like the rest of the app, so both live here. */

/** Resolves with the trimmed text, or null if the dialog was dismissed. */
function askText({ title, label = '', value = '', placeholder = '', confirmLabel = 'Save' }) {
    return new Promise((resolve) => {
        let done = false;
        const settle = (v) => { if (!done) { done = true; resolve(v); } };

        const body = document.createElement('div');
        body.innerHTML = `${label ? `<div class="chip-label">${esc(label)}</div>` : ''}
            <input class="wiz-input ask-input" value="${esc(value)}" placeholder="${esc(placeholder)}">`;

        const foot = document.createElement('div');
        foot.innerHTML = `<span class="spacer"></span>
            <button class="btn ghost" data-a="cancel">Cancel</button>
            <button class="btn primary" data-a="ok">${esc(confirmLabel)}</button>`;

        const accept = () => { settle($('.ask-input', body).value.trim()); closeModal(); };
        foot.addEventListener('click', (e) => {
            const a = e.target.closest('[data-a]')?.dataset.a;
            if (a === 'ok') accept();
            if (a === 'cancel') { settle(null); closeModal(); }
        });
        body.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); accept(); } });

        openModal({ title, body, foot, onClose: () => settle(null) });
        const input = $('.ask-input', body);
        setTimeout(() => { input.focus(); input.select(); }, 30);
    });
}

/** Resolves true only if the confirming button was actually pressed. */
function askConfirm({ title, message, confirmLabel = 'Delete', danger = true }) {
    return new Promise((resolve) => {
        let done = false;
        const settle = (v) => { if (!done) { done = true; resolve(v); } };

        const body = document.createElement('div');
        body.innerHTML = `<div class="ask-msg">${esc(message)}</div>`;

        const foot = document.createElement('div');
        foot.innerHTML = `<span class="spacer"></span>
            <button class="btn ghost" data-a="cancel">Keep it</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(confirmLabel)}</button>`;
        foot.addEventListener('click', (e) => {
            const a = e.target.closest('[data-a]')?.dataset.a;
            if (a === 'ok') { settle(true); closeModal(); }
            if (a === 'cancel') { settle(false); closeModal(); }
        });

        openModal({ title, body, foot, onClose: () => settle(false) });
        setTimeout(() => $('[data-a="cancel"]', foot)?.focus(), 30);
    });
}

/* ── Toasts ─────────────────────────────────────────────────── */
function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const ico = kind === 'lock' ? ICON.lock : kind === 'warn' ? '<svg viewBox="0 0 16 16"><path d="M8 2.5 14.5 13.5h-13z"/><path d="M8 6.5v3M8 11.6v.1"/></svg>' : ICON.check;
    el.innerHTML = `<span class="t-ico">${ico}</span><span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 220);
    }, 2200);
}

/* ── Clipboard & files ──────────────────────────────────────── */
/** The message as HTML, so paragraph breaks survive a paste into Gmail or Slack. */
function assembleHTML() {
    const parts = assembleParts();
    if (!parts.length) return '';
    const paras = [];
    for (let i = 0; i < parts.length; i++) {
        const html = esc(parts[i].text).replace(/\n/g, '<br>');
        if (i > 0 && parts[i].section.join !== 'para') {
            paras[paras.length - 1] += (parts[i].section.join === 'line' ? '<br>' : ' ') + html;
        } else {
            paras.push(html);
        }
    }
    return `<div>${paras.map((p) => `<p>${p}</p>`).join('')}</div>`;
}

/** Rich copy: both flavours in one clipboard item, as the spec requires. */
async function copyRich() {
    const plain = assemble();
    if (!plain.trim()) { toast('Nothing to copy yet', 'warn'); return; }
    try {
        if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('unsupported');
        await navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([assembleHTML()], { type: 'text/html' }),
        })]);
        toast('Copied with formatting', 'ok');
    } catch (e) {
        copyText(plain, 'Copied as plain text');
    }
}

async function copyText(text, msg = 'Copied to clipboard') {
    if (!text.trim()) { toast('Nothing to copy yet', 'warn'); return; }
    try {
        await navigator.clipboard.writeText(text);
        toast(msg, 'ok');
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        toast(ok ? msg : 'Copy failed — select the preview and copy manually', ok ? 'ok' : 'warn');
    }
}

function download(name, content, type = 'text/plain') {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Downloaded ${name}`, 'ok');
}

/* Keep letters from any alphabet — a Danish or Polish title should not come
   back as a row of hyphens. Only the characters filenames genuinely dislike go. */
const safeName = () => (doc.title || 'message')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase() || 'message';

function exportMarkdown() {
    let out = `# ${doc.title}\n\n`;
    for (const s of doc.sections) {
        if (!s.enabled) continue;
        const t = activeText(s).trim();
        if (!t) continue;
        out += `<!-- ${s.name || 'section'} · variation ${varKey(s.active)}${activeVariant(s).label ? ` (${activeVariant(s).label})` : ''}${s.locked ? ' · locked' : ''} -->\n${t}\n\n`;
    }
    return out.trimEnd() + '\n';
}

/* ── Wiring ─────────────────────────────────────────────────── */
function wire() {
    $('#btn-theme').addEventListener('click', () => setTheme(ui.theme === 'dark' ? 'light' : 'dark'));
    $('#btn-sidebar').addEventListener('click', () => setSidebar(!ui.sidebar));
    $$('[data-view-btn]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.viewBtn)));
    $$('.side-tab').forEach((b) => b.addEventListener('click', () => setSideTab(b.dataset.tab)));
    $$('#font-switch .seg-btn').forEach((b) => b.addEventListener('click', () => setFont(b.dataset.font)));

    $('#doc-title').addEventListener('input', (e) => { doc.title = e.target.value; save(); });

    $('#btn-reroll').addEventListener('click', rerollUnlocked);
    $('#btn-snapshot').addEventListener('click', () => promptSnapshot());
    $('#btn-add-version-side').addEventListener('click', () => promptSnapshot());
    $('#btn-add-section').addEventListener('click', () => addSection());
    $('#btn-add-section-side').addEventListener('click', () => addSection());
    $('#btn-copy').addEventListener('click', () => copyText(assemble()));
    $('#btn-copy-2').addEventListener('click', () => copyText(assemble()));

    $('#chk-diff').addEventListener('change', (e) => { ui.diffOn = e.target.checked; renderCompare(); save(); });
    $('#chk-only-diff').addEventListener('change', (e) => { ui.onlyDiff = e.target.checked; renderCompare(); save(); });
    $('#chk-blind').addEventListener('change', (e) => {
        ui.blind = e.target.checked;
        // Shuffle once per activation so position carries no information either.
        ui.blindOrder = ui.blind ? shuffled(ui.compare) : null;
        renderCompare(); save();
    });

    /* AI + guide */
    $('#btn-ai').addEventListener('click', openAIPanel);
    $('#btn-guide').addEventListener('click', () => openGuide());

    /* Proofreader */
    $('#fix-chip').addEventListener('click', () => {
        const p = $('#fix-panel');
        p.hidden ? openFixPanel() : (p.hidden = true);
    });
    $('#fix-apply-all').addEventListener('click', () => {
        const n = applyFixes(pendingFixes);
        pendingFixes = []; renderFixChip();
        toast(n ? `Applied ${n} fix${n === 1 ? '' : 'es'}` : 'Those fixes no longer apply', n ? 'ok' : 'warn');
    });
    $('#fix-dismiss').addEventListener('click', () => { pendingFixes = []; renderFixChip(); });
    $('#fix-list').addEventListener('click', (e) => {
        const b = e.target.closest('[data-apply]'); if (!b) return;
        const fix = pendingFixes[Number(b.dataset.apply)];
        if (fix && applyFix(fix)) {
            pendingFixes = pendingFixes.filter((f) => f !== fix);
            doc.sections.forEach(syncCard);
            renderPreview(); renderStatus(); save();
        }
        renderFixChip();
        if (pendingFixes.length) openFixPanel();
    });
    $('#chk-autofix').addEventListener('change', (e) => { ui.autofix = e.target.checked; save(); });

    /* Signals + recipient view */
    $('#btn-signals').addEventListener('click', () => {
        ui.signals = !ui.signals;
        if (!ui.signals) activeSignal = null;
        renderPreview(); save();
    });
    $('#signals-strip').addEventListener('click', (e) => {
        if (e.target.closest('[data-lang-chip]')) { openAIPanel(); return; }
        const chip = e.target.closest('[data-sig]'); if (!chip) return;
        activeSignal = activeSignal === chip.dataset.sig ? null : chip.dataset.sig;
        renderPreview();
    });
    $('#btn-recipient').addEventListener('click', () => {
        ui.recipientView = !ui.recipientView;
        $('#btn-recipient').classList.toggle('on', ui.recipientView);
        renderPreview(); save();
    });

    /* top-right menu */
    $('#btn-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = $('#menu-dropdown');
        const willOpen = dd.hidden;
        closeMenus();
        dd.hidden = !willOpen;
    });
    $('#menu-dropdown').addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        closeMenus();
        menuAction(b.dataset.act);
    });

    /* document switcher */
    $('#btn-docs').addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = $('#docs-dropdown');
        const willOpen = dd.hidden;
        closeMenus();
        if (willOpen) { renderDocsMenu(); dd.hidden = false; }
    });
    $('#docs-dropdown').addEventListener('click', (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { e.stopPropagation(); deleteDoc(del.dataset.del); return; }
        const row = e.target.closest('[data-doc]');
        if (row) { switchDoc(row.dataset.doc); return; }
        const act = e.target.closest('[data-doc-act]');
        if (act) { closeMenus(); docsMenuAction(act.dataset.docAct); }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown') && !e.target.closest('#btn-menu')
            && !e.target.closest('#btn-docs') && !e.target.closest('.sec-menu-btn')) closeMenus();
    });

    /* modal */
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-scrim').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-scrim') closeModal(); });

    /* import — files are added to the library, never swapped in over your work */
    $('#file-input').addEventListener('change', (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        if (files.length) importFiles(files);
    });

    wireSplitter();
    wireKeys();
}

async function menuAction(act) {
    switch (act) {
        case 'proofread': runProofread(true); break;
        case 'copy-rich': copyRich(); break;
        case 'lock-all': setAllLocks(true); break;
        case 'unlock-all': setAllLocks(false); break;
        case 'export-txt': download(`${safeName()}.txt`, assemble()); break;
        case 'export-md': download(`${safeName()}.md`, exportMarkdown(), 'text/markdown'); break;
        case 'shortcuts': showShortcuts(); break;
        case 'reset': {
            const ok = await askConfirm({
                title: 'Delete every message?',
                message: `All ${docs.length} message${docs.length === 1 ? '' : 's'} and every saved version go with it. This cannot be undone.`,
                confirmLabel: 'Delete everything',
            });
            if (!ok) return;
            localStorage.removeItem(LS_KEY);
            ui = { ...defaultUI, theme: ui.theme };
            docs = [blankDoc()];
            applyUI();
            openDoc(docs[0], { announce: 'Everything cleared' });
            break;
        }
    }
}

async function promptSnapshot() {
    const name = await askText({
        title: 'Save this version',
        label: 'A name you will recognise later',
        value: nextVersionName(),
        placeholder: 'Shorter opening',
        confirmLabel: 'Save version',
    });
    if (name === null) return;
    snapshot(name || nextVersionName());
    setSideTab('versions');
    if (!ui.sidebar) setSidebar(true);
}

/* ── Splitter ───────────────────────────────────────────────── */
function wireSplitter() {
    const sp = $('#splitter');
    const preview = $('#preview');
    let dragging = false;

    const isVertical = () => window.innerWidth <= 900;

    sp.addEventListener('mousedown', (e) => {
        dragging = true;
        sp.classList.add('active');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = isVertical() ? 'row-resize' : 'col-resize';
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        if (isVertical()) {
            const rect = $('#view-compose').getBoundingClientRect();
            const h = clamp(rect.bottom - e.clientY, 140, rect.height - 140);
            preview.style.height = h + 'px';
        } else {
            const w = clamp(window.innerWidth - e.clientX, 280, Math.max(320, window.innerWidth - 420));
            ui.previewW = Math.round(w);
            preview.style.width = w + 'px';
        }
    });
    window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        sp.classList.remove('active');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        save();
    });
    sp.addEventListener('dblclick', () => { ui.previewW = 420; preview.style.width = ''; preview.style.height = ''; save(); });
}

/* ── Keyboard ───────────────────────────────────────────────── */
const SHORTCUTS = [
    ['Message', [
        [['Ctrl', 'O'], 'Switch to another message'],
        [['Ctrl', '⏎'], 'Copy the assembled message'],
        [['Ctrl', 'Shift', '⏎'], 'Copy with formatting (for Gmail, Slack)'],
        [['Ctrl', 'G'], 'Guide me — answers become a draft'],
        [['Ctrl', 'S'], 'Save the current combination as a version'],
        [['Ctrl', 'Shift', 'R'], 'Reroll every unlocked section'],
        [['Ctrl', 'B'], 'Show / hide the sidebar'],
        [['Ctrl', '1'], 'Compose view'],
        [['Ctrl', '2'], 'Compare view'],
    ]],
    ['Focused section', [
        [['Alt', '←'], 'Previous variation'],
        [['Alt', '→'], 'Next variation'],
        [['Alt', 'L'], 'Lock / unlock'],
        [['Alt', 'M'], 'Write three alternatives with the local model'],
        [['Alt', 'N'], 'New variation'],
        [['Alt', 'D'], 'Duplicate this variation'],
        [['Alt', '↑'], 'Move section up'],
        [['Alt', '↓'], 'Move section down'],
        [['Alt', '1'], 'Jump to variation A, B, C… (Alt+2, Alt+3)'],
    ]],
];

function showShortcuts() {
    const body = SHORTCUTS.map(([title, rows]) => `
        <div class="sc-group-title">${title}</div>
        ${rows.map(([keys, desc]) => `<div class="sc-row">
            <span class="sc-desc">${esc(desc)}</span>
            <span class="sc-keys">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>
        </div>`).join('')}
    `).join('');
    openModal({ title: 'Keyboard shortcuts', body });
}

function wireKeys() {
    document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);

        if (e.key === 'Escape') {
            if (!$('#modal-scrim').hidden) { closeModal(); return; }
            if (openMenu || !$('#menu-dropdown').hidden || !$('#docs-dropdown').hidden) { closeMenus(); return; }
            if (typing) document.activeElement.blur();
            return;
        }

        if (mod && e.key === 'Enter') { e.preventDefault(); e.shiftKey ? copyRich() : copyText(assemble()); return; }
        if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); openGuide(); return; }
        if (mod && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); promptSnapshot(); return; }
        if (mod && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); rerollUnlocked(); return; }
        if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebar(!ui.sidebar); return; }
        if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#btn-docs').click(); return; }
        if (mod && e.key === '1') { e.preventDefault(); setView('compose'); return; }
        if (mod && e.key === '2') { e.preventDefault(); setView('compare'); return; }

        if (!e.altKey || mod) return;
        const id = focusedSection || doc.sections[0]?.id;
        if (!id) return;
        const s = getSection(id); if (!s) return;

        const act = {
            ArrowLeft: () => rotate(id, -1),
            ArrowRight: () => rotate(id, 1),
            ArrowUp: () => moveSection(id, -1),
            ArrowDown: () => moveSection(id, 1),
            l: () => toggleLock(id),
            m: () => magicVariations(id),
            n: () => addVariant(id),
            d: () => duplicateVariant(id),
        }[e.key.length === 1 ? e.key.toLowerCase() : e.key];

        if (act) { e.preventDefault(); act(); return; }

        if (/^[1-9]$/.test(e.key)) {
            e.preventDefault();
            const i = Number(e.key) - 1;
            if (i < s.variants.length) {
                if (s.locked) { bumpLock(cards.get(id)); return; }
                selectVariant(id, i, true);
            }
        }
    });
}

/* ── Boot ───────────────────────────────────────────────────── */
function applyUI() {
    document.documentElement.dataset.theme = ui.theme;
    $('#app').classList.toggle('side-hidden', !ui.sidebar);
    $('#preview').style.width = ui.previewW ? ui.previewW + 'px' : '';
    $('#preview-body').dataset.font = ui.font;
    $$('#font-switch .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.font === ui.font));
    $$('.side-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.sideTab));
    $('#tab-outline').hidden = ui.sideTab !== 'outline';
    $('#tab-versions').hidden = ui.sideTab !== 'versions';
    $('#chk-diff').checked = ui.diffOn;
    $('#chk-only-diff').checked = ui.onlyDiff;
    $('#chk-blind').checked = ui.blind;
    $('#chk-autofix').checked = ui.autofix;
    $('#btn-recipient').classList.toggle('on', ui.recipientView);
    renderAIChip();
    setView(ui.view === 'compare' ? 'compare' : 'compose');
}

function bootDoc() {
    $('#doc-title').value = doc.title;
    pendingFixes = [];
    renderFixChip();
    if (!ui.compare || !ui.compare.length) ui.compare = ['current'];
    ui.compare = ui.compare.filter((c) => c === 'current' || doc.versions.some((v) => v.id === c));
    if (!ui.compare.length) ui.compare = ['current'];
    // Opening a document is not editing it, so it keeps its place in the list.
    lastDocSig = docSig(doc);
    renderSections();
    renderVersions();
    renderCompare();
    renderDocsMenu();
    save(true);
}

function init() {
    const had = load();
    if (!had) {
        docs = [sampleDoc()];
        doc = docs[0];
        ui = { ...defaultUI, theme: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' };
    }
    // A model id saved before the list changed would leave the picker with
    // nothing selected, so fall back to the current suggestion.
    if (!ui.aiModel || !SmartAI.candidates().some((c) => c.id === ui.aiModel)) {
        ui.aiModel = SmartAI.suggestedModel();
    }

    // A stand-in model so the AI-dependent flows can be exercised without a GPU.
    if (/[?&]ai=mock\b/.test(location.search)) SmartAI.installMock(mockModel);

    SmartAI.onChange((s) => {
        renderAIChip();
        // The modal closes as soon as you pick, so the download has to stay
        // legible from the status bar — and from the panel if it is reopened.
        if (s.status === 'loading') {
            setAIStatus(`${s.message || 'Loading the model'} · ${Math.round((s.progress || 0) * 100)}%`);
            const bar = $('#modal-body .ai-bar span');
            if (bar) bar.style.width = `${Math.round((s.progress || 0) * 100)}%`;
            const txt = $('#modal-body .ai-progress-text');
            if (txt) txt.textContent = s.message || '';
        } else if (s.status !== 'ready') {
            setAIStatus('');
        }
    });

    applyUI();
    wire();
    bootDoc();

    // Keep textarea heights honest when the composer width changes.
    let ro;
    if (window.ResizeObserver) {
        ro = new ResizeObserver(() => {
            if (ui.view !== 'compose') return;
            doc.sections.forEach((s) => { const el = cards.get(s.id); if (el) autosize($('.editor', el)); });
        });
        ro.observe($('#composer'));
    }
    window.addEventListener('beforeunload', () => save(true));
}

init();
