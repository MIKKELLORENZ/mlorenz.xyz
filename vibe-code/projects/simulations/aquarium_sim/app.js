// app.js - Main application: game loop, UI, events
(function(ns) {
'use strict';

var storage = ns.storage;
var SeededRandom = ns.SeededRandom;
var formatTime = ns.formatTime;
var formatNumber = ns.formatNumber;

var createInitialState = ns.createInitialState;
var updateSimulation = ns.updateSimulation;
var feedAnimals = ns.feedAnimals;
var performWaterChange = ns.performWaterChange;
var cleanFilter = ns.cleanFilter;
var addEntity = ns.addEntity;
var useBacteriaStarter = ns.useBacteriaStarter;
var useWaterConditioner = ns.useWaterConditioner;
var serializeState = ns.serializeState;
var deserializeState = ns.deserializeState;

var ANIMAL_SPECIES = ns.ANIMAL_SPECIES;
var PLANT_SPECIES = ns.PLANT_SPECIES;
var DEVICE_TYPES = ns.DEVICE_TYPES;
var CARETAKER_TIPS = ns.CARETAKER_TIPS;
var ACHIEVEMENTS = ns.ACHIEVEMENTS;

var Renderer = ns.Renderer;
var ChartsRenderer = ns.ChartsRenderer;
var MiniDashboard = ns.MiniDashboard;

// ============================================
// AQUARIUM APP
// ============================================
function AquariumApp() {
    this.state = null;
    this.renderer = null;
    this.chartsRenderer = null;
    this.dashboard = null;
    this.rng = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this.running = false;
    this.activeChart = 'nitrogen';
    this.placementMode = null;
    this.placementItem = null;
    
    this.init();
}

AquariumApp.prototype.init = function() {
    var self = this;
    
    // Try to load saved state
    var saved = storage.load('aquarium_save');
    if (saved) {
        try {
            this.state = deserializeState(saved);
            console.log('Loaded saved game');
        } catch (e) {
            console.error('Failed to load save:', e);
            this.state = createInitialState();
        }
    } else {
        this.state = createInitialState();
        // Add starter equipment
        addEntity(this.state, 'device', 'filter', 50, 30);
        addEntity(this.state, 'device', 'heater', 100, 80);
        addEntity(this.state, 'device', 'light', this.state.tank.width / 2, 10);
    }
    
    this.rng = new SeededRandom(this.state.meta.seed);
    
    // Setup canvas
    var tankCanvas = document.getElementById('tankCanvas');
    this.renderer = new Renderer(tankCanvas, this.state);
    
    var chartsCanvas = document.getElementById('chartsCanvas');
    if (chartsCanvas) {
        this.chartsRenderer = new ChartsRenderer(chartsCanvas);
    }
    
    // Setup dashboard
    var paramsContainer = document.getElementById('miniDashboard');
    if (paramsContainer) {
        this.dashboard = new MiniDashboard(paramsContainer, this.state);
    }
    
    // Setup UI
    this.setupUI();
    this.setupEventListeners();
    
    // Start game loop
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(function(t) { self.gameLoop(t); });
    
    console.log('Aquarium Simulator initialized!');
};

AquariumApp.prototype.gameLoop = function(timestamp) {
    var self = this;
    if (!this.running) return;
    
    var deltaTime = timestamp - this.lastTime;
    this.lastTime = timestamp;
    
    // Cap delta to prevent spiral of death
    deltaTime = Math.min(deltaTime, 100);
    
    if (!this.state.settings.paused) {
        // Accumulate time for fixed timestep simulation
        this.accumulator += deltaTime * this.state.settings.simSpeed;
        
        var simStepMs = 1000 / 30; // 30 sim updates per real second at 1x
        var simMinutesPerStep = 2; // 2 sim minutes per step = 60 min/sec = 1 hour/sec at 1x
        
        // Limit max updates per frame to prevent spiral of death
        var maxUpdates = 4;
        var updates = 0;
        while (this.accumulator >= simStepMs && updates < maxUpdates) {
            updateSimulation(this.state, simMinutesPerStep, this.rng);
            this.accumulator -= simStepMs;
            updates++;
        }
        // Discard excess accumulated time to prevent catch-up lag
        if (this.accumulator > simStepMs * 2) {
            this.accumulator = 0;
        }
    }
    
    // Render
    this.renderer.render(deltaTime);
    if (this.chartsRenderer) {
        this.chartsRenderer.render(this.state, this.activeChart);
    }
    if (this.dashboard) {
        this.dashboard.update();
    }
    
    // Update UI
    this.updateUI();
    
    // Auto-save every 30 seconds real time
    if (Date.now() - this.state.meta.lastAutoSave > 30000) {
        this.saveGame();
        this.state.meta.lastAutoSave = Date.now();
    }
    
    requestAnimationFrame(function(t) { self.gameLoop(t); });
};

AquariumApp.prototype.setupUI = function() {
    var self = this;
    
    // Populate shop
    this.populateShop();
    
    // Setup tabs
    var tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            var tabId = this.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(function(t) { t.classList.remove('active'); });
            document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
            this.classList.add('active');
            var content = document.getElementById(tabId + '-tab');
            if (content) content.classList.add('active');
        });
    });
    
    // Chart selector
    var chartBtns = document.querySelectorAll('.chart-btn');
    chartBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            chartBtns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            self.activeChart = this.dataset.chart;
        });
    });
};

