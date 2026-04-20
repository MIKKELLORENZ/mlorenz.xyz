class Particle {
    constructor(x, y, vx = 0, vy = 0, mass = 1, color = 'white') {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = mass;
        this.color = color;
        this.radius = 2;
        this.fx = 0;
        this.fy = 0;
    }

    applyForce(fx, fy) {
        this.fx += fx;
        this.fy += fy;
    }

    update(dt, params) {
        // Apply accumulated forces
        const ax = this.fx / this.mass;
        const ay = this.fy / this.mass;

        this.vx += ax * dt;
        this.vy += ay * dt;

        // No max speed limit

        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // Reset forces for next step
        this.fx = 0;
        this.fy = 0;

        // Basic boundary wrapping (toroidal universe)
        // Ensure particles stay within bounds after position update, before next step's collision check
        if (this.x < 0) this.x += params.width;
        if (this.x > params.width) this.x -= params.width;
        if (this.y < 0) this.y += params.height;
        if (this.y > params.height) this.y -= params.height;
    }
}

class Simulation {
    constructor(params) {
        this.params = params;
        this.particles = [];
        this.age = 0;
        this.isRunning = false;
        this.tempGravityMod = 1.0;
        this.params.width = params.width || 1000; // Default width
        this.params.height = params.height || 750; // Default height
        this.params.mode = params.mode || 'random'; // Add mode parameter
        this.initParticles();
    }

    simplePRNG(seed) {
        // Accepts number seed
        let h = 1779033703 ^ seed;
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return function() {
            h = Math.imul(h ^ h >>> 16, 2246822507);
            h = Math.imul(h ^ h >>> 13, 3266489909);
            return (h ^= h >>> 16) >>> 0;
        }
    }

