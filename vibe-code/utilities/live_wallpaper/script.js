// App shell: drives the render loop, manages theme switching, fullscreen,
// UI auto-hide, and localStorage persistence.

(function () {
    'use strict';

    const STORAGE_KEY = 'live-wallpaper:theme';
    const UI_IDLE_MS = 3000;
    const DPR_CAP = 2;
    const MAX_DT = 60; // ms — clamp big gaps (tab switch, slow frame)

    const canvas = document.getElementById('stage');
    const ctx = canvas.getContext('2d');
    const pickerEl = document.getElementById('picker');
    const pickerListEl = document.getElementById('pickerList');
    const pickerCollapseBtn = document.getElementById('pickerCollapse');
    const pickerRevealBtn = document.getElementById('pickerReveal');
    const hideUiBtn = document.getElementById('hideUiBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const fsEnterIcon = document.getElementById('fsEnterIcon');
    const fsExitIcon = document.getElementById('fsExitIcon');
    const overlay = document.getElementById('uiOverlay');
    const hiddenHint = document.getElementById('hiddenHint');

    let active = null;       // active wallpaper instance
    let activeId = null;
    let startMs = 0;
    let lastFrameMs = 0;
    let rafId = null;
    let cssW = 0, cssH = 0;
    let dpr = 1;
    let uiHidden = false;
    let manualHide = false;  // user clicked "hide UI"
    let idleTimer = null;

    // ---------- Canvas sizing ----------
    function resizeCanvas() {
        dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        cssW = window.innerWidth;
        cssH = window.innerHeight;
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
        canvas.width = Math.max(1, Math.floor(cssW * dpr));
        canvas.height = Math.max(1, Math.floor(cssH * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (active) {
            active.dpr = dpr;
            active.resize(cssW, cssH);
        }
    }

    // ---------- Picker UI ----------
    function buildPicker() {
        pickerListEl.innerHTML = '';
        const themes = LiveWallpaper.list();
        themes.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'theme-card';
            btn.dataset.id = t.id;
            btn.innerHTML = `<span class="theme-name"></span><span class="theme-desc"></span>`;
            btn.querySelector('.theme-name').textContent = t.name;
            btn.querySelector('.theme-desc').textContent = t.description;
            btn.addEventListener('click', () => setActiveTheme(t.id));
            pickerListEl.appendChild(btn);
        });
        updatePickerActiveState();
    }

    function updatePickerActiveState() {
        pickerListEl.querySelectorAll('.theme-card').forEach(el => {
            el.classList.toggle('active', el.dataset.id === activeId);
        });
    }

    // ---------- Active theme management ----------
    function setActiveTheme(id) {
        const def = LiveWallpaper.get(id);
        if (!def) return;
        if (active) {
            try { active.destroy(); } catch (e) { console.error(e); }
            active = null;
        }
        activeId = id;
        const instance = def.factory(canvas);
        instance.dpr = dpr;
        instance.width = cssW;
        instance.height = cssH;
        instance.init();
        instance.resize(cssW, cssH);
        active = instance;
        startMs = performance.now();
        lastFrameMs = startMs;
        try { localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
        updatePickerActiveState();
    }

    // ---------- Render loop ----------
    function frame(now) {
        rafId = requestAnimationFrame(frame);
        if (document.hidden) {
            lastFrameMs = now;
            return;
        }
        let dt = now - lastFrameMs;
        if (dt > MAX_DT) dt = MAX_DT;
        lastFrameMs = now;
        if (active) {
            const t = now - startMs;
            try { active.render(t, dt); } catch (e) { console.error(e); }
        }
    }

    // ---------- Fullscreen ----------
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            (document.documentElement.requestFullscreen?.() ||
             document.documentElement.webkitRequestFullscreen?.())?.catch(() => {});
        } else {
            (document.exitFullscreen?.() || document.webkitExitFullscreen?.())?.catch(() => {});
        }
    }

    function updateFullscreenIcon() {
        const isFs = !!document.fullscreenElement;
        fsEnterIcon.classList.toggle('hidden', isFs);
        fsExitIcon.classList.toggle('hidden', !isFs);
    }

    // ---------- UI auto-hide ----------
    function showUi() {
        if (manualHide) return;
        if (uiHidden) {
            uiHidden = false;
            overlay.classList.remove('ui-hidden');
            document.body.classList.remove('ui-fully-hidden');
        }
        scheduleIdleHide();
    }

    function scheduleIdleHide() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            uiHidden = true;
            overlay.classList.add('ui-hidden');
            document.body.classList.add('ui-fully-hidden');
        }, UI_IDLE_MS);
    }

    function setManualHide(on) {
        manualHide = on;
        if (on) {
            clearTimeout(idleTimer);
            uiHidden = true;
            overlay.classList.add('ui-hidden');
            document.body.classList.add('ui-fully-hidden');
            hiddenHint.classList.remove('hidden');
            // Auto-remove hint node after its animation finishes.
            setTimeout(() => hiddenHint.classList.add('hidden'), 4200);
        } else {
            hiddenHint.classList.add('hidden');
            uiHidden = false;
            overlay.classList.remove('ui-hidden');
            document.body.classList.remove('ui-fully-hidden');
            scheduleIdleHide();
        }
    }

    // ---------- Picker collapse ----------
    function setPickerCollapsed(collapsed) {
        pickerEl.classList.toggle('collapsed', collapsed);
        pickerRevealBtn.classList.toggle('hidden', !collapsed);
    }

    // ---------- Event wiring ----------
    function wireEvents() {
        window.addEventListener('resize', resizeCanvas);

        pickerCollapseBtn.addEventListener('click', () => setPickerCollapsed(true));
        pickerRevealBtn.addEventListener('click', () => setPickerCollapsed(false));

        fullscreenBtn.addEventListener('click', toggleFullscreen);
        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

        hideUiBtn.addEventListener('click', () => setManualHide(true));

        // Wake UI on mouse / key activity.
        ['mousemove', 'mousedown', 'touchstart'].forEach(ev => {
            window.addEventListener(ev, () => {
                if (manualHide) return;
                showUi();
            }, { passive: true });
        });

        // Manual show: a click anywhere while hidden re-reveals UI.
        window.addEventListener('mousemove', () => {
            if (manualHide) {
                // require an explicit key press (H) to escape manual hide
            }
        }, { passive: true });

        document.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (e.key === 'f' || e.key === 'F') {
                toggleFullscreen();
            } else if (e.key === 'h' || e.key === 'H') {
                setManualHide(!manualHide);
            } else if (e.key === 'Escape') {
                if (manualHide) setManualHide(false);
            } else if (/^[1-9]$/.test(e.key)) {
                const list = LiveWallpaper.list();
                const idx = parseInt(e.key, 10) - 1;
                if (list[idx]) setActiveTheme(list[idx].id);
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                lastFrameMs = performance.now();
            }
        });
    }

    // ---------- Boot ----------
    function boot() {
        resizeCanvas();
        buildPicker();
        wireEvents();

        const stored = (() => {
            try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
        })();
        const themes = LiveWallpaper.list();
        const initialId = (stored && themes.some(t => t.id === stored))
            ? stored
            : (themes[0] && themes[0].id);
        if (initialId) setActiveTheme(initialId);

        scheduleIdleHide();
        rafId = requestAnimationFrame(frame);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
