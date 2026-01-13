// sim.js - Simulation core: water chemistry, organisms, devices, update step
(function(ns) {
'use strict';

const { SIM_CONSTANTS, ANIMAL_SPECIES, PLANT_SPECIES, DEVICE_TYPES, RANDOM_EVENTS, ACHIEVEMENTS } = ns;
const { clamp, lerp, generateId, SeededRandom, calculateParameterStress, RingBuffer } = ns;

// ============================================
// SIMULATION STATE FACTORY
// ============================================
function createInitialState(seed) {
    seed = seed || Date.now();
    return {
        tank: {
            volume: SIM_CONSTANTS.DEFAULT_TANK_VOLUME,
            width: SIM_CONSTANTS.DEFAULT_TANK_WIDTH,
            height: SIM_CONSTANTS.DEFAULT_TANK_HEIGHT,
            substrate: 'gravel',
            substrateDepth: 30
        },
        env: {
            temperature: 25, ph: 7.0, kh: SIM_CONSTANTS.KH_DEFAULT,
            ammonia: 0, nitrite: 0, nitrate: 5,
            oxygen: SIM_CONSTANTS.O2_SATURATION, co2: SIM_CONSTANTS.CO2_AMBIENT,
            clarity: 1.0, turbidity: 0, algae: 0, tannins: 0,
            flow: 0, surfaceAgitation: 0,
            bioCapacity: 50, bioPopulation: 10,
            stabilityScore: 100, ambientTemp: 22, roomLight: 0.3
        },
        entities: { animals: [], plants: [], devices: [], particles: [], decorations: [] },
        history: {
            temperature: new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES),
            ph: new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES),
            ammonia: new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES),
            nitrite: new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES),
            nitrate: new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES),
            oxygen: new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES),
            stability: new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES),
            algae: new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES)
        },
        settings: {
            simSpeed: 1, paused: false,
            lightSchedule: { on: 8, off: 20 },
            autoFeed: false, units: 'metric',
            showTooltips: true, particleDensity: 1.0
        },
        meta: {
            simTime: 0, realTime: Date.now(),
            lastHistorySample: 0, lastAutoSave: 0, seed: seed,
            achievements: [], consecutiveStableDays: 0, consecutiveLowAlgaeDays: 0,
            shrimpBred: 0, fishBred: 0, totalDeaths: 0, waterChanges: 0,
            activeEvents: [], warnings: [], log: []
        },
        inventory: { money: 100, food: 20, items: {} }
    };
}

// ============================================
// ENTITY FACTORIES
// ============================================
function createAnimal(speciesId, x, y, rng) {
    const species = ANIMAL_SPECIES[speciesId];
    if (!species) throw new Error('Unknown species: ' + speciesId);
    return {
        id: generateId(), species: species,
        x: x, y: y, vx: 0, vy: 0,
        angle: rng.range(0, Math.PI * 2),
        targetX: x, targetY: y,
        health: 100, stress: 0, hunger: 0, age: 0,
        size: 0.8 + rng.range(0, 0.4),
        behaviorState: 'wander', stateTimer: 0, schoolTarget: null,
        lastFed: 0, lastWaste: 0, deathTimer: 0,
        animFrame: rng.range(0, 100), flipX: rng.chance(0.5)
    };
}

function createPlant(speciesId, x, y, rng) {
    const species = PLANT_SPECIES[speciesId];
    if (!species) throw new Error('Unknown plant: ' + speciesId);
    return {
        id: generateId(), species: species,
        x: x, y: y,
        health: 100, growth: 0.3 + rng.range(0, 0.2),
        maxGrowth: species.maxSize,
        swayOffset: rng.range(0, Math.PI * 2),
        segments: Math.floor(3 + rng.range(0, 3))
    };
}

function createDevice(typeId, x, y) {
    const deviceType = DEVICE_TYPES[typeId];
    if (!deviceType) throw new Error('Unknown device: ' + typeId);
    return {
        id: generateId(), type: deviceType,
        x: x, y: y,
        enabled: true, dirtiness: 0,
        targetTemp: (deviceType.heating && deviceType.heating.targetTemp) || 25,
        isOn: true,
        foodRemaining: (deviceType.feeding && deviceType.feeding.capacity) || 0,
        lastDispense: 0
    };
}

function createParticle(type, x, y, rng) {
    return {
        id: generateId(), type: type,
        x: x, y: y,
        vx: rng.range(-0.2, 0.2),
        vy: type === 'bubble' ? rng.range(-1.5, -0.5) : rng.range(-0.1, 0.3),
        size: rng.range(2, type === 'bubble' ? 8 : 4),
        alpha: 1, life: rng.range(100, 300), maxLife: 300
    };
}

