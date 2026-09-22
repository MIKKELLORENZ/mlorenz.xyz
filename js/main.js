// Site behaviour. Loaded with `defer` on every page except the Vibe Code
// gallery, which has projects.js instead.
(function () {
    // The inline <head> script hides [data-reveal] content only while this
    // flag is unset; if this file never runs, it shows everything again.
    window.siteReady = true;

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('[data-year]').forEach(function (el) {
        el.textContent = new Date().getFullYear();
    });

    // The hero render fades in once it has decoded, rather than painting in
    // progressive bands.
    document.querySelectorAll('.hero-visual img').forEach(function (img) {
        function show() { img.classList.add('is-loaded'); }
        if (img.complete && img.naturalWidth) show();
        else {
            img.addEventListener('load', show, { once: true });
            img.addEventListener('error', show, { once: true });
        }
    });

    // Major sections rise in once as they reach the viewport.
    var items = document.querySelectorAll('[data-reveal]');
    if (items.length) {
        if (reduceMotion || !('IntersectionObserver' in window)) {
            items.forEach(function (el) { el.classList.add('is-visible'); });
        } else {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                });
            }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
            items.forEach(function (el) { observer.observe(el); });
        }
    }

    // The portrait clip is about 1 MB. Show the still at once and fetch the
    // video when the page is idle, never on reduced motion, save-data or 2G.
    var video = document.querySelector('.portrait video[data-src]');
    if (video && !reduceMotion) {
        var conn = navigator.connection || {};
        if (!conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || '')) {
            var start = function () {
                video.muted = true;
                video.src = video.dataset.src;
                var playing = video.play();
                if (playing && playing.then) {
                    playing.then(function () { video.classList.add('is-playing'); }, function () {});
                } else {
                    video.classList.add('is-playing');
                }
            };
            var schedule = function () {
                (window.requestIdleCallback || function (f) { setTimeout(f, 500); })(start, { timeout: 3000 });
            };
            if (document.readyState === 'complete') schedule();
            else window.addEventListener('load', schedule, { once: true });
        }
    }
})();