    initParticles() {
        this.particles = [];
        const random = this.simplePRNG(this.params.seed);
        const mode = this.params.mode;
        // Use the numParticles passed during recreate, which might be 3 or user-defined
        const numParticles = this.params.numParticles;
        const width = this.params.width;
        const height = this.params.height;
        const centerX = width / 2;
        const centerY = height / 2;

        console.log(`Initializing mode: ${mode} with ${numParticles} particles`);

        switch (mode) {
            case 'symmetric_clusters':
                const numClusters = 4;
                const particlesPerCluster = Math.floor(numParticles / numClusters);
                const clusterSpread = 50;
                const clusterDist = Math.min(width, height) * 0.3;
                const positions = [
                    { x: centerX - clusterDist, y: centerY - clusterDist },
                    { x: centerX + clusterDist, y: centerY - clusterDist },
                    { x: centerX - clusterDist, y: centerY + clusterDist },
                    { x: centerX + clusterDist, y: centerY + clusterDist },
                ];
                for (let c = 0; c < numClusters; c++) {
                    for (let i = 0; i < particlesPerCluster; i++) {
                        const x = positions[c].x + (random() / 0xFFFFFFFF - 0.5) * clusterSpread;
                        const y = positions[c].y + (random() / 0xFFFFFFFF - 0.5) * clusterSpread;
                        const vx = (random() / 0xFFFFFFFF - 0.5) * 0.1;
                        const vy = (random() / 0xFFFFFFFF - 0.5) * 0.1;
                        this.particles.push(new Particle(x, y, vx, vy, 1));
                    }
                }
                break;

            case 'spiral_galaxy':
                const numArms = 3;
                const armSpread = 0.5;
                const rotationFactor = 0.3; // Adjusted rotation influence (empirical)
                const bulgeRadius = 50;

                for (let i = 0; i < numParticles; i++) {
                    const angleOffset = (i % numArms) * (2 * Math.PI / numArms);
                    const distFromCenter = bulgeRadius + (random() / 0xFFFFFFFF) * (Math.min(width, height) * 0.4);
                    const angle = angleOffset + Math.log(distFromCenter / bulgeRadius) / armSpread + (random() / 0xFFFFFFFF - 0.5) * 0.5;

                    const x = centerX + distFromCenter * Math.cos(angle);
                    const y = centerY + distFromCenter * Math.sin(angle);

                    // Simplified tangential velocity - proportional to distance, scaled down
                    const speed = distFromCenter * rotationFactor * 0.01 * (1 + (random() / 0xFFFFFFFF - 0.5) * 0.4); // Added more randomness, reduced base speed
                    const vx = -speed * Math.sin(angle);
                    const vy = speed * Math.cos(angle);

                    this.particles.push(new Particle(x, y, vx, vy, 1));
                }
                break;

            case 'square_cluster':
                const squareSize = Math.min(width, height) * 0.4;
                const startX = centerX - squareSize / 2;
                const startY = centerY - squareSize / 2;
                for (let i = 0; i < numParticles; i++) {
                    const x = startX + (random() / 0xFFFFFFFF) * squareSize;
                    const y = startY + (random() / 0xFFFFFFFF) * squareSize;
                    const vx = (random() / 0xFFFFFFFF - 0.5) * 0.05; // Very low initial velocity
                    const vy = (random() / 0xFFFFFFFF - 0.5) * 0.05;
                    this.particles.push(new Particle(x, y, vx, vy, 1));
                }
                break;

            case 'approaching_clusters':
                const particlesPerGalaxy = Math.floor(numParticles / 2);
                const galaxyRadius = Math.min(width, height) * 0.15;
                const galaxyDist = width * 0.3;
                const approachSpeed = 13.5; // Increased from 0.4

                // Function to create a small spiral shape (without internal rotation)
                const createMiniSpiral = (galaxyCenterX, galaxyCenterY, numSpiralParticles, initialVx, initialVy) => {
                    const miniBulgeRadius = galaxyRadius * 0.1;
                    const miniNumArms = 2;
                    const miniArmSpread = 0.6;

                    for (let i = 0; i < numSpiralParticles; i++) {
                        const angleOffset = (i % miniNumArms) * (2 * Math.PI / miniNumArms);
                        const distFromGalaxyCenter = miniBulgeRadius + (random() / 0xFFFFFFFF) * (galaxyRadius - miniBulgeRadius);
                        const angle = angleOffset + Math.log(distFromGalaxyCenter / miniBulgeRadius) / miniArmSpread + (random() / 0xFFFFFFFF - 0.5) * 0.6;

                        const x = galaxyCenterX + distFromGalaxyCenter * Math.cos(angle);
                        const y = galaxyCenterY + distFromGalaxyCenter * Math.sin(angle);

                        // Total velocity = initial approach velocity + reduced random noise
                        const noiseFactor = 0.05; // Reduced from 0.1
                        const vx = initialVx + (random() / 0xFFFFFFFF - 0.5) * noiseFactor;
                        const vy = initialVy + (random() / 0xFFFFFFFF - 0.5) * noiseFactor;

                        this.particles.push(new Particle(x, y, vx, vy, 1));
                    }
                };

                // Galaxy 1 (left, moving right)
                createMiniSpiral(centerX - galaxyDist, centerY, particlesPerGalaxy, approachSpeed, 0);

                // Galaxy 2 (right, moving left)
                createMiniSpiral(centerX + galaxyDist, centerY, particlesPerGalaxy, -approachSpeed, 0);
                break;

            case 'binary_star_system':
                const starMass = 500;
                const starDist = 150;
                // Slightly reduced orbital speed factor
                const orbitalSpeed = Math.sqrt(this.params.gravity * starMass / (2 * starDist)) * 0.7; // Reduced from 0.8

                // Star 1
                this.particles.push(new Particle(centerX - starDist / 2, centerY, 0, orbitalSpeed, starMass));
                // Star 2
                this.particles.push(new Particle(centerX + starDist / 2, centerY, 0, -orbitalSpeed, starMass));

                const numOrbiting = Math.max(0, numParticles - 2);
                const minOrbitDist = starDist * 1.5;
                const maxOrbitDist = Math.min(width, height) * 0.4;
                for (let i = 0; i < numOrbiting; i++) {
                    const dist = minOrbitDist + (random() / 0xFFFFFFFF) * (maxOrbitDist - minOrbitDist);
                    const angle = (random() / 0xFFFFFFFF) * 2 * Math.PI;
                    const x = centerX + dist * Math.cos(angle);
                    const y = centerY + dist * Math.sin(angle);

                    // Adjusted circumbinary speed - less reliance on exact mass, more empirical scaling
                    const speedFactor = 0.6; // Empirical factor
                    const speed = Math.sqrt(this.params.gravity * (2 * starMass) / dist) * speedFactor * (1 + (random() / 0xFFFFFFFF - 0.5) * 0.3);
                    const vx = -speed * Math.sin(angle);
                    const vy = speed * Math.cos(angle);
                    this.particles.push(new Particle(x, y, vx, vy, 1));
                }
                break;

            case 'empty_center_ring':
                const ringInnerRadius = Math.min(width, height) * 0.2;
                const ringOuterRadius = Math.min(width, height) * 0.4;
                const ringRotation = 0.05; // Significantly reduced rotation factor

                for (let i = 0; i < numParticles; i++) {
                    const dist = ringInnerRadius + (random() / 0xFFFFFFFF) * (ringOuterRadius - ringInnerRadius);
                    const angle = (random() / 0xFFFFFFFF) * 2 * Math.PI;
                    const x = centerX + dist * Math.cos(angle);
                    const y = centerY + dist * Math.sin(angle);

                    // Reduced tangential velocity
                    const speed = dist * ringRotation * (random() / 0xFFFFFFFF * 0.5 + 0.75);
                    const vx = -speed * Math.sin(angle) + (random() / 0xFFFFFFFF - 0.5) * 0.05; // Add slight radial noise
                    const vy = speed * Math.cos(angle) + (random() / 0xFFFFFFFF - 0.5) * 0.05; // Add slight radial noise
                    this.particles.push(new Particle(x, y, vx, vy, 1));
                }
                break;

            case 'orthogonal_streams':
                const streamWidth = 50;
                const streamLength = width * 0.8;
                const streamSpeed = 0.4; // Reduced stream speed
                const particlesPerStream = Math.floor(numParticles / 2);

                // Stream 1 (Horizontal, moving right)
                const startY1 = centerY;
                const startX1 = centerX - streamLength / 2;
                for (let i = 0; i < particlesPerStream; i++) {
                    const x = startX1 + (random() / 0xFFFFFFFF) * streamLength;
                    const y = startY1 + (random() / 0xFFFFFFFF - 0.5) * streamWidth;
                    const vx = streamSpeed * (1 + (random() / 0xFFFFFFFF - 0.5) * 0.2); // Added more variation
                    const vy = (random() / 0xFFFFFFFF - 0.5) * 0.1; // Increased perpendicular noise slightly
                    this.particles.push(new Particle(x, y, vx, vy, 1));
                }

                // Stream 2 (Vertical, moving down)
                const startX2 = centerX;
                const startY2 = centerY - streamLength / 2;
                 for (let i = 0; i < particlesPerStream; i++) {
                    const x = startX2 + (random() / 0xFFFFFFFF - 0.5) * streamWidth;
                    const y = startY2 + (random() / 0xFFFFFFFF) * streamLength;
                    const vx = (random() / 0xFFFFFFFF - 0.5) * 0.1; // Increased perpendicular noise slightly
                    const vy = streamSpeed * (1 + (random() / 0xFFFFFFFF - 0.5) * 0.2); // Added more variation
                    this.particles.push(new Particle(x, y, vx, vy, 1));
                }
                break;

            case 'random':
            default: // Default to random
                for (let i = 0; i < numParticles; i++) {
                    const x = (random() / 0xFFFFFFFF) * width;
                    const y = (random() / 0xFFFFFFFF) * height;
                    const vx = ((random() / 0xFFFFFFFF) - 0.5) * 0.1;
                    const vy = ((random() / 0xFFFFFFFF) - 0.5) * 0.1;
                    this.particles.push(new Particle(x, y, vx, vy, 1));
                }
                break;
        }
        this.age = 0;
    }