// ============================================
// SIMULATION UPDATE
// ============================================
function updateSimulation(state, dtMinutes, rng) {
    var dt = dtMinutes / 1440;
    state.meta.simTime += dtMinutes;
    
    var hourOfDay = (state.meta.simTime / 60) % 24;
    var lightOn = hourOfDay >= state.settings.lightSchedule.on && 
                  hourOfDay < state.settings.lightSchedule.off;
    
    updateWaterChemistry(state, dt, lightOn, rng);
    updateDevices(state, dt, lightOn);
    updateBacteria(state, dt);
    updateAlgae(state, dt, lightOn);
    updateAnimals(state, dt, dtMinutes, rng);
    updatePlants(state, dt, lightOn, rng);
    updateParticles(state, dtMinutes);
    calculateStability(state);
    updateWarnings(state);
    checkEvents(state, dt, rng);
    
    if (state.meta.simTime - state.meta.lastHistorySample >= SIM_CONSTANTS.HISTORY_SAMPLE_INTERVAL) {
        recordHistory(state);
        state.meta.lastHistorySample = state.meta.simTime;
    }
    checkAchievements(state);
}

// ============================================
// WATER CHEMISTRY
// ============================================
function updateWaterChemistry(state, dt, lightOn, rng) {
    updateTemperature(state, dt);
    updateOxygen(state, dt, lightOn);
    updateCO2(state, dt, lightOn);
    updatePH(state, dt);
    updateClarity(state, dt);
    if (rng.chance(0.01 * dt)) {
        state.env.temperature += rng.range(-0.1, 0.1);
    }
}

function updateTemperature(state, dt) {
    var env = state.env;
    var heater = state.entities.devices.find(function(d) { return d.type.id === 'heater' && d.enabled; });
    
    if (heater) {
        var diff = heater.targetTemp - env.temperature;
        var rate = heater.type.heating.heatingRate * dt * 24;
        env.temperature += clamp(diff, -rate, rate);
    } else {
        var diff2 = env.ambientTemp - env.temperature;
        env.temperature += diff2 * 0.1 * dt;
    }
    
    var heatWave = state.meta.activeEvents.find(function(e) { return e.id === 'heatWave'; });
    if (heatWave) {
        env.temperature += heatWave.effects.tempChange * 0.1 * dt;
    }
    env.temperature = clamp(env.temperature, 15, 35);
}

function updateOxygen(state, dt, lightOn) {
    var env = state.env;
    var o2Consumed = 0;
    
    state.entities.animals.forEach(function(animal) {
        o2Consumed += animal.species.oxygenUse * (100 / state.tank.volume) * dt;
    });
    o2Consumed += (env.bioPopulation * 0.001) * dt;
    
    var o2Produced = 0;
    state.entities.plants.forEach(function(plant) {
        if (lightOn) {
            var efficiency = (1 - env.turbidity * plant.species.algaeSensitivity);
            o2Produced += plant.species.oxygenProduction * plant.growth * efficiency * dt;
        } else {
            o2Consumed += plant.species.oxygenProduction * 0.1 * plant.growth * dt;
        }
    });
    
    var surfaceExchange = env.surfaceAgitation * SIM_CONSTANTS.PUMP_O2_EXCHANGE_RATE * dt;
    var saturationDiff = SIM_CONSTANTS.O2_SATURATION - env.oxygen;
    o2Produced += saturationDiff * surfaceExchange;
    
    state.entities.devices.forEach(function(device) {
        if (device.type.id === 'airStone' && device.enabled) {
            o2Produced += device.type.aeration.o2ExchangeRate * saturationDiff * dt;
        }
    });
    
    env.oxygen += o2Produced - o2Consumed;
    env.oxygen = clamp(env.oxygen, 0, SIM_CONSTANTS.O2_SATURATION * 1.2);
}

function updateCO2(state, dt, lightOn) {
    var env = state.env;
    var co2Produced = 0;
    
    state.entities.animals.forEach(function(animal) {
        co2Produced += animal.species.oxygenUse * 0.8 * dt;
    });
    
    var co2Consumed = 0;
    state.entities.plants.forEach(function(plant) {
        if (lightOn) {
            co2Consumed += plant.species.co2Need * plant.growth * dt;
        } else {
            co2Produced += plant.species.co2Need * 0.2 * plant.growth * dt;
        }
    });
    
    var surfaceExchange = env.surfaceAgitation * 0.3 * dt;
    var ambientDiff = SIM_CONSTANTS.CO2_AMBIENT - env.co2;
    env.co2 += co2Produced - co2Consumed + (ambientDiff * surfaceExchange);
    env.co2 = clamp(env.co2, 0, 30);
}

function updatePH(state, dt) {
    var env = state.env;
    var co2Effect = (env.co2 - SIM_CONSTANTS.CO2_AMBIENT) * 0.02;
    var bufferStrength = env.kh / 10;
    var neutralDrift = (SIM_CONSTANTS.PH_NEUTRAL - env.ph) * 0.01 * dt;
    
    var decorEffect = 0;
    state.entities.decorations.forEach(function(decor) {
        if (decor.effects && decor.effects.phChange) {
            decorEffect += decor.effects.phChange * dt;
        }
    });
    
    var totalChange = (-co2Effect + neutralDrift + decorEffect) / (1 + bufferStrength);
    env.ph += totalChange * dt;
    env.ph = clamp(env.ph, 5.5, 9.0);
}

