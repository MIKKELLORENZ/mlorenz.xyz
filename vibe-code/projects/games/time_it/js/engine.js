/* ========================================
   TIME IT! - Physics Engine
   Handles rocket simulation and rendering
   ======================================== */

class RocketEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
        
        // Physics constants
        this.GRAVITY = 30;           // Pixels per second squared (reduced for better gameplay)
        this.SCALE = 1;              // 1 meter = 1 pixel (adjustable)
        this.AIR_RESISTANCE = 0.0005; // Drag coefficient (reduced)
        
        // Simulation state
        this.rocket = null;
        this.level = null;
        this.time = 0;
        this.running = false;
        this.finished = false;
        
        // Camera
        this.camera = {
            x: 0,
            y: 0,
            targetY: 0,
            smoothing: 0.1
        };
        
        // Particles for effects
        this.particles = [];
        
        // Trail for rocket path
        this.trail = [];
        
        // Animation frame
        this.animationId = null;
        this.lastTime = 0;
        
        // Orbit tracking
        this.orbitTime = 0;
        this.maxAltitudeReached = 0;
        
        // Results callback
        this.onFinish = null;
        
        // Bind resize handler
        window.addEventListener('resize', () => this.resize());
    }
    
    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.groundY = this.canvas.height - 100;
        this.launchX = this.canvas.width / 2;
    }
    
    // Initialize rocket for simulation
    initRocket(components, timings) {
        // Calculate rocket height based on components
        const rocketHeight = components.reduce((h, c) => h + (c.size?.height || 30) + 2, 0);
        
        // Calculate fuel bonuses from fuel tanks
        const fuelBonus = this.calculateFuelBonus(components);
        
        this.rocket = {
            x: this.launchX,
            y: this.groundY - rocketHeight,  // Bottom of rocket touches ground
            vx: 0,
            vy: 0,
            angle: -90,  // Pointing up (in degrees, -90 is up)
            angularVelocity: 0,
            components: components.map((c, i) => {
                // Apply fuel bonus to engines
                let burnTime = c.stats?.burnTime || c.stats?.duration || 0;
                if (c.category === 'engines') {
                    burnTime += fuelBonus;
                }
                return {
                    ...c,
                    index: i,
                    timing: timings[i] || 0,
                    active: false,
                    burned: false,
                    separated: false,
                    burnTimeRemaining: burnTime,
                    totalBurnTime: burnTime,
                    rotationPhase: 'idle'  // Track rotation state: idle, turning, holding, returning
                };
            }),
            mass: this.calculateMass(components),
            dragCoefficient: this.calculateDrag(components),
            crashed: false,
            landed: false,
            hasLandingGear: components.some(c => c.category === 'landing'),
            maxLandingSpeed: this.getMaxLandingSpeed(components),
            hasParachute: components.some(c => c.id === 'parachute'),
            parachuteDeployed: false
        };
        
        // Separated stages (debris falling)
        this.separatedStages = [];
        
        this.time = 0;
        this.trail = [];
        this.particles = [];
        this.orbitTime = 0;
        this.maxAltitudeReached = 0;
        this.finished = false;
    }
    
    calculateFuelBonus(components) {
        let bonus = 0;
        components.forEach(c => {
            if (c.stats?.fuelBonus) {
                bonus += c.stats.fuelBonus;
            }
        });
        return bonus;
    }
    
    calculateMass(components) {
        // Sum up all component masses
        let mass = 10;  // Base rocket frame mass
        components.forEach(c => {
            mass += c.stats?.mass || (c.size?.height || 30) * 0.2;
        });
        return mass;
    }
    
    calculateDrag(components) {
        let drag = this.AIR_RESISTANCE;
        // Nose cone reduces drag
        if (components.some(c => c.id === 'nose-cone')) {
            drag *= 0.7;
        }
        return drag;
    }
    
    getMaxLandingSpeed(components) {
        let maxSpeed = 10; // Default very low
        components.forEach(c => {
            if (c.stats?.maxLandingSpeed) {
                maxSpeed = Math.max(maxSpeed, c.stats.maxLandingSpeed);
            }
        });
        return maxSpeed;
    }
    
    // Set current level
    setLevel(level) {
        this.level = level;
    }
    
    // Start simulation
    start() {
        this.running = true;
        this.lastTime = performance.now();
        this.animate();
    }
    
    // Stop simulation
    stop() {
        this.running = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
    }
    
    // Main animation loop
    animate() {
        if (!this.running) return;
        
        const currentTime = performance.now();
        const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.05); // Cap at 50ms
        this.lastTime = currentTime;
        
        this.update(deltaTime);
        this.render();
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    // Physics update
    update(dt) {
        if (!this.rocket) return;
        
        // Always update particles and separated stages (for explosion animation)
        this.updateParticles(dt);
        this.updateSeparatedStages(dt);
        
        // Stop other updates if simulation is finished
        if (this.finished) return;
        
        this.time += dt;
        
        // Check time limit
        if (this.time >= this.level.maxTime) {
            this.finishSimulation();
            return;
        }
        
        // Process components based on timing
        this.processComponents(dt);
        
        // Apply physics
        this.applyPhysics(dt);
        
        // Update camera
        this.updateCamera();
        
        // Add trail point
        if (this.time % 0.1 < dt) {
            this.trail.push({
                x: this.rocket.x,
                y: this.rocket.y,
                alpha: 1
            });
            if (this.trail.length > 200) {
                this.trail.shift();
            }
        }
        
        // Track max altitude
        const altitude = this.groundY - this.rocket.y;
        if (altitude > this.maxAltitudeReached) {
            this.maxAltitudeReached = altitude;
        }
        
        // Check collision and objectives
        this.checkCollisions();
        this.checkObjective();
    }
    
    processComponents(dt) {
        const rocket = this.rocket;
        
        rocket.components.forEach((comp, i) => {
            if (comp.separated) return; // Skip separated components
            
            // Check if component should activate
            if (!comp.active && !comp.burned && this.time >= comp.timing) {
                comp.active = true;
                
                // Check for stage separation - if this is an engine starting
                // and there's a component below it (lower index) that hasn't finished burning
                if (comp.category === 'engines' && i > 0) {
                    // Find components below this one that are still active
                    let separationIndex = -1;
                    for (let j = i - 1; j >= 0; j--) {
                        const belowComp = rocket.components[j];
                        if (belowComp.separated) continue;
                        
                        // If component below is still burning or hasn't started yet
                        if (belowComp.category === 'engines' && !belowComp.burned) {
                            separationIndex = i;
                            break;
                        }
                    }
                    
                    // Trigger separation
                    if (separationIndex > 0) {
                        this.triggerSeparation(separationIndex);
                    }
                }
            }
            
            // Process active components
            if (comp.active && !comp.burned && !comp.separated) {
                // Reduce burn time
                comp.burnTimeRemaining -= dt;
                
                if (comp.burnTimeRemaining <= 0) {
                    comp.active = false;
                    comp.burned = true;
                    
                    // Auto-separate exhausted component
                    this.separateExhaustedComponent(i);
                }
            }
        });
    }
    
    triggerSeparation(atIndex) {
        // Separate all components below atIndex
        const separatedComps = [];
        for (let i = 0; i < atIndex; i++) {
            if (!this.rocket.components[i].separated) {
                this.rocket.components[i].separated = true;
                this.rocket.components[i].active = false;
                separatedComps.push({ ...this.rocket.components[i] });
            }
        }
        
        if (separatedComps.length > 0) {
            // Calculate position offset for separated stage
            let yOffset = 0;
            for (let i = atIndex; i < this.rocket.components.length; i++) {
                yOffset += (this.rocket.components[i].size?.height || 30) + 2;
            }
            
            // Create debris stage
            this.separatedStages.push({
                components: separatedComps,
                x: this.rocket.x,
                y: this.rocket.y + yOffset / 2,
                vx: this.rocket.vx * 0.3,
                vy: this.rocket.vy * 0.5 + 20, // Fall slower initially
                angle: this.rocket.angle,
                angularVelocity: (Math.random() - 0.5) * 60 // Tumble
            });
            
            // Create separation particles
            this.createSeparationParticles();
            
            // Recalculate rocket mass
            const remainingComps = this.rocket.components.filter(c => !c.separated);
            this.rocket.mass = this.calculateMass(remainingComps);
        }
    }
    
    createSeparationParticles(x, y) {
        const posX = x || this.rocket.x;
        const posY = y || this.rocket.y;
        
        for (let i = 0; i < 25; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 40 + Math.random() * 60;
            
            this.particles.push({
                x: posX,
                y: posY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.8 + Math.random() * 0.4,
                maxLife: 1.2,
                size: 3 + Math.random() * 5,
                color: ['#aaaaaa', '#888888', '#cccccc', '#ff6b35'][Math.floor(Math.random() * 4)]
            });
        }
        
        // Add some sparks
        for (let i = 0; i < 10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 80 + Math.random() * 100;
            
            this.particles.push({
                x: posX,
                y: posY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.3 + Math.random() * 0.3,
                maxLife: 0.6,
                size: 2 + Math.random() * 3,
                color: '#ffff00',
                spark: true
            });
        }
    }
    
    separateExhaustedComponent(componentIndex) {
        const comp = this.rocket.components[componentIndex];
        if (comp.separated) return;
        
        // Only separate if it's at the bottom of non-separated components
        const nonSeparatedBelow = this.rocket.components.slice(0, componentIndex).filter(c => !c.separated);
        if (nonSeparatedBelow.length > 0) return; // Can't separate middle components
        
        // Mark as separated
        comp.separated = true;
        
        // Calculate position offset
        let yOffset = 0;
        for (let i = componentIndex + 1; i < this.rocket.components.length; i++) {
            if (!this.rocket.components[i].separated) {
                yOffset += (this.rocket.components[i].size?.height || 30) + 2;
            }
        }
        
        // Create single component debris
        this.separatedStages.push({
            components: [{ ...comp }],
            x: this.rocket.x,
            y: this.rocket.y + yOffset,
            vx: this.rocket.vx * 0.2 + (Math.random() - 0.5) * 30,
            vy: this.rocket.vy * 0.3 + 30,
            angle: this.rocket.angle,
            angularVelocity: (Math.random() - 0.5) * 90
        });
        
        // Small separation effect
        this.createSeparationParticles(this.rocket.x, this.rocket.y + yOffset);
        
        // Recalculate rocket mass
        const remainingComps = this.rocket.components.filter(c => !c.separated);
        if (remainingComps.length > 0) {
            this.rocket.mass = this.calculateMass(remainingComps);
        }
    }
    
    updateSeparatedStages(dt) {
        this.separatedStages.forEach(stage => {
            // Apply gravity
            stage.vy += this.GRAVITY * dt;
            
            // Apply air resistance
            const speed = Math.sqrt(stage.vx * stage.vx + stage.vy * stage.vy);
            if (speed > 0) {
                const drag = 0.002 * speed * speed;
                stage.vx -= (stage.vx / speed) * drag * dt;
                stage.vy -= (stage.vy / speed) * drag * dt;
            }
            
            // Update position
            stage.x += stage.vx * dt;
            stage.y += stage.vy * dt;
            
            // Update rotation
            stage.angle += stage.angularVelocity * dt;
            
            // Check ground collision for debris
            if (stage.y >= this.groundY - 20 && !stage.exploded) {
                stage.exploded = true;
                this.createDebrisExplosion(stage.x, this.groundY - 10, stage.components.length);
            }
        });
        
        // Remove stages that fell below ground (after explosion)
        this.separatedStages = this.separatedStages.filter(s => s.y < this.groundY + 50 || !s.exploded);
    }
    
    applyPhysics(dt) {
        const rocket = this.rocket;
        
        // Calculate forces
        let thrustX = 0;
        let thrustY = 0;
        let brakeForce = 0;
        let rotationForce = 0;
        
        // Check for parachute deployment
        const altitude = this.groundY - rocket.y;
        if (rocket.hasParachute && !rocket.parachuteDeployed) {
            const parachute = rocket.components.find(c => c.id === 'parachute');
            if (parachute && altitude <= parachute.stats.deployAltitude && rocket.vy > 0) {
                rocket.parachuteDeployed = true;
                this.createSeparationParticles(); // Visual effect
            }
        }
        
        // Apply parachute braking if deployed
        if (rocket.parachuteDeployed) {
            const parachute = rocket.components.find(c => c.id === 'parachute');
            if (parachute) {
                brakeForce += parachute.stats.brakingForce || 1200;
            }
        }
        
        rocket.components.forEach(comp => {
            if (!comp.active || comp.separated) return;
            
            const angleRad = rocket.angle * Math.PI / 180;
            
            switch (comp.category) {
                case 'engines':
                    const thrust = comp.stats.thrust;
                    thrustX += Math.cos(angleRad) * thrust;
                    thrustY += Math.sin(angleRad) * thrust;
                    
                    // Create flame particles
                    this.createFlameParticles(comp);
                    break;
                    
                case 'rotation':
                    // Improved rotation: turn, optionally hold, then return
                    const totalDuration = comp.totalBurnTime || comp.stats.duration;
                    const elapsed = totalDuration - comp.burnTimeRemaining;
                    const holdTime = comp.stats.holdTime || 0;
                    const hasStabilization = comp.stats.stabilization;
                    
                    // Calculate phase durations
                    const turnTime = (totalDuration - holdTime) / 2;
                    const direction = comp.stats.direction === 'right' ? 1 : -1;
                    
                    if (elapsed < turnTime) {
                        // Phase 1: Turning
                        comp.rotationPhase = 'turning';
                        rotationForce = comp.stats.rotationSpeed * direction;
                    } else if (hasStabilization && elapsed < turnTime + holdTime) {
                        // Phase 2: Holding (only if has stabilization)
                        comp.rotationPhase = 'holding';
                        rotationForce = 0;
                    } else {
                        // Phase 3: Returning
                        comp.rotationPhase = 'returning';
                        rotationForce = -comp.stats.rotationSpeed * direction;
                    }
                    break;
                    
                case 'brakes':
                    brakeForce += comp.stats.brakingForce;
                    break;
                    
                case 'landing':
                    // Hover jets provide upward thrust when close to ground
                    if (comp.stats.hoverCapable && altitude < 100) {
                        const hoverThrust = comp.stats.hoverThrust || 600;
                        // Apply hover thrust opposite to gravity
                        thrustY -= hoverThrust * (1 - altitude / 100);
                    }
                    break;
            }
        });
        
        // Apply thrust
        rocket.vx += (thrustX / rocket.mass) * dt;
        rocket.vy += (thrustY / rocket.mass) * dt;
        
        // Apply gravity
        rocket.vy += this.GRAVITY * dt;
        
        // Apply air resistance (quadratic drag)
        const speed = Math.sqrt(rocket.vx * rocket.vx + rocket.vy * rocket.vy);
        if (speed > 0) {
            const dragForce = rocket.dragCoefficient * speed * speed;
            rocket.vx -= (rocket.vx / speed) * dragForce * dt;
            rocket.vy -= (rocket.vy / speed) * dragForce * dt;
        }
        
        // Apply brakes
        if (brakeForce > 0 && speed > 0) {
            const brakeDecel = brakeForce / rocket.mass;
            const brakeAmount = Math.min(brakeDecel * dt, speed);
            rocket.vx -= (rocket.vx / speed) * brakeAmount;
            rocket.vy -= (rocket.vy / speed) * brakeAmount;
        }
        
        // Apply rotation
        rocket.angle += rotationForce * dt;
        
        // Apply guidance computer stabilization (reduce drift towards vertical)
        const guidanceComp = rocket.components.find(c => c.id === 'guidance' && !c.separated);
        if (guidanceComp && rotationForce === 0) {
            const stabilizationStrength = guidanceComp.stats.stabilization || 0.1;
            // Gradually return angle towards 90 degrees (upward)
            const targetAngle = 90; // Changed from -90 since angles work differently
            const angleDiff = targetAngle - rocket.angle;
            rocket.angle += angleDiff * stabilizationStrength * dt * 2;
        }
        
        // Update position
        rocket.x += rocket.vx * dt;
        rocket.y += rocket.vy * dt;
    }
    
    createFlameParticles(engine) {
        const angleRad = this.rocket.angle * Math.PI / 180;
        const flameAngle = angleRad + Math.PI; // Opposite to thrust direction
        
        for (let i = 0; i < 3; i++) {
            const spread = (Math.random() - 0.5) * 0.5;
            const speed = 100 + Math.random() * 100;
            
            this.particles.push({
                x: this.rocket.x - Math.cos(angleRad) * 30,
                y: this.rocket.y - Math.sin(angleRad) * 30,
                vx: Math.cos(flameAngle + spread) * speed + this.rocket.vx * 0.3,
                vy: Math.sin(flameAngle + spread) * speed + this.rocket.vy * 0.3,
                life: 0.5 + Math.random() * 0.3,
                maxLife: 0.8,
                size: 5 + Math.random() * 10,
                color: Math.random() > 0.5 ? '#ff6b35' : '#ffd700'
            });
        }
    }
    
    updateParticles(dt) {
        this.particles = this.particles.filter(p => {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            
            // Different behavior for different particle types
            if (p.smoke) {
                // Smoke rises and slows down
                p.vy -= 30 * dt;
                p.vx *= 0.98;
                p.vy *= 0.98;
            } else if (p.debris) {
                // Debris affected by gravity and rotates
                p.vy += this.GRAVITY * dt * 0.5;
                if (p.rotationSpeed) {
                    p.rotation += p.rotationSpeed * dt;
                }
            } else if (p.fireball) {
                // Fireballs rise slightly and shrink
                p.vy -= 20 * dt;
                p.size *= 0.97;
            } else if (p.spark) {
                // Sparks affected by gravity
                p.vy += this.GRAVITY * dt * 0.3;
            } else {
                p.size *= 0.95;
            }
            
            return p.life > 0 && p.size > 0.5;
        });
        
        // Fade trail
        this.trail.forEach(t => {
            t.alpha *= 0.995;
        });
        this.trail = this.trail.filter(t => t.alpha > 0.01);
    }
    
    updateCamera() {
        // Follow rocket with smooth camera
        this.camera.targetY = Math.min(0, -(this.rocket.y - this.canvas.height * 0.6));
        this.camera.y += (this.camera.targetY - this.camera.y) * this.camera.smoothing;
    }
    
    checkCollisions() {
        const rocket = this.rocket;
        
        // Calculate rocket bottom position (rocket.y is the drawing origin at bottom)
        const rocketHeight = rocket.components.filter(c => !c.separated).reduce((h, c) => h + (c.size?.height || 30) + 2, 0);
        const rocketBottom = rocket.y + rocketHeight;
        
        // Ground collision - only when falling down and after grace period
        if (rocketBottom >= this.groundY && this.time > 0.5 && rocket.vy > 0) {
            rocket.y = this.groundY - rocketHeight;
            
            const speed = Math.sqrt(rocket.vx * rocket.vx + rocket.vy * rocket.vy);
            
            if (speed > rocket.maxLandingSpeed || !rocket.hasLandingGear) {
                rocket.crashed = true;
                this.createExplosion();
                this.finishSimulation();
            } else {
                rocket.landed = true;
                rocket.vx = 0;
                rocket.vy = 0;
                
                // Check if this is a landing objective
                if (this.level.objectiveType === 'landing' && this.level.target.y <= 100) {
                    this.finishSimulation();
                }
            }
        }
        
        // Landing platform collision (for elevated platforms)
        if (this.level.objectiveType === 'landing') {
            const target = this.level.target;
            const platformY = this.groundY - target.y;
            const platformX = this.launchX + target.x;
            
            // Check if bottom of rocket hits platform
            if (rocketBottom >= platformY && rocketBottom <= platformY + 30 &&
                rocket.x >= platformX - target.width/2 && rocket.x <= platformX + target.width/2) {
                
                const speed = Math.sqrt(rocket.vx * rocket.vx + rocket.vy * rocket.vy);
                
                if (rocket.vy > 0) { // Falling onto platform
                    rocket.y = platformY - rocketHeight;
                    
                    if (speed > rocket.maxLandingSpeed || !rocket.hasLandingGear) {
                        rocket.crashed = true;
                        this.createExplosion();
                    } else {
                        rocket.landed = true;
                        rocket.vx = 0;
                        rocket.vy = 0;
                    }
                    this.finishSimulation();
                }
            }
        }
        
        // Out of bounds
        if (rocket.x < -500 || rocket.x > this.canvas.width + 500) {
            this.finishSimulation();
        }
    }
    
    checkObjective() {
        const rocket = this.rocket;
        const target = this.level.target;
        
        switch (this.level.objectiveType) {
            case 'hoop':
                // Check if rocket passes through hoop (use center of rocket)
                const rocketCenter = rocket.components.filter(c => !c.separated).reduce((h, c) => h + (c.size?.height || 30) + 2, 0) / 2;
                const hoopX = this.launchX + target.x;
                const hoopY = this.groundY - target.y;
                const dist = Math.sqrt(
                    Math.pow(rocket.x - hoopX, 2) + 
                    Math.pow((rocket.y + rocketCenter) - hoopY, 2)
                );
                
                if (dist <= target.radius) {
                    // Passed through!
                    this.finishSimulation();
                }
                break;
                
            case 'orbit':
                const altitude = this.groundY - rocket.y;
                const verticalSpeed = Math.abs(rocket.vy);
                
                if (altitude >= target.y - target.tolerance && 
                    altitude <= target.y + target.tolerance &&
                    verticalSpeed <= target.maxVerticalSpeed) {
                    this.orbitTime += 1/60; // Assuming 60fps
                    
                    if (this.orbitTime >= target.minTime) {
                        this.finishSimulation();
                    }
                } else {
                    this.orbitTime = Math.max(0, this.orbitTime - 0.5/60);
                }
                break;
        }
    }
    
    createExplosion() {
        const rocketHeight = this.rocket.components.filter(c => !c.separated).reduce((h, c) => h + (c.size?.height || 30) + 2, 0);
        const x = this.rocket.x;
        const y = this.rocket.y + rocketHeight / 2;  // Center of rocket
        
        // Main fireball
        for (let i = 0; i < 80; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 30 + Math.random() * 200;
            
            this.particles.push({
                x: x + (Math.random() - 0.5) * 40,
                y: y + (Math.random() - 0.5) * 40,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - Math.random() * 50,
                life: 1.2 + Math.random() * 0.8,
                maxLife: 2,
                size: 15 + Math.random() * 30,
                color: ['#ff4757', '#ff6b35', '#ffd700', '#ff8c00'][Math.floor(Math.random() * 4)],
                fireball: true
            });
        }
        
        // Smoke cloud
        for (let i = 0; i < 40; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 20 + Math.random() * 80;
            
            this.particles.push({
                x: x + (Math.random() - 0.5) * 60,
                y: y + (Math.random() - 0.5) * 60,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 30 - Math.random() * 40,
                life: 2 + Math.random() * 1,
                maxLife: 3,
                size: 30 + Math.random() * 50,
                color: ['#333333', '#444444', '#555555', '#666666'][Math.floor(Math.random() * 4)],
                smoke: true
            });
        }
        
        // Sparks and debris
        for (let i = 0; i < 60; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 100 + Math.random() * 250;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - Math.random() * 100,
                life: 0.5 + Math.random() * 0.5,
                maxLife: 1,
                size: 3 + Math.random() * 6,
                color: ['#ffff00', '#ffffff', '#ff6b35'][Math.floor(Math.random() * 3)],
                spark: true
            });
        }
        
        // Metal debris chunks
        for (let i = 0; i < 25; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 50 + Math.random() * 150;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 50,
                life: 1.5 + Math.random() * 1,
                maxLife: 2.5,
                size: 8 + Math.random() * 15,
                color: ['#555555', '#777777', '#999999'][Math.floor(Math.random() * 3)],
                debris: true,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 500
            });
        }
        
        // Ground scorch ring
        for (let i = 0; i < 30; i++) {
            const angle = (i / 30) * Math.PI * 2;
            const speed = 80 + Math.random() * 60;
            
            this.particles.push({
                x: x,
                y: this.groundY - 10,
                vx: Math.cos(angle) * speed,
                vy: -20 - Math.random() * 30,
                life: 0.8 + Math.random() * 0.4,
                maxLife: 1.2,
                size: 10 + Math.random() * 15,
                color: '#ff4500',
                groundRing: true
            });
        }
    }
    
    createDebrisExplosion(x, y, componentCount) {
        const intensity = Math.min(componentCount, 3);
        
        // Small fireball
        for (let i = 0; i < 20 * intensity; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 20 + Math.random() * 100;
            
            this.particles.push({
                x: x + (Math.random() - 0.5) * 20,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - Math.random() * 40,
                life: 0.6 + Math.random() * 0.4,
                maxLife: 1,
                size: 8 + Math.random() * 15,
                color: ['#ff4757', '#ff6b35', '#ffd700'][Math.floor(Math.random() * 3)],
                fireball: true
            });
        }
        
        // Smoke puff
        for (let i = 0; i < 15 * intensity; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 15 + Math.random() * 40;
            
            this.particles.push({
                x: x + (Math.random() - 0.5) * 30,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: -20 - Math.random() * 30,
                life: 1.2 + Math.random() * 0.6,
                maxLife: 1.8,
                size: 15 + Math.random() * 25,
                color: ['#444444', '#555555', '#666666'][Math.floor(Math.random() * 3)],
                smoke: true
            });
        }
        
        // Sparks
        for (let i = 0; i < 15 * intensity; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 120;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - Math.random() * 50,
                life: 0.3 + Math.random() * 0.3,
                maxLife: 0.6,
                size: 2 + Math.random() * 4,
                color: '#ffff00',
                spark: true
            });
        }
    }
    
    finishSimulation() {
        this.finished = true;
        // Don't stop running immediately - let particles animate
        
        // Calculate results
        const results = this.calculateResults();
        
        // Continue animation for explosion, then callback after delay
        const explosionDuration = this.rocket.crashed ? 3000 : 500;
        
        // Keep updating particles for explosion animation
        setTimeout(() => {
            this.running = false;
            if (this.onFinish) {
                this.onFinish(results);
            }
        }, explosionDuration);
    }
    
    calculateResults() {
        const rocket = this.rocket;
        const target = this.level.target;
        let distance = Infinity;
        let landingSpeed = null;
        
        switch (this.level.objectiveType) {
            case 'hoop':
                const hoopX = this.launchX + target.x;
                const hoopY = this.groundY - target.y;
                distance = Math.sqrt(
                    Math.pow(rocket.x - hoopX, 2) + 
                    Math.pow(rocket.y - hoopY, 2)
                );
                break;
                
            case 'landing':
                const platformX = this.launchX + target.x;
                const platformY = this.groundY - target.y;
                distance = Math.sqrt(
                    Math.pow(rocket.x - platformX, 2) + 
                    Math.pow(rocket.y - platformY, 2)
                );
                landingSpeed = Math.sqrt(rocket.vx * rocket.vx + rocket.vy * rocket.vy);
                
                if (rocket.crashed) {
                    distance = Infinity;
                }
                break;
                
            case 'orbit':
                const altitude = this.groundY - rocket.y;
                distance = Math.abs(altitude - target.y);
                
                if (this.orbitTime < target.minTime) {
                    distance += (target.minTime - this.orbitTime) * 50;
                }
                break;
        }
        
        // Check if level requires minimum altitude first
        if (target.requireMinAltitude && this.maxAltitudeReached < target.requireMinAltitude) {
            distance = Infinity;
        }
        
        const score = calculateScore(this.level, distance, landingSpeed);
        const credits = calculateCreditsEarned(this.level, score);
        const passed = isLevelPassed(score);
        
        return {
            distance: Math.round(distance),
            score,
            credits,
            passed,
            crashed: rocket.crashed,
            landed: rocket.landed,
            maxAltitude: Math.round(this.maxAltitudeReached),
            finalTime: this.time.toFixed(1)
        };
    }
    
    // Rendering
    render() {
        const ctx = this.ctx;
        
        // Clear canvas
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Save state and apply camera transform
        ctx.save();
        ctx.translate(0, this.camera.y);
        
        // Draw background gradient (sky layers)
        this.drawSky();
        
        // Draw trail
        this.drawTrail();
        
        // Draw target
        this.drawTarget();
        
        // Draw ground
        this.drawGround();
        
        // Draw separated stages (debris)
        this.drawSeparatedStages();
        
        // Draw particles
        this.drawParticles();
        
        // Draw rocket
        if (this.rocket && !this.rocket.crashed) {
            this.drawRocket();
        }
        
        ctx.restore();
    }
    
    drawSeparatedStages() {
        const ctx = this.ctx;
        
        this.separatedStages.forEach(stage => {
            ctx.save();
            ctx.translate(stage.x, stage.y);
            ctx.rotate((stage.angle + 90) * Math.PI / 180);
            ctx.globalAlpha = 0.6; // Make debris slightly transparent
            
            let yOffset = 0;
            stage.components.forEach(comp => {
                const height = comp.size?.height || 30;
                const width = comp.size?.width || 40;
                
                ctx.save();
                ctx.translate(0, -yOffset - height / 2);
                this.drawComponentShape(ctx, comp, width, height);
                ctx.restore();
                
                yOffset += height + 2;
            });
            
            ctx.globalAlpha = 1;
            ctx.restore();
        });
    }
    
    drawSky() {
        const ctx = this.ctx;
        
        // Draw altitude markers
        for (let alt = 200; alt <= 2000; alt += 200) {
            const y = this.groundY - alt;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.setLineDash([10, 10]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvas.width, y);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Altitude label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.font = '12px Orbitron';
            ctx.fillText(`${alt}m`, 10, y - 5);
        }
    }
    
    drawTrail() {
        const ctx = this.ctx;
        
        this.trail.forEach((point, i) => {
            ctx.fillStyle = `rgba(0, 212, 255, ${point.alpha * 0.5})`;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    drawTarget() {
        const ctx = this.ctx;
        const target = this.level.target;
        
        switch (this.level.objectiveType) {
            case 'hoop':
                const hoopX = this.launchX + target.x;
                const hoopY = this.groundY - target.y;
                
                // Glowing hoop
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 20;
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 6;
                ctx.beginPath();
                ctx.arc(hoopX, hoopY, target.radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
                
                // Inner ring
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(hoopX, hoopY, target.radius - 10, 0, Math.PI * 2);
                ctx.stroke();
                break;
                
            case 'landing':
                const platX = this.launchX + target.x;
                const platY = this.groundY - target.y;
                
                // Platform
                ctx.fillStyle = '#3a8a5a';
                ctx.shadowColor = '#2ed573';
                ctx.shadowBlur = 15;
                
                // Main platform
                ctx.beginPath();
                ctx.roundRect(
                    platX - target.width/2, 
                    platY - 10, 
                    target.width, 
                    target.height,
                    5
                );
                ctx.fill();
                ctx.shadowBlur = 0;
                
                // Landing markers
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(platX - 20, platY - 5);
                ctx.lineTo(platX - 10, platY + 10);
                ctx.lineTo(platX, platY - 5);
                ctx.lineTo(platX + 10, platY + 10);
                ctx.lineTo(platX + 20, platY - 5);
                ctx.stroke();
                
                // Support pillars
                ctx.fillStyle = '#2a6a4a';
                ctx.fillRect(platX - target.width/2 + 10, platY + target.height - 10, 15, 50);
                ctx.fillRect(platX + target.width/2 - 25, platY + target.height - 10, 15, 50);
                break;
                
            case 'orbit':
                const orbitY = this.groundY - target.y;
                
                // Orbit zone
                ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
                ctx.lineWidth = 2;
                ctx.setLineDash([15, 10]);
                
                // Upper bound
                ctx.beginPath();
                ctx.moveTo(0, orbitY - target.tolerance);
                ctx.lineTo(this.canvas.width, orbitY - target.tolerance);
                ctx.stroke();
                
                // Lower bound
                ctx.beginPath();
                ctx.moveTo(0, orbitY + target.tolerance);
                ctx.lineTo(this.canvas.width, orbitY + target.tolerance);
                ctx.stroke();
                
                ctx.setLineDash([]);
                
                // Center line
                ctx.strokeStyle = 'rgba(0, 212, 255, 0.8)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(0, orbitY);
                ctx.lineTo(this.canvas.width, orbitY);
                ctx.stroke();
                
                // Label
                ctx.fillStyle = '#00d4ff';
                ctx.font = '14px Orbitron';
                ctx.fillText('ORBITAL ZONE', 20, orbitY - target.tolerance - 10);
                
                // Progress indicator
                if (this.orbitTime > 0) {
                    ctx.fillStyle = '#2ed573';
                    ctx.font = '16px Orbitron';
                    ctx.fillText(`ORBIT TIME: ${this.orbitTime.toFixed(1)}s / ${target.minTime}s`, 
                        this.canvas.width/2 - 100, orbitY - target.tolerance - 10);
                }
                break;
        }
    }
    
    drawGround() {
        const ctx = this.ctx;
        
        // Ground gradient
        const gradient = ctx.createLinearGradient(0, this.groundY, 0, this.groundY + 100);
        gradient.addColorStop(0, '#2a4a3a');
        gradient.addColorStop(1, '#1a2a2a');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, this.groundY, this.canvas.width, 100);
        
        // Launch pad
        ctx.fillStyle = '#444';
        ctx.fillRect(this.launchX - 60, this.groundY, 120, 15);
        
        // Pad markings
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.launchX - 30, this.groundY + 7);
        ctx.lineTo(this.launchX + 30, this.groundY + 7);
        ctx.stroke();
    }
    
    drawParticles() {
        const ctx = this.ctx;
        
        // Sort particles so smoke renders behind fire
        const sortedParticles = [...this.particles].sort((a, b) => {
            if (a.smoke && !b.smoke) return -1;
            if (!a.smoke && b.smoke) return 1;
            return 0;
        });
        
        sortedParticles.forEach(p => {
            const alpha = p.life / p.maxLife;
            ctx.globalAlpha = alpha;
            
            if (p.smoke) {
                // Smoke particles - grow over time and fade
                const growFactor = 1 + (1 - alpha) * 2;
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * growFactor);
                gradient.addColorStop(0, p.color);
                gradient.addColorStop(0.5, p.color);
                gradient.addColorStop(1, 'transparent');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * growFactor, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.fireball) {
                // Fireball particles - glowing with core
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
                gradient.addColorStop(0, '#ffffff');
                gradient.addColorStop(0.2, '#ffff00');
                gradient.addColorStop(0.5, p.color);
                gradient.addColorStop(1, 'transparent');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
                ctx.fill();
            } else if (p.spark) {
                // Spark particles - bright streaks
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            } else if (p.debris) {
                // Debris chunks - rotating rectangles
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation * Math.PI / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size/2, -p.size/3, p.size, p.size * 0.6);
                ctx.restore();
            } else if (p.groundRing) {
                // Ground ring particles
                ctx.fillStyle = p.color;
                ctx.globalAlpha = alpha * 0.7;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Default circular particles
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        });
        
        ctx.globalAlpha = 1;
    }
    
    drawRocket() {
        const ctx = this.ctx;
        const rocket = this.rocket;
        
        ctx.save();
        ctx.translate(rocket.x, rocket.y);
        ctx.rotate((rocket.angle + 90) * Math.PI / 180);
        
        // Draw components from bottom to top (skip separated ones)
        let yOffset = 0;
        
        rocket.components.forEach((comp, i) => {
            // Skip separated components - they're drawn as debris
            if (comp.separated) return;
            
            const height = comp.size?.height || 30;
            const width = comp.size?.width || 40;
            
            ctx.save();
            ctx.translate(0, -yOffset - height/2);
            
            // Component glow when active
            if (comp.active) {
                ctx.shadowColor = '#ff6b35';
                ctx.shadowBlur = 20;
            }
            
            // Draw component shape
            this.drawComponentShape(ctx, comp, width, height);
            
            // Draw flame if engine is active
            if (comp.active && comp.category === 'engines') {
                this.drawFlame(ctx, width, height);
            }
            
            ctx.restore();
            
            yOffset += height + 2;
        });
        
        ctx.restore();
    }
    
    drawComponentShape(ctx, comp, width, height) {
        switch (comp.shape) {
            case 'engine-basic':
                ctx.fillStyle = '#777';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, [5, 5, 10, 10]);
                ctx.fill();
                
                // Nozzle
                ctx.fillStyle = '#333';
                ctx.beginPath();
                ctx.roundRect(-width/4, height/2 - 10, width/2, 15, [0, 0, 10, 10]);
                ctx.fill();
                break;
            
            case 'engine-booster':
                ctx.fillStyle = '#cc5500';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, [4, 4, 8, 8]);
                ctx.fill();
                
                ctx.fillStyle = '#222';
                ctx.beginPath();
                ctx.roundRect(-width/4, height/2 - 8, width/2, 12, [0, 0, 8, 8]);
                ctx.fill();
                break;
                
            case 'engine-turbo':
                ctx.fillStyle = '#cc5522';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, [8, 8, 15, 15]);
                ctx.fill();
                
                ctx.fillStyle = '#333';
                ctx.beginPath();
                ctx.roundRect(-width/3, height/2 - 12, width*2/3, 18, [0, 0, 12, 12]);
                ctx.fill();
                break;
                
            case 'engine-ion':
                ctx.fillStyle = '#0099bb';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, [10, 10, 15, 15]);
                ctx.fill();
                
                // Glow ring
                ctx.strokeStyle = '#00d4ff';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, height/4, width/3, 0, Math.PI * 2);
                ctx.stroke();
                break;
                
            case 'engine-nuclear':
                ctx.fillStyle = '#11aa55';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, [10, 10, 20, 20]);
                ctx.fill();
                
                // Radiation symbol
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(0, 0, width/6, 0, Math.PI * 2);
                ctx.fill();
                break;
                
            case 'rotation-basic':
                ctx.fillStyle = '#666';
                ctx.fillRect(-width/2, -height/2, width, height);
                
                // Side thrusters
                ctx.fillStyle = '#555';
                ctx.fillRect(-width/2 - 8, -height/2 - 2, 10, height + 4);
                ctx.fillRect(width/2 - 2, -height/2 - 2, 10, height + 4);
                break;
                
            case 'rotation-gyro':
                ctx.fillStyle = '#7744cc';
                ctx.beginPath();
                ctx.ellipse(0, 0, width/2, height/2, 0, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.strokeStyle = '#aa77ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.ellipse(0, 0, width/3, height/3, 0, 0, Math.PI * 2);
                ctx.stroke();
                break;
                
            case 'brake-basic':
                ctx.fillStyle = '#cc3344';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, 5);
                ctx.fill();
                break;
                
            case 'brake-retro':
                ctx.fillStyle = '#cc6600';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, 5);
                ctx.fill();
                
                // Side nozzles
                ctx.fillStyle = '#aa5500';
                ctx.beginPath();
                ctx.moveTo(-width/2, -height/4);
                ctx.lineTo(-width/2 - 8, 0);
                ctx.lineTo(-width/2, height/4);
                ctx.fill();
                
                ctx.beginPath();
                ctx.moveTo(width/2, -height/4);
                ctx.lineTo(width/2 + 8, 0);
                ctx.lineTo(width/2, height/4);
                ctx.fill();
                break;
                
            case 'brake-aero':
                ctx.fillStyle = '#994400';
                ctx.beginPath();
                ctx.ellipse(0, 0, width/2, height/2, 0, 0, Math.PI * 2);
                ctx.fill();
                
                // Center glow
                ctx.fillStyle = '#ff6600';
                ctx.beginPath();
                ctx.arc(0, 0, width/5, 0, Math.PI * 2);
                ctx.fill();
                break;
                
            case 'landing-basic':
                ctx.fillStyle = '#666';
                ctx.fillRect(-width/2, -height/2, width, height);
                
                // Legs
                ctx.strokeStyle = '#555';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(-width/3, height/2);
                ctx.lineTo(-width/2 - 5, height/2 + 15);
                ctx.moveTo(width/3, height/2);
                ctx.lineTo(width/2 + 5, height/2 + 15);
                ctx.stroke();
                break;
                
            case 'landing-airbag':
                ctx.fillStyle = '#ccaa00';
                ctx.beginPath();
                ctx.ellipse(0, 0, width/2, height/2, 0, 0, Math.PI * 2);
                ctx.fill();
                break;
                
            case 'landing-hover':
                ctx.fillStyle = '#4488bb';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, 6);
                ctx.fill();
                
                // Hover jets
                ctx.fillStyle = '#00aaff';
                ctx.beginPath();
                ctx.arc(-width/3, height/2 + 4, 5, 0, Math.PI * 2);
                ctx.arc(width/3, height/2 + 4, 5, 0, Math.PI * 2);
                ctx.fill();
                break;
                
            case 'nose-cone':
                ctx.fillStyle = '#ddd';
                ctx.beginPath();
                ctx.moveTo(0, -height/2);
                ctx.lineTo(width/2, height/2);
                ctx.lineTo(-width/2, height/2);
                ctx.closePath();
                ctx.fill();
                break;
            
            case 'crew-capsule':
                // Main body
                ctx.fillStyle = '#6080a0';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, [18, 18, 5, 5]);
                ctx.fill();
                
                // Window
                ctx.fillStyle = '#003366';
                ctx.beginPath();
                ctx.ellipse(0, -height/6, width/4, height/6, 0, 0, Math.PI * 2);
                ctx.fill();
                
                // Window glow
                ctx.strokeStyle = '#66aaff';
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
                
            case 'fuel-tank':
            case 'fuel-tank-large':
                ctx.fillStyle = '#777';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, 8);
                ctx.fill();
                
                // Highlight
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.fillRect(-width/2 + 5, -height/2 + 5, 6, height - 10);
                break;
                
            case 'parachute':
                ctx.fillStyle = '#ff4466';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, [8, 8, 4, 4]);
                ctx.fill();
                break;
                
            case 'decoupler':
                ctx.fillStyle = '#444';
                ctx.fillRect(-width/2, -height/2, width, height);
                
                // Separation charge indicator
                ctx.fillStyle = '#ff8800';
                ctx.fillRect(-width/3, -height/4, width*2/3, height/2);
                break;
                
            case 'guidance':
                ctx.fillStyle = '#334455';
                ctx.beginPath();
                ctx.roundRect(-width/2, -height/2, width, height, 4);
                ctx.fill();
                
                // Screen
                ctx.fillStyle = '#001122';
                ctx.fillRect(-width/3, -height/3, width*2/3, height/2);
                ctx.strokeStyle = '#00d4ff';
                ctx.lineWidth = 1;
                ctx.strokeRect(-width/3, -height/3, width*2/3, height/2);
                break;
                
            default:
                ctx.fillStyle = '#666';
                ctx.fillRect(-width/2, -height/2, width, height);
        }
        
        ctx.shadowBlur = 0;
    }
    
    drawFlame(ctx, width, height) {
        const flameHeight = 30 + Math.random() * 20;
        
        // Outer flame
        ctx.fillStyle = '#ff6b35';
        ctx.beginPath();
        ctx.moveTo(-width/4, height/2);
        ctx.quadraticCurveTo(-width/6, height/2 + flameHeight/2, 0, height/2 + flameHeight);
        ctx.quadraticCurveTo(width/6, height/2 + flameHeight/2, width/4, height/2);
        ctx.closePath();
        ctx.fill();
        
        // Inner flame
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.moveTo(-width/6, height/2);
        ctx.quadraticCurveTo(-width/10, height/2 + flameHeight/3, 0, height/2 + flameHeight * 0.6);
        ctx.quadraticCurveTo(width/10, height/2 + flameHeight/3, width/6, height/2);
        ctx.closePath();
        ctx.fill();
    }
    
    // Get current flight data for UI
    getFlightData() {
        if (!this.rocket) return null;
        
        const altitude = Math.max(0, Math.round(this.groundY - this.rocket.y));
        const speed = Math.sqrt(this.rocket.vx * this.rocket.vx + this.rocket.vy * this.rocket.vy);
        
        let distanceToTarget = '---';
        if (this.level) {
            const target = this.level.target;
            switch (this.level.objectiveType) {
                case 'hoop':
                    const hoopX = this.launchX + target.x;
                    const hoopY = this.groundY - target.y;
                    distanceToTarget = Math.round(Math.sqrt(
                        Math.pow(this.rocket.x - hoopX, 2) + 
                        Math.pow(this.rocket.y - hoopY, 2)
                    )) + 'm';
                    break;
                case 'landing':
                    const platX = this.launchX + target.x;
                    const platY = this.groundY - target.y;
                    distanceToTarget = Math.round(Math.sqrt(
                        Math.pow(this.rocket.x - platX, 2) + 
                        Math.pow(this.rocket.y - platY, 2)
                    )) + 'm';
                    break;
                case 'orbit':
                    distanceToTarget = Math.round(Math.abs(altitude - target.y)) + 'm';
                    break;
            }
        }
        
        return {
            altitude: altitude + 'm',
            velocity: Math.round(speed) + ' m/s',
            time: this.time.toFixed(1) + 's',
            distanceToTarget
        };
    }
}
