// Theme handling. An inline script in <head> applies the saved theme class to
// <html> before first paint; this file wires up the navbar toggle button.
// initDarkModeToggle is exposed globally so pages that rebuild the navbar
// (e.g. projects.js interactive mode) can re-bind the new toggle button.
(function () {
    function currentTheme() {
        try {
            const stored = localStorage.getItem('theme');
            if (stored === 'dark' || stored === 'light') return stored;
        } catch (e) { /* storage unavailable */ }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        const root = document.documentElement;
        root.classList.toggle('dark-mode', theme === 'dark');
        root.classList.toggle('light-mode', theme !== 'dark');
        const toggle = document.getElementById('theme-toggle');
        if (toggle) toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    }

    window.initDarkModeToggle = function () {
        const toggle = document.getElementById('theme-toggle');
        if (!toggle) return;

        applyTheme(currentTheme());

        toggle.addEventListener('click', function () {
            const next = document.documentElement.classList.contains('dark-mode') ? 'light' : 'dark';
            try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
            applyTheme(next);
        });
    };

    document.addEventListener('DOMContentLoaded', window.initDarkModeToggle);
})();