function updateClarity(state, dt) {
    var env = state.env;
    env.turbidity *= Math.pow(0.95, dt);
    
    state.entities.devices.forEach(function(device) {
        if (device.type.id === 'filter' && device.enabled) {
            var efficiency = 1 - (device.dirtiness * device.type.maintenance.performanceDecay);
            env.turbidity -= device.type.mechanical.turbidityReduction * efficiency * dt;
        }
    });
    
    env.turbidity += env.ammonia * 0.05 * dt;
    env.turbidity += env.algae * 0.1 * dt;
    env.turbidity = clamp(env.turbidity, 0, 1);
    env.clarity = 1 - env.turbidity;
}

// ============================================
// NITROGEN CYCLE
// ============================================
function updateBacteria(state, dt) {
    var env = state.env;
    
    if (env.ammonia > 0.01 && env.oxygen > 3) {
        var growthRate = SIM_CONSTANTS.BACTERIA_GROWTH_RATE;
        var ammoniaFactor = Math.min(env.ammonia / 0.5, 1);
        var tempFactor = env.temperature > 20 && env.temperature < 30 ? 1 : 0.5;
        var growth = growthRate * ammoniaFactor * tempFactor * dt;
        env.bioPopulation = Math.min(env.bioPopulation + growth * env.bioPopulation, env.bioCapacity);
    }
    
    if (env.oxygen < 2) {
        env.bioPopulation *= Math.pow(0.9, dt);
    }
    
    var nitrificationCapacity = env.bioPopulation / 100;
    
    var ammoniaConverted = Math.min(env.ammonia, nitrificationCapacity * SIM_CONSTANTS.BACTERIA_AMMONIA_CONVERSION * dt);
    env.ammonia -= ammoniaConverted;
    env.nitrite += ammoniaConverted * 0.9;
    
    var nitriteConverted = Math.min(env.nitrite, nitrificationCapacity * SIM_CONSTANTS.BACTERIA_NITRITE_CONVERSION * dt);
    env.nitrite -= nitriteConverted;
    env.nitrate += nitriteConverted * 0.95;
    
    state.entities.plants.forEach(function(plant) {
        var uptakeEfficiency = plant.health / 100;
        env.nitrate -= plant.species.nitrateUptake * plant.growth * uptakeEfficiency * dt;
        env.ammonia -= plant.species.ammoniaUptake * plant.growth * uptakeEfficiency * dt;
    });
    
    env.ammonia = Math.max(0, env.ammonia);
    env.nitrite = Math.max(0, env.nitrite);
    env.nitrate = Math.max(0, env.nitrate);
}

function updateAlgae(state, dt, lightOn) {
    var env = state.env;
    var algaeBloom = state.meta.activeEvents.find(function(e) { return e.id === 'algaeBloom'; });
    var bloomMultiplier = algaeBloom ? algaeBloom.effects.algaeGrowthMultiplier : 1;
    
    var growthRate = SIM_CONSTANTS.ALGAE_GROWTH_BASE * bloomMultiplier;
    if (lightOn) growthRate *= SIM_CONSTANTS.ALGAE_LIGHT_FACTOR;
    
    var nutrientFactor = 1 + (env.nitrate / 20) * SIM_CONSTANTS.ALGAE_NUTRIENT_FACTOR;
    growthRate *= nutrientFactor;
    
    var suppression = 0;
    state.entities.plants.forEach(function(plant) {
        if (plant.species.floating && plant.species.lightBlocking) {
            suppression += plant.species.algaeSuppression * plant.growth;
        }
    });
    growthRate *= (1 - suppression);
    
    state.entities.animals.forEach(function(animal) {
        if (animal.species.algaeConsumption) {
            env.algae -= animal.species.algaeConsumption * (animal.health / 100) * dt;
        }
    });
    
    env.algae += growthRate * dt;
    env.algae = clamp(env.algae, 0, 1);
}

// ============================================
// DEVICE UPDATES
// ============================================
function updateDevices(state, dt, lightOn) {
    var env = state.env;
    var powerOut = state.meta.activeEvents.find(function(e) { return e.id === 'powerOutage'; });
    
    env.flow = 0;
    env.surfaceAgitation = 0;
    var totalBioCapacity = 50;
    
    state.entities.devices.forEach(function(device) {
        if (!device.enabled || powerOut) return;
        
        if (device.type.maintenance) {
            device.dirtiness += device.type.maintenance.dirtyRate * dt;
            device.dirtiness = clamp(device.dirtiness, 0, 1);
        }
        
        var efficiency = device.type.maintenance 
            ? (1 - device.dirtiness * device.type.maintenance.performanceDecay) : 1;
        
        switch (device.type.id) {
            case 'filter':
                totalBioCapacity += device.type.biological.baseCapacity * efficiency;
                env.flow += device.type.flowOutput * efficiency;
                env.surfaceAgitation += 0.3 * efficiency;
                break;
            case 'pump':
                env.flow += device.type.flowOutput * efficiency;
                env.surfaceAgitation += device.type.oxygenation.surfaceAgitation * efficiency;
                break;
            case 'airStone':
                env.flow += device.type.flowOutput;
                env.surfaceAgitation += device.type.aeration.surfaceAgitation;
                break;
            case 'light':
                var hour = (state.meta.simTime / 60) % 24;
                device.isOn = hour >= state.settings.lightSchedule.on && hour < state.settings.lightSchedule.off;
                break;
            case 'autoFeeder':
                if (device.foodRemaining > 0) {
                    var minuteOfDay = state.meta.simTime % 1440;
                    var feedTimes = [8 * 60, 18 * 60];
                    feedTimes.forEach(function(feedMinute) {
                        if (Math.abs(minuteOfDay - feedMinute) < 5 && state.meta.simTime - device.lastDispense > 60) {
                            feedAnimals(state, device.type.feeding.amountPerDispense);
                            device.foodRemaining -= device.type.feeding.amountPerDispense;
                            device.lastDispense = state.meta.simTime;
                        }
                    });
                }
                break;
        }
    });
    
    env.bioCapacity = totalBioCapacity;
    env.flow = clamp(env.flow, 0, 1);
    env.surfaceAgitation = clamp(env.surfaceAgitation, 0, 1);
}

