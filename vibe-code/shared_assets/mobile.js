/* ══════════════════════════════════════════════════════════════════════════
   Shared mobile layer for the vibe-code simulations — the DOM half.

   On a narrow screen this takes the sim's side panels out of the flow and
   parks them in a bottom sheet, so the canvas keeps the entire screen and the
   controls are one tap away. Nothing is destroyed or rebuilt: the panels are
   the same nodes, just moved, so every element reference, event listener and
   chart the app already holds keeps working. Going back to a wide viewport
   puts them back exactly where they were.

   Opt-in markup (all optional):
     data-mob-panel            treat this element as a panel to move
     data-mob-label="Stats"    what its tab in the bottom bar says
     data-mob-skip             never move this one
     data-mob-bar              move this control into the bottom bar itself,
                               so it is reachable without opening the sheet
     data-mob-root             the element that should be exactly one screen tall
     data-mob-layout           the flex row holding stage + panels
     data-mob-stage            the thing that should get the whole screen

   With no attributes at all it finds #panel, #panel-left, #panel-right and
   #panel-chart next to #layout and #viewport, which is what the sims already
   use. The three structural hooks exist for the tool apps (laser studio, the
   DAW, the writer), which are the same shape under different class names.

   Exposes window.MobileUI = { active, open(i), close(), isPhone() }.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var MQ = '(max-width: 860px)';
    var DEFAULT_PANELS = '#panel, #panel-left, #panel-right, #panel-chart';
    var DEFAULT_LABELS = {
        'panel': 'Controls',
        'panel-left': 'Controls',
        'panel-right': 'Stats',
        'panel-chart': 'Charts'
    };

    var mq = window.matchMedia(MQ);
    var built = false;
    var sheet, scrim, bar, grip;
    var panels = [];      // { el, label, home: Comment, tab: <button> }
    var barMoved = [];    // { el, home: Comment }
    var activeIndex = -1;
    var sheetHome = null; // where the sheet lives while docked
    var aspect = window.MOB_STAGE_ASPECT || 0;  // world width / height
    var stageH = 0;

    function labelFor(el, i) {
        if (el.dataset.mobLabel) return el.dataset.mobLabel;
        if (DEFAULT_LABELS[el.id]) return DEFAULT_LABELS[el.id];
        var h = el.querySelector('h2, h3');
        if (h && h.textContent.trim()) return h.textContent.trim().split(/\s{2,}|·|—/)[0].slice(0, 14);
        return 'Panel ' + (i + 1);
    }

    /* The sims' own side panels, plus anything explicitly marked — an app that
       builds a panel at runtime can just set data-mob-panel on it and be
       picked up here whichever order the scripts happened to run in. */
    function findPanels() {
        var picked = document.querySelectorAll(DEFAULT_PANELS + ', [data-mob-panel]');
        var seen = [];
        Array.prototype.forEach.call(picked, function (el) {
            if (el.hasAttribute('data-mob-skip') || seen.indexOf(el) >= 0) return;
            seen.push(el);
        });
        return seen;
    }

    /* A comment node left where an element used to live, so it can go back to
       the same position among its siblings rather than at the end. */
    function bookmark(el) {
        var home = document.createComment('mob');
        el.parentNode.insertBefore(home, el);
        return home;
    }

    function restoreTo(home, el) {
        if (home && home.parentNode) home.parentNode.insertBefore(el, home);
        if (home && home.parentNode) home.parentNode.removeChild(home);
    }

    function build() {
        if (built) return;
        var found = findPanels();
        /* No panels means this page is not the standard sim shell — leave it
           alone beyond the touch-sizing CSS. */
        if (!found.length) return;
        built = true;
        document.body.classList.add('mob-shell');

        scrim = document.createElement('div');
        scrim.className = 'mob-scrim';
        scrim.addEventListener('click', close);

        sheet = document.createElement('div');
        sheet.className = 'mob-sheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-label', 'Simulation controls');

        grip = document.createElement('div');
        grip.className = 'mob-sheet-grip';
        grip.setAttribute('aria-hidden', 'true');
        sheet.appendChild(grip);

        bar = document.createElement('nav');
        bar.className = 'mob-bar';
        bar.setAttribute('aria-label', 'Simulation controls');

        /* Row one: whatever the app wants within thumb reach at all times —
           pause, speed. On a phone the topbar cannot hold these and the live
           stats without spilling, and the bottom of the screen is where a
           thumb already is. Row two: one tab per panel. */
        var actions = document.createElement('div');
        actions.className = 'mob-bar-actions';
        var wanted = document.querySelectorAll('[data-mob-bar]');
        Array.prototype.forEach.call(wanted, function (el) {
            barMoved.push({ el: el, home: bookmark(el) });
            actions.appendChild(el);
        });
        if (wanted.length) bar.appendChild(actions);

        var tabs = document.createElement('div');
        tabs.className = 'mob-bar-tabs';
        bar.appendChild(tabs);

        found.forEach(function (el, i) {
            var rec = { el: el, label: labelFor(el, i), home: bookmark(el) };
            el.classList.add('mob-panel');
            sheet.appendChild(el);

            var tab = document.createElement('button');
            tab.type = 'button';
            tab.textContent = rec.label;
            tab.setAttribute('aria-expanded', 'false');
            tab.addEventListener('click', function () {
                if (activeIndex === i && sheet.classList.contains('open')) close();
                else open(i);
            });
            tabs.appendChild(tab);
            rec.tab = tab;
            panels.push(rec);
        });

        document.body.appendChild(scrim);
        document.body.appendChild(sheet);
        document.body.appendChild(bar);

        syncBarHeight();
        /* The bar grows a row when the app has its own controls, and again if a
           panel is added later, so the stage's bottom padding tracks it rather
           than a number guessed once at startup. */
        if (window.ResizeObserver) {
            new ResizeObserver(syncBarHeight).observe(bar);
        }
        wireSwipe();
        wireTabScroll();
        document.addEventListener('keydown', onKey);
        if (aspect) dock();
        reflow();
    }

    /* ── Docked mode ──────────────────────────────────────────────────────
       A sim whose world is wider than it is tall fits itself into the stage
       and letterboxes the rest, which on a phone in portrait means half the
       screen is black. If the app tells us its world aspect we can give the
       stage exactly the height that world needs and hand the leftover to the
       panel, permanently open below it — so the space shows the fitness
       chart instead of nothing. Collapsing it (tap the lit tab) gives the
       stage everything back. */

    function syncBarHeight() {
        if (!bar) return;
        var h = Math.round(bar.getBoundingClientRect().height);
        if (!h) return;
        var prev = parseInt(document.documentElement.style.getPropertyValue('--mob-bar-h'), 10);
        if (prev === h) return;
        document.documentElement.style.setProperty('--mob-bar-h', h + 'px');
        measure();
    }

    function stageEl() {
        return document.querySelector('[data-mob-stage]') ||
               document.getElementById('viewport') ||
               document.getElementById('canvas-wrap') ||
               document.getElementById('stage') ||
               document.getElementById('stage-wrap') ||
               document.querySelector('.viewport');
    }

    function layoutEl() {
        return document.querySelector('[data-mob-layout]') ||
               document.getElementById('layout');
    }

    function dock() {
        var layout = layoutEl();
        var stage = stageEl();
        if (!layout || !stage || !sheet || sheet.classList.contains('docked')) return;
        sheetHome = document.createComment('mob-sheet');
        sheet.parentNode.insertBefore(sheetHome, sheet);
        layout.appendChild(sheet);
        sheet.classList.add('docked');
        document.body.classList.add('mob-docked');
        /* Docked, the panel is what you watch alongside the sim, so it opens
           on the readouts rather than the settings — the last panel is the
           charts/stats column in every sim here unless one says otherwise. */
        var pref = panels.findIndex(function (r) { return r.el.hasAttribute('data-mob-default'); });
        open(pref >= 0 ? pref : panels.length - 1);
        measure();
    }

    function undock() {
        if (!sheet || !sheet.classList.contains('docked')) return;
        sheet.classList.remove('docked');
        document.body.classList.remove('mob-docked');
        document.documentElement.style.removeProperty('--mob-stage-h');
        stageH = 0;
        if (sheetHome && sheetHome.parentNode) {
            sheetHome.parentNode.insertBefore(sheet, sheetHome);
            sheetHome.parentNode.removeChild(sheetHome);
        }
        sheetHome = null;
    }

    /* Height the stage needs to show the whole world at this width, clamped so
       the panel below always keeps a usable slice and the stage never becomes
       a strip. */
    function measure() {
        if (!aspect || !sheet || !sheet.classList.contains('docked')) return;
        var stage = stageEl();
        var layout = layoutEl();
        if (!stage || !layout) return;
        var avail = layout.clientHeight;
        var w = stage.clientWidth || document.documentElement.clientWidth;
        var want = Math.round(w / aspect);
        var h = Math.max(Math.min(avail * 0.34, 220), Math.min(want, avail * 0.66));
        if (Math.abs(h - stageH) < 2) return;
        stageH = h;
        document.documentElement.style.setProperty('--mob-stage-h', h + 'px');
        reflow();
    }

    /* Called by the app once it knows its world size — safe to call every
       frame, it only does work when the number actually changes. */
    function stageAspect(r) {
        if (!r || !isFinite(r) || Math.abs(r - aspect) < 0.01) return;
        aspect = r;
        window.MOB_STAGE_ASPECT = r;
        if (built) { dock(); measure(); }
    }

    /* For panels the app builds at runtime (after this file has already run),
       or floating overlays that have no business hovering over a phone-sized
       stage. Safe to call before the layer is built, and on desktop, where it
       does nothing. */
    function addPanel(el, label) {
        if (!el) return;
        el.setAttribute('data-mob-panel', '');
        if (label) el.setAttribute('data-mob-label', label);
        if (!built || panels.some(function (r) { return r.el === el; })) return;
        var i = panels.length;
        var rec = { el: el, label: label || labelFor(el, i), home: bookmark(el) };
        el.classList.add('mob-panel');
        sheet.appendChild(el);
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.textContent = rec.label;
        tab.addEventListener('click', function () {
            if (activeIndex === i && !document.body.classList.contains('mob-collapsed')) close();
            else open(i);
        });
        bar.querySelector('.mob-bar-tabs').appendChild(tab);
        rec.tab = tab;
        panels.push(rec);
        syncBarHeight();
    }

    function teardown() {
        if (!built) return;
        close();
        undock();
        document.body.classList.remove('mob-collapsed');
        panels.forEach(function (rec) {
            rec.el.classList.remove('mob-panel', 'active');
            restoreTo(rec.home, rec.el);
        });
        barMoved.forEach(function (rec) { restoreTo(rec.home, rec.el); });
        [scrim, sheet, bar].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
        document.removeEventListener('keydown', onKey);
        document.body.classList.remove('mob-shell');
        panels = [];
        barMoved = [];
        activeIndex = -1;
        built = false;
        reflow();
    }

    function open(i) {
        if (!built || !panels[i]) return;
        panels.forEach(function (rec, j) {
            rec.el.classList.toggle('active', i === j);
            rec.tab.classList.toggle('on', i === j);
            rec.tab.setAttribute('aria-expanded', i === j ? 'true' : 'false');
        });
        activeIndex = i;
        sheet.classList.remove('closing');
        sheet.classList.add('open');
        sheet.style.transform = '';
        var docked = sheet.classList.contains('docked');
        document.body.classList.remove('mob-collapsed');
        scrim.classList.toggle('on', !docked);
        if (docked) measure();
        /* Panels host live charts that size themselves to their container, and
           that container had zero width until now. */
        reflow();
    }

    function close() {
        if (!built || !sheet.classList.contains('open')) return;
        var docked = sheet.classList.contains('docked');
        panels.forEach(function (rec) {
            rec.tab.classList.remove('on');
            rec.tab.setAttribute('aria-expanded', 'false');
        });
        if (docked) {
            /* Docked: collapsing hands the whole stage back to the sim. */
            document.body.classList.add('mob-collapsed');
            reflow();
            return;
        }
        sheet.classList.add('closing');
        sheet.classList.remove('open');
        sheet.style.transform = '';
        scrim.classList.remove('on');
        window.setTimeout(function () { if (sheet) sheet.classList.remove('closing'); }, 300);
    }

    /* The mode strip (Train / Watch / Play) scrolls sideways on a phone, and a
       tab you cannot see is a tab you do not know exists. Keep the selected one
       in view — including at startup, where the active one may start off-screen
       to the right. */
    function wireTabScroll() {
        var strip = document.getElementById('mode-tabs');
        if (!strip) return;
        var show = function (el) {
            if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' });
        };
        strip.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('button') : null;
            if (btn) window.setTimeout(function () { show(btn); }, 0);
        });
        show(strip.querySelector('.active, [aria-selected="true"]'));
    }

    function onKey(e) {
        if (e.key === 'Escape') close();
    }

    /* Drag the grip down to dismiss — the gesture people already expect from
       every other bottom sheet on the device. */
    function wireSwipe() {
        var startY = 0, dy = 0, dragging = false;

        grip.addEventListener('pointerdown', function (e) {
            if (!sheet.classList.contains('open')) return;
            dragging = true;
            startY = e.clientY;
            dy = 0;
            sheet.style.transition = 'none';
            grip.setPointerCapture(e.pointerId);
        });

        grip.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            dy = Math.max(0, e.clientY - startY);
            sheet.style.transform = 'translateY(' + dy + 'px)';
        });

        function end() {
            if (!dragging) return;
            dragging = false;
            sheet.style.transition = '';
            sheet.style.transform = '';
            if (dy > 60) close();
        }

        grip.addEventListener('pointerup', end);
        grip.addEventListener('pointercancel', end);
    }

    /* Most of these sims size their canvas from the container on resize, so a
       synthetic resize is how we tell them the stage just changed shape. Two
       frames because the sheet's transition changes nothing until it lands. */
    function reflow() {
        var fire = function () { window.dispatchEvent(new Event('resize')); };
        fire();
        window.requestAnimationFrame(fire);
        window.setTimeout(fire, 320);
    }

    function apply() {
        if (mq.matches) {
            document.body.classList.add('mob');
            build();
        } else {
            document.body.classList.remove('mob');
            teardown();
        }
    }

    function init() {
        apply();
        if (mq.addEventListener) mq.addEventListener('change', apply);
        else if (mq.addListener) mq.addListener(apply);
        window.addEventListener('orientationchange', function () {
            window.setTimeout(function () { measure(); reflow(); }, 250);
        });
    }

    window.MobileUI = {
        open: open,
        close: close,
        addPanel: addPanel,
        reflow: reflow,
        stageAspect: stageAspect,
        isPhone: function () { return mq.matches; },
        get active() { return activeIndex; }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