AquariumApp.prototype.populateShop = function() {
    var self = this;
    var container = document.getElementById('shopItems');
    if (!container) return;
    
    this.shopData = {
        fish: [],
        invertebrates: [],
        plants: [],
        equipment: []
    };
    
    // Categorize animals
    Object.values(ANIMAL_SPECIES).forEach(function(species) {
        if (species.category === 'fish') {
            self.shopData.fish.push({ type: 'animal', data: species });
        } else {
            self.shopData.invertebrates.push({ type: 'animal', data: species });
        }
    });
    
    // Plants
    Object.values(PLANT_SPECIES).forEach(function(species) {
        self.shopData.plants.push({ type: 'plant', data: species });
    });
    
    // Equipment
    Object.values(DEVICE_TYPES).forEach(function(device) {
        self.shopData.equipment.push({ type: 'device', data: device });
    });
    
    // Show fish by default
    this.showShopCategory('fish');
    
    // Setup category buttons
    var categoryBtns = document.querySelectorAll('.category-btn');
    categoryBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            categoryBtns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            self.showShopCategory(this.dataset.category);
        });
    });
};

AquariumApp.prototype.showShopCategory = function(category) {
    var self = this;
    var container = document.getElementById('shopItems');
    if (!container || !this.shopData) return;
    
    container.innerHTML = '';
    var items = this.shopData[category] || [];
    
    items.forEach(function(item) {
        var el = self.createShopItem(item.type, item.data.id, item.data.name, item.data.price, item.data.description);
        container.appendChild(el);
    });
};

AquariumApp.prototype.createShopItem = function(type, id, name, price, description) {
    var self = this;
    var div = document.createElement('div');
    div.className = 'shop-item';
    div.innerHTML = '<div class="shop-item-name">' + name + '</div>' +
        '<div class="shop-item-desc">' + description + '</div>' +
        '<div class="shop-item-price">$' + price + '</div>';
    
    div.addEventListener('click', function() {
        if (self.state.inventory.money >= price) {
            self.startPlacement(type, id, price);
        } else {
            self.showMessage('Not enough money!', 'error');
        }
    });
    
    return div;
};

AquariumApp.prototype.startPlacement = function(type, id, price) {
    this.placementMode = type;
    this.placementItem = { id: id, price: price };
    document.getElementById('tankCanvas').style.cursor = 'crosshair';
    this.showMessage('Click in the tank to place', 'info');
};

AquariumApp.prototype.cancelPlacement = function() {
    this.placementMode = null;
    this.placementItem = null;
    document.getElementById('tankCanvas').style.cursor = 'default';
};