// ============================================
// ANIMAL UPDATES
// ============================================
function updateAnimals(state, dt, dtMinutes, rng) {
    var env = state.env;
    var toRemove = [];
    
    state.entities.animals.forEach(function(animal) {
        animal.age += dtMinutes;
        updateAnimalStress(animal, env, dt);
        
        animal.hunger += (animal.species.foodNeed / 1440) * dtMinutes;
        animal.hunger = clamp(animal.hunger, 0, 100);
        
        if (animal.hunger > 70) {
            animal.stress += (animal.hunger - 70) * 0.1 * dt;
        }
        
        if (animal.species.behavior.grazing && env.algae > 0.05) {
            var grazed = Math.min(0.01 * dt, env.algae);
            env.algae -= grazed;
            animal.hunger -= grazed * 500;
        }
        
        if (animal.hunger < 80) {
            var wasteRate = animal.species.wasteRate * (100 / state.tank.volume);
            env.ammonia += wasteRate * dt;
        }
        
        if (animal.stress > 50) {
            animal.health -= (animal.stress - 50) * 0.05 * dt;
        } else if (animal.stress < 20 && animal.hunger < 50) {
            animal.health += 5 * dt;
        }
        animal.health = clamp(animal.health, 0, 100);
        
        if (animal.health <= 0 || animal.stress >= SIM_CONSTANTS.STRESS_DEATH_THRESHOLD) {
            animal.deathTimer += dtMinutes;
            if (animal.deathTimer > 60) {
                toRemove.push(animal);
                state.meta.totalDeaths++;
                addLogMessage(state, '😢 ' + animal.species.name + ' has died.', 'death');
                env.ammonia += 0.5;
            }
        } else {
            animal.deathTimer = Math.max(0, animal.deathTimer - dtMinutes * 0.5);
        }
        
        checkReproduction(state, animal, dt, rng);
        updateAnimalBehavior(animal, state, dtMinutes, rng);
        animal.animFrame += dtMinutes * animal.species.behavior.speed;
    });
    
    toRemove.forEach(function(animal) {
        var index = state.entities.animals.indexOf(animal);
        if (index > -1) state.entities.animals.splice(index, 1);
    });
}

function updateAnimalStress(animal, env, dt) {
    var comfort = animal.species.comfort;
    var sensitivity = animal.species.stressSensitivity;
    var stressGain = 0;
    
    stressGain += calculateParameterStress(env.temperature, comfort.temp.min, comfort.temp.max, comfort.temp.min - 5, comfort.temp.max + 5) * sensitivity.temperature * 20;
    stressGain += calculateParameterStress(env.ph, comfort.pH.min, comfort.pH.max, comfort.pH.min - 1, comfort.pH.max + 1) * sensitivity.pH * 15;
    
    if (env.ammonia > comfort.ammonia.max) {
        var severity = (env.ammonia - comfort.ammonia.max) / (comfort.ammonia.critical - comfort.ammonia.max);
        stressGain += clamp(severity, 0, 1) * sensitivity.ammonia * 30;
    }
    if (env.nitrite > comfort.nitrite.max) {
        var severity2 = (env.nitrite - comfort.nitrite.max) / (comfort.nitrite.critical - comfort.nitrite.max);
        stressGain += clamp(severity2, 0, 1) * sensitivity.nitrite * 30;
    }
    if (env.nitrate > comfort.nitrate.max) {
        var severity3 = (env.nitrate - comfort.nitrate.max) / (comfort.nitrate.critical - comfort.nitrate.max);
        stressGain += clamp(severity3, 0, 1) * sensitivity.nitrate * 10;
    }
    if (env.oxygen < comfort.oxygen.min) {
        var severity4 = (comfort.oxygen.min - env.oxygen) / (comfort.oxygen.min - comfort.oxygen.critical);
        stressGain += clamp(severity4, 0, 1) * sensitivity.oxygen * 25;
    }
    if (env.flow < comfort.flow.min || env.flow > comfort.flow.max) {
        stressGain += 5 * sensitivity.flow;
    }
    
    if (stressGain > 0) {
        animal.stress += stressGain * dt;
    } else {
        animal.stress -= SIM_CONSTANTS.STRESS_RECOVERY_RATE * 100 * dt;
    }
    animal.stress = clamp(animal.stress, 0, 100);
}

