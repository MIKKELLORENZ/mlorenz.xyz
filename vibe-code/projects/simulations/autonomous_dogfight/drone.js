class Drone {
    constructor(scene, position = { x: 0, y: 1, z: 0 }, color = 0x333333, id = 0) {
        this.scene = scene;
        this.id = id;
        this.color = color;
        
        // Physical properties
        this.mass = 1.0;
        this.gravity = 9.8;
        this.maxThrust = 3.0 * this.mass * this.gravity;
        this.drag = 0.1;
        this.angularDrag = 0.2;
        this.rotorDistance = 0.4;
        
        // Physics timestep
        this.fixedTimestep = 0.005;
        this.subSteps = 0;
        this.timeRemainder = 0;
        
        // State
        this.position = new THREE.Vector3(position.x, position.y, position.z);
        this.rotation = new THREE.Euler(0, 0, 0, 'XYZ');
        this.quaternion = new THREE.Quaternion();
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.angularVelocity = new THREE.Vector3(0, 0, 0);
        
        // Rotors
        this.rotorThrusts = [0, 0, 0, 0];
        this.rotorThrustsTarget = [0, 0, 0, 0];
        this.motorTimeConstant = 0.05;
        
        // PID controllers
        this.rollPID = new PIDController(2.0, 0.1, 0.5);
        this.pitchPID = new PIDController(2.0, 0.1, 0.5);
        this.yawPID = new PIDController(2.0, 0.0, 0.2);
        this.altitudePID = new PIDController(2.0, 0.5, 0.2);
        
        // Control inputs
        this.controlInputs = { roll: 0, pitch: 0, yaw: 0, thrust: 0 };
        
        // External forces
        this.externalForce = new THREE.Vector3(0, 0, 0);
        
        // Build mesh
        this.createDroneMesh();
        
        // Crash state
        this.crashed = false;
        this.crashTimeout = null;
        
        // Audio placeholder
        this.createAudio();
        
        // Combat
        this.hasWeapon = true;
        this.weaponCooldown = 0;
        this.weaponCooldownTime = 1.0;
        this.maxDetectionRange = 30;
        this.shotBy = null;
        this.isShooting = false;
        this.projectiles = [];
        this.health = 100;
        this.isDestroyed = false;
        
        // Detection
        this.detectedDrones = [];
        this.nearestDrone = null;
        this.nearestDroneDistance = Infinity;
        this.nearestDroneDirection = new THREE.Vector3();
        
        // Weapon
        this.createWeapon();
        
        // Floating health bar
        this.createHealthBar();
        
        // Engine trail particles
        this.trailParticles = [];
        this.trailTimer = 0;
        
        // Inertia
        this.calculateInertia();
    }
    
    calculateInertia() {
        const width = this.rotorDistance * 2;
        const height = 0.1;
        const depth = width;
        const rotorMass = this.mass * 0.15;
        const bodyMass = this.mass - (rotorMass * 4);
        
        const Ixx_body = (1/12) * bodyMass * (height*height + depth*depth);
        const Iyy_body = (1/12) * bodyMass * (width*width + depth*depth);
        const Izz_body = (1/12) * bodyMass * (width*width + height*height);
        
        const rotorContribution = rotorMass * this.rotorDistance * this.rotorDistance * 2;
        
        this.inertia = new THREE.Vector3(
            Ixx_body + rotorContribution,
            (Iyy_body + rotorContribution * 0.5) * 0.6,
            Izz_body + rotorContribution
        );
    }
    
    createDroneMesh() {
        const bodyGeometry = new THREE.BoxGeometry(0.3, 0.1, 0.3);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: this.color, metalness: 0.4, roughness: 0.6 });
        this.body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        this.body.castShadow = true;
        this.body.receiveShadow = true;
        
        this.mesh = new THREE.Group();
        this.mesh.add(this.body);
        
        // Arms (X-configuration matching diagonal motor positions)
        const armLength = this.rotorDistance * 2 * Math.SQRT2;
        const armGeometry = new THREE.BoxGeometry(armLength, 0.04, 0.04);
        const armMaterial = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.3, roughness: 0.7 });
        
        this.armFB = new THREE.Mesh(armGeometry, armMaterial);
        this.armFB.rotation.y = Math.PI / 4;
        this.armFB.castShadow = true;
        this.mesh.add(this.armFB);
        
        this.armLR = new THREE.Mesh(armGeometry, armMaterial);
        this.armLR.rotation.y = -Math.PI / 4;
        this.armLR.castShadow = true;
        this.mesh.add(this.armLR);
        
        // Rotors
        this.rotors = [];
        const rotorPositions = [
            { x: -this.rotorDistance, y: 0.05, z: -this.rotorDistance },
            { x: this.rotorDistance, y: 0.05, z: -this.rotorDistance },
            { x: -this.rotorDistance, y: 0.05, z: this.rotorDistance },
            { x: this.rotorDistance, y: 0.05, z: this.rotorDistance }
        ];
        
        for (let i = 0; i < 4; i++) {
            const rotorGroup = new THREE.Group();
            
            // Motor hub
            const centerGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.025, 12);
            const centerMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 });
            const center = new THREE.Mesh(centerGeometry, centerMaterial);
            center.castShadow = true;
            rotorGroup.add(center);
            
            // X-blade (two perpendicular blades in a group)
            const bladeGeometry = new THREE.BoxGeometry(0.22, 0.008, 0.04);
            const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.2, roughness: 0.6 });
            const bladeGroup = new THREE.Group();
            const blade1 = new THREE.Mesh(bladeGeometry, bladeMaterial);
            blade1.castShadow = true;
            bladeGroup.add(blade1);
            const blade2 = new THREE.Mesh(bladeGeometry, bladeMaterial);
            blade2.rotation.y = Math.PI / 2;
            blade2.castShadow = true;
            bladeGroup.add(blade2);
            rotorGroup.add(bladeGroup);
            
            // Motor guard ring
            const guardGeometry = new THREE.TorusGeometry(0.15, 0.008, 6, 20);
            const guardMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.3, roughness: 0.7 });
            const guard = new THREE.Mesh(guardGeometry, guardMaterial);
            guard.rotation.x = Math.PI / 2;
            guard.castShadow = true;
            rotorGroup.add(guard);
            
            rotorGroup.position.set(rotorPositions[i].x, rotorPositions[i].y, rotorPositions[i].z);
            
            this.rotors.push({
                mesh: rotorGroup,
                blade: bladeGroup,
                speed: 0,
                direction: i % 2 === 0 ? 1 : -1
            });
            
            this.mesh.add(rotorGroup);
        }
        
        // Nose indicator
        const noseGeometry = new THREE.ConeGeometry(0.05, 0.2, 8);
        const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        this.nose = new THREE.Mesh(noseGeometry, noseMaterial);
        this.nose.rotation.x = Math.PI / 2;
        this.nose.position.set(0, 0, -0.25);
        this.mesh.add(this.nose);
        
        // Camera/sensor dome (under nose)
        const camGeo = new THREE.SphereGeometry(0.04, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const camMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });
        const camDome = new THREE.Mesh(camGeo, camMat);
        camDome.rotation.x = Math.PI;
        camDome.position.set(0, -0.06, -0.12);
        this.mesh.add(camDome);
        
        // Status LEDs (front = team color, rear = white)
        const ledGeo = new THREE.SphereGeometry(0.018, 6, 6);
        const frontLedMat = new THREE.MeshBasicMaterial({ color: this.color });
        const rearLedMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const ledPositions = [
            { x: -this.rotorDistance, z: -this.rotorDistance, mat: frontLedMat },
            { x:  this.rotorDistance, z: -this.rotorDistance, mat: frontLedMat },
            { x: -this.rotorDistance, z:  this.rotorDistance, mat: rearLedMat },
            { x:  this.rotorDistance, z:  this.rotorDistance, mat: rearLedMat }
        ];
        for (const lp of ledPositions) {
            const led = new THREE.Mesh(ledGeo, lp.mat);
            led.position.set(lp.x, 0.08, lp.z);
            this.mesh.add(led);
        }
        
        // Landing skids
        const skidMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.3, roughness: 0.7 });
        const skidGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6);
        const skidF = new THREE.Mesh(skidGeo, skidMat);
        skidF.rotation.z = Math.PI / 2;
        skidF.position.set(0, -0.13, -0.1);
        this.mesh.add(skidF);
        const skidR = new THREE.Mesh(skidGeo, skidMat);
        skidR.rotation.z = Math.PI / 2;
        skidR.position.set(0, -0.13, 0.1);
        this.mesh.add(skidR);
        // Skid legs
        const legGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6);
        const legPos = [
            { x: -0.15, z: -0.1 }, { x: 0.15, z: -0.1 },
            { x: -0.15, z:  0.1 }, { x: 0.15, z:  0.1 }
        ];
        for (const lp of legPos) {
            const leg = new THREE.Mesh(legGeo, skidMat);
            leg.position.set(lp.x, -0.08, lp.z);
            this.mesh.add(leg);
        }
        
        // Team-color glow light
        const teamLight = new THREE.PointLight(this.color, 0.3, 3);
        teamLight.position.set(0, -0.1, 0);
        this.mesh.add(teamLight);
        
        // Vision cone
        this.createVisionCone();
        
        this.mesh.position.copy(this.position);
        this.scene.add(this.mesh);
    }
    
    createVisionCone() {
        const coneLength = 15.0;
        const coneAngle = Math.PI / 4;
        const coneEndRadius = Math.tan(coneAngle) * coneLength;
        
        const coneGeometry = new THREE.ConeGeometry(coneEndRadius, coneLength, 16, 1, true);
        coneGeometry.rotateX(Math.PI / 2);
        coneGeometry.translate(0, 0, -coneLength / 2);
        
        const coneMaterial = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        
        this.visionCone = new THREE.Mesh(coneGeometry, coneMaterial);
        this.mesh.add(this.visionCone);
        
        const wireframeMaterial = new THREE.LineBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0.5
        });
        
        this.visionConeWireframe = new THREE.LineSegments(
            new THREE.WireframeGeometry(coneGeometry),
            wireframeMaterial
        );
        this.mesh.add(this.visionConeWireframe);
    }
    
    createAudio() {
        // Placeholder for positional audio
        this.audioListener = new THREE.AudioListener();
        this.rotorSound = new THREE.PositionalAudio(this.audioListener);
    }
    
    createWeapon() {
        if (!this.hasWeapon) return;
        // Main barrel (slightly tapered, metallic)
        const barrelGeometry = new THREE.CylinderGeometry(0.015, 0.025, 0.25, 8);
        const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.7, roughness: 0.3 });
        this.gunBarrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
        this.gunBarrel.rotation.x = Math.PI / 2;
        this.gunBarrel.position.set(0, -0.05, -0.22);
        this.mesh.add(this.gunBarrel);
        // Muzzle ring at barrel tip
        const muzzleGeo = new THREE.TorusGeometry(0.022, 0.006, 6, 12);
        const muzzleMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });
        const muzzle = new THREE.Mesh(muzzleGeo, muzzleMat);
        muzzle.position.set(0, -0.05, -0.345);
        this.mesh.add(muzzle);
    }
    
    // ─── Floating Health Bar ─────────────────────────────────────────
    createHealthBar() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 16;
        this.healthCanvas = canvas;
        this.healthCtx = canvas.getContext('2d');
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        this.healthSprite = new THREE.Sprite(spriteMaterial);
        this.healthSprite.scale.set(1.2, 0.15, 1);
        this.healthSprite.position.set(0, 0.7, 0);
        this.mesh.add(this.healthSprite);
        
        this._drawHealthBar();
    }
    
    _drawHealthBar() {
        const ctx = this.healthCtx;
        const w = this.healthCanvas.width;
        const h = this.healthCanvas.height;
        const pct = Math.max(0, this.health / 100);
        
        ctx.clearRect(0, 0, w, h);
        
        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.roundRect(0, 0, w, h, 4);
        ctx.fill();
        
        // Health fill with gradient green → yellow → red
        let color;
        if (pct > 0.6) color = '#00ff88';
        else if (pct > 0.3) color = '#ffcc00';
        else color = '#ff3344';
        
        ctx.fillStyle = color;
        ctx.roundRect(2, 2, (w - 4) * pct, h - 4, 3);
        ctx.fill();
        
        this.healthSprite.material.map.needsUpdate = true;
    }
    
    // ─── Engine Trail Particles ──────────────────────────────────────
    _spawnTrailParticle() {
        const thrust = this.controlInputs.thrust;
        if (thrust < 0.15) return;
        
        const size = 0.03 + thrust * 0.04;
        const geo = new THREE.SphereGeometry(size, 4, 4);
        const mat = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0.6
        });
        const p = new THREE.Mesh(geo, mat);
        
        // Spawn slightly below drone centre
        const worldPos = new THREE.Vector3(0, -0.1, 0);
        this.mesh.localToWorld(worldPos);
        p.position.copy(worldPos);
        
        this.scene.add(p);
        this.trailParticles.push({ mesh: p, life: 0.4, age: 0 });
    }
    
    _updateTrailParticles(dt) {
        this.trailTimer -= dt;
        if (this.trailTimer <= 0) {
            this._spawnTrailParticle();
            this.trailTimer = 0.03;
        }
        
        for (let i = this.trailParticles.length - 1; i >= 0; i--) {
            const tp = this.trailParticles[i];
            tp.age += dt;
            tp.mesh.position.y -= dt * 1.5;
            tp.mesh.material.opacity = Math.max(0, 0.6 * (1 - tp.age / tp.life));
            tp.mesh.scale.multiplyScalar(0.96);
            
            if (tp.age >= tp.life) {
                this.scene.remove(tp.mesh);
                this.trailParticles.splice(i, 1);
            }
        }
    }
    
    // ─── Controls ────────────────────────────────────────────────────
    setControlInputs(roll, pitch, yaw, thrust) {
        this.controlInputs.roll = Math.max(-1, Math.min(1, roll));
        this.controlInputs.pitch = Math.max(-1, Math.min(1, pitch));
        this.controlInputs.yaw = Math.max(-1, Math.min(1, yaw));
        this.controlInputs.thrust = Math.max(0, Math.min(1, thrust));
    }
    
    applyExternalForce(force) {
        this.externalForce.copy(force);
    }
    
    applyThrusts(thrusts) {
        for (let i = 0; i < 4; i++) {
            this.rotorThrustsTarget[i] = Math.max(0, Math.min(1, thrusts[i]));
        }
    }
    
    // ─── Combat ──────────────────────────────────────────────────────
    shoot() {
        if (!this.hasWeapon || this.weaponCooldown > 0 || this.crashed || this.isDestroyed) return false;
        
        const projectileGeometry = new THREE.SphereGeometry(0.07, 6, 6);
        const projColor = this.id === 0 ? 0x44ff88 : 0xff44ff;
        const projectileMaterial = new THREE.MeshBasicMaterial({ color: projColor });
        const projectile = new THREE.Mesh(projectileGeometry, projectileMaterial);
        
        // Direction: local -Z axis (same as vision cone direction)
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(this.quaternion);
        
        // Spawn at barrel tip (barrel center + half-length along forward)
        const barrelPosition = new THREE.Vector3();
        this.gunBarrel.getWorldPosition(barrelPosition);
        barrelPosition.addScaledVector(direction, 0.13);
        projectile.position.copy(barrelPosition);
        
        this.scene.add(projectile);
        
        this.projectiles.push({
            mesh: projectile,
            direction: direction,
            speed: 30,
            lifetime: 2,
            fromDrone: this.id
        });
        
        this.weaponCooldown = this.weaponCooldownTime;
        this.isShooting = true;
        
        // Improved muzzle flash – multi-layer with point light
        this._createMuzzleFlash(barrelPosition);
        
        return true;
    }
    
    _createMuzzleFlash(pos) {
        const flashGroup = new THREE.Group();
        flashGroup.position.copy(pos);
        
        // Core flash
        const coreGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 });
        const core = new THREE.Mesh(coreGeo, coreMat);
        flashGroup.add(core);
        
        // Outer glow
        const glowGeo = new THREE.SphereGeometry(0.18, 8, 8);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6 });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        flashGroup.add(glow);
        
        // Point light flash
        const flashLight = new THREE.PointLight(0xffaa00, 2, 5);
        flashGroup.add(flashLight);
        
        this.scene.add(flashGroup);
        
        let elapsed = 0;
        const animateFlash = () => {
            elapsed += 0.016;
            const t = elapsed / 0.12;
            coreMat.opacity = Math.max(0, 1.0 - t);
            glowMat.opacity = Math.max(0, 0.6 - t * 0.6);
            flashLight.intensity = Math.max(0, 2 - t * 2);
            glow.scale.setScalar(1 + t * 0.5);
            
            if (t < 1) {
                requestAnimationFrame(animateFlash);
            } else {
                this.scene.remove(flashGroup);
                this.isShooting = false;
            }
        };
        animateFlash();
    }
    
    updateProjectiles(deltaTime, otherDrones) {
        if (this.weaponCooldown > 0) this.weaponCooldown -= deltaTime;
        
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            
            proj.mesh.position.add(proj.direction.clone().multiplyScalar(proj.speed * deltaTime));
            proj.lifetime -= deltaTime;
            
            for (const drone of otherDrones) {
                if (drone.id === this.id || drone.isDestroyed) continue;
                if (proj.mesh.position.distanceTo(drone.position) < 0.5) {
                    drone.takeDamage(25, this.id);
                    this.scene.remove(proj.mesh);
                    this.projectiles.splice(i, 1);
                    this.createHitEffect(proj.mesh.position.clone());
                    break;
                }
            }
            
            if (!this.projectiles[i]) continue;
            
            if (proj.lifetime <= 0) {
                this.scene.remove(proj.mesh);
                this.projectiles.splice(i, 1);
                continue;
            }
            
            const p = proj.mesh.position;
            if (Math.abs(p.x) > 29 || Math.abs(p.z) > 19 || p.y < 0.1 || p.y > 14.5) {
                this.scene.remove(proj.mesh);
                this.projectiles.splice(i, 1);
            }
        }
    }
    
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
        
        let scale = 1.0;
        let opacity = 0.8;
        const animate = () => {
            scale += 0.1;
            opacity -= 0.05;
            effect.scale.set(scale, scale, scale);
            effectMaterial.opacity = opacity;
            if (opacity > 0) requestAnimationFrame(animate);
            else this.scene.remove(effect);
        };
        animate();
    }
    
    takeDamage(amount, fromDroneId) {
        if (this.isDestroyed) return;
        this.health -= amount;
        this.shotBy = fromDroneId;
        
        this._drawHealthBar();
        
        const originalColor = this.body.material.color.clone();
        this.body.material.color.set(0xff0000);
        
        if (this.health > 0) {
            setTimeout(() => { this.body.material.color.copy(originalColor); }, 200);
        } else {
            this.destroy();
        }
    }
    
    destroy() {
        if (this.isDestroyed) return;
        this.isDestroyed = true;
        this.crashed = true;
        this.body.material.color.set(0x000000);
        this.createExplosionEffect();
        console.log(`Drone ${this.id} was destroyed by Drone ${this.shotBy}`);
    }
    
    createExplosionEffect() {
        const particleCount = 20;
        const particles = [];
        
        for (let i = 0; i < particleCount; i++) {
            const size = 0.05 + Math.random() * 0.1;
            const geo = new THREE.SphereGeometry(size, 8, 8);
            const mat = new THREE.MeshBasicMaterial({
                color: Math.random() > 0.5 ? 0xff6600 : 0xffcc00,
                transparent: true,
                opacity: 0.8
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.copy(this.position);
            const dir = new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1).normalize();
            particles.push({ mesh: p, direction: dir, speed: 2 + Math.random()*3 });
            this.scene.add(p);
        }
        
        let time = 0;
        const animate = () => {
            time += 0.016;
            for (const p of particles) {
                p.mesh.position.add(p.direction.clone().multiplyScalar(p.speed * 0.016));
                p.mesh.material.opacity = Math.max(0, 0.8 - time * 0.8);
            }
            if (time < 1) requestAnimationFrame(animate);
            else particles.forEach(p => this.scene.remove(p.mesh));
        };
        animate();
    }
    
    detectDrones(drones) {
        this.detectedDrones = [];
        this.nearestDrone = null;
        this.nearestDroneDistance = Infinity;
        
        for (const drone of drones) {
            if (drone.id === this.id || drone.isDestroyed) continue;
            const distance = this.position.distanceTo(drone.position);
            if (distance <= this.maxDetectionRange) {
                const direction = new THREE.Vector3().subVectors(drone.position, this.position).normalize();
                this.detectedDrones.push({ id: drone.id, distance, direction, drone });
                if (distance < this.nearestDroneDistance) {
                    this.nearestDrone = drone;
                    this.nearestDroneDistance = distance;
                    this.nearestDroneDirection = direction;
                }
            }
        }
        return this.detectedDrones.length > 0;
    }
    
    // ─── Physics Update ──────────────────────────────────────────────
    update(deltaTime) {
        if (this.isDestroyed || this.crashed) return;
        
        this.timeRemainder += deltaTime;
        while (this.timeRemainder >= this.fixedTimestep) {
            this.fixedUpdate(this.fixedTimestep);
            this.timeRemainder -= this.fixedTimestep;
            this.subSteps++;
        }
        
        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);
        this.externalForce.set(0, 0, 0);
        
        // Trail particles
        this._updateTrailParticles(deltaTime);
        
        this.updateVisionCone();
    }
    
    fixedUpdate(deltaTime) {
        this.applyFlightControl(deltaTime);
        this.updateMotorDynamics(deltaTime);
        
        const forces = new THREE.Vector3(0, -this.mass * this.gravity, 0);
        forces.add(this.externalForce);
        const torques = new THREE.Vector3(0, 0, 0);
        
        for (let i = 0; i < 4; i++) {
            const targetSpeed = this.rotorThrusts[i] * 30;
            this.rotors[i].speed += (targetSpeed - this.rotors[i].speed) * 5 * deltaTime;
            this.rotors[i].blade.rotation.y += this.rotors[i].speed * this.rotors[i].direction * deltaTime;
            
            const thrust = this.rotorThrusts[i] * this.maxThrust / 4;
            const thrustVector = new THREE.Vector3(0, thrust, 0);
            thrustVector.applyQuaternion(this.quaternion);
            forces.add(thrustVector);
            
            const pos = this.rotors[i].mesh.position;
            if (i === 0 || i === 2) torques.x -= thrust * this.rotorDistance;
            else torques.x += thrust * this.rotorDistance;
            
            if (i === 0 || i === 1) torques.z -= thrust * this.rotorDistance;
            else torques.z += thrust * this.rotorDistance;
            
            if (i % 2 === 0) torques.y += thrust * 0.2;
            else torques.y -= thrust * 0.2;
        }
        
        forces.add(this.velocity.clone().multiplyScalar(-this.drag * this.velocity.length()));
        torques.add(this.angularVelocity.clone().multiplyScalar(-this.angularDrag));
        
        this.velocity.add(forces.clone().divideScalar(this.mass).multiplyScalar(deltaTime));
        
        this.angularVelocity.add(new THREE.Vector3(
            torques.x / this.inertia.x,
            torques.y / this.inertia.y,
            torques.z / this.inertia.z
        ).multiplyScalar(deltaTime));
        
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        const deltaRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            this.angularVelocity.x * deltaTime,
            this.angularVelocity.y * deltaTime,
            this.angularVelocity.z * deltaTime,
            'XYZ'
        ));
        this.quaternion.multiply(deltaRotation);
        this.quaternion.normalize();
        this.rotation.setFromQuaternion(this.quaternion);
        
        this.checkCollisions();
        
        if (this.hasWeapon && this.projectiles.length > 0) {
            const otherDrones = [];
            if (typeof window.drones !== 'undefined' && window.drones) {
                for (let i = 0; i < window.drones.length; i++) {
                    if (window.drones[i].id !== this.id && !window.drones[i].isDestroyed) otherDrones.push(window.drones[i]);
                }
            }
            this.updateProjectiles(deltaTime, otherDrones);
        }
    }
    
    updateMotorDynamics(deltaTime) {
        for (let i = 0; i < 4; i++) {
            const error = this.rotorThrustsTarget[i] - this.rotorThrusts[i];
            this.rotorThrusts[i] += error * (1 - Math.exp(-deltaTime / this.motorTimeConstant));
        }
    }
    
    applyFlightControl(deltaTime) {
        const roll = this.rotation.x;
        const pitch = this.rotation.z;
        
        const desiredRoll = this.controlInputs.roll * 0.6;
        const desiredPitch = this.controlInputs.pitch * 0.6;
        
        const rollRate = this.rollPID.update(desiredRoll - roll, deltaTime);
        const pitchRate = this.pitchPID.update(desiredPitch - pitch, deltaTime);
        const yawRate = this.controlInputs.yaw - (this.angularVelocity.y * 0.1);
        
        const baseThrust = this.controlInputs.thrust;
        const rollControl = rollRate * 0.2;
        const pitchControl = pitchRate * 0.2;
        const yawControl = yawRate * 0.1;
        
        this.rotorThrustsTarget[0] = baseThrust - rollControl - pitchControl + yawControl;
        this.rotorThrustsTarget[1] = baseThrust + rollControl - pitchControl - yawControl;
        this.rotorThrustsTarget[2] = baseThrust - rollControl + pitchControl - yawControl;
        this.rotorThrustsTarget[3] = baseThrust + rollControl + pitchControl + yawControl;
        
        for (let i = 0; i < 4; i++) {
            this.rotorThrustsTarget[i] = Math.max(0, Math.min(1, this.rotorThrustsTarget[i]));
        }
    }
    
    checkCollisions() {
        let didCrash = false;
        
        if (this.position.y < 0.1) {
            this.position.y = 0.1;
            if (this.velocity.y < -3.0) { didCrash = true; }
            else { this.velocity.y = Math.abs(this.velocity.y) * 0.2; }
        }
        
        if (this.position.y > 14.5) {
            this.position.y = 14.5;
            this.velocity.y = Math.min(0, this.velocity.y) * -0.3;
            // Ceiling hit crashes during training too — teaches altitude limits
            didCrash = true;
        }
        
        if (Math.abs(this.position.x) > 29) {
            this.position.x = Math.sign(this.position.x) * 29;
            this.velocity.x = -this.velocity.x * 0.3;
            didCrash = true; // Crash on wall hit during training — must learn boundaries
        }
        
        if (Math.abs(this.position.z) > 19) {
            this.position.z = Math.sign(this.position.z) * 19;
            this.velocity.z = -this.velocity.z * 0.3;
            didCrash = true; // Crash on wall hit during training — must learn boundaries
        }
        
        if (didCrash && !this.crashed) this.crash("Collision with boundary");
    }
    
    crash(reason) {
        if (this.crashed || this.isDestroyed) return;
        this.crashed = true;
        console.log(`Drone ${this.id} crashed: ${reason}`);
        this.body.material.color.set(0xff0000);
        
        if (!window.trainingEnabled) {
            clearTimeout(this.crashTimeout);
            this.crashTimeout = setTimeout(() => this.reset(), 1000);
        }
    }
    
    reset() {
        this.resetWithPosition({ x: 0, y: 1, z: 0 });
    }
    
    resetWithPosition(position) {
        this.position.set(position.x, position.y, position.z);
        this.rotation.set(0, 0, 0);
        this.quaternion.identity();
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.rotorThrusts = [0, 0, 0, 0];
        this.rotorThrustsTarget = [0, 0, 0, 0];
        this.externalForce.set(0, 0, 0);
        
        this.rollPID.reset();
        this.pitchPID.reset();
        this.yawPID.reset();
        this.altitudePID.reset();
        
        this.controlInputs = { roll: 0, pitch: 0, yaw: 0, thrust: 0 };
        
        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);
        
        this.crashed = false;
        this.health = 100;
        this.isDestroyed = false;
        this.shotBy = null;
        this.weaponCooldown = 0;
        this.isShooting = false;
        
        for (const p of this.projectiles) this.scene.remove(p.mesh);
        this.projectiles = [];
        
        // Clean trail particles
        for (const tp of this.trailParticles) this.scene.remove(tp.mesh);
        this.trailParticles = [];
        
        this.detectedDrones = [];
        this.nearestDrone = null;
        this.nearestDroneDistance = Infinity;
        
        this.body.material.color.set(this.color);
        this._drawHealthBar();
    }
    
    setInitialRotation(x, y, z) {
        this.rotation.set(x, y, z);
        this.quaternion.setFromEuler(this.rotation);
        this.mesh.quaternion.copy(this.quaternion);
    }
    
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
            weaponCooldown: this.weaponCooldown,
            ceilingDistance: 15 - this.position.y,
            floorDistance: this.position.y
        };
        
        if (this.nearestDrone) {
            state.nearestDroneDistance = this.nearestDroneDistance;
            state.nearestDroneDirection = this.nearestDroneDirection.clone();
            state.nearestDroneId = this.nearestDrone.id;
            state.nearestDrone = this.nearestDrone;
        } else {
            state.nearestDroneDistance = null;
            state.nearestDroneDirection = null;
            state.nearestDroneId = null;
            state.nearestDrone = null;
        }
        
        return state;
    }
    
    updateVisionCone() {
        if (!this.visionCone) return;
        
        if (this.detectedDrones.length > 0) {
            this.visionCone.material.opacity = 0.3;
            this.visionConeWireframe.material.opacity = 0.7;
            
            if (this.nearestDrone) {
                const droneForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
                const targetAlignment = droneForward.dot(this.nearestDroneDirection);
                
                if (targetAlignment > 0.9) {
                    this.visionCone.material.color.set(0xff0000);
                    this.visionConeWireframe.material.color.set(0xff0000);
                } else {
                    this.visionCone.material.color.set(this.color);
                    this.visionConeWireframe.material.color.set(this.color);
                }
            }
        } else {
            this.visionCone.material.opacity = 0.1;
            this.visionConeWireframe.material.opacity = 0.3;
            this.visionCone.material.color.set(this.color);
            this.visionConeWireframe.material.color.set(this.color);
        }
    }
}

// ─── PID Controller ──────────────────────────────────────────────────
class PIDController {
    constructor(kp, ki, kd) {
        this.kp = kp;
        this.ki = ki;
        this.kd = kd;
        this.integral = 0;
        this.previousError = 0;
        this.output = 0;
        this.integralLimit = 1.0;
        this.outputLimit = 1.0;
    }
    
    update(error, dt) {
        const p = this.kp * error;
        this.integral += error * dt;
        this.integral = Math.max(-this.integralLimit, Math.min(this.integralLimit, this.integral));
        const i = this.ki * this.integral;
        const derivative = (error - this.previousError) / dt;
        const d = this.kd * derivative;
        this.output = Math.max(-this.outputLimit, Math.min(this.outputLimit, p + i + d));
        this.previousError = error;
        return this.output;
    }
    
    reset() {
        this.integral = 0;
        this.previousError = 0;
        this.output = 0;
    }
}
