/* ========================================
   TIME IT! - Main Game Controller
   Handles UI, assembly, and game flow
   ======================================== */

class Game {
    constructor() {
        // Game state
        this.currentLevel = 1;
        this.credits = 0;        // Current available credits (set from level budget)
        this.totalScore = 0;
        this.unlockedLevels = 1;
        this.missionBriefingShown = false; // Track if briefing was shown for current level
        
        // Rocket assembly
        this.assembledComponents = [];
        this.componentTimings = [];
        
        // Last used rocket (for retry)
        this.lastRocketBuild = null;
        
        // Drag and drop state
        this.draggedIndex = null;
        
        // Engine
        this.engine = null;
        
        // DOM elements
        this.elements = {};
        
        // Current catalog category
        this.currentCategory = 'engines';
        
        // Initialize
        this.init();
    }
    
    init() {
        // Cache DOM elements
        this.cacheElements();
        
        // Initialize physics engine
        this.engine = new RocketEngine(this.elements.canvas);
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Set initial budget from first level
        const level = getLevel(this.currentLevel);
        this.credits = level.budget || 200;
        
        // Set level on engine so preview can show the target
        this.engine.setLevel(level);
        
        // Show mission briefing
        this.showMissionBriefing();
        
        // Render catalog
        this.renderCatalog();
        
        // Update preview (initially empty)
        this.updatePreview();
        
        // Update UI
        this.updateUI();
    }
    
    // Update the engine preview with current assembled components
    updatePreview() {
        if (this.engine) {
            this.engine.setPreviewComponents(this.assembledComponents);
        }
    }
    
    cacheElements() {
        this.elements = {
            canvas: document.getElementById('sky-canvas'),
            levelNumber: document.getElementById('level-number'),
            objectiveText: document.getElementById('objective-text'),
            credits: document.getElementById('credits'),
            score: document.getElementById('score'),
            
            // Modals
            missionModal: document.getElementById('mission-modal'),
            missionTitle: document.getElementById('mission-title'),
            missionObjectiveIcon: document.getElementById('mission-objective-icon'),
            missionDescription: document.getElementById('mission-description'),
            targetHeight: document.getElementById('target-height'),
            missionBudget: document.getElementById('mission-budget'),
            bonusCredits: document.getElementById('bonus-credits'),
            startMissionBtn: document.getElementById('start-mission-btn'),
            
            resultsModal: document.getElementById('results-modal'),
            resultsTitle: document.getElementById('results-title'),
            resultsIcon: document.getElementById('results-icon'),
            resultDistance: document.getElementById('result-distance'),
            resultPoints: document.getElementById('result-points'),
            resultCredits: document.getElementById('result-credits'),
            nextMissionBtn: document.getElementById('next-mission-btn'),
            retryMissionBtn: document.getElementById('retry-mission-btn'),
            
            // Assembly
            gameArea: document.getElementById('game-area'),
            rocketSlots: document.getElementById('rocket-slots'),
            timingList: document.getElementById('timing-list'),
            catalogItems: document.getElementById('catalog-items'),
            catalogTabs: document.getElementById('catalog-tabs'),
            
            // Buttons
            clearBtn: document.getElementById('clear-btn'),
            launchBtn: document.getElementById('launch-btn'),
            abortBtn: document.getElementById('abort-btn'),
            
            // Flight info
            flightInfo: document.getElementById('flight-info'),
            altitude: document.getElementById('altitude'),
            velocity: document.getElementById('velocity'),
            flightTime: document.getElementById('flight-time'),
            distanceToTarget: document.getElementById('distance-to-target'),
            simControls: document.getElementById('sim-controls')
        };
    }
    