function checkReproduction(state, animal, dt, rng) {
    var repro = animal.species.reproduction;
    if (!repro || repro.method === 'none') return;
    if (animal.stress > SIM_CONSTANTS.REPRODUCTION_STRESS_MAX) return;
    if (animal.hunger > 50) return;
    if (animal.age < repro.maturityDays * 1440) return;
    
    var sameSpecies = state.entities.animals.filter(function(a) { return a.species.id === animal.species.id; });
    if (sameSpecies.length < 2) return;
    
    if (rng.chance(repro.chance * dt)) {
        var offspring = rng.int(repro.offspring.min, repro.offspring.max);
        for (var i = 0; i < offspring; i++) {
            var baby = createAnimal(animal.species.id, animal.x + rng.range(-30, 30), animal.y + rng.range(-30, 30), rng);
            baby.size = 0.4;
            baby.age = 0;
            state.entities.animals.push(baby);
        }
        
        if (animal.species.category === 'shrimp') {
            state.meta.shrimpBred += offspring;
        } else {
            state.meta.fishBred += offspring;
        }
        addLogMessage(state, '🎉 ' + offspring + ' baby ' + animal.species.name + '(s) born!', 'birth');
    }
}

function updateAnimalBehavior(animal, state, dtMinutes, rng) {
    var behavior = animal.species.behavior;
    var tank = state.tank;
    
    animal.stateTimer -= dtMinutes;
    
    if (animal.stateTimer <= 0) {
        var behaviors = ['wander', 'rest', 'explore'];
        if (behavior.grazing && state.env.algae > 0.05) behaviors.push('graze');
        if (behavior.schooling) behaviors.push('school');
        animal.behaviorState = rng.pick(behaviors);
        animal.stateTimer = rng.range(30, 180);
        pickNewTarget(animal, state, rng);
    }
    
    if (behavior.schooling && animal.behaviorState === 'school') {
        applySchoolingForces(animal, state);
    }
    
    var dx = animal.targetX - animal.x;
    var dy = animal.targetY - animal.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > 5) {
        var speed = behavior.speed * (animal.health / 100) * (animal.behaviorState === 'rest' ? 0.3 : 1);
        var targetAngle = Math.atan2(dy, dx);
        
        var angleDiff = targetAngle - animal.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        animal.angle += angleDiff * behavior.turnRate;
        
        animal.vx = Math.cos(animal.angle) * speed;
        animal.vy = Math.sin(animal.angle) * speed;
        animal.flipX = animal.vx < 0;
    } else {
        animal.vx *= 0.9;
        animal.vy *= 0.9;
        if (rng.chance(0.02)) pickNewTarget(animal, state, rng);
    }
    
    animal.vx += state.env.flow * 0.1;
    animal.x += animal.vx * dtMinutes * 0.5;
    animal.y += animal.vy * dtMinutes * 0.5;
    
    var margin = 20;
    var substrateTop = tank.height - state.tank.substrateDepth;
    animal.x = clamp(animal.x, margin, tank.width - margin);
    
    var minY = margin, maxY = substrateTop - margin;
    if (behavior.depthPreference === 'bottom') { minY = substrateTop - 100; maxY = substrateTop - 10; }
    else if (behavior.depthPreference === 'top') { minY = margin; maxY = tank.height * 0.4; }
    else if (behavior.depthPreference === 'surface' && behavior.wallClimbing) { maxY = substrateTop - 5; }
    animal.y = clamp(animal.y, minY, maxY);
}

function pickNewTarget(animal, state, rng) {
    var tank = state.tank;
    var behavior = animal.species.behavior;
    var substrateTop = tank.height - state.tank.substrateDepth;
    var targetY;
    
    if (behavior.depthPreference === 'bottom') { targetY = rng.range(substrateTop - 80, substrateTop - 15); }
    else if (behavior.depthPreference === 'top') { targetY = rng.range(30, tank.height * 0.35); }
    else { targetY = rng.range(tank.height * 0.2, substrateTop - 50); }
    
    animal.targetX = rng.range(50, tank.width - 50);
    animal.targetY = targetY;
}

