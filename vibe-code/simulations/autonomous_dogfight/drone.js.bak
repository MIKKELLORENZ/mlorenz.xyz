class Drone {
    constructor(scene, position = { x: 0, y: 1, z: 0 }, color = 0x333333, id = 0) {
        this.scene = scene;
        this.id = id; // Add drone identifier for multi-drone scenarios
        this.color = color; // Different color for each drone
        
        // Drone physical properties
        this.mass = 1.0; // kg
        this.gravity = 9.8; // m/s²
        this.maxThrust = 3.0 * this.mass * this.gravity; // Newtons, 3x weight for maneuverability
        this.drag = 0.1;
        this.angularDrag = 0.2;
        this.rotorDistance = 0.4; // Distance from center to each rotor
        
        // Physics simulation parameters
        this.fixedTimestep = 0.005; // 5ms fixed physics step for stability
        this.subSteps = 0; // Counter for accumulated sub-steps
        this.timeRemainder = 0; // Time remaining from previous frame
        
        // Drone state
        this.position = new THREE.Vector3(position.x, position.y, position.z);
        this.rotation = new THREE.Euler(0, 0, 0, 'XYZ');
        this.quaternion = new THREE.Quaternion();
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.angularVelocity = new THREE.Vector3(0, 0, 0);
        
        // Rotor thrusts (between 0.0 and 1.0)
        // Order: front-left, front-right, back-left, back-right
        this.rotorThrusts = [0, 0, 0, 0];
        this.rotorThrustsTarget = [0, 0, 0, 0]; // Target thrusts for motor dynamics
        
        // Motor dynamics - first order lag
        this.motorTimeConstant = 0.05; // Motor response time (seconds)
        
        // PID Controllers for attitude
        this.rollPID = new PIDController(2.0, 0.1, 0.5);
        this.pitchPID = new PIDController(2.0, 0.1, 0.5);
        this.yawPID = new PIDController(2.0, 0.0, 0.2); // Increased yaw authority
        this.altitudePID = new PIDController(2.0, 0.5, 0.2);
        
        // Control inputs (desired values)
        this.controlInputs = {
            roll: 0,     // -1 to 1 (negative = roll left, positive = roll right)
            pitch: 0,    // -1 to 1 (negative = pitch forward, positive = pitch back)
            yaw: 0,      // -1 to 1 (negative = yaw left, positive = yaw right)
            thrust: 0    // 0 to 1 (0 = no thrust, 1 = max thrust)
        };
        
        // External forces (for wind simulation)
        this.externalForce = new THREE.Vector3(0, 0, 0);
        
        // Create the drone mesh with updated color
        this.createDroneMesh();
        
        // Crash state
        this.crashed = false;
        this.crashTimeout = null;
        
        // Audio for rotors (optional)
        this.createAudio();
        
        // Combat-related properties
        this.hasWeapon = true;
        this.weaponCooldown = 0;
        this.weaponCooldownTime = 1.0; // 1 second between shots
        this.maxDetectionRange = 30;
        this.shotBy = null; // Track which drone shot this one
        this.isShooting = false;
        this.projectiles = []; // Store active projectiles
        this.health = 100; // Drone health
        this.isDestroyed = false; // Different from crashed - specifically for combat
        
        // Target tracking
        this.detectedDrones = []; // Other drones in detection range
        this.nearestDrone = null; // Closest detected drone
        this.nearestDroneDistance = Infinity;
        this.nearestDroneDirection = new THREE.Vector3();
        
        // Weapon setup
        this.createWeapon();
        
        // Calculate moment of inertia tensor based on mass and dimensions
        this.calculateInertia();
    }
    
    // Calculate inertia tensor for more realistic physics
    calculateInertia() {
        // Simplified model: treat drone as a rectangular box with rotors
        const width = this.rotorDistance * 2;  // Distance between opposite rotors
        const height = 0.1;
        const depth = width;
        
        // For a rectangular solid, principal moments of inertia are:
        // Ixx = (1/12) * m * (y² + z²)
        // Iyy = (1/12) * m * (x² + z²)
        // Izz = (1/12) * m * (x² + y²)
        
        // Add effect of rotors as point masses at corners
        const rotorMass = this.mass * 0.15; // Each rotor is ~15% of total mass
        const bodyMass = this.mass - (rotorMass * 4);
        
        // Body contribution - rectangular prism formula
        const Ixx_body = (1/12) * bodyMass * (height*height + depth*depth);
        const Iyy_body = (1/12) * bodyMass * (width*width + depth*depth);
        const Izz_body = (1/12) * bodyMass * (width*width + height*height);
        
        // Rotors contribution - parallel axis theorem
        // Add each rotor's contribution to the inertia
        const rotorDistanceSq = this.rotorDistance * this.rotorDistance;
        
        // Each rotor contributes to all axes
        const rotorContribution = rotorMass * rotorDistanceSq * 2; // 2 rotors per axis
        
        // Total inertia
        const Ixx = Ixx_body + rotorContribution;
        const Iyy = Iyy_body + rotorContribution * 0.5; // Less effect on yaw
        const Izz = Izz_body + rotorContribution;
        
        // Create inertia vector (principal moments of inertia)
        this.inertia = new THREE.Vector3(Ixx, Iyy, Izz);
        
        // Increase yaw authority for better turning
        this.inertia.y *= 0.6;
    }
    
    createDroneMesh() {
        // Create drone body with the specified color
        const bodyGeometry = new THREE.BoxGeometry(0.3, 0.1, 0.3);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: this.color });
        this.body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        this.body.castShadow = true;
        this.body.receiveShadow = true;
        
        // Create drone group to hold all parts
        this.mesh = new THREE.Group();
        this.mesh.add(this.body);
        
        // Create arms
        const armGeometry = new THREE.BoxGeometry(0.9, 0.05, 0.05);
        const armMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
        
        this.armFB = new THREE.Mesh(armGeometry, armMaterial);
        this.armFB.castShadow = true;
        this.mesh.add(this.armFB);
        
        this.armLR = new THREE.Mesh(armGeometry, armMaterial);
        this.armLR.castShadow = true;
        this.armLR.rotation.y = Math.PI / 2;
        this.mesh.add(this.armLR);
        
        // Create rotors
        this.rotors = [];
        const rotorPositions = [
            { x: -this.rotorDistance, y: 0.05, z: -this.rotorDistance }, // Front-left
            { x: this.rotorDistance, y: 0.05, z: -this.rotorDistance },  // Front-right
            { x: -this.rotorDistance, y: 0.05, z: this.rotorDistance },  // Back-left
            { x: this.rotorDistance, y: 0.05, z: this.rotorDistance }    // Back-right
        ];
        
        for (let i = 0; i < 4; i++) {
            const rotorGroup = new THREE.Group();
            
            // Rotor center
            const centerGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16);
            const centerMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
            const center = new THREE.Mesh(centerGeometry, centerMaterial);
            center.castShadow = true;
            rotorGroup.add(center);
            
            // Rotor blades
            const bladeGeometry = new THREE.BoxGeometry(0.2, 0.01, 0.05);
            const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
            const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
            blade.castShadow = true;
            rotorGroup.add(blade);
            
            // Rotor rotation direction indicator (red/blue)
            const color = (i % 2 === 0) ? 0xff0000 : 0x0000ff;
            const indicatorGeometry = new THREE.BoxGeometry(0.05, 0.03, 0.05);
            const indicatorMaterial = new THREE.MeshStandardMaterial({ color: color });
            const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
            indicator.position.y = 0.03;
            indicator.castShadow = true;
            rotorGroup.add(indicator);
            
            // Position the rotor
            rotorGroup.position.set(
                rotorPositions[i].x,
                rotorPositions[i].y,
                rotorPositions[i].z
            );
            
            this.rotors.push({
                mesh: rotorGroup,
                blade: blade,
                speed: 0,
                direction: i % 2 === 0 ? 1 : -1 // Alternate directions
            });
            
            this.mesh.add(rotorGroup);
        }
        
        // Add a directional indicator to show which way the drone is facing
        const noseGeometry = new THREE.ConeGeometry(0.05, 0.2, 8);
        const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        this.nose = new THREE.Mesh(noseGeometry, noseMaterial);
        this.nose.rotation.x = Math.PI / 2; // Point forward
        this.nose.position.set(0, 0, -0.25); // Position at front of drone
        this.mesh.add(this.nose);
        
        // Create vision cone to visualize field of view
        this.createVisionCone();
        
        // Set initial position
        this.mesh.position.copy(this.position);
        this.scene.add(this.mesh);
    }
    
    // Add a vision cone to visualize drone's field of view
    createVisionCone() {
        // Field of view parameters
        const coneLength = 15.0; // Length of the cone
        const coneAngle = Math.PI / 4; // 45-degree cone
        
        // Calculate radius at the end of the cone based on the angle
        const coneEndRadius = Math.tan(coneAngle) * coneLength;
        
        // Create cone geometry
        const coneGeometry = new THREE.ConeGeometry(coneEndRadius, coneLength, 16, 1, true);
        
        // Rotate the cone to point forward (along negative Z-axis)
        coneGeometry.rotateX(Math.PI / 2);
        
        // Position the cone so its apex is at the drone's center and it extends forward
        coneGeometry.translate(0, 0, -coneLength/2);
        
        // Create material with drone's color but transparent
        const coneMaterial = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        
        // Create the mesh
        this.visionCone = new THREE.Mesh(coneGeometry, coneMaterial);
        
        // Add to drone mesh
        this.mesh.add(this.visionCone);
        
        // Create a wireframe outline for better visibility
        const wireframeMaterial = new THREE.LineBasicMaterial({ 
            color: this.color,
            transparent: true,
            opacity: 0.5
        });
        
        const wireframe = new THREE.LineSegments(
            new THREE.WireframeGeometry(coneGeometry),
            wireframeMaterial
        );
        
        this.visionConeWireframe = wireframe;
        this.mesh.add(wireframe);
    }
    
    createAudio() {
        // Optionally implement rotor sound effects
        this.audioListener = new THREE.AudioListener();
        this.rotorSound = new THREE.PositionalAudio(this.audioListener);
        
        // Would need to load audio file and set up properly
        // Left as a placeholder for now
    }
    
    createWeapon() {
        if (!this.hasWeapon) return;
        
        // Create a gun barrel
        const barrelGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8);
        const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
        this.gunBarrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
        this.gunBarrel.rotation.x = Math.PI / 2; // Align with drone facing
        this.gunBarrel.position.set(0, -0.05, -0.2); // Position under nose
        this.mesh.add(this.gunBarrel);
    }
    
    // New method to set higher-level control inputs
    setControlInputs(roll, pitch, yaw, thrust) {
        // Clamp inputs to valid ranges
        this.controlInputs.roll = Math.max(-1, Math.min(1, roll));
        this.controlInputs.pitch = Math.max(-1, Math.min(1, pitch));
        this.controlInputs.yaw = Math.max(-1, Math.min(1, yaw));
        this.controlInputs.thrust = Math.max(0, Math.min(1, thrust));
    }
    
    // Apply external force (e.g., wind)
    applyExternalForce(force) {
        this.externalForce.copy(force);
    }
    
    // For backwards compatibility
    applyThrusts(thrusts) {
        // Safety check for valid thrust values
        for (let i = 0; i < 4; i++) {
            this.rotorThrustsTarget[i] = Math.max(0, Math.min(1, thrusts[i]));
        }
    }
    
    // Method to shoot projectiles
    shoot() {
        if (!this.hasWeapon || this.weaponCooldown > 0 || this.crashed || this.isDestroyed) return false;
        
        // Create projectile
        const projectileGeometry = new THREE.SphereGeometry(0.05, 8, 8);
        const projectileMaterial = new THREE.MeshBasicMaterial({ 
            color: this.id === 0 ? 0x00ff00 : 0xff00ff // Different color for each drone
        });
        const projectile = new THREE.Mesh(projectileGeometry, projectileMaterial);
        
        // Position at gun barrel
        const barrelPosition = new THREE.Vector3();
        this.gunBarrel.getWorldPosition(barrelPosition);
        projectile.position.copy(barrelPosition);
        
        // Set direction based on drone orientation
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.quaternion);
        
        // Add to scene
        this.scene.add(projectile);
        
        // Store projectile data
        this.projectiles.push({
            mesh: projectile,
            direction: direction,
            speed: 30, // Projectile speed
            lifetime: 2, // Seconds before despawning
            fromDrone: this.id
        });
        
        // Start cooldown
        this.weaponCooldown = this.weaponCooldownTime;
        this.isShooting = true;
        
        // Create a small muzzle flash effect
        const flashGeometry = new THREE.SphereGeometry(0.1, 8, 8);
        const flashMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00,
            transparent: true,
            opacity: 0.8
        });
        const flash = new THREE.Mesh(flashGeometry, flashMaterial);
        flash.position.copy(barrelPosition);
        this.scene.add(flash);
        
        // Remove flash after a short time
        setTimeout(() => {
            this.scene.remove(flash);
            this.isShooting = false;
        }, 100);
        
        return true;
    }
    
    // Update projectiles
    updateProjectiles(deltaTime, otherDrones) {
        // Update cooldown
        if (this.weaponCooldown > 0) {
            this.weaponCooldown -= deltaTime;
        }
        
        // Update existing projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];
            
            // Move projectile
            const movement = projectile.direction.clone().multiplyScalar(projectile.speed * deltaTime);
            projectile.mesh.position.add(movement);
            
            // Update lifetime
            projectile.lifetime -= deltaTime;
            
            // Check for collisions with other drones
            for (const drone of otherDrones) {
                if (drone.id === this.id || drone.isDestroyed) continue; // Skip self and already destroyed drones
                
                // Check distance to drone (simple sphere collision)
                const distToDrone = projectile.mesh.position.distanceTo(drone.position);
                if (distToDrone < 0.5) { // Hit if within 0.5 units
                    // Register hit
                    drone.takeDamage(25, this.id);
                    
                    // Remove projectile
                    this.scene.remove(projectile.mesh);
                    this.projectiles.splice(i, 1);
                    
                    // Create hit effect
                    this.createHitEffect(projectile.mesh.position.clone());
                    
                    continue; // Skip rest of checks for this projectile
                }
            }
            
            // Remove if expired
            if (projectile.lifetime <= 0) {
                this.scene.remove(projectile.mesh);
                this.projectiles.splice(i, 1);
                continue;
            }
            
            // Check collisions with walls and floor/ceiling
            const pos = projectile.mesh.position;
            if (Math.abs(pos.x) > 29 || Math.abs(pos.z) > 19 || pos.y < 0.1 || pos.y > 14.5) {
                this.scene.remove(projectile.mesh);
                this.projectiles.splice(i, 1);
            }
        }
    }
    
    // Create visual effect for hits
    createHitEffect(position) {
        const effectGeometry = new THREE.SphereGeometry(0.2, 8, 8);
        const effectMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xff6600,
            transparent: true,
            opacity: 0.8
        });
        const effect = new THREE.Mesh(effectGeometry, effectMaterial);
        effect.position.copy(position);
        this.scene.add(effect);
        
        // Animation - expand and fade
        let scale = 1.0;
        let opacity = 0.8;
        
        const animate = () => {
            scale += 0.1;
            opacity -= 0.05;
            
            effect.scale.set(scale, scale, scale);
            effectMaterial.opacity = opacity;
            
            if (opacity > 0) {
                requestAnimationFrame(animate);
            } else {
                this.scene.remove(effect);
            }
        };
        
        animate();
    }
    
    // Handle being hit
    takeDamage(amount, fromDroneId) {
        if (this.isDestroyed) return;
        
        this.health -= amount;
        this.shotBy = fromDroneId;
        
        // Visual feedback - turn red briefly
        const originalColor = this.body.material.color.clone();
        this.body.material.color.set(0xff0000);
        
        // Reset color after a short time if still alive
        if (this.health > 0) {
            setTimeout(() => {
                this.body.material.color.copy(originalColor);
            }, 200);
        } else {
            this.destroy();
        }
    }
    
    // Destruction (from being shot)
    destroy() {
        if (this.isDestroyed) return;
        
        this.isDestroyed = true;
        this.crashed = true; // Also count as crashed for compatibility
        
        // Visual effect - drone turns black
        this.body.material.color.set(0x000000);
        
        // Create explosion effect
        this.createExplosionEffect();
        
        console.log(`Drone ${this.id} was destroyed by Drone ${this.shotBy}`);
    }
    
    createExplosionEffect() {
        // Create multiple particles for explosion
        const particleCount = 20;
        const particles = [];
        
        for (let i = 0; i < particleCount; i++) {
            const size = 0.05 + Math.random() * 0.1;
            const geometry = new THREE.SphereGeometry(size, 8, 8);
            const material = new THREE.MeshBasicMaterial({ 
                color: Math.random() > 0.5 ? 0xff6600 : 0xffcc00,
                transparent: true,
                opacity: 0.8
            });
            
            const particle = new THREE.Mesh(geometry, material);
            particle.position.copy(this.position);
            
            // Random direction
            const direction = new THREE.Vector3(
                Math.random() * 2 - 1,
                Math.random() * 2 - 1,
                Math.random() * 2 - 1
            ).normalize();
            
            const speed = 2 + Math.random() * 3;
            
            particles.push({
                mesh: particle,
                direction: direction,
                speed: speed
            });
            
            this.scene.add(particle);
        }
        
        // Animate particles
        let time = 0;
        const animate = () => {
            time += 0.016; // Approximately 60fps
            
            for (const particle of particles) {
                // Move outward
                particle.mesh.position.add(
                    particle.direction.clone().multiplyScalar(particle.speed * 0.016)
                );
                
                // Fade out
                particle.mesh.material.opacity = Math.max(0, 0.8 - time * 0.8);
            }
            
            if (time < 1) {
                requestAnimationFrame(animate);
            } else {
                // Remove all particles
                for (const particle of particles) {
                    this.scene.remove(particle.mesh);
                }
            }
        };
        
        animate();
    }
    
    // Detect other drones
    detectDrones(drones) {
        this.detectedDrones = [];
        this.nearestDrone = null;
        this.nearestDroneDistance = Infinity;
        
        for (const drone of drones) {
            if (drone.id === this.id || drone.isDestroyed) continue; // Skip self and destroyed drones
            
            const distance = this.position.distanceTo(drone.position);
            
            if (distance <= this.maxDetectionRange) {
                // Calculate direction vector to other drone
                const direction = new THREE.Vector3().subVectors(drone.position, this.position).normalize();
                
                // Add to detected drones
                this.detectedDrones.push({
                    id: drone.id,
                    distance: distance,
                    direction: direction,
                    drone: drone
                });
                
                // Update nearest drone if closer
                if (distance < this.nearestDroneDistance) {
                    this.nearestDrone = drone;
                    this.nearestDroneDistance = distance;
                    this.nearestDroneDirection = direction;
                }
            }
        }
        
        return this.detectedDrones.length > 0;
    }
    
    update(deltaTime) {
        if (this.isDestroyed) return;
        if (this.crashed) return;
        
        // Split physics update into multiple smaller fixed timesteps
        // for more stable and accurate simulation
        this.timeRemainder += deltaTime;
        
        // Process fixed timesteps until we've consumed the frame time
        while (this.timeRemainder >= this.fixedTimestep) {
            this.fixedUpdate(this.fixedTimestep);
            this.timeRemainder -= this.fixedTimestep;
            this.subSteps++;
        }
        
        // Interpolation for rendering could be done here if needed
        
        // Update mesh position and rotation
        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);
        
        // Reset external forces each frame
        this.externalForce.set(0, 0, 0);
        
        // Update vision cone visibility
        this.updateVisionCone();
    }
    
    // Fixed timestep physics update for stability
    fixedUpdate(deltaTime) {
        // Apply PID control
        this.applyFlightControl(deltaTime);
        
        // Apply motor dynamics (lag)
        this.updateMotorDynamics(deltaTime);
        
        // Calculate forces and torques
        const forces = new THREE.Vector3(0, -this.mass * this.gravity, 0); // Gravity
        
        // Add external forces (wind/turbulence)
        forces.add(this.externalForce);
        
        const torques = new THREE.Vector3(0, 0, 0);
        
        // Update rotor visual rotation based on thrust
        for (let i = 0; i < 4; i++) {
            // Target rotation speed based on thrust
            const targetSpeed = this.rotorThrusts[i] * 30;
            
            // Gradually adjust speed
            this.rotors[i].speed += (targetSpeed - this.rotors[i].speed) * 5 * deltaTime;
            
            // Rotate the blades
            this.rotors[i].blade.rotation.y += this.rotors[i].speed * this.rotors[i].direction * deltaTime;
            
            // Calculate thrust force in local space
            const thrust = this.rotorThrusts[i] * this.maxThrust / 4;
            
            // Convert thrust to world space (apply drone's rotation)
            const thrustVector = new THREE.Vector3(0, thrust, 0);
            thrustVector.applyQuaternion(this.quaternion);
            forces.add(thrustVector);
            
            // Calculate torque based on rotor position and thrust
            const pos = this.rotors[i].mesh.position;
            
            // Roll torque (x-axis) - depends on left/right position
            if (i === 0 || i === 2) { // Left rotors
                torques.x -= thrust * this.rotorDistance;
            } else { // Right rotors
                torques.x += thrust * this.rotorDistance;
            }
            
            // Pitch torque (z-axis) - depends on front/back position
            if (i === 0 || i === 1) { // Front rotors
                torques.z -= thrust * this.rotorDistance;
            } else { // Back rotors
                torques.z += thrust * this.rotorDistance;
            }
            
            // Yaw torque (y-axis) - alternating directions
            if (i % 2 === 0) { // Rotors spinning clockwise
                torques.y += thrust * 0.2; // Increased yaw effect
            } else { // Rotors spinning counter-clockwise
                torques.y -= thrust * 0.2; // Increased yaw effect
            }
        }
        
        // Apply drag forces
        const dragForce = this.velocity.clone().multiplyScalar(-this.drag * this.velocity.length());
        forces.add(dragForce);
        
        const angularDragTorque = this.angularVelocity.clone().multiplyScalar(-this.angularDrag);
        torques.add(angularDragTorque);
        
        // Update velocity based on forces (F = ma, so a = F/m)
        const acceleration = forces.clone().divideScalar(this.mass);
        this.velocity.add(acceleration.multiplyScalar(deltaTime));
        
        // Update angular velocity based on torques using proper inertia tensor
        const angularAcceleration = new THREE.Vector3(
            torques.x / this.inertia.x,
            torques.y / this.inertia.y,
            torques.z / this.inertia.z
        );
        this.angularVelocity.add(angularAcceleration.multiplyScalar(deltaTime));
        
        // Update position based on velocity
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Update rotation based on angular velocity
        const deltaRotation = new THREE.Quaternion()
            .setFromEuler(new THREE.Euler(
                this.angularVelocity.x * deltaTime,
                this.angularVelocity.y * deltaTime,
                this.angularVelocity.z * deltaTime,
                'XYZ'
            ));
        this.quaternion.multiply(deltaRotation);
        this.quaternion.normalize(); // Prevent drift due to numerical errors
        
        // Update rotation Euler from quaternion
        this.rotation.setFromQuaternion(this.quaternion);
        
        // Check for collisions
        this.checkCollisions();
        
        // Update projectiles if we have weapons
        if (this.hasWeapon && this.projectiles.length > 0) {
            // Get other drones for collision detection
            const otherDrones = [];
            
            // First check if global drones array exists
            if (typeof window.drones !== 'undefined' && window.drones) {
                // Use global drones array
                for (let i = 0; i < window.drones.length; i++) {
                    if (window.drones[i].id !== this.id && !window.drones[i].isDestroyed) {
                        otherDrones.push(window.drones[i]);
                    }
                }
            } else {
                // Fallback to passed otherDrones from constructor if available
                if (typeof this.otherDrones !== 'undefined' && this.otherDrones) {
                    otherDrones.push(...this.otherDrones.filter(d => !d.isDestroyed));
                }
            }
            
            this.updateProjectiles(deltaTime, otherDrones);
        }
    }
    
    // Apply motor dynamics - motors don't respond instantly
    updateMotorDynamics(deltaTime) {
        for (let i = 0; i < 4; i++) {
            // First-order lag dynamics
            const error = this.rotorThrustsTarget[i] - this.rotorThrusts[i];
            const response = error * (1 - Math.exp(-deltaTime / this.motorTimeConstant));
            this.rotorThrusts[i] += response;
        }
    }
    
    // High-level flight controller using PID
    applyFlightControl(deltaTime) {
        // Extract Euler angles for control
        const roll = this.rotation.x;  // x-axis rotation
        const pitch = this.rotation.z; // z-axis rotation (pitched forward)
        const yaw = this.rotation.y;   // y-axis rotation
        
        // Calculate desired roll and pitch based on control inputs
        const desiredRoll = this.controlInputs.roll * 0.6; // Max +/- 0.6 radians (~30 degrees)
        const desiredPitch = this.controlInputs.pitch * 0.6;
        
        // PID control for roll
        const rollRate = this.rollPID.update(desiredRoll - roll, deltaTime);
        
        // PID control for pitch
        const pitchRate = this.pitchPID.update(desiredPitch - pitch, deltaTime);
        
        // Direct yaw rate control with basic dampening
        const yawRate = this.controlInputs.yaw - (this.angularVelocity.y * 0.1);
        
        // Base thrust based on control input, with adjustments for attitude
        const baseThrust = this.controlInputs.thrust;
        
        // Calculate individual rotor thrusts to achieve desired rates
        // Format: [front-left, front-right, back-left, back-right]
        
        // Roll control: increase left rotors and decrease right, or vice versa
        const rollControl = rollRate * 0.2;
        
        // Pitch control: increase back rotors and decrease front, or vice versa
        const pitchControl = pitchRate * 0.2;
        
        // Yaw control: increase CW rotors and decrease CCW, or vice versa
        const yawControl = yawRate * 0.1;
        
        // Apply all control factors to get target thrusts
        this.rotorThrustsTarget[0] = baseThrust - rollControl - pitchControl + yawControl; // Front-left
        this.rotorThrustsTarget[1] = baseThrust + rollControl - pitchControl - yawControl; // Front-right
        this.rotorThrustsTarget[2] = baseThrust - rollControl + pitchControl - yawControl; // Back-left
        this.rotorThrustsTarget[3] = baseThrust + rollControl + pitchControl + yawControl; // Back-right
        
        // Ensure all thrusts are within limits
        for (let i = 0; i < 4; i++) {
            this.rotorThrustsTarget[i] = Math.max(0, Math.min(1, this.rotorThrustsTarget[i]));
        }
    }
    
    checkCollisions() {
        let didCrash = false;
        
        // Check floor collision
        if (this.position.y < 0.1) {
            // Hit the ground
            this.position.y = 0.1;
            
            // Check if it was a hard landing
            if (this.velocity.y < -2.0) {
                didCrash = true;
                console.log("Crashed: Hard landing");
            } else {
                // Bounce slightly and kill vertical velocity
                this.velocity.y = Math.abs(this.velocity.y) * 0.2;
            }
        }
        
        // Check ceiling collision
        if (this.position.y > 14.5) {
            this.position.y = 14.5;
            this.velocity.y = Math.min(0, this.velocity.y);

            // Always count ceiling collisions as crashes - lowered velocity threshold
            didCrash = true;
            console.log("Crashed: Hit ceiling");
            
            // Trigger immediate reset for all drones when hitting ceiling
            if (window.trainingEnabled) {
                if (typeof resetAllDrones === 'function') {
                    console.log("Triggering reset for all drones due to ceiling collision");
                    resetAllDrones();
                }
            }
        }
        
        // Check wall collisions
        if (Math.abs(this.position.x) > 29) {
            this.position.x = Math.sign(this.position.x) * 29;
            this.velocity.x = -this.velocity.x * 0.5;
            
            // Always count wall collisions as crashes for RL learning
            didCrash = true;
            console.log("Crashed: Hit wall (X-axis)");
        }
        
        if (Math.abs(this.position.z) > 19) {
            this.position.z = Math.sign(this.position.z) * 19;
            this.velocity.z = -this.velocity.z * 0.5;
            
            // Always count wall collisions as crashes for RL learning
            didCrash = true;
            console.log("Crashed: Hit wall (Z-axis)");
        }
        
        // If any collision was detected, trigger crash
        if (didCrash && !this.crashed) {
            this.crash("Collision with boundary");
        }
    }
    
    crash(reason) {
        if (this.crashed || this.isDestroyed) return;
        
        this.crashed = true;
        console.log(`Drone ${this.id} crashed: ${reason}`);
        
        // Visual indication of crash
        this.body.material.color.set(0xff0000);
        
        // Don't automatically reset - let the RL system handle it
        // If not in training mode, reset after a short delay
        if (!window.trainingEnabled) {
            clearTimeout(this.crashTimeout);
            this.crashTimeout = setTimeout(() => {
                this.reset();
            }, 1000);
        }
    }
    
    reset() {
        // Reset physical state to a default position
        this.resetWithPosition({ x: 0, y: 1, z: 0 });
    }

    resetWithPosition(position) {
        // Reset physical state with the provided position
        this.position.set(position.x, position.y, position.z);
        this.rotation.set(0, 0, 0);
        this.quaternion.identity();
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.rotorThrusts = [0, 0, 0, 0];
        this.rotorThrustsTarget = [0, 0, 0, 0];
        this.externalForce.set(0, 0, 0);
        
        // Reset controllers
        this.rollPID.reset();
        this.pitchPID.reset();
        this.yawPID.reset();
        this.altitudePID.reset();
        
        // Reset control inputs
        this.controlInputs = {
            roll: 0,
            pitch: 0,
            yaw: 0,
            thrust: 0
        };
        
        // Reset visual state
        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);
        
        // Reset crash state
        this.crashed = false;
        
        // Reset combat-related properties
        this.health = 100;
        this.isDestroyed = false;
        this.shotBy = null;
        this.weaponCooldown = 0;
        this.isShooting = false;
        
        // Remove any active projectiles
        for (const projectile of this.projectiles) {
            this.scene.remove(projectile.mesh);
        }
        this.projectiles = [];
        
        // Reset detection data
        this.detectedDrones = [];
        this.nearestDrone = null;
        this.nearestDroneDistance = Infinity;
        
        // Reset body color to original drone color (important!)
        this.body.material.color.set(this.color);
    }

    setInitialRotation(x, y, z) {
        // Set rotation and update quaternion
        this.rotation.set(x, y, z);
        this.quaternion.setFromEuler(this.rotation);
        
        // Update mesh
        this.mesh.quaternion.copy(this.quaternion);
    }
    
    // Get the current state of the drone for RL
    getState() {
        const state = {
            position: this.position.clone(),
            rotation: new THREE.Euler().setFromQuaternion(this.quaternion),
            velocity: this.velocity.clone(),
            angularVelocity: this.angularVelocity.clone(),
            rotorThrusts: [...this.rotorThrusts],
            crashed: this.crashed,
            isDestroyed: this.isDestroyed,
            health: this.health,
            isShooting: this.isShooting,
            weaponCooldown: this.weaponCooldown
        };
        
        // Calculate distance to ceiling and floor
        const ceilingDistance = 15 - this.position.y; // Gym ceiling is at y=15
        const floorDistance = this.position.y; // Floor is at y=0
        
        // Add distance sensors to state
        state.ceilingDistance = ceilingDistance;
        state.floorDistance = floorDistance;
        
        // Add information about nearest drone if detected
        if (this.nearestDrone) {
            state.nearestDroneDistance = this.nearestDroneDistance;
            state.nearestDroneDirection = this.nearestDroneDirection.clone();
            state.nearestDroneId = this.nearestDrone.id;
        } else {
            state.nearestDroneDistance = null;
            state.nearestDroneDirection = null;
            state.nearestDroneId = null;
        }
        
        return state;
    }
    
    // Update vision cone visibility based on detection
    updateVisionCone() {
        if (!this.visionCone) return;
        
        // Show cone if a drone is detected
        if (this.detectedDrones.length > 0) {
            // Make the cone more visible when a drone is detected
            this.visionCone.material.opacity = 0.3;
            this.visionConeWireframe.material.opacity = 0.7;
            
            // Highlight when target is in front for shooting
            if (this.nearestDrone) {
                const droneForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
                const targetAlignment = droneForward.dot(this.nearestDroneDirection);
                
                if (targetAlignment > 0.9) {
                    // Target is directly in front - highlight cone in red
                    this.visionCone.material.color.set(0xff0000);
                    this.visionConeWireframe.material.color.set(0xff0000);
                } else {
                    // Target detected but not directly in front - use detection color
                    this.visionCone.material.color.set(this.color);
                    this.visionConeWireframe.material.color.set(this.color);
                }
            }
        } else {
            // Make cone less visible when no drones detected
            this.visionCone.material.opacity = 0.1;
            this.visionConeWireframe.material.opacity = 0.3;
            this.visionCone.material.color.set(this.color);
            this.visionConeWireframe.material.color.set(this.color);
        }
    }
}

// PID Controller class
class PIDController {
    constructor(kp, ki, kd) {
        this.kp = kp; // Proportional gain
        this.ki = ki; // Integral gain
        this.kd = kd; // Derivative gain
        
        this.integral = 0;
        this.previousError = 0;
        this.output = 0;
        
        // Limits
        this.integralLimit = 1.0;
        this.outputLimit = 1.0;
    }
    
    update(error, dt) {
        // Proportional term
        const p = this.kp * error;
        
        // Integral term with anti-windup
        this.integral += error * dt;
        this.integral = Math.max(-this.integralLimit, Math.min(this.integralLimit, this.integral));
        const i = this.ki * this.integral;
        
        // Derivative term
        const derivative = (error - this.previousError) / dt;
        const d = this.kd * derivative;
        
        // Compute output
        this.output = p + i + d;
        
        // Limit output
        this.output = Math.max(-this.outputLimit, Math.min(this.outputLimit, this.output));
        
        // Store error for next iteration
        this.previousError = error;
        
        return this.output;
    }
    
    reset() {
        this.integral = 0;
        this.previousError = 0;
        this.output = 0;
    }
}
