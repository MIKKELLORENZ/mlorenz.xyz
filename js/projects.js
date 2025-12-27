document.addEventListener('DOMContentLoaded', function() {
    // Sample projects data (this would typically come from a JSON file or API)
    const projects = [
        {
            id: "cosmo_lab",
            title: "Cosmo Lab",
            description: "An interactive simulation of particle interactions and physics.",
            thumbnail: "../vibe-code/projects/simulations/cosmo_lab/thumbnail.jpg",
            category: "simulations",
            tags: ["photons","physics","javascript","planets"],
            date: "2025-04-26",
            path: "projects/simulations/cosmo_lab/index.html",
            type: "iframe" 
        },

        {
            id: "moon_lander",
            title: "Moon Lander",
            description: "A game where you control a lunar module and try to land safely on the moon.",
            thumbnail: "../vibe-code/projects/games/moon_lander/thumbnail.jpg",
            category: "games",
            tags: ["space", "physics", "javascript"],
            date: "2024-05-20",
            path: "projects/games/moon_lander/moon_lander.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "craft_note",
            title: "Craft Note",
            description: "",
            thumbnail: "../vibe-code/projects/utilities/craft_note/thumbnail.jpg",
            category: "utilities",
            tags: ["sticky notes", "productivity", "javascript", "utilities","note-taking","to-do", "to do"],
            date: "2025-07-17",
            path: "projects/utilities/craft_note/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "hdr_enhance",
            title: "HDR Enhance",
            description: "Enhance your images with simulated High Dynamic Range (HDR) processing.",
            thumbnail: "../vibe-code/projects/utilities/hdr_enhance/thumbnail.jpg",
            category: "utilities",
            tags: ["image processing", "hdr", "javascript"],
            date: "2025-06-29",
            path: "projects/utilities/hdr_enhance/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },

        {
            id: "random_password_generator",
            title: "Random Password Generator",
            description: "Generate secure random passwords with customizable options.",
            thumbnail: "../vibe-code/projects/utilities/random_password_generator/thumbnail.jpg",
            category: "utilities",
            tags: ["security", "passwords", "javascript"],
            date: "2025-05-03",
            path: "projects/utilities/random_password_generator/index.html",
            type: "iframe" // Explicitly set to load in iframe
        },


        {
            id: "stick_balance",
            title: "Stick Balance",
            description: "Physics simulation of balancing a stick with reinforcement learning.",
            thumbnail: "../vibe-code/projects/simulations/stick_balance/thumbnail.jpg",
            category: "simulations",
            tags: ["physics", "balance", "reinforcement learning"],
            date: "2025-01-10",
            path: "projects/simulations/stick_balance/index.html",
            type: "iframe"
        },

        {
            id: "bayesian_optimization",
            title: "Bayesian Optimization (Interactive)",
            description: "Don't know Bayesian Optimization? Learn it by brewing coffee!",
            thumbnail: "../vibe-code/projects/simulations/bayesian_optimization/thumbnail.jpg",
            category: "simulations",
            tags: ["bayesian optimization", "machine learning", "interactive","coffee","optimization"],
            date: "2025-07-23",
            path: "projects/simulations/bayesian_optimization/index.html",
            type: "iframe"
        },

        {
            id: "laser_cut_puzzle_maker",
            title: "Laser Cut Puzzle Maker",
            description: "Create custom laser-cut ready puzzles from your images.",
            thumbnail: "../vibe-code/projects/utilities/laser_cut_puzzle_maker/thumbnail.jpg",
            category: "utilities",
            tags: ["laser cut", "puzzle", "image processing"],
            date: "2025-12-27",
            path: "projects/utilities/laser_cut_puzzle_maker/index.html",
            type: "iframe"
        },



    ];

    const projectsContainer = document.getElementById('projects-container');
    const searchInput = document.getElementById('search-input');
    const categoryFilter = document.getElementById('category-filter');
    const sortOptions = document.getElementById('sort-options');
    const applyFiltersBtn = document.getElementById('apply-filters');
    const activeFilters = document.getElementById('active-filters');
    const searchContainer = document.querySelector('.search-container');
    
    // Store the original navbar content to restore it later
    const navbar = document.querySelector('.navbar');
    let originalNavbarHTML = null;

    // Flag to track if a game/simulation is active
    let isInteractiveContentActive = false;

    // Function to toggle interactive mode
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
                    <span class="project-title">${projectTitle || 'Interactive Project'}</span>
                </div>
                <button id="theme-toggle" aria-label="Toggle dark mode">
                    🌙
                </button>
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

    // Check if we need to load a specific project
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');

    if (projectId) {
        loadProject(projectId);
    } else {
        displayProjects(projects);
    }

    // Event listeners - Auto-trigger search and filters
    searchInput.addEventListener('input', applyFilters);
    categoryFilter.addEventListener('change', applyFilters);
    sortOptions.addEventListener('change', applyFilters);
    
    // Keep the manual apply button as well for explicit filtering
    applyFiltersBtn.addEventListener('click', applyFilters);
    
    // Function to display projects as cards
    function displayProjects(projectsArray) {
        // Show search container when viewing project list
        searchContainer.style.display = 'block';
        
        // Reset interactive mode when viewing projects list
        setInteractiveMode(false);
        
        projectsContainer.innerHTML = '';
        
        // Group projects by category
        const groupedProjects = groupByCategory(projectsArray);
        
        // Render each category
        for (const category in groupedProjects) {
            // Add category header
            const categoryHeader = document.createElement('h2');
            categoryHeader.classList.add('category-header');
            categoryHeader.textContent = category.charAt(0).toUpperCase() + category.slice(1);
            projectsContainer.appendChild(categoryHeader);
            
            // Create grid for this category
            const categoryGrid = document.createElement('div');
            categoryGrid.classList.add('grid');
            projectsContainer.appendChild(categoryGrid);
            
            // Add projects in this category
            groupedProjects[category].forEach(project => {
                const card = createProjectCard(project);
                categoryGrid.appendChild(card);
            });
        }
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
        const card = document.createElement('div');
        card.classList.add('card');
        card.innerHTML = `
            <div class="card-image">
                <img src="${project.thumbnail}" alt="${project.title}">
            </div>
            <div class="card-content">
                <h3 class="card-title">${project.title}</h3>
                <p class="card-description">${project.description}</p>
                <div class="card-tags">
                    ${project.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                </div>
            </div>
        `;
        
        // Add click event to open the project
        card.addEventListener('click', () => {
            window.location.href = `?project=${project.id}`;
        });
        
        return card;
    }
    
    // Function to load a specific project
    function loadProject(projectId) {
        const project = projects.find(p => p.id === projectId);
        
        if (project) {
            // Hide search container when viewing a project
            searchContainer.style.display = 'none';
            
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
                            <p>Project content would load here. This is a placeholder for ${project.title}.</p>
                            <p>In a real implementation, this would load the project's content from: ${project.path}</p>
                        </div>
                    `;
            }
            
            projectsContainer.appendChild(projectFrame);
            
            // Update browser history and title
            document.title = `${project.title} - Vibe Code`;
            history.pushState({projectId: project.id}, '', `?project=${project.id}`);
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
    
    // Function to apply filters and sort
    function applyFilters() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        const categoryValue = categoryFilter.value;
        const sortValue = sortOptions.value;
        
        // Filter projects
        let filteredProjects = projects.filter(project => {
            // Search filter
            const matchesSearch = !searchTerm || 
                project.title.toLowerCase().includes(searchTerm) ||
                project.description.toLowerCase().includes(searchTerm) ||
                project.tags.some(tag => tag.toLowerCase().includes(searchTerm));
                
            // Category filter
            const matchesCategory = categoryValue === 'all' || project.category === categoryValue;
            
            return matchesSearch && matchesCategory;
        });
        
        // Sort projects
        switch(sortValue) {
            case 'newest':
                filteredProjects.sort((a, b) => new Date(b.date) - new Date(a.date));
                break;
            case 'oldest':
                filteredProjects.sort((a, b) => new Date(a.date) - new Date(b.date));
                break;
            case 'az':
                filteredProjects.sort((a, b) => a.title.localeCompare(b.title));
                break;
            case 'za':
                filteredProjects.sort((a, b) => b.title.localeCompare(a.title));
                break;
        }
        
        // Display active filters
        updateActiveFilters(searchTerm, categoryValue, sortValue);
        
        // Update display
        displayProjects(filteredProjects);
    }
    
    // Function to update active filters display
    function updateActiveFilters(search, category, sort) {
        activeFilters.innerHTML = '';
        
        if (search) {
            const searchTag = document.createElement('div');
            searchTag.classList.add('filter-tag');
            searchTag.innerHTML = `Search: ${search} <span class="remove">&times;</span>`;
            searchTag.querySelector('.remove').addEventListener('click', () => {
                searchInput.value = '';
                applyFilters();
            });
            activeFilters.appendChild(searchTag);
        }
        
        if (category !== 'all') {
            const categoryTag = document.createElement('div');
            categoryTag.classList.add('filter-tag');
            categoryTag.innerHTML = `Category: ${category} <span class="remove">&times;</span>`;
            categoryTag.querySelector('.remove').addEventListener('click', () => {
                categoryFilter.value = 'all';
                applyFilters();
            });
            activeFilters.appendChild(categoryTag);
        }
        
        const sortNames = {
            'newest': 'Newest First',
            'oldest': 'Oldest First',
            'az': 'A-Z',
            'za': 'Z-A'
        };
        
        const sortTag = document.createElement('div');
        sortTag.classList.add('filter-tag');
        sortTag.innerHTML = `Sort: ${sortNames[sort]}`;
        activeFilters.appendChild(sortTag);
    }
    
    // Handle browser back/forward navigation
    window.addEventListener('popstate', (event) => {
        if (event.state && event.state.projectId) {
            loadProject(event.state.projectId);
        } else {
            isInteractiveContentActive = false; // Reset flag when returning to project list
            displayProjects(projects);
            document.title = 'Vibe Code - Projects Gallery';
        }
    });
});