function applySchoolingForces(animal, state) {
    var behavior = animal.species.behavior;
    var sameSpecies = state.entities.animals.filter(function(a) { return a.species.id === animal.species.id && a.id !== animal.id; });
    if (sameSpecies.length === 0) return;
    
    var alignX = 0, alignY = 0, cohesionX = 0, cohesionY = 0, separationX = 0, separationY = 0, neighbors = 0;
    
    sameSpecies.forEach(function(other) {
        var dx = other.x - animal.x;
        var dy = other.y - animal.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < behavior.schoolRadius && dist > 0) {
            neighbors++;
            alignX += other.vx;
            alignY += other.vy;
            cohesionX += dx;
            cohesionY += dy;
            if (dist < 30) { separationX -= dx / dist; separationY -= dy / dist; }
        }
    });
    
    if (neighbors > 0) {
        animal.targetX += (alignX / neighbors) * behavior.alignmentWeight + (cohesionX / neighbors) * behavior.cohesionWeight + separationX * behavior.separationWeight;
        animal.targetY += (alignY / neighbors) * behavior.alignmentWeight + (cohesionY / neighbors) * behavior.cohesionWeight + separationY * behavior.separationWeight;
    }
}

// ============================================
// PLANT UPDATES
// ============================================
function updatePlants(state, dt, lightOn, rng) {
    var env = state.env;
    var lightLevel = lightOn ? 1.0 : 0.1;
    
    state.entities.plants.forEach(function(plant) {
        if (plant.species.floating && plant.species.lightBlocking) {
            lightLevel -= plant.species.lightBlocking * plant.growth * 0.3;
        }
    });
    lightLevel *= (1 - env.turbidity * 0.5);
    lightLevel *= (1 - env.algae * 0.3);
    lightLevel = Math.max(0.1, lightLevel);
    
    state.entities.plants.forEach(function(plant) {
        var effectiveLight = lightLevel;
        if (plant.species.lightNeed === 'high' && lightLevel < 0.7) effectiveLight *= 0.5;
        else if (plant.species.lightNeed === 'low') effectiveLight = Math.min(1, lightLevel * 1.5);
        
        if (lightOn && env.co2 > 0.5) {
            var growthRate = plant.species.growthRate * effectiveLight;
            var nutrientFactor = Math.min(1, env.nitrate / 10);
            plant.growth += growthRate * nutrientFactor * dt;
            plant.growth = Math.min(plant.growth, plant.maxGrowth);
        }
        
        var healthChange = 0;
        if (env.algae > 0.3) healthChange -= env.algae * plant.species.algaeSensitivity * 10 * dt;
        if (plant.species.lightNeed === 'high' && lightLevel < 0.5) healthChange -= 5 * dt;
        if (lightLevel > 0.5 && env.nitrate > 5 && env.algae < 0.2) healthChange += 3 * dt;
        
        plant.health += healthChange;
        plant.health = clamp(plant.health, 0, 100);
        
        if (plant.health <= 0) {
            plant.growth -= 0.1 * dt;
            env.ammonia += 0.05 * dt;
        }
    });
    
    state.entities.plants = state.entities.plants.filter(function(p) { return p.growth > 0.1 || p.health > 0; });
}

// ============================================
// PARTICLE UPDATES
// ============================================
function updateParticles(state, dtMinutes) {
    var tank = state.tank;
    
    state.entities.particles.forEach(function(particle) {
        particle.x += particle.vx * dtMinutes;
        particle.y += particle.vy * dtMinutes;
        particle.vx += state.env.flow * 0.02;
        
        if (particle.type === 'bubble') {
            particle.vy = Math.min(particle.vy, -0.5);
            if (particle.y < 10) particle.life = 0;
            particle.x += Math.sin(particle.life * 0.1) * 0.3;
        } else if (particle.type === 'food') {
            particle.vy = Math.min(particle.vy + 0.01, 0.3);
        }
        
        particle.life -= dtMinutes;
        particle.alpha = particle.life / particle.maxLife;
        particle.x = clamp(particle.x, 0, tank.width);
    });
    
    state.entities.particles = state.entities.particles.filter(function(p) { return p.life > 0; });
}

// ============================================
// DERIVED CALCULATIONS
// ============================================
function calculateStability(state) {
    var env = state.env;
    var score = 100;
    
    if (env.ammonia > 0.1) score -= Math.min(40, env.ammonia * 50);
    if (env.nitrite > 0.1) score -= Math.min(40, env.nitrite * 50);
    if (env.nitrate > 30) score -= Math.min(15, (env.nitrate - 30) * 0.5);
    if (env.oxygen < 5) score -= (5 - env.oxygen) * 10;
    
    var tempVariance = Math.abs(env.temperature - 25);
    if (tempVariance > 3) score -= (tempVariance - 3) * 3;
    
    var phVariance = Math.abs(env.ph - 7);
    if (phVariance > 0.5) score -= (phVariance - 0.5) * 10;
    
    score -= env.turbidity * 10;
    score -= env.algae * 15;
    
    if (state.entities.animals.length > 0) {
        var avgStress = state.entities.animals.reduce(function(sum, a) { return sum + a.stress; }, 0) / state.entities.animals.length;
        score -= avgStress * 0.2;
    }
    
    env.stabilityScore = clamp(Math.round(score), 0, 100);
    
    var days = Math.floor(state.meta.simTime / 1440);
    var lastDays = Math.floor((state.meta.simTime - 1) / 1440);
    
    if (env.stabilityScore >= 70) {
        if (days > lastDays) state.meta.consecutiveStableDays++;
    } else {
        state.meta.consecutiveStableDays = 0;
    }
    
    if (env.algae < 0.05) {
        if (days > lastDays) state.meta.consecutiveLowAlgaeDays++;
    } else {
        state.meta.consecutiveLowAlgaeDays = 0;
    }
}