    setupEventListeners() {
        // Mission modal
        this.elements.startMissionBtn.addEventListener('click', () => this.startMission());
        
        // Results modal
        this.elements.nextMissionBtn.addEventListener('click', () => this.nextMission());
        this.elements.retryMissionBtn.addEventListener('click', () => this.retryMission());
        
        // Catalog tabs
        this.elements.catalogTabs.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn')) {
                this.switchCategory(e.target.dataset.category);
            }
        });
        
        // Assembly controls
        this.elements.clearBtn.addEventListener('click', () => this.clearRocket());
        this.elements.launchBtn.addEventListener('click', () => this.launchRocket());
        this.elements.abortBtn.addEventListener('click', () => this.abortMission());
        
        // Catalog item clicks
        this.elements.catalogItems.addEventListener('click', (e) => {
            const item = e.target.closest('.catalog-item');
            if (item && !item.classList.contains('locked')) {
                this.addComponent(item.dataset.componentId);
            }
        });
    }
    
    // ========== UI Updates ==========
    
    updateUI() {
        this.elements.levelNumber.textContent = this.currentLevel;
        this.elements.credits.textContent = this.credits;
        this.elements.score.textContent = this.totalScore;
        
        const level = getLevel(this.currentLevel);
        this.elements.objectiveText.textContent = getObjectiveDescription(level.objectiveType);
        
        this.updateLaunchButton();
    }
    
    updateLaunchButton() {
        const hasEngine = this.assembledComponents.some(c => c.category === 'engines');
        this.elements.launchBtn.disabled = !hasEngine;
    }
    
    // ========== Mission Flow ==========
    
    showMissionBriefing() {
        const level = getLevel(this.currentLevel);
        
        this.elements.missionTitle.textContent = `MISSION ${level.id}: ${level.name}`;
        this.elements.missionObjectiveIcon.textContent = getObjectiveIcon(level.objectiveType);
        this.elements.missionDescription.textContent = level.description;
        
        // Target info
        let targetInfo = '';
        switch (level.objectiveType) {
            case 'hoop':
                targetInfo = `${level.target.y}m altitude`;
                if (level.target.x !== 0) {
                    targetInfo += ` (${level.target.x > 0 ? '+' : ''}${level.target.x}m offset)`;
                }
                break;
            case 'landing':
                if (level.target.requireMinAltitude) {
                    targetInfo = `Reach ${level.target.requireMinAltitude}m first, then land`;
                } else {
                    targetInfo = `${level.target.y}m altitude platform`;
                }
                break;
            case 'orbit':
                targetInfo = `${level.target.y}m (hold ${level.target.minTime}s)`;
                break;
        }
        this.elements.targetHeight.textContent = targetInfo;
        this.elements.missionBudget.textContent = `💰 ${level.budget || 200}`;
        this.elements.bonusCredits.textContent = `+${level.bonusCredits}`;
        
        // Reset budget for this level
        this.credits = level.budget || 200;
        
        // Only show modal if briefing hasn't been shown for this level
        if (!this.missionBriefingShown) {
            this.elements.missionModal.classList.remove('hidden');
            this.missionBriefingShown = true;
        }
        this.elements.resultsModal.classList.add('hidden');
        
        this.updateUI();
    }
    
    startMission() {
        this.elements.missionModal.classList.add('hidden');
        this.renderCatalog();
    }
    
    showResults(results) {
        const level = getLevel(this.currentLevel);
        const modalContent = this.elements.resultsModal.querySelector('.modal-content');
        
        // Remove previous state classes
        modalContent.classList.remove('success', 'failure');
        
        if (results.crashed) {
            this.elements.resultsTitle.textContent = 'MISSION FAILED';
            this.elements.resultsIcon.textContent = '💥';
            modalContent.classList.add('failure');
        } else if (results.hardLanding) {
            this.elements.resultsTitle.textContent = 'ROUGH LANDING!';
            this.elements.resultsIcon.textContent = '⚠️';
            if (results.passed) {
                modalContent.classList.add('success');
            }
        } else if (results.passed) {
            this.elements.resultsTitle.textContent = 'MISSION COMPLETE!';
            this.elements.resultsIcon.textContent = '🎉';
            modalContent.classList.add('success');
            // Trigger confetti!
            this.createConfetti();
        } else {
            this.elements.resultsTitle.textContent = 'MISSION INCOMPLETE';
            this.elements.resultsIcon.textContent = '😔';
            modalContent.classList.add('failure');
        }
        
        let distanceText = results.crashed ? 'CRASHED' : `${results.distance}m`;
        if (results.hardLanding && results.hardLandingPenalty > 0) {
            distanceText += ` (Hard landing: -${results.hardLandingPenalty} credits)`;
        }
        
        this.elements.resultDistance.textContent = distanceText;
        this.elements.resultPoints.textContent = results.score;
        this.elements.resultCredits.textContent = `+${results.credits}`;
        
        // Show helpful hints for failed landing missions
        const hintElement = document.getElementById('results-hint');
        const hint = this.getFailureHint(results, level);
        if (hint) {
            hintElement.innerHTML = hint;
            hintElement.classList.remove('hidden');
        } else {
            hintElement.classList.add('hidden');
        }
        
        // Show/hide next mission button
        if (results.passed && this.currentLevel < getTotalLevels()) {
            this.elements.nextMissionBtn.style.display = 'inline-block';
        } else if (this.currentLevel >= getTotalLevels()) {
            this.elements.nextMissionBtn.textContent = 'YOU WIN!';
            this.elements.nextMissionBtn.disabled = true;
            this.elements.nextMissionBtn.style.display = 'inline-block';
        } else {
            this.elements.nextMissionBtn.style.display = 'none';
        }
        
        // Update game state
        this.credits += results.credits;
        this.totalScore += results.score;
        
        if (results.passed && this.currentLevel >= this.unlockedLevels) {
            this.unlockedLevels = this.currentLevel + 1;
        }
        
        // Don't save - refresh resets game
        // this.saveGame();
        this.updateUI();
        
        this.elements.resultsModal.classList.remove('hidden');
    }
    
    nextMission() {
        if (this.currentLevel < getTotalLevels()) {
            this.currentLevel++;
            
            // Get new level budget
            const level = getLevel(this.currentLevel);
            this.credits = level.budget || 200;
            this.lastRocketBuild = null;
            this.missionBriefingShown = false; // Reset for new level
            
            // Update engine with new level for preview target
            this.engine.setLevel(level);
            
            this.clearRocket(true); // Don't refund, budget already reset
            this.showMissionBriefing();
            this.updateUI();
        }
    }
    
    retryMission() {
        this.elements.resultsModal.classList.add('hidden');
        
        // Reset budget for retry
        const level = getLevel(this.currentLevel);
        this.credits = level.budget || 200;
        
        // Restore last rocket build for free (budget already reset)
        if (this.lastRocketBuild && this.lastRocketBuild.components.length > 0) {
            const totalCost = this.lastRocketBuild.components.reduce((sum, c) => sum + c.price, 0);
            
            // Only restore if we can afford it
            if (totalCost <= this.credits) {
                this.assembledComponents = this.lastRocketBuild.components.map(c => ({ ...c }));
                this.componentTimings = [...this.lastRocketBuild.timings];
                this.credits -= totalCost;
                
                this.renderRocket();
                this.renderTimingControls();
                this.renderCatalog();
                this.updatePreview();
                this.updateUI();
                this.showToast('Rocket restored! Budget reset.');
            } else {
                this.clearRocket(true);
                this.showToast('Budget reset for retry.');
            }
        } else {
            this.clearRocket(true);
        }
        
        // Don't show mission modal again - just return to game area
        this.elements.resultsModal.classList.add('hidden');
        this.updateUI();
    }
    
    // ========== Catalog ==========
    
    switchCategory(category) {
        this.currentCategory = category;
        
        // Update tab styles
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });
        
        this.renderCatalog();
    }
    
    renderCatalog() {
        const items = COMPONENTS[this.currentCategory] || [];
        
        this.elements.catalogItems.innerHTML = items.map(item => {
            const unlocked = isComponentUnlocked(item.id, this.unlockedLevels);
            const affordable = canAfford(item.id, this.credits);
            const locked = !unlocked || !affordable;
            
            // Format stats with better labels and units
            let statsHtml = '';
            if (item.stats) {
                const formatStat = (key, value) => {
                    const labels = {
                        thrust: { label: 'Thrust', unit: 'N' },
                        burnTime: { label: 'Burn', unit: 's' },
                        duration: { label: 'Duration', unit: 's' },
                        rotationSpeed: { label: 'Spin', unit: '°/s' },
                        stabilization: { label: 'Hold', unit: '%' },
                        force: { label: 'Force', unit: 'N' },
                        mass: { label: 'Mass', unit: 'kg' },
                        fuelBonus: { label: '+Fuel', unit: 's' },
                        deployAltitude: { label: 'Deploy', unit: 'm' },
                        dragCoeff: { label: 'Drag', unit: '' },
                        precision: { label: 'Precision', unit: '%' }
                    };
                    const info = labels[key] || { label: key, unit: '' };
                    return `<div class="stat-row">
                        <span>${info.label}</span>
                        <span>${value}${info.unit}</span>
                    </div>`;
                };
                
                // Show most relevant stats (excluding fuelConsumption which is just visual)
                const relevantKeys = Object.keys(item.stats).filter(k => k !== 'fuelConsumption');
                statsHtml = relevantKeys.slice(0, 3).map(key => formatStat(key, item.stats[key])).join('');
            }
            
            return `
                <div class="catalog-item ${locked ? 'locked' : ''}" 
                     data-component-id="${item.id}"
                     title="${item.description}">
                    <div class="preview">
                        <div class="component-shape ${item.shape}"></div>
                    </div>
                    <div class="name">${item.name}</div>
                    <div class="stats">${statsHtml}</div>
                    <div class="price">
                        ${!unlocked ? '🔒 Lvl ' + item.unlockLevel : '💰 ' + item.price}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    // ========== Assembly ==========
    
    addComponent(componentId) {
        const component = getComponentById(componentId);
        if (!component) return;
        
        // Check if can afford
        if (component.price > this.credits) {
            this.showToast('Not enough credits!');
            return;
        }
        
        // Deduct credits
        this.credits -= component.price;
        
        // Add to assembly
        this.assembledComponents.push({ ...component });
        this.componentTimings.push(0);
        
        // Update UI
        this.renderRocket();
        this.renderTimingControls();
        this.renderCatalog();
        this.updatePreview();
        this.updateUI();
    }
    
    removeComponent(index) {
        if (index < 0 || index >= this.assembledComponents.length) return;
        
        // Full refund when removing component
        const component = this.assembledComponents[index];
        this.credits += component.price;
        
        // Remove from assembly
        this.assembledComponents.splice(index, 1);
        this.componentTimings.splice(index, 1);
        
        // Update UI
        this.renderRocket();
        this.renderTimingControls();
        this.renderCatalog();
        this.updatePreview();
        this.updateUI();
    }
    
    clearRocket(skipRefund = false) {
        // Full refund when clearing rocket
        if (!skipRefund) {
            this.assembledComponents.forEach(comp => {
                this.credits += comp.price;
            });
        }
        
        this.assembledComponents = [];
        this.componentTimings = [];
        
        this.renderRocket();
        this.renderTimingControls();
        this.renderCatalog();
        this.updatePreview();
        this.updateUI();
    }
    
    renderRocket() {
        // Rocket preview is now drawn on canvas, no HTML needed
        // This function is kept for compatibility but does nothing
    }
    
    // Drag and drop handlers - no longer used since rocket is on canvas
    onDragStart(event, index) {
        this.draggedIndex = index;
        event.target.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
    }
    
    onDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }
    
    onDrop(event, targetIndex) {
        event.preventDefault();
        if (this.draggedIndex === null || this.draggedIndex === targetIndex) return;
        
        // Reorder components
        const draggedComp = this.assembledComponents[this.draggedIndex];
        const draggedTiming = this.componentTimings[this.draggedIndex];
        
        // Remove from old position
        this.assembledComponents.splice(this.draggedIndex, 1);
        this.componentTimings.splice(this.draggedIndex, 1);
        
        // Insert at new position
        this.assembledComponents.splice(targetIndex, 0, draggedComp);
        this.componentTimings.splice(targetIndex, 0, draggedTiming);
        
        this.renderRocket();
        this.renderTimingControls();
    }
    
    onDragEnd(event) {
        event.target.classList.remove('dragging');
        this.draggedIndex = null;
    }
    
    // Timing list drag handlers
    onTimingDragStart(event) {
        const item = event.target.closest('.timing-item');
        if (!item) return;
        this.draggedTimingIndex = parseInt(item.dataset.index);
        item.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
    }
    
    onTimingDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        
        const item = event.target.closest('.timing-item[draggable="true"]');
        if (item) {
            item.classList.add('drag-over');
        }
    }
    
    onTimingDrop(event) {
        event.preventDefault();
        const targetItem = event.target.closest('.timing-item[draggable="true"]');
        if (!targetItem) return;
        
        const targetIndex = parseInt(targetItem.dataset.index);
        if (this.draggedTimingIndex === undefined || this.draggedTimingIndex === targetIndex) return;
        
        // Reorder components
        const draggedComp = this.assembledComponents[this.draggedTimingIndex];
        const draggedTiming = this.componentTimings[this.draggedTimingIndex];
        
        // Remove from old position
        this.assembledComponents.splice(this.draggedTimingIndex, 1);
        this.componentTimings.splice(this.draggedTimingIndex, 1);
        
        // Adjust target index if needed
        const adjustedTarget = this.draggedTimingIndex < targetIndex ? targetIndex : targetIndex;
        
        // Insert at new position
        this.assembledComponents.splice(adjustedTarget, 0, draggedComp);
        this.componentTimings.splice(adjustedTarget, 0, draggedTiming);
        
        this.renderRocket();
        this.renderTimingControls();
        this.updatePreview();
    }
    
    onTimingDragEnd(event) {
        event.target.classList.remove('dragging');
        this.elements.timingList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        this.draggedTimingIndex = undefined;
    }

    renderTimingControls() {
        if (this.assembledComponents.length === 0) {
            this.elements.timingList.innerHTML = '<p style="color: var(--text-secondary); text-align: center; font-size: 14px;">Add components to set timing</p>';
            return;
        }
        
        // Display components from top to bottom (reverse order for visual)
        // But keep indices correct for timing array
        const reversedIndices = [...this.assembledComponents.keys()].reverse();
        
        // Add crew capsule indicator at top (always present, not draggable)
        let html = `
            <div class="timing-item crew-capsule-indicator">
                <div class="timing-main">
                    <span class="component-icon">👨‍🚀</span>
                    <span class="component-name">Crew Capsule</span>
                    <span class="fixed-label">FIXED TOP</span>
                </div>
            </div>
        `;
        
        html += reversedIndices.map(i => {
            const comp = this.assembledComponents[i];
            // Get burn/duration time for this component
            const burnTime = comp.stats?.burnTime || comp.stats?.duration || 0;
            const startTime = this.componentTimings[i] || 0;
            const endTime = startTime + burnTime;
            
            // Build info badges
            let badges = '';
            if (burnTime > 0) {
                badges += `<span class="timing-badge burn">${burnTime}s</span>`;
            }
            if (comp.stats?.thrust && comp.category === 'engines') {
                badges += `<span class="timing-badge thrust">${comp.stats.thrust}N</span>`;
            }
            if (comp.stats?.force) {
                badges += `<span class="timing-badge force">${comp.stats.force}N</span>`;
            }
            if (comp.stats?.rotationSpeed) {
                badges += `<span class="timing-badge rotation">${comp.stats.rotationSpeed}°/s</span>`;
            }
            if (comp.stats?.directionLabel) {
                badges += `<span class="timing-badge direction">${comp.stats.directionLabel}</span>`;
            }
            if (comp.stats?.mass) {
                badges += `<span class="timing-badge mass">${comp.stats.mass}kg</span>`;
            }
            
            // First component (index 0, bottom of rocket) always starts instantly
            if (i === 0) {
                this.componentTimings[0] = 0; // Ensure it's always 0
                return `
                    <div class="timing-item first-component" draggable="true" data-index="${i}">
                        <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
                        <div class="timing-content">
                            <div class="timing-main">
                                <span class="component-name">${comp.name}</span>
                                <span class="instant-label">INSTANT</span>
                                <button class="remove-btn" data-index="${i}" title="Remove">×</button>
                            </div>
                            <div class="timing-badges">${badges}</div>
                            ${burnTime > 0 ? `<div class="timing-end">Ends: ${burnTime.toFixed(1)}s</div>` : ''}
                            <div class="position-label">⬇ BOTTOM (Engine)</div>
                        </div>
                    </div>
                `;
            }
            
            return `
                <div class="timing-item" draggable="true" data-index="${i}">
                    <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
                    <div class="timing-content">
                        <div class="timing-main">
                            <span class="component-name">${comp.name}</span>
                            <input type="number" 
                                   min="0" 
                                   max="60" 
                                   step="0.5" 
                                   value="${this.componentTimings[i]}"
                                   onchange="game.updateTiming(${i}, this.value)">
                            <span class="unit">sec</span>
                            <button class="remove-btn" data-index="${i}" title="Remove">×</button>
                        </div>
                        <div class="timing-badges">${badges}</div>
                        ${burnTime > 0 ? `<div class="timing-end">Ends: ${endTime.toFixed(1)}s</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        this.elements.timingList.innerHTML = html;
        
        // Add drag event listeners
        this.elements.timingList.querySelectorAll('.timing-item[draggable="true"]').forEach(item => {
            item.addEventListener('dragstart', (e) => this.onTimingDragStart(e));
            item.addEventListener('dragover', (e) => this.onTimingDragOver(e));
            item.addEventListener('drop', (e) => this.onTimingDrop(e));
            item.addEventListener('dragend', (e) => this.onTimingDragEnd(e));
        });
        
        // Add remove button listeners
        this.elements.timingList.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeComponent(parseInt(btn.dataset.index));
            });
        });
    }
    
    updateTiming(index, value) {
        this.componentTimings[index] = parseFloat(value) || 0;
    }
    
    // ========== Launch & Simulation ==========
    
    launchRocket() {
        if (this.assembledComponents.length === 0) {
            this.showToast('Build a rocket first!');
            return;
        }
        
        const hasEngine = this.assembledComponents.some(c => c.category === 'engines');
        if (!hasEngine) {
            this.showToast('Add an engine!');
            return;
        }
        
        // Save current rocket build for retry
        this.lastRocketBuild = {
            components: this.assembledComponents.map(c => ({ ...c })),
            timings: [...this.componentTimings]
        };
        
        // Setup simulation
        const level = getLevel(this.currentLevel);
        this.engine.setLevel(level);
        this.engine.initRocket(this.assembledComponents, this.componentTimings);
        
        // Set finish callback
        this.engine.onFinish = (results) => this.onSimulationFinish(results);
        
        // Hide game area, show flight info
        this.elements.gameArea.classList.add('hidden');
        this.elements.flightInfo.classList.remove('hidden');
        this.elements.simControls.classList.remove('hidden');
        
        // Start simulation
        this.engine.start();
        
        // Update flight info display
        this.flightInfoInterval = setInterval(() => this.updateFlightInfo(), 50);
    }
    
    updateFlightInfo() {
        const data = this.engine.getFlightData();
        if (data) {
            this.elements.altitude.textContent = data.altitude;
            this.elements.velocity.textContent = data.velocity;
            this.elements.flightTime.textContent = data.time;
            this.elements.distanceToTarget.textContent = data.distanceToTarget;
        }
    }
    
    onSimulationFinish(results) {
        clearInterval(this.flightInfoInterval);
        
        // Show results quickly for success, slightly longer for crash
        const delay = results.passed ? 100 : 500;
        setTimeout(() => {
            this.elements.flightInfo.classList.add('hidden');
            this.elements.simControls.classList.add('hidden');
            this.elements.gameArea.classList.remove('hidden');
            
            this.showResults(results);
        }, delay);
    }
    
    abortMission() {
        this.engine.stop();
        clearInterval(this.flightInfoInterval);
        
        this.elements.flightInfo.classList.add('hidden');
        this.elements.simControls.classList.add('hidden');
        this.elements.gameArea.classList.remove('hidden');
        
        this.showResults({
            distance: 9999,
            score: 0,
            credits: 0,
            passed: false,
            crashed: false
        });
    }
    
    // ========== Save/Load ==========
    
    saveGame() {
        const saveData = {
            currentLevel: this.currentLevel,
            credits: this.credits,
            totalScore: this.totalScore,
            unlockedLevels: this.unlockedLevels
        };
        
        localStorage.setItem('timeIt_save', JSON.stringify(saveData));
    }
    
    loadGame() {
        const saved = localStorage.getItem('timeIt_save');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.currentLevel = data.currentLevel || 1;
                this.credits = data.credits || 500;
                this.totalScore = data.totalScore || 0;
                this.unlockedLevels = data.unlockedLevels || 1;
            } catch (e) {
                console.log('Failed to load save');
            }
        }
    }
    
    // ========== Utilities ==========
    
    getFailureHint(results, level) {
        // Only show hints for failures
        if (results.passed && !results.hardLanding) return null;
        
        // Check what landing equipment the player has
        const hasParachute = this.assembledComponents.some(c => c.id === 'parachute');
        const hasLandingLegs = this.assembledComponents.some(c => c.id === 'landing-legs');
        const hasAirBags = this.assembledComponents.some(c => c.id === 'air-bags');
        const hasHoverJet = this.assembledComponents.some(c => c.id === 'hover-jet');
        const hasAerospike = this.assembledComponents.some(c => c.id === 'aerospike-brake');
        const hasBraking = hasParachute || hasHoverJet || hasAerospike;
        const hasLandingGear = hasLandingLegs || hasAirBags;
        
        // For landing missions
        if (level.objectiveType === 'landing') {
            if (results.crashed) {
                if (!hasBraking && !hasLandingGear) {
                    return `<span class="hint-icon">💡</span> <strong>TIP:</strong> For landing missions, try adding a <span class="hint-highlight">Parachute</span> to slow your descent, or <span class="hint-highlight">Landing Legs</span>/<span class="hint-highlight">Air Bags</span> to survive harder landings!`;
                } else if (!hasBraking) {
                    return `<span class="hint-icon">💡</span> <strong>TIP:</strong> You have landing gear, but you're still coming in too fast! Try adding a <span class="hint-highlight">Parachute</span> or <span class="hint-highlight">Hover Jet</span> to slow down before touchdown.`;
                } else if (!hasLandingGear) {
                    return `<span class="hint-icon">💡</span> <strong>TIP:</strong> The capsule alone can only survive very gentle landings (2 m/s). Add <span class="hint-highlight">Landing Legs</span> (8 m/s) or <span class="hint-highlight">Air Bags</span> (15 m/s) for more tolerance!`;
                } else {
                    return `<span class="hint-icon">💡</span> <strong>TIP:</strong> Still too fast! Make sure your braking systems activate at the right time. Check your timing settings.`;
                }
            } else if (results.hardLanding) {
                return `<span class="hint-icon">💡</span> <strong>TIP:</strong> Close! Try activating your braking earlier, or add <span class="hint-highlight">Air Bags</span> for the highest landing tolerance.`;
            }
        }
        
        // For other mission types that failed
        if (results.crashed && !hasBraking) {
            return `<span class="hint-icon">💡</span> <strong>TIP:</strong> If you need to land safely, consider adding a <span class="hint-highlight">Parachute</span> or other braking system!`;
        }
        
        return null;
    }
    
    showToast(message) {
        // Simple toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 15px 30px;
            border-radius: 10px;
            font-family: 'Exo 2', sans-serif;
            z-index: 2000;
            animation: fadeInOut 2s ease-in-out forwards;
        `;
        toast.textContent = message;
        
        // Add animation keyframes if not exists
        if (!document.getElementById('toast-style')) {
            const style = document.createElement('style');
            style.id = 'toast-style';
            style.textContent = `
                @keyframes fadeInOut {
                    0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    20% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    80% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
    
    createConfetti() {
        const colors = ['#00ff88', '#00dd66', '#88ff88', '#44ff99', '#00ffaa', '#66ffbb', '#ffd700', '#ffff00'];
        const confettiCount = 80;
        
        for (let i = 0; i < confettiCount; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                
                // Random position across top of screen
                const startX = Math.random() * window.innerWidth;
                const startY = -20;
                
                // Random properties
                const color = colors[Math.floor(Math.random() * colors.length)];
                const size = 8 + Math.random() * 10;
                const duration = 2 + Math.random() * 2;
                const drift = (Math.random() - 0.5) * 200;
                
                confetti.style.cssText = `
                    left: ${startX}px;
                    top: ${startY}px;
                    width: ${size}px;
                    height: ${size}px;
                    background: ${color};
                    border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
                    animation-duration: ${duration}s;
                    box-shadow: 0 0 6px ${color};
                `;
                
                // Add horizontal drift via CSS variable
                confetti.style.setProperty('--drift', `${drift}px`);
                
                document.body.appendChild(confetti);
                
                // Remove after animation
                setTimeout(() => confetti.remove(), duration * 1000);
            }, i * 30); // Stagger confetti creation
        }
    }
}

// Initialize game when DOM is ready
let game;
document.addEventListener('DOMContentLoaded', () => {
    game = new Game();
});
