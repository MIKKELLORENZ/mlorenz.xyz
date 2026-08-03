/* ═══════════════════════════════════════════════════════════════
   ai.js — optional, lazy, entirely-local language model layer.

   Nothing here loads until the user explicitly turns it on: the base app
   ships zero AI weight. WebLLM runs on WebGPU, which needs no COOP/COEP
   headers, so it works on GitHub Pages. The model downloads once and is
   cached by the browser; after that it runs offline.

   Everything in the app must still work with this file inert.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const SmartAI = (function () {

    const CDN = 'https://esm.run/@mlc-ai/web-llm';

    /* Small models only — see the size notes in alternative_ideas.md.
       Resolved against WebLLM's live prebuilt list so a renamed id just
       drops out of the picker instead of throwing at load time. */
   /* Sizes are the vram_required_MB values WebLLM publishes for these builds.
      Nothing below 1B is offered: the sub-billion models cannot hold a brief
      and a paragraph in mind at once, and their rewrites are not worth reading.
      Qwen2.5-0.5B is absent for the same reason, and because it wants 945 MB —
      more than the 1B Llama below it. */
    const CANDIDATES = [
        {
            id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B', mb: 879,
            note: '879 MB. The lightest model still worth using. Good at shortening and tightening, less reliable at nuance.',
        },
        {
            id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 1.5B', mb: 1630,
            note: '1.6 GB. Follows instructions noticeably better — the best balance for this kind of writing.',
        },
        {
            id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 3B', mb: 2264,
            note: '2.3 GB. The best sentences of the three. Needs a machine with room to spare.',
        },
    ];

    const DEFAULT_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

    const state = {
        status: 'off',        // off | loading | ready | error | unsupported
        modelId: DEFAULT_ID,
        models: CANDIDATES.slice(),
        progress: 0,
        message: '',
        error: '',
        busy: false,
    };

    let engine = null;
    let mock = null;
    const listeners = new Set();

    const emit = () => listeners.forEach((fn) => { try { fn(snapshot()); } catch (_) {} });
    const snapshot = () => ({ ...state });

    function set(patch) { Object.assign(state, patch); emit(); }

    /* ── Capability ─────────────────────────────────────────────
       `navigator.gpu` existing is not the same as there being a graphics
       device behind it. When the adapter request comes back null, WebLLM's
       CreateMLCEngine never rejects — it simply hangs — so the adapter has to
       be checked up front or the app waits forever with nothing to show. */

    const NO_GPU = 'This browser has no WebGPU. Chrome or Edge 113+ on desktop can run the model; Firefox and Safari still cannot.';

    const NO_ADAPTER =
        'WebGPU is switched on in this browser, but it cannot reach a graphics device, so the model has nothing to run on. ' +
        'Almost always this is hardware acceleration being off: open Chrome’s Settings → System and turn on ' +
        '“Use graphics acceleration when available”, then restart the browser. ' +
        'Visit chrome://gpu to confirm — the WebGPU line should read “Hardware accelerated”. ' +
        'Remote desktop sessions and some virtual machines cannot run it at all.';

    const STALLED =
        'The model stopped making progress and was given up on. The download may have been blocked — ' +
        'content blockers and corporate proxies both do this to large files from a CDN — or the graphics device dropped out. ' +
        'Trying again often works, and the smallest model is the one most likely to get through.';

    const FILE_ORIGIN =
        'This page is open straight from the filesystem — the address starts with file:// rather than http. ' +
        'Browsers do not give file:// pages the cache storage the model needs for its weights, and the request for ' +
        'that storage then never returns rather than failing, so the load simply hangs and nothing appears to happen. ' +
        'Open Smart Writer over http instead: the copy published on the site works, or serve this folder locally — ' +
        'run “python -m http.server” in it and visit http://localhost:8000.';

    /* No progress at all for this long means it is not coming. A slow download
       still ticks constantly, so this only fires on a genuine stall. */
    const STALL_MS = 75000;

    let device = { checked: false, ok: false, reason: '' };

    function supported() {
        return typeof navigator !== 'undefined' && 'gpu' in navigator;
    }

    /* The test harness runs from file:// on purpose, so it can wave this through
       with ?ai-file-ok and still exercise the loading path. */
    const FILE_OK = /[?&]ai-file-ok\b/.test(typeof location !== 'undefined' ? location.search : '');
    const fileOrigin = () => typeof location !== 'undefined' && location.protocol === 'file:';
    const originBlocked = () => fileOrigin() && !FILE_OK;
    const originReason = () => (fileOrigin() ? FILE_ORIGIN : '');

    /** True when the model cannot start for a reason we already know about. */
    const blocked = () => originBlocked() || (device.checked && !device.ok);

    /** Ask the platform for a real adapter. Cached — it does not change mid-session. */
    async function checkDevice(force = false) {
        if (device.checked && !force) return device;
        if (!supported()) {
            device = { checked: true, ok: false, reason: NO_GPU };
            return device;
        }
        try {
            const adapter = await navigator.gpu.requestAdapter();
            device = adapter
                ? { checked: true, ok: true, reason: '' }
                : { checked: true, ok: false, reason: NO_ADAPTER };
        } catch (err) {
            device = { checked: true, ok: false, reason: `${NO_ADAPTER}\n\n(${err && err.message})` };
        }
        emit();
        return device;
    }

    function unsupportedReason() {
        if (!supported()) return NO_GPU;
        if (originBlocked()) return FILE_ORIGIN;
        if (device.checked && !device.ok) return device.reason;
        return '';
    }

    /** Machines with little memory get pointed at the lightest usable model. */
    function suggestedModel() {
        const mem = navigator.deviceMemory;
        if (typeof mem === 'number' && mem <= 8) return CANDIDATES[0].id;
        return DEFAULT_ID;
    }

    /* ── Lifecycle ──────────────────────────────────────────── */

    /** WebLLM's own errors are written for whoever wrote WebLLM. */
    function explain(err) {
        const raw = String(err && err.message ? err.message : err);
        if (/CacheStorage|caches|QuotaExceeded|storage/i.test(raw)) {
            return 'The browser would not give the model anywhere to keep its weights. ' +
                (fileOrigin()
                    ? 'This page is running from a file:// address, which is the usual cause — serve it over http instead. '
                    : 'Private/incognito windows and a full disk both do this, and some privacy extensions block the Cache API outright. ') +
                `\n\n(${raw})`;
        }
        if (/device|adapter|GPU|WebGPU/i.test(raw)) {
            return `The graphics device gave up while the model was starting. Reloading the page and trying the smallest model usually gets past it.\n\n(${raw})`;
        }
        return raw;
    }

    /* Bumped by every enable() and by cancel(), so a load that has been
       abandoned cannot come back later and claim to be ready. */
    let loadToken = 0;

    async function enable(modelId, onProgress) {
        if (state.status === 'loading') return false;
        if (mock) {                                   // test backend
            set({ status: 'ready', modelId: modelId || state.modelId, progress: 1, message: 'Mock model ready', error: '' });
            return true;
        }

        // Checked before anything else: it costs nothing and is the likeliest
        // reason a load goes quiet during local development.
        if (originBlocked()) {
            set({ status: 'unsupported', progress: 0, message: '', error: FILE_ORIGIN, modelId: modelId || state.modelId });
            return false;
        }

        const token = ++loadToken;
        set({ status: 'loading', progress: 0, message: 'Checking the graphics device…', error: '', modelId: modelId || state.modelId });

        // Fail here rather than hanging inside WebLLM with nothing to report.
        const dev = await checkDevice(true);
        if (token !== loadToken) return false;
        if (!dev.ok) {
            set({ status: 'unsupported', progress: 0, message: '', error: dev.reason });
            return false;
        }

        set({ message: 'Fetching the runtime…' });
        let watchdog = null;
        try {
            const webllm = await import(/* webpackIgnore: true */ CDN);
            if (token !== loadToken) return false;

            // Keep only the candidates this build of WebLLM actually ships.
            const available = new Set((webllm.prebuiltAppConfig?.model_list || []).map((m) => m.model_id));
            if (available.size) {
                const kept = CANDIDATES.filter((c) => available.has(c.id));
                if (kept.length) {
                    state.models = kept;
                    if (!kept.some((c) => c.id === state.modelId)) state.modelId = kept[0].id;
                }
            }

            let lastBeat = Date.now();
            const stalled = new Promise((_, reject) => {
                watchdog = setInterval(() => {
                    if (token !== loadToken) { clearInterval(watchdog); return; }
                    if (Date.now() - lastBeat > STALL_MS) {
                        clearInterval(watchdog);
                        reject(new Error(STALLED));
                    }
                }, 2000);
            });

            const started = webllm.CreateMLCEngine(state.modelId, {
                initProgressCallback: (p) => {
                    lastBeat = Date.now();
                    if (token !== loadToken) return;
                    const pct = typeof p.progress === 'number' ? p.progress : 0;
                    set({ progress: pct, message: p.text || 'Loading…' });
                    if (onProgress) onProgress(pct, p.text || '');
                },
            });

            engine = await Promise.race([started, stalled]);
            clearInterval(watchdog);

            // Someone gave up on this load while it was still running.
            if (token !== loadToken) {
                try { if (engine && engine.unload) await engine.unload(); } catch (_) {}
                engine = null;
                return false;
            }

            set({ status: 'ready', progress: 1, message: 'Ready' });
            return true;
        } catch (err) {
            clearInterval(watchdog);
            if (token !== loadToken) return false;
            engine = null;
            set({ status: 'error', progress: 0, error: explain(err) });
            return false;
        }
    }

    /** Stop waiting on a load that is going nowhere. */
    function cancel() {
        if (state.status !== 'loading') return false;
        loadToken++;
        set({ status: 'off', progress: 0, message: '', error: '' });
        return true;
    }

    async function disable() {
        loadToken++;
        try { if (engine && engine.unload) await engine.unload(); } catch (_) {}
        engine = null;
        set({ status: 'off', progress: 0, message: '', error: '' });
    }

    /* ── Generation ─────────────────────────────────────────── */
    async function chat(messages, opts = {}) {
        if (mock) return mock(messages, opts);
        if (!engine) throw new Error('The local model is not running');
        const res = await engine.chat.completions.create({
            messages,
            temperature: opts.temperature ?? 0.7,
            max_tokens: opts.maxTokens ?? 300,
        });
        return res.choices?.[0]?.message?.content ?? '';
    }

    /** Small models pad their answers. Strip the padding down to the prose. */
    function clean(text) {
        let t = String(text || '').trim();
        t = t.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
        // "Sure! Here's a warmer version:" and friends
        t = t.replace(/^(sure|certainly|of course|here(’|')?s|here is|okay|ok)\b[^\n]{0,80}?:\s*/i, '').trim();
        t = t.replace(/^(rewritten|revised|version|answer|output)\s*:\s*/i, '').trim();
        // A whole answer wrapped in quotes
        if (/^["“'][\s\S]*["”']$/.test(t) && !/["“][\s\S]*["”][\s\S]*["“]/.test(t)) {
            t = t.replace(/^["“']/, '').replace(/["”']$/, '').trim();
        }
        t = t.replace(/^\s*[-*]\s+/gm, '');
        t = t.replace(/\n{3,}/g, '\n\n');
        return t.trim();
    }

    /* ── Test backend ───────────────────────────────────────── */
    function installMock(fn) {
        mock = fn;
        set({ status: 'ready', progress: 1, message: 'Mock model ready', modelId: 'mock' });
    }

    return {
        get status() { return state.status; },
        get busy() { return state.busy; },
        setBusy(b) { set({ busy: !!b }); },
        snapshot, supported, unsupportedReason, suggestedModel,
        candidates: () => state.models.slice(),
        device: () => ({ ...device }),
        checkDevice, blocked, fileOrigin, originReason,
        enable, disable, cancel, chat, clean, installMock,
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get isMock() { return !!mock; },
    };
})();