AquariumApp.prototype.setupEventListeners = function() {
    var self = this;
    
    // Canvas click for placement
    var canvas = document.getElementById('tankCanvas');
    canvas.addEventListener('click', function(e) {
        if (self.placementMode) {
            var rect = canvas.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            
            addEntity(self.state, self.placementMode, self.placementItem.id, x, y);
            self.state.inventory.money -= self.placementItem.price;
            self.cancelPlacement();
            self.showMessage('Placed!', 'success');
        } else {
            // Selection
            var rect2 = canvas.getBoundingClientRect();
            var x2 = e.clientX - rect2.left;
            var y2 = e.clientY - rect2.top;
            var entity = self.renderer.getEntityAtPoint(x2, y2);
            if (entity) {
                self.showEntityInfo(entity);
            }
        }
    });
    
    canvas.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        self.cancelPlacement();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') self.cancelPlacement();
        if (e.key === ' ') { self.state.settings.paused = !self.state.settings.paused; e.preventDefault(); }
        if (e.key === 'f') feedAnimals(self.state);
        if (e.key === '1') self.state.settings.simSpeed = 1;
        if (e.key === '2') self.state.settings.simSpeed = 2;
        if (e.key === '3') self.state.settings.simSpeed = 5;
        if (e.key === '4') self.state.settings.simSpeed = 10;
    });
    
    // Speed buttons
    var speedBtns = document.querySelectorAll('.speed-btn');
    speedBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            speedBtns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            self.state.settings.simSpeed = parseInt(this.dataset.speed);
        });
    });
    
    // Pause button
    var pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', function() {
            self.state.settings.paused = !self.state.settings.paused;
            this.textContent = self.state.settings.paused ? '▶️' : '⏸️';
        });
    }
    
    // Action buttons
    var feedBtn = document.getElementById('feedBtn');
    if (feedBtn) feedBtn.addEventListener('click', function() { feedAnimals(self.state); });
    
    var waterChangeBtn = document.getElementById('waterChangeBtn');
    if (waterChangeBtn) waterChangeBtn.addEventListener('click', function() { performWaterChange(self.state, 25); });
    
    var cleanFilterBtn = document.getElementById('cleanFilterBtn');
    if (cleanFilterBtn) cleanFilterBtn.addEventListener('click', function() { cleanFilter(self.state); });
    
    var bacteriaBtn = document.getElementById('bacteriaBtn');
    if (bacteriaBtn) bacteriaBtn.addEventListener('click', function() { useBacteriaStarter(self.state); });
    
    var conditionerBtn = document.getElementById('conditionerBtn');
    if (conditionerBtn) conditionerBtn.addEventListener('click', function() { useWaterConditioner(self.state); });
    
    // Save/Load
    var saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.addEventListener('click', function() { self.saveGame(); self.showMessage('Game saved!', 'success'); });
    
    var resetBtn = document.getElementById('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', function() {
        if (confirm('Reset all progress?')) {
            storage.remove('aquarium_save');
            location.reload();
        }
    });
    
    // Resize handler
    window.addEventListener('resize', function() {
        self.renderer.resize();
        if (self.chartsRenderer) self.chartsRenderer.resize();
    });
};

AquariumApp.prototype.updateUI = function() {
    // Time display
    var timeEl = document.getElementById('timeDisplay');
    if (timeEl) timeEl.textContent = formatTime(this.state.meta.simTime);
    
    // Money
    var moneyEl = document.getElementById('money');
    if (moneyEl) moneyEl.textContent = '$' + this.state.inventory.money;
    
    // Stability score
    var stabilityEl = document.getElementById('stabilityScore');
    if (stabilityEl) {
        stabilityEl.textContent = this.state.env.stabilityScore + '%';
        stabilityEl.className = 'stability-' + (this.state.env.stabilityScore >= 70 ? 'good' : this.state.env.stabilityScore >= 40 ? 'warn' : 'bad');
    }
    
    // Population counts
    var fishCount = document.getElementById('fishCount');
    if (fishCount) {
        var fish = this.state.entities.animals.filter(function(a) { return a.species.category === 'fish'; }).length;
        fishCount.textContent = fish;
    }
    
    var shrimpCount = document.getElementById('shrimpCount');
    if (shrimpCount) {
        var shrimp = this.state.entities.animals.filter(function(a) { return a.species.category === 'shrimp'; }).length;
        shrimpCount.textContent = shrimp;
    }
    
    var plantCount = document.getElementById('plantCount');
    if (plantCount) {
        plantCount.textContent = this.state.entities.plants.length;
    }
    
    // Warnings
    var warningsEl = document.getElementById('warningsContainer');
    if (warningsEl) {
        if (this.state.meta.warnings.length > 0) {
            warningsEl.innerHTML = this.state.meta.warnings.map(function(w) {
                return '<div class="warning-item warning-' + w.severity + '">' + w.message + '</div>';
            }).join('');
            warningsEl.style.display = 'block';
        } else {
            warningsEl.style.display = 'none';
        }
    }
    
    // Tips
    this.updateTips();
    
    // Log
    this.updateLog();
    
    // Achievements
    this.updateAchievements();
};