function updateWarnings(state) {
    var env = state.env;
    var warnings = [];
    
    if (env.ammonia > SIM_CONSTANTS.AMMONIA_TOXICITY_THRESHOLD) warnings.push({ type: 'ammonia', message: 'Ammonia spike!', severity: 'danger' });
    else if (env.ammonia > 0.25) warnings.push({ type: 'ammonia', message: 'Ammonia elevated', severity: 'warning' });
    
    if (env.nitrite > SIM_CONSTANTS.NITRITE_TOXICITY_THRESHOLD) warnings.push({ type: 'nitrite', message: 'Nitrite spike!', severity: 'danger' });
    else if (env.nitrite > 0.25) warnings.push({ type: 'nitrite', message: 'Nitrite elevated', severity: 'warning' });
    
    if (env.oxygen < SIM_CONSTANTS.O2_CRITICAL_LOW) warnings.push({ type: 'oxygen', message: 'Oxygen critical!', severity: 'danger' });
    else if (env.oxygen < 5.5) warnings.push({ type: 'oxygen', message: 'Oxygen low', severity: 'warning' });
    
    if (Math.abs(env.ph - 7) > 1) warnings.push({ type: 'ph', message: 'pH unstable', severity: 'warning' });
    
    var fishCount = state.entities.animals.filter(function(a) { return a.species.category === 'fish'; }).length;
    var shrimpCount = state.entities.animals.filter(function(a) { return a.species.category === 'shrimp'; }).length;
    var bioload = fishCount * 2 + shrimpCount * 0.5;
    if (bioload > state.tank.volume / 8) warnings.push({ type: 'stock', message: 'Overstocked', severity: 'warning' });
    
    var filter = state.entities.devices.find(function(d) { return d.type.id === 'filter'; });
    if (filter && filter.dirtiness > 0.7) warnings.push({ type: 'filter', message: 'Filter dirty', severity: 'warning' });
    if (!filter && state.entities.animals.length > 0) warnings.push({ type: 'filter', message: 'No filter!', severity: 'danger' });
    
    state.meta.warnings = warnings;
}

// ============================================
// EVENTS
// ============================================
function checkEvents(state, dt, rng) {
    state.meta.activeEvents = state.meta.activeEvents.filter(function(event) {
        event.remaining -= dt * 1440;
        return event.remaining > 0;
    });
    
    Object.keys(RANDOM_EVENTS).forEach(function(key) {
        var eventDef = RANDOM_EVENTS[key];
        if (state.meta.activeEvents.some(function(e) { return e.id === eventDef.id; })) return;
        if (eventDef.conditions && !eventDef.conditions(state)) return;
        
        if (rng.chance(eventDef.probability * dt)) {
            var duration = rng.range(eventDef.duration.min, eventDef.duration.max) * 60;
            state.meta.activeEvents.push({
                id: eventDef.id, name: eventDef.name, effects: eventDef.effects, remaining: duration
            });
            addLogMessage(state, '⚡ ' + eventDef.warning, 'event');
        }
    });
}

function checkAchievements(state) {
    Object.keys(ACHIEVEMENTS).forEach(function(key) {
        var achievement = ACHIEVEMENTS[key];
        if (state.meta.achievements.indexOf(achievement.id) !== -1) return;
        if (achievement.condition(state)) {
            state.meta.achievements.push(achievement.id);
            addLogMessage(state, '🏆 Achievement unlocked: ' + achievement.name + '!', 'achievement');
        }
    });
}

// ============================================
// PLAYER ACTIONS
// ============================================
function feedAnimals(state, amount) {
    amount = amount || 1;
    var rng = new SeededRandom(state.meta.simTime);
    
    for (var i = 0; i < amount * 5; i++) {
        state.entities.particles.push(createParticle('food', rng.range(100, state.tank.width - 100), 20, rng));
    }
    
    state.entities.animals.forEach(function(animal) {
        animal.hunger = Math.max(0, animal.hunger - amount * 30);
        animal.lastFed = state.meta.simTime;
    });
    
    var excess = amount * SIM_CONSTANTS.FEED_WASTE_FACTOR;
    state.env.ammonia += excess * 0.1;
    state.env.turbidity += excess * 0.02;
    addLogMessage(state, '🍽️ Fed the tank', 'action');
}

function performWaterChange(state, percentage) {
    var factor = 1 - (percentage / 100);
    state.env.ammonia *= factor;
    state.env.nitrite *= factor;
    state.env.nitrate *= factor;
    state.env.turbidity *= factor;
    state.env.algae *= factor * 0.9;
    state.env.tannins *= factor;
    state.env.bioPopulation *= (factor + (1 - factor) * 0.8);
    state.env.temperature = lerp(state.env.temperature, 23, percentage / 200);
    state.meta.waterChanges++;
    addLogMessage(state, '💧 Performed ' + percentage + '% water change', 'action');
}