    applyForces() {
        const G = this.params.gravity * this.tempGravityMod;
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const p1 = this.particles[i];
                const p2 = this.particles[j];

                let dx = p2.x - p1.x;
                let dy = p2.y - p1.y;

                // Toroidal distance check
                if (Math.abs(dx) > this.params.width / 2) {
                    dx = dx > 0 ? dx - this.params.width : dx + this.params.width;
                }
                if (Math.abs(dy) > this.params.height / 2) {
                    dy = dy > 0 ? dy - this.params.height : dy + this.params.height;
                }

                const distSq = dx * dx + dy * dy;
                const dist = Math.sqrt(distSq);

                // Gravity (Attractive) - always squared law, no cutoff
                const softening = 2.0; // Prevent singularity at very close range
                const forceMagGravity = (G * p1.mass * p2.mass) / (distSq + softening * softening);
                const fgx = forceMagGravity * (dx / (dist + 1e-8));
                const fgy = forceMagGravity * (dy / (dist + 1e-8));

                p1.applyForce(fgx, fgy);
                p2.applyForce(-fgx, -fgy);
            }
        }
    }

    handleCollisions() {
        const restitution = 0.8; // Coefficient of restitution (0 = perfectly inelastic, 1 = perfectly elastic)

        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const p1 = this.particles[i];
                const p2 = this.particles[j];

                let dx = p2.x - p1.x;
                let dy = p2.y - p1.y;

                // Toroidal distance check for collisions too
                if (Math.abs(dx) > this.params.width / 2) {
                    dx = dx > 0 ? dx - this.params.width : dx + this.params.width;
                }
                if (Math.abs(dy) > this.params.height / 2) {
                    dy = dy > 0 ? dy - this.params.height : dy + this.params.height;
                }

                const distSq = dx * dx + dy * dy;
                const minDist = p1.radius + p2.radius;

                if (distSq < minDist * minDist && distSq > 0.001) { // Check for overlap (and avoid exact overlap issues)
                    const dist = Math.sqrt(distSq);
                    const overlap = minDist - dist;

                    // Collision normal vector (normalized dx, dy)
                    const nx = dx / dist;
                    const ny = dy / dist;

                    // Separate particles slightly to avoid sticking
                    const separationFactor = 0.5; // How much each particle moves
                    p1.x -= nx * overlap * separationFactor;
                    p1.y -= ny * overlap * separationFactor;
                    p2.x += nx * overlap * separationFactor;
                    p2.y += ny * overlap * separationFactor;

                    // Relative velocity
                    const dvx = p2.vx - p1.vx;
                    const dvy = p2.vy - p1.vy;

                    // Velocity component along the normal
                    const vn = dvx * nx + dvy * ny;

                    // If velocities are separating, do nothing (already moving apart)
                    if (vn >= 0) continue;

                    // Calculate impulse scalar (simplified for equal mass)
                    // For unequal mass: const impulse = -(1 + restitution) * vn / (1/p1.mass + 1/p2.mass);
                    const impulse = -(1 + restitution) * vn / 2; // Assuming mass = 1 for both

                    // Apply impulse
                    p1.vx -= impulse * nx; // / p1.mass; (if mass varies)
                    p1.vy -= impulse * ny; // / p1.mass;
                    p2.vx += impulse * nx; // / p2.mass;
                    p2.vy += impulse * ny; // / p2.mass;
                }
            }
        }
    }

    step(dt) {
        if (!this.isRunning) return;

        const scaledDt = dt * this.params.simSpeed;

        this.applyForces();
        this.handleCollisions(); // Handle collisions after forces, before position update

        this.particles.forEach(p => p.update(scaledDt, this.params));

        this.age++;
    }

    addParticleCluster(x, y, count = 5, spread = 20) {
         const random = Math.random; // Use built-in random for this quick add
         for (let i = 0; i < count; i++) {
            // Ensure added particles are within bounds initially
            const px = Math.max(0, Math.min(this.params.width, x + (random() - 0.5) * spread));
            const py = Math.max(0, Math.min(this.params.height, y + (random() - 0.5) * spread));
            const vx = (random() - 0.5) * 0.5; // Small initial velocity
            const vy = (random() - 0.5) * 0.5;
            const newParticle = new Particle(px, py, vx, vy, 1); // Use default mass/radius
            this.particles.push(newParticle);
            this.grid.add(newParticle); // Add to grid
         }
         // Optional: Update particle count display if needed
         // const numParticlesInput = document.getElementById('numParticles');
         // if (numParticlesInput) numParticlesInput.value = this.particles.length;
         // const numParticlesValue = document.getElementById('numParticlesValue');
         // if (numParticlesValue) numParticlesValue.textContent = this.particles.length;
    }

    setTempGravityMod(mod) {
        this.tempGravityMod = mod;
        console.log(`Temp gravity mod set to: ${mod}`); // Log change
        // Consider removing the automatic reset or making it configurable
        // setTimeout(() => { this.tempGravityMod = 1.0; console.log("Temp gravity mod reset."); }, 5000);
    }

    togglePlayPause() {
        this.isRunning = !this.isRunning;
        return this.isRunning;
    }

    setSpeed(speed) {
        this.params.simSpeed = speed;
    }

    updateParams(newParams) {
        this.params.gravity = newParams.gravity ?? this.params.gravity;
        // Update width/height if canvas resizes and renderer informs simulation
        this.params.width = newParams.width ?? this.params.width;
        this.params.height = newParams.height ?? this.params.height;
    }

    recreate(newParams) {
        const currentSize = { width: this.params.width, height: this.params.height };
        // Include mode in the merge
        this.params = { ...this.params, ...currentSize, ...newParams };
        this.initParticles(); // initParticles now uses this.params.mode
        this.isRunning = false;
        this.tempGravityMod = 1.0;
    }
}