AquariumApp.prototype.updateTips = function() {
    var tipsEl = document.getElementById('tipsContainer');
    if (!tipsEl) return;
    
    var self = this;
    var activeTips = [];
    Object.values(CARETAKER_TIPS).forEach(function(tip) {
        if (tip.condition(self.state)) activeTips.push(tip);
    });
    
    if (activeTips.length > 0) {
        tipsEl.innerHTML = activeTips.slice(0, 3).map(function(tip) {
            return '<div class="tip-item tip-' + tip.priority + '">' + tip.message + '</div>';
        }).join('');
        tipsEl.style.display = 'block';
    } else {
        tipsEl.innerHTML = '<div class="tip-item tip-low">🌊 Tank looking good!</div>';
    }
};

AquariumApp.prototype.updateLog = function() {
    var logEl = document.getElementById('logContent');
    if (!logEl) return;
    
    logEl.innerHTML = this.state.meta.log.slice(0, 20).map(function(entry) {
        var time = formatTime(entry.time);
        return '<div class="log-entry log-' + entry.type + '"><span class="log-time">' + time + '</span> ' + entry.message + '</div>';
    }).join('');
};

AquariumApp.prototype.updateAchievements = function() {
    var achievementsEl = document.getElementById('statsContent');
    if (!achievementsEl) return;
    
    var self = this;
    achievementsEl.innerHTML = Object.values(ACHIEVEMENTS).map(function(ach) {
        var unlocked = self.state.meta.achievements.indexOf(ach.id) !== -1;
        return '<div class="achievement-item ' + (unlocked ? 'unlocked' : 'locked') + '">' +
            '<span class="achievement-icon">' + (unlocked ? ach.icon : '🔒') + '</span>' +
            '<span class="achievement-name">' + ach.name + '</span>' +
            '<span class="achievement-desc">' + ach.description + '</span>' +
            '</div>';
    }).join('');
};

AquariumApp.prototype.showEntityInfo = function(entity) {
    var infoEl = document.getElementById('entityInfo');
    if (!infoEl) return;
    
    var html = '';
    if (entity.species) {
        // Animal or plant
        html = '<h3>' + entity.species.name + '</h3>' +
            '<p>Health: ' + formatNumber(entity.health) + '%</p>';
        if (entity.stress !== undefined) {
            html += '<p>Stress: ' + formatNumber(entity.stress) + '%</p>';
            html += '<p>Hunger: ' + formatNumber(entity.hunger) + '%</p>';
        }
        if (entity.growth !== undefined) {
            html += '<p>Growth: ' + formatNumber(entity.growth * 100) + '%</p>';
        }
    } else if (entity.type) {
        // Device
        html = '<h3>' + entity.type.name + '</h3>' +
            '<p>Status: ' + (entity.enabled ? 'On' : 'Off') + '</p>';
        if (entity.dirtiness !== undefined) {
            html += '<p>Dirty: ' + formatNumber(entity.dirtiness * 100) + '%</p>';
        }
    }
    
    infoEl.innerHTML = html;
    infoEl.style.display = 'block';
};

AquariumApp.prototype.showMessage = function(text, type) {
    var msgEl = document.getElementById('message');
    if (!msgEl) {
        msgEl = document.createElement('div');
        msgEl.id = 'message';
        document.body.appendChild(msgEl);
    }
    
    msgEl.textContent = text;
    msgEl.className = 'message message-' + type;
    msgEl.style.display = 'block';
    
    setTimeout(function() {
        msgEl.style.display = 'none';
    }, 2000);
};

AquariumApp.prototype.saveGame = function() {
    var serialized = serializeState(this.state);
    storage.save('aquarium_save', serialized);
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    window.aquariumApp = new AquariumApp();
});

// Export
ns.AquariumApp = AquariumApp;

})(window.AquariumSim);