function cleanFilter(state) {
    var filter = state.entities.devices.find(function(d) { return d.type.id === 'filter'; });
    if (!filter) return;
    var bacteriaLoss = state.env.bioPopulation * filter.type.maintenance.cleaningBacteriaLoss;
    state.env.bioPopulation -= bacteriaLoss;
    filter.dirtiness = 0;
    addLogMessage(state, '🔧 Cleaned filter (some bacteria lost)', 'action');
}

function addEntity(state, type, entityData, x, y) {
    var rng = new SeededRandom(state.meta.simTime);
    switch (type) {
        case 'animal':
            var animal = createAnimal(entityData, x, y, rng);
            state.entities.animals.push(animal);
            addLogMessage(state, '🐟 Added ' + ANIMAL_SPECIES[entityData].name, 'action');
            break;
        case 'plant':
            var plant = createPlant(entityData, x, y, rng);
            state.entities.plants.push(plant);
            addLogMessage(state, '🌿 Added ' + PLANT_SPECIES[entityData].name, 'action');
            break;
        case 'device':
            var device = createDevice(entityData, x, y);
            state.entities.devices.push(device);
            addLogMessage(state, '⚙️ Added ' + DEVICE_TYPES[entityData].name, 'action');
            break;
    }
}

function removeEntity(state, type, id) {
    switch (type) {
        case 'animal': state.entities.animals = state.entities.animals.filter(function(a) { return a.id !== id; }); break;
        case 'plant': state.entities.plants = state.entities.plants.filter(function(p) { return p.id !== id; }); break;
        case 'device': state.entities.devices = state.entities.devices.filter(function(d) { return d.id !== id; }); break;
    }
}

function useBacteriaStarter(state) { state.env.bioPopulation += 100; addLogMessage(state, '🦠 Added bacteria starter', 'action'); }
function useWaterConditioner(state) { state.env.ammonia = Math.max(0, state.env.ammonia - 0.5); addLogMessage(state, '💊 Added water conditioner', 'action'); }
function usePHBuffer(state) { state.env.kh += 2; state.env.ph = lerp(state.env.ph, 7.0, 0.3); addLogMessage(state, '⚗️ Added pH buffer', 'action'); }
function usePlantFertilizer(state) { state.env.nitrate += 5; state.entities.plants.forEach(function(p) { p.growth += 0.1; }); addLogMessage(state, '🌱 Added plant fertilizer', 'action'); }
function useAlgaeTreatment(state) { state.env.algae = Math.max(0, state.env.algae - 0.3); state.entities.plants.forEach(function(p) { p.health -= 5; }); addLogMessage(state, '🧪 Applied algae treatment', 'action'); }

// ============================================
// HISTORY AND LOGGING
// ============================================
function recordHistory(state) {
    var env = state.env;
    var t = state.meta.simTime;
    state.history.temperature.push({ t: t, v: env.temperature });
    state.history.ph.push({ t: t, v: env.ph });
    state.history.ammonia.push({ t: t, v: env.ammonia });
    state.history.nitrite.push({ t: t, v: env.nitrite });
    state.history.nitrate.push({ t: t, v: env.nitrate });
    state.history.oxygen.push({ t: t, v: env.oxygen });
    state.history.stability.push({ t: t, v: env.stabilityScore });
    state.history.algae.push({ t: t, v: env.algae });
}

function addLogMessage(state, message, type) {
    type = type || 'info';
    state.meta.log.unshift({ time: state.meta.simTime, message: message, type: type });
    if (state.meta.log.length > 100) state.meta.log.pop();
}

// ============================================
// SERIALIZATION
// ============================================
function serializeState(state) {
    var serialized = JSON.parse(JSON.stringify(state));
    Object.keys(state.history).forEach(function(key) {
        serialized.history[key] = state.history[key].toArray();
    });
    return JSON.stringify(serialized);
}

function deserializeState(json) {
    var data = JSON.parse(json);
    Object.keys(data.history).forEach(function(key) {
        var buffer = new RingBuffer(SIM_CONSTANTS.HISTORY_MAX_SAMPLES);
        data.history[key].forEach(function(item) { buffer.push(item); });
        data.history[key] = buffer;
    });
    return data;
}

// Export to namespace
ns.createInitialState = createInitialState;
ns.createAnimal = createAnimal;
ns.createPlant = createPlant;
ns.createDevice = createDevice;
ns.createParticle = createParticle;
ns.updateSimulation = updateSimulation;
ns.feedAnimals = feedAnimals;
ns.performWaterChange = performWaterChange;
ns.cleanFilter = cleanFilter;
ns.addEntity = addEntity;
ns.removeEntity = removeEntity;
ns.useBacteriaStarter = useBacteriaStarter;
ns.useWaterConditioner = useWaterConditioner;
ns.usePHBuffer = usePHBuffer;
ns.usePlantFertilizer = usePlantFertilizer;
ns.useAlgaeTreatment = useAlgaeTreatment;
ns.serializeState = serializeState;
ns.deserializeState = deserializeState;

})(window.AquariumSim);
