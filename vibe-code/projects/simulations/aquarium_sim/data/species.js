// data/species.js - Species, plants, and device definitions
(function(ns) {
'use strict';

// ============================================
// SIMULATION CONSTANTS
// ============================================
const SIM_CONSTANTS = {
    MINUTES_PER_TICK: 1,
    HISTORY_SAMPLE_INTERVAL: 10,
    HISTORY_MAX_SAMPLES: 1440,
    DEFAULT_TANK_VOLUME: 100,
    DEFAULT_TANK_WIDTH: 800,
    DEFAULT_TANK_HEIGHT: 500,
    AMMONIA_TOXICITY_THRESHOLD: 0.5,
    NITRITE_TOXICITY_THRESHOLD: 0.5,
    NITRATE_SAFE_MAX: 40,
    O2_SATURATION: 8.5,
    O2_CRITICAL_LOW: 4.0,
    CO2_AMBIENT: 3.0,
    BACTERIA_GROWTH_RATE: 0.02,
    BACTERIA_MAX_CAPACITY: 1000,
    BACTERIA_AMMONIA_CONVERSION: 0.8,
    BACTERIA_NITRITE_CONVERSION: 0.9,
    FILTER_TURBIDITY_REDUCTION: 0.1,
    PUMP_O2_EXCHANGE_RATE: 0.5,
    PH_NEUTRAL: 7.0,
    PH_DRIFT_RATE: 0.01,
    KH_DEFAULT: 4,
    FEED_WASTE_FACTOR: 0.3,
    OVERFEEDING_THRESHOLD: 2.0,
    STRESS_RECOVERY_RATE: 0.05,
    STRESS_DEATH_THRESHOLD: 100,
    STRESS_SICK_THRESHOLD: 70,
    ALGAE_GROWTH_BASE: 0.02,
    ALGAE_LIGHT_FACTOR: 1.5,
    ALGAE_NUTRIENT_FACTOR: 2.0,
    REPRODUCTION_STRESS_MAX: 30,
    REPRODUCTION_FOOD_MIN: 0.5
};

// ============================================
// ANIMAL SPECIES DEFINITIONS
// ============================================
const ANIMAL_SPECIES = {
    cherryShrimp: {
        id: 'cherryShrimp',
        name: 'Cherry Shrimp',
        category: 'shrimp',
        description: 'Hardy, colorful invertebrates that help clean algae and detritus.',
        size: { width: 15, height: 8 },
        spriteStyle: 'shrimp',
        colors: { primary: '#e63946', secondary: '#f4a261', accent: '#ffffff' },
        behavior: {
            speed: 0.3, turnRate: 0.15, schooling: false, shyness: 0.6,
            depthPreference: 'bottom', activityPattern: 'constant', grazing: true
        },
        wasteRate: 0.02, oxygenUse: 0.01, foodNeed: 0.5,
        diet: ['algae', 'detritus', 'pellets'],
        comfort: {
            temp: { min: 20, max: 28, ideal: 24 },
            pH: { min: 6.5, max: 8.0, ideal: 7.2 },
            ammonia: { max: 0.25, critical: 1.0 },
            nitrite: { max: 0.25, critical: 1.0 },
            nitrate: { max: 30, critical: 80 },
            oxygen: { min: 5.0, critical: 3.0 },
            flow: { min: 0.1, max: 0.6, ideal: 0.3 }
        },
        stressSensitivity: {
            temperature: 1.0, pH: 0.8, ammonia: 2.0, nitrite: 2.0,
            nitrate: 0.5, oxygen: 1.5, flow: 0.3
        },
        reproduction: { method: 'eggs', chance: 0.03, offspring: { min: 5, max: 15 }, maturityDays: 30 },
        price: 3, rarity: 'common'
    },
    neonTetra: {
        id: 'neonTetra',
        name: 'Neon Tetra',
        category: 'fish',
        description: 'Vibrant schooling fish with iridescent blue and red stripes.',
        size: { width: 22, height: 10 },
        spriteStyle: 'smallFish',
        colors: { primary: '#1e96fc', secondary: '#e63946', accent: '#ffffff', stripe: '#00d4ff' },
        behavior: {
            speed: 0.8, turnRate: 0.2, schooling: true, schoolRadius: 60,
            alignmentWeight: 0.4, cohesionWeight: 0.3, separationWeight: 0.3,
            shyness: 0.4, depthPreference: 'mid', activityPattern: 'diurnal'
        },
        wasteRate: 0.04, oxygenUse: 0.02, foodNeed: 0.8,
        diet: ['flakes', 'pellets', 'frozen'],
        comfort: {
            temp: { min: 22, max: 28, ideal: 25 },
            pH: { min: 6.0, max: 7.5, ideal: 6.8 },
            ammonia: { max: 0.1, critical: 0.5 },
            nitrite: { max: 0.1, critical: 0.5 },
            nitrate: { max: 20, critical: 50 },
            oxygen: { min: 5.5, critical: 4.0 },
            flow: { min: 0.2, max: 0.5, ideal: 0.35 }
        },
        stressSensitivity: {
            temperature: 1.2, pH: 1.0, ammonia: 2.5, nitrite: 2.5,
            nitrate: 0.8, oxygen: 1.2, flow: 0.5
        },
        reproduction: { method: 'eggs', chance: 0.01, offspring: { min: 20, max: 50 }, maturityDays: 60, difficult: true },
        price: 4, rarity: 'common'
    },
    corydoras: {
        id: 'corydoras',
        name: 'Corydoras',
        category: 'fish',
        description: 'Peaceful bottom-dwelling catfish that sifts through substrate.',
        size: { width: 30, height: 18 },
        spriteStyle: 'bottomFish',
        colors: { primary: '#8d99ae', secondary: '#2b2d42', accent: '#edf2f4', spots: '#495057' },
        behavior: {
            speed: 0.5, turnRate: 0.12, schooling: true, schoolRadius: 80,
            alignmentWeight: 0.3, cohesionWeight: 0.4, separationWeight: 0.3,
            shyness: 0.5, depthPreference: 'bottom', activityPattern: 'crepuscular', sifting: true
        },
        wasteRate: 0.06, oxygenUse: 0.03, foodNeed: 1.0,
        diet: ['sinking', 'pellets', 'frozen', 'detritus'],
        comfort: {
            temp: { min: 22, max: 28, ideal: 25 },
            pH: { min: 6.0, max: 8.0, ideal: 7.0 },
            ammonia: { max: 0.15, critical: 0.6 },
            nitrite: { max: 0.15, critical: 0.6 },
            nitrate: { max: 25, critical: 60 },
            oxygen: { min: 5.0, critical: 3.5 },
            flow: { min: 0.1, max: 0.4, ideal: 0.25 }
        },
        stressSensitivity: {
            temperature: 1.0, pH: 0.7, ammonia: 2.0, nitrite: 2.0,
            nitrate: 0.6, oxygen: 1.3, flow: 0.4
        },
        reproduction: { method: 'eggs', chance: 0.015, offspring: { min: 10, max: 30 }, maturityDays: 90 },
        price: 6, rarity: 'common'
    },
    nerite: {
        id: 'nerite',
        name: 'Nerite Snail',
        category: 'snail',
        description: 'Excellent algae eater that won\'t reproduce in freshwater.',
        size: { width: 18, height: 16 },
        spriteStyle: 'snail',
        colors: { shell: '#5c4033', shellPattern: '#8b7355', body: '#3d3d3d', accent: '#f5deb3' },
        behavior: {
            speed: 0.08, turnRate: 0.05, schooling: false, shyness: 0.2,
            depthPreference: 'surface', activityPattern: 'constant', grazing: true, wallClimbing: true
        },
        wasteRate: 0.03, oxygenUse: 0.005, foodNeed: 0.3,
        diet: ['algae'],
        algaeConsumption: 0.05,
        comfort: {
            temp: { min: 18, max: 30, ideal: 24 },
            pH: { min: 7.0, max: 8.5, ideal: 7.5 },
            ammonia: { max: 0.3, critical: 1.5 },
            nitrite: { max: 0.3, critical: 1.5 },
            nitrate: { max: 40, critical: 100 },
            oxygen: { min: 4.0, critical: 2.5 },
            flow: { min: 0.0, max: 0.8, ideal: 0.3 }
        },
        stressSensitivity: {
            temperature: 0.6, pH: 1.2, ammonia: 1.5, nitrite: 1.5,
            nitrate: 0.3, oxygen: 0.8, flow: 0.2
        },
        reproduction: { method: 'none', chance: 0, offspring: { min: 0, max: 0 }, maturityDays: 0 },
        price: 4, rarity: 'common'
    }
};

// ============================================
// PLANT DEFINITIONS
// ============================================
const PLANT_SPECIES = {
    hornwort: {
        id: 'hornwort',
        name: 'Hornwort',
        category: 'stem',
        description: 'Fast-growing stem plant that absorbs excess nutrients.',
        size: { width: 40, height: 120 },
        spriteStyle: 'stemPlant',
        colors: { stem: '#2d6a4f', leaves: '#40916c', highlight: '#74c69d' },
        growthRate: 0.05, maxSize: 1.5, lightNeed: 'medium',
        nitrateUptake: 2.0, ammoniaUptake: 0.3, oxygenProduction: 0.3, co2Need: 0.2,
        algaeSensitivity: 0.3, turbidityTolerance: 0.7,
        placement: 'background', rooted: false,
        price: 5, rarity: 'common'
    },
    anubias: {
        id: 'anubias',
        name: 'Anubias',
        category: 'rhizome',
        description: 'Hardy slow-grower that thrives in low light.',
        size: { width: 50, height: 60 },
        spriteStyle: 'broadLeaf',
        colors: { stem: '#1b4332', leaves: '#2d6a4f', highlight: '#52b788' },
        growthRate: 0.01, maxSize: 1.3, lightNeed: 'low',
        nitrateUptake: 0.5, ammoniaUptake: 0.1, oxygenProduction: 0.1, co2Need: 0.05,
        algaeSensitivity: 0.8, turbidityTolerance: 0.9,
        placement: 'midground', rooted: true, attachable: true,
        price: 8, rarity: 'common'
    },
    dwarfHairgrass: {
        id: 'dwarfHairgrass',
        name: 'Dwarf Hairgrass',
        category: 'carpet',
        description: 'Creates a lush green carpet with high light.',
        size: { width: 60, height: 30 },
        spriteStyle: 'carpet',
        colors: { blades: '#55a630', tips: '#80b918', base: '#2b9348' },
        growthRate: 0.03, maxSize: 1.2, lightNeed: 'high',
        nitrateUptake: 1.5, ammoniaUptake: 0.2, oxygenProduction: 0.25, co2Need: 0.3,
        algaeSensitivity: 0.6, turbidityTolerance: 0.4,
        placement: 'foreground', rooted: true, spreading: true,
        price: 6, rarity: 'uncommon'
    },
    amazonFrogbit: {
        id: 'amazonFrogbit',
        name: 'Amazon Frogbit',
        category: 'floating',
        description: 'Floating plant that reduces light and absorbs nutrients.',
        size: { width: 45, height: 15 },
        spriteStyle: 'floating',
        colors: { leaves: '#52b788', roots: '#774936', highlight: '#95d5b2' },
        growthRate: 0.08, maxSize: 2.0, lightNeed: 'medium',
        nitrateUptake: 3.0, ammoniaUptake: 0.5, oxygenProduction: 0.2, co2Need: 0.1,
        algaeSensitivity: 0.1, turbidityTolerance: 1.0,
        lightBlocking: 0.3, algaeSuppression: 0.1,
        placement: 'surface', rooted: false, floating: true,
        price: 4, rarity: 'common'
    }
};

// ============================================
// DEVICE DEFINITIONS
// ============================================
const DEVICE_TYPES = {
    filter: {
        id: 'filter', name: 'Hang-on Filter', category: 'filtration',
        description: 'Provides mechanical and biological filtration.',
        mechanical: { turbidityReduction: 0.15, particleCapture: 0.8 },
        biological: { baseCapacity: 200, nitrificationRate: 0.9, oxygenNeed: 0.1 },
        flowOutput: 0.4, flowPattern: 'surface',
        maintenance: { dirtyRate: 0.02, cleaningBacteriaLoss: 0.3, performanceDecay: 0.5 },
        powerUse: 5, price: 25, rarity: 'common'
    },
    pump: {
        id: 'pump', name: 'Water Pump', category: 'circulation',
        description: 'Increases water flow and oxygenation.',
        flowOutput: 0.6, flowPattern: 'mid',
        oxygenation: { surfaceAgitation: 0.3, o2ExchangeRate: 0.4 },
        maintenance: { dirtyRate: 0.01, cleaningBacteriaLoss: 0, performanceDecay: 0.3 },
        powerUse: 3, price: 15, rarity: 'common'
    },
    heater: {
        id: 'heater', name: 'Aquarium Heater', category: 'temperature',
        description: 'Maintains stable water temperature.',
        heating: { targetTemp: 25, heatingRate: 0.5, accuracy: 0.5 },
        powerUse: 50, price: 20, rarity: 'common'
    },
    light: {
        id: 'light', name: 'LED Light', category: 'lighting',
        description: 'Provides light for plants and viewing.',
        lighting: { intensity: 1.0, spectrum: 'full', schedulable: true },
        plantGrowthBonus: 0.2, algaeRisk: 0.1,
        powerUse: 15, price: 30, rarity: 'common'
    },
    airStone: {
        id: 'airStone', name: 'Air Stone', category: 'aeration',
        description: 'Creates bubbles for oxygenation and aesthetics.',
        aeration: { bubbleRate: 0.8, o2ExchangeRate: 0.3, surfaceAgitation: 0.2 },
        flowOutput: 0.15, flowPattern: 'vertical',
        powerUse: 2, price: 8, rarity: 'common'
    },
    autoFeeder: {
        id: 'autoFeeder', name: 'Auto Feeder', category: 'feeding',
        description: 'Automatically dispenses food on schedule.',
        feeding: { capacity: 50, dispensesPerDay: 2, amountPerDispense: 1.0 },
        powerUse: 1, price: 20, rarity: 'uncommon'
    }
};

// ============================================
// DECORATIONS
// ============================================
const DECORATIONS = {
    driftwood: {
        id: 'driftwood', name: 'Driftwood',
        description: 'Natural wood that slowly releases tannins.',
        effects: { phChange: -0.1, tannins: 0.02, hideSpot: true },
        size: { width: 80, height: 40 }, price: 12
    },
    rock: {
        id: 'rock', name: 'Dragon Stone',
        description: 'Inert decorative rock.',
        effects: { hideSpot: true },
        size: { width: 50, height: 35 }, price: 8
    },
    crushedCoral: {
        id: 'crushedCoral', name: 'Crushed Coral',
        description: 'Slowly raises pH and KH.',
        effects: { phChange: 0.05, khChange: 0.1, bufferBoost: true },
        size: { width: 40, height: 10 }, placement: 'substrate', price: 6
    }
};

// ============================================
// CONSUMABLES
// ============================================
const CONSUMABLES = {
    fishFood: { id: 'fishFood', name: 'Fish Flakes', description: 'Standard fish food.', feedingValue: 1.0, wasteMultiplier: 1.0, sinks: false, price: 5, uses: 20 },
    sinkingPellets: { id: 'sinkingPellets', name: 'Sinking Pellets', description: 'Food for bottom dwellers.', feedingValue: 1.2, wasteMultiplier: 0.8, sinks: true, price: 6, uses: 15 },
    bacteriaStarter: { id: 'bacteriaStarter', name: 'Bacteria Starter', description: 'Jump-starts the nitrogen cycle.', bacteriaBoost: 100, price: 10, uses: 1 },
    waterConditioner: { id: 'waterConditioner', name: 'Water Conditioner', description: 'Neutralizes chlorine and detoxifies ammonia temporarily.', ammoniaNeutralize: 0.5, duration: 24, price: 8, uses: 10 },
    phBuffer: { id: 'phBuffer', name: 'pH Buffer', description: 'Stabilizes pH around neutral.', phTarget: 7.0, khBoost: 2, price: 7, uses: 5 },
    plantFertilizer: { id: 'plantFertilizer', name: 'Plant Fertilizer', description: 'Boosts plant growth.', growthBoost: 0.5, duration: 24, nitrateAdd: 5, price: 8, uses: 8 },
    algaeTreatment: { id: 'algaeTreatment', name: 'Algae Treatment', description: 'Reduces algae levels.', algaeReduction: 0.3, plantStress: 0.1, price: 9, uses: 3 }
};

// ============================================
// ACHIEVEMENTS
// ============================================
const ACHIEVEMENTS = {
    firstFish: { id: 'firstFish', name: 'First Splash', description: 'Add your first fish to the tank.', icon: '🐟', condition: (state) => state.entities.animals.some(a => a.species.category === 'fish') },
    stableWeek: { id: 'stableWeek', name: 'Stable Waters', description: 'Maintain stability score above 70 for 7 days.', icon: '⚖️', condition: (state) => state.meta.consecutiveStableDays >= 7 },
    crystalClear: { id: 'crystalClear', name: 'Crystal Clear', description: 'Achieve 95%+ water clarity.', icon: '💎', condition: (state) => state.env.clarity >= 0.95 },
    plantedParadise: { id: 'plantedParadise', name: 'Planted Paradise', description: 'Have 5 or more thriving plants.', icon: '🌿', condition: (state) => state.entities.plants.filter(p => p.health >= 80).length >= 5 },
    shrimpBabies: { id: 'shrimpBabies', name: 'Baby Shrimp!', description: 'Successfully breed shrimp.', icon: '🦐', condition: (state) => state.meta.shrimpBred > 0 },
    cycled: { id: 'cycled', name: 'Cycled Tank', description: 'Establish a mature nitrogen cycle.', icon: '🔄', condition: (state) => state.env.bioPopulation >= 150 },
    biodiversity: { id: 'biodiversity', name: 'Diverse Ecosystem', description: 'Have at least 4 different species.', icon: '🌈', condition: (state) => { const species = new Set(); state.entities.animals.forEach(a => species.add(a.species.id)); return species.size >= 4; } },
    algaeFree: { id: 'algaeFree', name: 'Algae-Free Zone', description: 'Keep algae below 5% for 3 days.', icon: '✨', condition: (state) => state.meta.consecutiveLowAlgaeDays >= 3 }
};

// ============================================
// RANDOM EVENTS
// ============================================
const RANDOM_EVENTS = {
    heatWave: { id: 'heatWave', name: 'Heat Wave', description: 'Ambient temperature rises, heating the tank!', probability: 0.005, duration: { min: 12, max: 48 }, effects: { tempChange: 3 }, warning: 'Temperature rising due to heat wave!' },
    algaeBloom: { id: 'algaeBloom', name: 'Algae Bloom', description: 'Conditions have triggered rapid algae growth.', probability: 0.01, conditions: (state) => state.env.nitrate > 30 && state.env.algae > 0.2, duration: { min: 24, max: 72 }, effects: { algaeGrowthMultiplier: 3 }, warning: 'Algae bloom detected!' },
    snailEggs: { id: 'snailEggs', name: 'Snail Eggs', description: 'Mystery snail eggs appeared on the glass!', probability: 0.02, conditions: (state) => state.entities.animals.some(a => a.species.category === 'snail'), effects: { notification: true }, warning: 'Snail eggs spotted on the glass!' },
    powerOutage: { id: 'powerOutage', name: 'Power Flicker', description: 'Brief power interruption affects equipment.', probability: 0.003, duration: { min: 1, max: 4 }, effects: { devicesDisabled: true }, warning: 'Power flicker! Equipment temporarily offline.' }
};

// ============================================
// TIPS AND GUIDANCE
// ============================================
const CARETAKER_TIPS = {
    highAmmonia: { condition: (state) => state.env.ammonia > 0.25, message: '⚠️ Ammonia is elevated. Consider a water change or adding bacteria starter.', priority: 'high' },
    lowOxygen: { condition: (state) => state.env.oxygen < 5.5, message: '⚠️ Oxygen is getting low. Add an air stone or increase surface agitation.', priority: 'high' },
    highNitrate: { condition: (state) => state.env.nitrate > 30, message: '💡 Nitrate is building up. Time for a water change or add more plants.', priority: 'medium' },
    phDrifting: { condition: (state) => Math.abs(state.env.ph - 7.0) > 0.8, message: '💡 pH is drifting from neutral. Consider adding a buffer.', priority: 'medium' },
    filterDirty: { condition: (state) => { const filter = state.entities.devices.find(d => d.type.id === 'filter'); return filter && filter.dirtiness > 0.7; }, message: '🔧 Filter needs cleaning. Performance is reduced.', priority: 'medium' },
    overstocked: { condition: (state) => { const fishCount = state.entities.animals.filter(a => a.species.category === 'fish').length; const shrimpCount = state.entities.animals.filter(a => a.species.category === 'shrimp').length; const bioload = fishCount * 2 + shrimpCount * 0.5; return bioload > state.tank.volume / 10; }, message: '⚠️ Tank may be overstocked. Watch ammonia levels closely.', priority: 'high' },
    needPlants: { condition: (state) => state.entities.plants.length === 0 && state.env.nitrate > 20, message: '💡 Plants can help absorb excess nitrates naturally.', priority: 'low' },
    algaeWarning: { condition: (state) => state.env.algae > 0.3, message: '🌿 Algae is growing. Reduce light duration or add algae eaters.', priority: 'medium' },
    cycling: { condition: (state) => state.env.bioPopulation < 50 && state.entities.animals.length > 0, message: '🔄 Tank is still cycling. Add fish slowly to avoid ammonia spikes.', priority: 'high' }
};

// Export to namespace
ns.SIM_CONSTANTS = SIM_CONSTANTS;
ns.ANIMAL_SPECIES = ANIMAL_SPECIES;
ns.PLANT_SPECIES = PLANT_SPECIES;
ns.DEVICE_TYPES = DEVICE_TYPES;
ns.DECORATIONS = DECORATIONS;
ns.CONSUMABLES = CONSUMABLES;
ns.ACHIEVEMENTS = ACHIEVEMENTS;
ns.RANDOM_EVENTS = RANDOM_EVENTS;
ns.CARETAKER_TIPS = CARETAKER_TIPS;

})(window.AquariumSim);
