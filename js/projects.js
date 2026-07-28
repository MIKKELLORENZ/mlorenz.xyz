document.addEventListener('DOMContentLoaded', function() {
    // Sample projects data (this would typically come from a JSON file or API)
    const projects = [
        {
            id: "cosmo_lab",
            title: "Cosmo Lab",
            description: "An interactive simulation of particle interactions and physics.",
            thumbnail: "../vibe-code/simulations/cosmo_lab/thumbnail.jpg",
            category: "simulations",
            tags: ["photons","physics","javascript","planets"],
            date: "2025-04-26",
            path: "simulations/cosmo_lab/index.html",
            type: "iframe"
        },

        {
            id: "moon_lander",
            title: "Moon Lander",
            description: "A game where you control a lunar module and try to land safely on the moon.",
            thumbnail: "../vibe-code/games/moon_lander/thumbnail.jpg",
            category: "games",
            tags: ["space", "physics", "javascript"],
            date: "2024-05-20",
            path: "games/moon_lander/moon_lander.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "stockman",
            title: "Stockman",
            description: "A stock trading simulation game.",
            thumbnail: "https://github.com/MIKKELLORENZ/stockman/blob/main/menu_wallpaper.png?raw=true",
            category: "games",
            tags: ["stocks", "trading", "simulation", "javascript"],
            date: "2026-04-20",
            path: "games/stockman/index.html",
            type: "iframe"
        },

        {
            id: "craft_note",
            title: "Craft Note",
            description: "A sticky-note board for quick notes and to-dos, right in your browser.",
            thumbnail: "../vibe-code/utilities/craft_note/thumbnail.jpg",
            category: "utilities",
            tags: ["sticky notes", "productivity", "javascript", "utilities","note-taking","to-do", "to do"],
            date: "2025-07-17",
            path: "utilities/craft_note/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "hdr_enhance",
            title: "HDR Enhance",
            description: "Enhance your images with simulated High Dynamic Range (HDR) processing.",
            thumbnail: "../vibe-code/utilities/hdr_enhance/thumbnail.jpg",
            category: "utilities",
            tags: ["image processing", "hdr", "javascript"],
            date: "2025-06-29",
            path: "utilities/hdr_enhance/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "everdiff",
            title: "EverDiff",
            description: "A browser-based document diff tool with multi-pane comparison, exports, and granular word, character, line, or sentence diffs.",
            thumbnail: "../vibe-code/utilities/everdiff/thumbnail.jpg",
            category: "utilities",
            tags: ["diff", "documents", "text comparison", "javascript", "export"],
            date: "2026-04-20",
            path: "utilities/everdiff/index.html",
            type: "iframe"
        },

        {
            id: "live_wallpaper",
            title: "Matrix Live Wallpaper",
            description: "A customizable Matrix-style live wallpaper with visual presets, color modes, performance controls, and screenshots.",
            thumbnail: "../vibe-code/utilities/live_wallpaper/thumbnail.jpg",
            category: "utilities",
            tags: ["wallpaper", "matrix", "animation", "canvas", "customization"],
            date: "2026-04-20",
            path: "utilities/live_wallpaper/index.html",
            type: "iframe"
        },

        {
            id: "random_password_generator",
            title: "Random Password Generator",
            description: "Generate secure random passwords with customizable options.",
            thumbnail: "../vibe-code/utilities/random_password_generator/thumbnail.jpg",
            category: "utilities",
            tags: ["security", "passwords", "javascript"],
            date: "2025-05-03",
            path: "utilities/random_password_generator/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },


        {
            id: "neural_racers",
            title: "Neural Racers",
            description: "Watch cars with ray sensors and recurrent neural-network brains learn to race — and fire at rivals — via evolutionary reinforcement learning. Switch tracks to test how well they generalize.",
            thumbnail: "../vibe-code/simulations/2d_driving_reinforcement_learning/thumbnail.png",
            category: "simulations",
            tags: ["reinforcement learning", "neural network", "cars", "racing", "evolution", "machine learning", "javascript"],
            date: "2026-06-11",
            path: "simulations/2d_driving_reinforcement_learning/index.html",
            type: "iframe"
        },

        {
            id: "neural_arena",
            title: "Neural Arena",
            description: "Battle-only sibling of Neural Racers: cars with line-of-sight sensors evolve to fight, dodge and hide behind cover while a danger zone closes in. Free-for-all, or red vs blue with two co-evolving gene pools.",
            thumbnail: "../vibe-code/simulations/neural_arena/thumbnail.png",
            category: "simulations",
            tags: ["reinforcement learning", "neural network", "battle", "evolution", "machine learning", "javascript"],
            date: "2026-06-11",
            path: "simulations/neural_arena/index.html",
            type: "iframe"
        },

        {
            id: "stick_balance",
            title: "Stick Balance",
            description: "Physics simulation of balancing a stick with reinforcement learning.",
            thumbnail: "../vibe-code/simulations/stick_balance/thumbnail.jpg",
            category: "simulations",
            tags: ["physics", "balance", "reinforcement learning"],
            date: "2025-01-10",
            path: "simulations/stick_balance/index.html",
            type: "iframe"
        },

        {
            id: "bayesian_optimization",
            title: "Bayesian Optimization (Interactive)",
            description: "Don't know Bayesian Optimization? Learn it by brewing coffee!",
            thumbnail: "../vibe-code/simulations/bayesian_optimization/thumbnail.jpg",
            category: "simulations",
            tags: ["bayesian optimization", "machine learning", "interactive","coffee","optimization"],
            date: "2025-07-23",
            path: "simulations/bayesian_optimization/index.html",
            type: "iframe"
        },

        {
            id: "laser_cut_puzzle_maker",
            title: "Laser Cut Puzzle Maker",
            description: "Create custom laser-cut ready puzzles from your images.",
            thumbnail: "../vibe-code/utilities/laser_cut_puzzle_maker/thumbnail.jpg",
            category: "utilities",
            tags: ["laser cut", "puzzle", "image processing"],
            date: "2025-12-27",
            path: "utilities/laser_cut_puzzle_maker/index.html",
            type: "iframe"
        },

        {
            id: "laser_cutter_studio",
            title: "Laser Cutter Studio",
            description: "Browser-based laser cutter / engraver with layers, dithering, GCode export and preview.",
            thumbnail: "../vibe-code/utilities/laser_cutter_studio/thumbnail.png",
            category: "utilities",
            tags: ["laser cut", "engraver", "gcode", "grbl", "lightburn", "dithering", "svg", "pdf"],
            date: "2026-04-17",
            path: "utilities/laser_cutter_studio/index.html",
            type: "iframe"
        },

        {
            id: "audio_studio",
            title: "Audio Studio",
            description: "A browser-based digital audio workstation with multi-track recording, EQ, compression, effects, and more.",
            thumbnail: "../vibe-code/utilities/audio_studio/thumbnail.png",
            category: "utilities",
            tags: ["audio", "music", "DAW", "recording", "mixing", "EQ", "compressor", "effects"],
            date: "2026-04-04",
            path: "utilities/audio_studio/index.html",
            type: "iframe"
        },

        {
            id: "chess_neuro_evolution",
            title: "Chess Neuroevolution",
            description: "A population of neural-network chess players evolves through elitism, crossover and mutation — no backpropagation. Watch the champion play live while fitness, game outcomes and brain activations update each generation.",
            thumbnail: "../vibe-code/simulations/chess_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["chess", "neuroevolution", "neural network", "evolution", "genetic algorithm", "machine learning", "javascript"],
            date: "2026-07-18",
            path: "simulations/chess_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "neural_moon_landers",
            title: "Neural Moon Landers",
            description: "A population of recurrent neural-network pilots evolves to touch down softly on the moon. Five terrains — from open plains to a needle rift — test how well the champion generalizes beyond what it trained on.",
            thumbnail: "../vibe-code/simulations/moon_lander_reinforcement_learning/thumbnail.png",
            category: "simulations",
            tags: ["moon lander", "neural network", "evolution", "reinforcement learning", "machine learning", "physics", "javascript"],
            date: "2026-07-18",
            path: "simulations/moon_lander_reinforcement_learning/index.html",
            type: "iframe"
        },

        {
            id: "food_delivery_neuro_evolution",
            title: "Food Delivery Neuroevolution",
            description: "Neural-network couriers evolve to follow a GPS route through procedurally generated towns, picking up food and delivering it to customers — dodging trees, pedestrians and each other while learning to keep right and stop for red lights. Copy-paste crossover and slider-driven mutation, no backpropagation.",
            thumbnail: "../vibe-code/simulations/food_delivery_neuro_evolution/thumbnail.png",
            category: "simulations",
            tags: ["food delivery", "self-driving", "neural network", "neuroevolution", "genetic algorithm", "a-star", "machine learning", "javascript"],
            date: "2026-07-19",
            path: "simulations/food_delivery_neuro_evolution/index.html",
            type: "iframe"
        },

        {
            id: "smart_ocean_boats",
            title: "Smart Ocean Boats",
            description: "Real-scale hydrofoil boats evolve to chase an endless chain of GPS waypoints across three hand-crafted seas — countering wind, gyres and tidal currents, then learning to dodge (and in the combat stage, hunt) each other. Elites, crossover and champion grace, no backpropagation.",
            thumbnail: "../vibe-code/simulations/smart_ocean_boats/thumbnail.png",
            category: "simulations",
            tags: ["boats", "hydrofoil", "neuroevolution", "neural network", "genetic algorithm", "gps navigation", "ocean currents", "machine learning", "javascript"],
            date: "2026-07-21",
            path: "simulations/smart_ocean_boats/index.html",
            type: "iframe"
        },

        {
            id: "todo",
            title: "Todo",
            description: "A quiet, minimal to-do list. Add, check off, rename by double-click and drag to reorder, with soft sounds and three color modes — light, dark and navy. Everything lives in your browser's local storage, so clearing your browsing data clears the list.",
            thumbnail: "../vibe-code/utilities/todo/thumbnail.jpg",
            category: "utilities",
            tags: ["to-do", "to do", "todo list", "tasks", "productivity", "local storage", "minimal", "javascript"],
            date: "2026-07-27",
            path: "utilities/todo/index.html",
            type: "iframe",
            featured: false // thumbnail doesn't carry a full-bleed hero slide
        },



    ];

    /* ═══════════════════════════════════════════════════════════
       Config & derived data
       ═══════════════════════════════════════════════════════════ */

    const FEATURED_COUNT = 5;      // slides in the showcase carousel
    const NEW_WINDOW_DAYS = 21;    // "NEW" badge window, measured from the latest project
    const SLIDE_DURATION = 7000;   // ms per carousel slide

    const CATEGORY_LABELS = {
        all: 'Everything',
        simulations: 'Simulations',
        games: 'Games',
        utilities: 'Utilities'
    };

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Parse "YYYY-MM-DD" as a local date — new Date(str) treats it as UTC,
    // which can render as the previous day in western time zones.
    function parseDate(str) {
        const [y, m, d] = String(str).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    }

    function formatDate(str) {
        return parseDate(str).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });
    }

    function esc(str) {
        return String(str).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    const byNewest = [...projects].sort((a, b) => parseDate(b.date) - parseDate(a.date));
    const latestTime = byNewest.length ? parseDate(byNewest[0].date).getTime() : 0;
    const newCutoff = latestTime - NEW_WINDOW_DAYS * 86400000;

    const isNew = project => parseDate(project.date).getTime() >= newCutoff;

    // Opt a project out of the showcase with `featured: false` when its
    // thumbnail doesn't hold up at hero size. It still appears in the grid.
    const featured = byNewest
        .filter(project => project.featured !== false)
        .slice(0, FEATURED_COUNT);

    /* ═══════════════════════════════════════════════════════════
       DOM references & view state
       ═══════════════════════════════════════════════════════════ */

    const projectsContainer = document.getElementById('projects-container');
    const showcaseEl = document.getElementById('showcase');
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const searchField = searchInput ? searchInput.closest('.vc-search') : null;
    const pillsEl = document.getElementById('category-pills');
    const sortOptions = document.getElementById('sort-options');
    const searchContainer = document.querySelector('.search-container');

    // Store the original navbar content to restore it later
    const navbar = document.querySelector('.navbar');
    let originalNavbarHTML = null;

    // Flag to track if a game/simulation is active
    let isInteractiveContentActive = false;

    let activeCategory = 'all';
    let carousel = null;   // teardown handle for the showcase
    let cardObserver = null;

    /* ═══════════════════════════════════════════════════════════
       Featured showcase carousel
       ═══════════════════════════════════════════════════════════ */

    function buildShowcase(items) {
        if (!showcaseEl || !items.length) return;

        const slides = items.map((project, i) => `
            <a class="vc-slide${i === 0 ? ' is-active' : ''}" href="?project=${encodeURIComponent(project.id)}"
               role="group" aria-roledescription="slide" aria-label="${i + 1} of ${items.length}: ${esc(project.title)}"
               ${i === 0 ? '' : 'tabindex="-1" aria-hidden="true"'}>
                <div class="vc-slide-media">
                    <img src="${esc(project.thumbnail)}" alt="" ${i === 0 ? '' : 'loading="lazy"'} decoding="async">
                </div>
                <div class="vc-slide-scrim"></div>
                <div class="vc-slide-body">
                    <div class="vc-eyebrow">
                        ${isNew(project) ? '<span class="vc-chip-new">New</span>' : ''}
                        <span>${esc(CATEGORY_LABELS[project.category] || project.category)}</span>
                        <span class="vc-sep"></span>
                        <span>${formatDate(project.date)}</span>
                    </div>
                    <h2 class="vc-slide-title">${esc(project.title)}</h2>
                    <p class="vc-slide-desc">${esc(project.description)}</p>
                    <span class="vc-slide-cta">Open project <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
                </div>
            </a>
        `).join('');

        const dots = items.map((project, i) => `
            <button type="button" class="vc-dot${i === 0 ? ' is-active' : ''}" data-index="${i}"
                    aria-label="Show ${esc(project.title)}"${i === 0 ? ' aria-current="true"' : ''}>
                <span class="vc-dot-fill"></span>
            </button>
        `).join('');

        showcaseEl.innerHTML = `
            <div class="vc-showcase${prefersReducedMotion || items.length < 2 ? ' no-autoplay' : ''}"
                 style="--vc-duration:${SLIDE_DURATION}ms">
                <div class="vc-showcase-viewport">${slides}</div>
                <button type="button" class="vc-showcase-arrow prev" aria-label="Previous project">
                    <i class="fas fa-chevron-left" aria-hidden="true"></i>
                </button>
                <button type="button" class="vc-showcase-arrow next" aria-label="Next project">
                    <i class="fas fa-chevron-right" aria-hidden="true"></i>
                </button>
                <div class="vc-dots">${dots}</div>
            </div>
        `;

        const root = showcaseEl.querySelector('.vc-showcase');
        const slideEls = Array.from(root.querySelectorAll('.vc-slide'));
        const dotEls = Array.from(root.querySelectorAll('.vc-dot'));
        const autoplay = !prefersReducedMotion && items.length > 1;
        let index = 0;

        function show(next) {
            index = (next + slideEls.length) % slideEls.length;

            slideEls.forEach((slide, i) => {
                const active = i === index;
                slide.classList.toggle('is-active', active);
                slide.setAttribute('aria-hidden', String(!active));
                slide.tabIndex = active ? 0 : -1;
            });

            dotEls.forEach((dot, i) => {
                const active = i === index;
                dot.classList.toggle('is-active', active);
                if (active) dot.setAttribute('aria-current', 'true');
                else dot.removeAttribute('aria-current');
            });

            // Restart the progress animation on the newly active dot
            if (autoplay) {
                const fill = dotEls[index].querySelector('.vc-dot-fill');
                fill.style.animation = 'none';
                void fill.offsetWidth; // force reflow so the animation replays
                fill.style.animation = '';
            }
        }

        // Autoplay is driven by the progress bar finishing, so pausing the CSS
        // animation (hover, focus, hidden tab) pauses advancement for free.
        function onProgressEnd(e) {
            if (e.animationName === 'vc-progress' && e.target.closest('.vc-dot.is-active')) {
                show(index + 1);
            }
        }

        const setPaused = paused => root.classList.toggle('is-paused', paused);
        const onVisibility = () => setPaused(document.hidden);

        if (autoplay) {
            root.addEventListener('animationend', onProgressEnd);
            root.addEventListener('pointerenter', () => setPaused(true));
            root.addEventListener('pointerleave', () => setPaused(false));
            root.addEventListener('focusin', () => setPaused(true));
            root.addEventListener('focusout', () => setPaused(false));
            document.addEventListener('visibilitychange', onVisibility);
        }

        root.querySelector('.prev').addEventListener('click', () => show(index - 1));
        root.querySelector('.next').addEventListener('click', () => show(index + 1));
        dotEls.forEach(dot => dot.addEventListener('click', () => show(Number(dot.dataset.index))));

        root.addEventListener('keydown', e => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
        });

        // Swipe — and swallow the click that a swipe would otherwise trigger
        let startX = null;
        let swiped = false;
        root.addEventListener('pointerdown', e => { startX = e.clientX; swiped = false; });
        root.addEventListener('pointerup', e => {
            if (startX === null) return;
            const dx = e.clientX - startX;
            startX = null;
            if (Math.abs(dx) > 45) {
                swiped = true;
                show(dx < 0 ? index + 1 : index - 1);
            }
        });
        root.addEventListener('click', e => {
            if (swiped) { e.preventDefault(); swiped = false; }
        }, true);

        show(0);

        carousel = {
            destroy() {
                document.removeEventListener('visibilitychange', onVisibility);
                showcaseEl.innerHTML = '';
                carousel = null;
            }
        };
    }

    function destroyShowcase() {
        if (carousel) carousel.destroy();
        else if (showcaseEl) showcaseEl.innerHTML = '';
    }

    /* ═══════════════════════════════════════════════════════════
       Toolbar — segmented category control
       ═══════════════════════════════════════════════════════════ */

    function buildPills() {
        if (!pillsEl) return;

        const counts = projects.reduce((acc, p) => {
            acc[p.category] = (acc[p.category] || 0) + 1;
            return acc;
        }, {});

        // Order categories by how recently each was added to, newest first
        const order = Object.keys(counts).sort((a, b) => newestIn(b) - newestIn(a));

        const buttons = ['all', ...order].map(key => `
            <button type="button" class="vc-pill${key === activeCategory ? ' is-active' : ''}"
                    data-category="${key}" role="tab" aria-selected="${key === activeCategory}">
                ${esc(CATEGORY_LABELS[key] || key)}<span class="vc-pill-count">${key === 'all' ? projects.length : counts[key]}</span>
            </button>
        `).join('');

        pillsEl.innerHTML = `<span class="vc-pill-thumb" aria-hidden="true"></span>${buttons}`;

        pillsEl.querySelectorAll('.vc-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                activeCategory = pill.dataset.category;
                pillsEl.querySelectorAll('.vc-pill').forEach(p => {
                    const on = p === pill;
                    p.classList.toggle('is-active', on);
                    p.setAttribute('aria-selected', String(on));
                });
                moveThumb();
                applyFilters();
            });
        });

        moveThumb();
        window.addEventListener('resize', moveThumb);
        // Pill widths change once the web font swaps in
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(moveThumb);
        }
    }

    function newestIn(category) {
        return projects
            .filter(p => p.category === category)
            .reduce((max, p) => Math.max(max, parseDate(p.date).getTime()), 0);
    }

    function moveThumb() {
        if (!pillsEl) return;
        const thumb = pillsEl.querySelector('.vc-pill-thumb');
        const active = pillsEl.querySelector('.vc-pill.is-active');
        if (!thumb || !active) return;
        thumb.style.width = `${active.offsetWidth}px`;
        thumb.style.transform = `translateX(${active.offsetLeft}px)`;
    }

    /* ═══════════════════════════════════════════════════════════
       Grid rendering
       ═══════════════════════════════════════════════════════════ */

    function setInteractiveMode(enabled, projectTitle = null) {
        const mainContent = document.getElementById('main-content');

        if (enabled) {
            // Save original navbar HTML if we haven't already
            if (originalNavbarHTML === null) {
                originalNavbarHTML = navbar.innerHTML;
            }

            // Replace navbar content with title and back button
            const navbarContainer = navbar.querySelector('.container');
            navbarContainer.innerHTML = `
                <button id="nav-back-button" class="nav-back-button">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                <div class="project-title-container">
                    <span class="project-title">${esc(projectTitle || 'Interactive Project')}</span>
                </div>
                <button id="theme-toggle" aria-label="Toggle dark mode"></button>
            `;

            // Add event listener to the new back button
            document.getElementById('nav-back-button').addEventListener('click', () => {
                window.location.href = 'index.html';
            });

            // Re-initialize dark mode toggle
            if (typeof initDarkModeToggle === 'function') {
                initDarkModeToggle();
            }

            mainContent.classList.add('interactive-mode');
            document.body.classList.add('interactive-mode');
        } else {
            // Restore original navbar
            if (originalNavbarHTML !== null) {
                navbar.innerHTML = originalNavbarHTML;

                // Re-initialize dark mode toggle
                if (typeof initDarkModeToggle === 'function') {
                    initDarkModeToggle();
                }
            }

            mainContent.classList.remove('interactive-mode');
            document.body.classList.remove('interactive-mode');
        }

        isInteractiveContentActive = enabled;
    }

    // Reveal cards as they scroll in, staggered per grid row
    function observeCards(cards) {
        if (prefersReducedMotion) {
            cards.forEach(card => card.classList.add('is-in'));
            return;
        }

        if (!cardObserver) {
            cardObserver = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const card = entry.target;
                    card.classList.add('is-in');
                    obs.unobserve(card);
                    // Drop the stagger once the entrance has played, otherwise it
                    // would also delay the hover lift for the rest of the session.
                    setTimeout(() => { card.style.transitionDelay = ''; }, 1200);
                });
            }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
        }

        cards.forEach((card, i) => {
            card.style.transitionDelay = `${Math.min(i, 7) * 0.055}s`;
            cardObserver.observe(card);
        });
    }

    function sectionHeader(title, count) {
        const head = document.createElement('div');
        head.className = 'vc-section-head';
        head.innerHTML = `
            <h2 class="vc-section-title">${esc(title)}</h2>
            <span class="vc-section-count">${count}</span>
            <span class="vc-section-rule"></span>
        `;
        return head;
    }

    function renderGrid(items) {
        const grid = document.createElement('div');
        grid.className = 'grid';
        items.forEach(project => grid.appendChild(createProjectCard(project)));
        return grid;
    }

    // Function to display projects as cards
    function displayProjects(projectsArray, options = {}) {
        const { grouped = true, heading = null } = options;

        // Show the toolbar when viewing the project list. The showcase's own
        // visibility is decided by applyFilters(), so it is deliberately untouched.
        if (searchContainer) searchContainer.style.display = '';

        // Reset interactive mode when viewing projects list
        setInteractiveMode(false);

        projectsContainer.innerHTML = '';

        if (!projectsArray.length) {
            projectsContainer.innerHTML = `
                <div class="vc-empty">
                    <i class="fas fa-ghost" aria-hidden="true"></i>
                    <strong>Nothing here yet</strong>
                    <span>No project matches that search.</span>
                    <div><button type="button" id="vc-reset">Clear filters</button></div>
                </div>
            `;
            const reset = document.getElementById('vc-reset');
            if (reset) reset.addEventListener('click', resetFilters);
            return;
        }

        const cards = [];

        if (grouped) {
            // Categories ordered by their most recent project, so a brand new
            // project pulls its whole section to the top of the page.
            const groups = groupByCategory(projectsArray);
            Object.keys(groups)
                .sort((a, b) => newestIn(b) - newestIn(a))
                .forEach(category => {
                    projectsContainer.appendChild(
                        sectionHeader(CATEGORY_LABELS[category] || category, groups[category].length)
                    );
                    const grid = renderGrid(groups[category]);
                    projectsContainer.appendChild(grid);
                    cards.push(...grid.children);
                });
        } else {
            projectsContainer.appendChild(sectionHeader(heading || 'Results', projectsArray.length));
            const grid = renderGrid(projectsArray);
            projectsContainer.appendChild(grid);
            cards.push(...grid.children);
        }

        observeCards(cards);
    }

    // Function to group projects by category
    function groupByCategory(projects) {
        return projects.reduce((acc, project) => {
            const category = project.category;
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(project);
            return acc;
        }, {});
    }

    // Function to create a project card
    function createProjectCard(project) {
        // A real anchor gives keyboard access, middle-click, and link previews for free
        const card = document.createElement('a');
        card.classList.add('card');
        card.href = `?project=${encodeURIComponent(project.id)}`;
        card.innerHTML = `
            <div class="card-image">
                ${isNew(project) ? '<span class="card-badge">New</span>' : ''}
                <img src="${esc(project.thumbnail)}" alt="${esc(project.title)}" loading="lazy" decoding="async" onerror="this.hidden = true; this.nextElementSibling.hidden = false;">
                <div class="card-image-fallback" hidden>
                    <span>${esc(project.title)}</span>
                </div>
            </div>
            <div class="card-content">
                <div class="card-meta">
                    <span>${esc(CATEGORY_LABELS[project.category] || project.category)}</span>
                    <span class="vc-sep"></span>
                    <span>${formatDate(project.date)}</span>
                </div>
                <h3 class="card-title">${esc(project.title)}</h3>
                <p class="card-description">${esc(project.description)}</p>
                <div class="card-tags">
                    ${project.tags.slice(0, 4).map(tag => `<span class="tag">${esc(tag)}</span>`).join('')}
                </div>
            </div>
        `;

        return card;
    }

    // Spotlight follows the cursor across whichever card it is over
    if (window.matchMedia('(hover: hover)').matches) {
        let frame = null;
        projectsContainer.addEventListener('pointermove', e => {
            const card = e.target.closest('.card');
            if (!card || frame) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                const rect = card.getBoundingClientRect();
                card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
                card.style.setProperty('--my', `${e.clientY - rect.top}px`);
            });
        });
    }

    // Function to load a specific project
    function loadProject(projectId) {
        const project = projects.find(p => p.id === projectId);

        if (project) {
            // Hide the gallery chrome while a project is open
            if (searchContainer) searchContainer.style.display = 'none';
            destroyShowcase();
            if (showcaseEl) showcaseEl.style.display = 'none';

            // Clear the main content
            projectsContainer.innerHTML = '';

            // Create project container with maximum height
            const projectFrame = document.createElement('div');
            projectFrame.style.width = '100%';
            projectFrame.style.height = 'calc(100vh - 35px)'; // Reduced to 35px for ultra-thin navbar in interactive mode
            projectFrame.style.border = 'none';
            projectFrame.style.display = 'flex';
            projectFrame.style.flexDirection = 'column';
            projectFrame.style.position = 'relative'; // For absolute positioning of overlay elements
            projectFrame.style.marginTop = '0'; // Remove margin to push it up

            // Determine project type if not explicitly set
            const projectType = project.type || getProjectTypeFromPath(project.path);

            // Set interactive mode based on project type with project title
            setInteractiveMode(projectType === 'iframe' || projectType === 'canvas', project.title);

            // Load project based on type
            switch(projectType) {
                case 'iframe':
                    loadIframeProject(project, projectFrame);
                    break;
                case 'canvas':
                    loadCanvasProject(project, projectFrame);
                    break;
                default:
                    // Default fallback
                    setInteractiveMode(false);
                    projectFrame.innerHTML += `
                        <div style="padding: 20px; background-color: var(--bg-secondary); border-radius: 8px; min-height: calc(100vh - 250px);">
                            <p>Project content would load here. This is a placeholder for ${esc(project.title)}.</p>
                            <p>In a real implementation, this would load the project's content from: ${esc(project.path)}</p>
                        </div>
                    `;
            }

            projectsContainer.appendChild(projectFrame);

            // Update title and history state. replaceState (not pushState): this runs
            // on initial load of ?project=… pages, and pushing would duplicate the
            // entry so the back button needs two presses to leave.
            document.title = `${project.title} - Vibe Code`;
            history.replaceState({projectId: project.id}, '', `?project=${project.id}`);
        } else {
            // Project not found, redirect to projects list
            window.location.href = 'index.html';
        }
    }

    // Function to determine project type from file path
    function getProjectTypeFromPath(path) {
        const extension = path.split('.').pop().toLowerCase();

        switch(extension) {
            case 'html':
                return 'iframe';
            case 'js':
                return 'canvas'; // Assume JS files are for canvas-based projects
            default:
                return 'unknown';
        }
    }

    // Function to load iframe-based projects
    function loadIframeProject(project, container) {
        const iframeContainer = document.createElement('div');
        iframeContainer.style.width = '100%';
        iframeContainer.style.height = '100%'; // Take full height of parent
        iframeContainer.style.position = 'relative';
        iframeContainer.style.margin = '0';
        iframeContainer.style.overflow = 'hidden';
        iframeContainer.style.borderRadius = '0'; // Remove border radius to maximize space
        iframeContainer.style.flex = '1'; // Take remaining space
        iframeContainer.classList.add('interactive-container');

        // Create iframe
        const iframe = document.createElement('iframe');
        iframe.src = `../vibe-code/${project.path}`;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.overflow = 'hidden';
        iframe.id = 'interactive-iframe';

        iframeContainer.appendChild(iframe);
        container.appendChild(iframeContainer);

        // Focus handling for keyboard events
        iframe.addEventListener('load', () => {
            setupKeyboardControl(iframe, iframeContainer);
        });
    }

    // Function to load canvas-based projects
    function loadCanvasProject(project, container) {
        // Create game container
        const gameContainer = document.createElement('div');
        gameContainer.id = 'game-container';
        gameContainer.style.width = '100%';
        gameContainer.style.height = '100%'; // Take full height of parent
        gameContainer.style.position = 'relative';
        gameContainer.style.margin = '0';
        gameContainer.style.backgroundColor = 'var(--bg-secondary)';
        gameContainer.style.overflow = 'hidden';
        gameContainer.style.borderRadius = '0'; // Remove border radius to maximize space
        gameContainer.style.flex = '1'; // Take remaining space
        gameContainer.classList.add('interactive-container');

        // Create canvas for the game
        const canvas = document.createElement('canvas');
        canvas.id = project.canvasId || 'game-canvas'; // Use project's canvas ID or default
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight - 35; // Reduced to 35px for ultra-thin navbar
        canvas.style.backgroundColor = '#000';
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        gameContainer.appendChild(canvas);
        container.appendChild(gameContainer);

        // Add instructions if available
        if (project.instructions) {
            const instructions = document.createElement('div');
            instructions.style.padding = '20px';
            instructions.style.textAlign = 'center';
            instructions.style.marginTop = '10px';
            instructions.innerHTML = project.instructions;
            container.appendChild(instructions);
        }

        // Load the project's JavaScript
        const script = document.createElement('script');
        script.src = `../vibe-code/${project.path}`;
        document.body.appendChild(script);

        // Set a small timeout to ensure the DOM is fully ready
        setTimeout(() => {
            // Force resize canvas to fill container
            const gameCanvas = document.getElementById(canvas.id);
            if (gameCanvas) {
                const containerWidth = gameContainer.clientWidth;
                const containerHeight = gameContainer.clientHeight;
                gameCanvas.width = containerWidth;
                gameCanvas.height = containerHeight;
            }

            // Setup keyboard control for canvas games
            setupKeyboardControl(canvas, gameContainer);
        }, 100);

        // Add event listener for window resize to keep canvas sized correctly
        window.addEventListener('resize', () => {
            const gameCanvas = document.getElementById(canvas.id);
            if (gameCanvas) {
                const containerWidth = gameContainer.clientWidth;
                const containerHeight = gameContainer.clientHeight;
                gameCanvas.width = containerWidth;
                gameCanvas.height = containerHeight;
            }
        });
    }

    // Function to setup keyboard control and prevent default scrolling
    function setupKeyboardControl(element, container) {
        // Track focus state
        let hasFocus = false;

        // Add focus indicator
        container.style.position = 'relative';

        // When user clicks on the interactive element
        container.addEventListener('click', function() {
            hasFocus = true;
            container.style.boxShadow = '0 0 0 2px rgba(66, 153, 225, 0.5)';

            // Try to focus the element
            if (element.contentWindow) {
                // For iframes
                element.contentWindow.focus();
            } else {
                // For canvas and other elements
                element.focus();
            }
        });

        // When user clicks elsewhere
        document.addEventListener('click', function(e) {
            if (!container.contains(e.target)) {
                hasFocus = false;
                container.style.boxShadow = 'none';
            }
        });

        // Prevent default scrolling behavior when arrows are used and container has focus
        document.addEventListener('keydown', function(e) {
            // Check if the interactive content has focus
            if (hasFocus || isInteractiveContentActive) {
                // Prevent default for arrow keys, space and other gaming-related keys
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space', 'w', 'a', 's', 'd'].includes(e.key)) {
                    e.preventDefault();
                }
            }
        }, { passive: false });

        // Add touch support for mobile
        container.addEventListener('touchstart', function() {
            hasFocus = true;
            container.style.boxShadow = '0 0 0 2px rgba(66, 153, 225, 0.5)';
        });
    }

    /* ═══════════════════════════════════════════════════════════
       Filtering
       ═══════════════════════════════════════════════════════════ */

    function applyFilters() {
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const sortValue = sortOptions ? sortOptions.value : 'newest';

        if (searchField) searchField.classList.toggle('has-value', !!searchTerm);

        let filteredProjects = projects.filter(project => {
            const matchesSearch = !searchTerm ||
                project.title.toLowerCase().includes(searchTerm) ||
                project.description.toLowerCase().includes(searchTerm) ||
                project.category.toLowerCase().includes(searchTerm) ||
                project.tags.some(tag => tag.toLowerCase().includes(searchTerm));

            const matchesCategory = activeCategory === 'all' || project.category === activeCategory;

            return matchesSearch && matchesCategory;
        });

        switch(sortValue) {
            case 'newest':
                filteredProjects.sort((a, b) => parseDate(b.date) - parseDate(a.date));
                break;
            case 'oldest':
                filteredProjects.sort((a, b) => parseDate(a.date) - parseDate(b.date));
                break;
            case 'az':
                filteredProjects.sort((a, b) => a.title.localeCompare(b.title));
                break;
            case 'za':
                filteredProjects.sort((a, b) => b.title.localeCompare(a.title));
                break;
        }

        // The showcase is a "start here" surface — it only belongs on the
        // unfiltered view, where it isn't competing with the user's own query.
        const isDefaultView = !searchTerm && activeCategory === 'all';
        if (showcaseEl) showcaseEl.style.display = isDefaultView ? '' : 'none';

        const heading = searchTerm
            ? `Results for “${searchTerm}”`
            : (CATEGORY_LABELS[activeCategory] || activeCategory);

        displayProjects(filteredProjects, {
            grouped: isDefaultView,
            heading
        });
    }

    function resetFilters() {
        if (searchInput) searchInput.value = '';
        activeCategory = 'all';
        if (pillsEl) {
            pillsEl.querySelectorAll('.vc-pill').forEach(p => {
                const on = p.dataset.category === 'all';
                p.classList.toggle('is-active', on);
                p.setAttribute('aria-selected', String(on));
            });
            moveThumb();
        }
        applyFilters();
    }

    /* ═══════════════════════════════════════════════════════════
       Boot
       ═══════════════════════════════════════════════════════════ */

    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (sortOptions) sortOptions.addEventListener('change', applyFilters);
    if (searchClear) {
        searchClear.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            applyFilters();
            if (searchInput) searchInput.focus();
        });
    }

    // "/" focuses search, Escape clears it — the way a gallery should behave
    document.addEventListener('keydown', e => {
        if (isInteractiveContentActive || !searchInput) return;
        if (e.key === '/' && document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        } else if (e.key === 'Escape' && document.activeElement === searchInput) {
            searchInput.value = '';
            applyFilters();
        }
    });

    buildPills();

    // Check if we need to load a specific project
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');

    if (projectId) {
        loadProject(projectId);
    } else {
        buildShowcase(featured);
        applyFilters();
    }

    // Handle browser back/forward navigation
    window.addEventListener('popstate', (event) => {
        if (event.state && event.state.projectId) {
            loadProject(event.state.projectId);
        } else {
            isInteractiveContentActive = false; // Reset flag when returning to project list
            if (!carousel) buildShowcase(featured);
            applyFilters();
            document.title = 'Vibe Code - Projects Gallery';
        }
    });
});
