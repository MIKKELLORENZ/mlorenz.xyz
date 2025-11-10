// Greek Garden with Floating Musical Bowls
class FloatingBowlsGarden {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.bowls = [];
        this.audioContext = null;
        this.container = document.getElementById('container');
        this.columnPositions = [];
        this.windField = { time: 0 }; // Wind simulation for water currents
        this.grassBlades = []; // For animated grass
        this.ambientParticles = []; // For ambient effects
        
        // Lydian scale frequencies (C Lydian: C D E F# G A B) - pitched up one octave
        this.lydianScale = [523.25, 587.33, 659.25, 739.99, 783.99, 880.00, 987.77];
        
        this.init();
        this.createGarden();
        this.createPond();
        this.createBowls();
        this.setupAudio();
        this.animate();
        this.setupControls();
    }

    init() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x87CEEB, 50, 200);
    this.raycaster = new THREE.Raycaster();

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 15, 25);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x87CEEB, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Softer, more natural lighting and color
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        this.scene.add(directionalLight);
    }

    createGarden() {
        // Ground
        const groundGeometry = new THREE.PlaneGeometry(120, 120);
        const groundMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x4a7c59,
            transparent: true,
            opacity: 0.8
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Greek columns
        this.createColumns();
        
        // Fencing around the garden
        this.createFencing();
        
        // Trees and vegetation
        this.createVegetation();
        
        // Greek architectural elements
        this.createArchitecture();
        
        // Ambient effects
        this.createAmbientEffects();
    }

    createColumns() {
        // Store column positions to avoid tree overlap - moved further out
        this.columnPositions = [
            [-40, 0, -30], [40, 0, -30], [-40, 0, 30], [40, 0, 30],
            [-30, 0, -40], [30, 0, -40], [-30, 0, 40], [30, 0, 40]
        ];

        this.columnPositions.forEach(pos => {
            // Column base
            const baseGeometry = new THREE.CylinderGeometry(2, 2.5, 1, 8);
            const baseMaterial = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
            const base = new THREE.Mesh(baseGeometry, baseMaterial);
            base.position.set(pos[0], 0.5, pos[2]);
            base.castShadow = true;
            base.receiveShadow = true;
            this.scene.add(base);

            // Column shaft
            const shaftGeometry = new THREE.CylinderGeometry(1.8, 1.8, 12, 16);
            const shaftMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
            const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
            shaft.position.set(pos[0], 7, pos[2]);
            shaft.castShadow = true;
            shaft.receiveShadow = true;
            this.scene.add(shaft);

            // Column capital
            const capitalGeometry = new THREE.CylinderGeometry(2.2, 1.8, 2, 8);
            const capitalMaterial = new THREE.MeshLambertMaterial({ color: 0xf8f8f8 });
            const capital = new THREE.Mesh(capitalGeometry, capitalMaterial);
            capital.position.set(pos[0], 14, pos[2]);
            capital.castShadow = true;
            capital.receiveShadow = true;
            this.scene.add(capital);
        });
    }

    createFencing() {
        const fenceRadius = 55;
        const fenceHeight = 3;
        const posts = 24;

        for (let i = 0; i < posts; i++) {
            const angle = (i / posts) * Math.PI * 2;
            const x = Math.cos(angle) * fenceRadius;
            const z = Math.sin(angle) * fenceRadius;

            // Fence post
            const postGeometry = new THREE.CylinderGeometry(0.1, 0.1, fenceHeight, 8);
            const postMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
            const post = new THREE.Mesh(postGeometry, postMaterial);
            post.position.set(x, fenceHeight / 2, z);
            post.castShadow = true;
            this.scene.add(post);

            // Fence rail
            if (i < posts - 1) {
                const nextAngle = ((i + 1) / posts) * Math.PI * 2;
                const nextX = Math.cos(nextAngle) * fenceRadius;
                const nextZ = Math.sin(nextAngle) * fenceRadius;

                const start = new THREE.Vector3(x, fenceHeight * 0.7, z);
                const end = new THREE.Vector3(nextX, fenceHeight * 0.7, nextZ);
                const dir = end.clone().sub(start);
                const distance = dir.length();
                if (distance <= 0.0001) return;
                dir.normalize();

                const railGeometry = new THREE.CylinderGeometry(0.05, 0.05, distance, 8);
                const railMaterial = new THREE.MeshLambertMaterial({ color: 0x654321 });
                const rail = new THREE.Mesh(railGeometry, railMaterial);

                // Align cylinder Y-axis with the segment direction
                rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                rail.position.copy(start.clone().add(end).multiplyScalar(0.5));
                rail.castShadow = true;
                this.scene.add(rail);
            }
        }
    }

    createVegetation() {
        // Trees - check distance from columns to avoid overlap
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            const radius = 35 + Math.random() * 12;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;

            // Check if too close to any column
            let tooClose = false;
            for (let col of this.columnPositions) {
                const distance = Math.sqrt((x - col[0]) ** 2 + (z - col[2]) ** 2);
                if (distance < 8) {
                    tooClose = true;
                    break;
                }
            }
            
            if (tooClose) continue;

            // Tree trunk
            const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.8, 8, 8);
            const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.set(x, 4, z);
            trunk.castShadow = true;
            this.scene.add(trunk);

            // Tree foliage
            const foliageGeometry = new THREE.SphereGeometry(4 + Math.random() * 2, 8, 6);
            const foliageMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
            const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
            foliage.position.set(x, 10 + Math.random() * 2, z);
            foliage.castShadow = true;
            this.scene.add(foliage);
        }

        // Bushes around the pond
        for (let i = 0; i < 24; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 12 + Math.random() * 4;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;

            const bushGeometry = new THREE.SphereGeometry(1 + Math.random() * 0.8, 6, 4);
            const bushMaterial = new THREE.MeshLambertMaterial({ color: 0x32CD32 });
            const bush = new THREE.Mesh(bushGeometry, bushMaterial);
            bush.position.set(x, 1, z);
            bush.castShadow = true;
            this.scene.add(bush);
        }
    }

    createArchitecture() {
        // Marble benches with more detail
        const benchPositions = [[-18, 0, -18], [18, 0, -18], [-18, 0, 18], [18, 0, 18]];
        
        benchPositions.forEach(pos => {
            // Main bench
            const benchGeometry = new THREE.BoxGeometry(6, 1, 2);
            const benchMaterial = new THREE.MeshLambertMaterial({ color: 0xf5f5dc });
            const bench = new THREE.Mesh(benchGeometry, benchMaterial);
            bench.position.set(pos[0], 0.5, pos[2]);
            bench.castShadow = true;
            bench.receiveShadow = true;
            this.scene.add(bench);
            
            // Bench legs
            for (let i = 0; i < 2; i++) {
                const legGeometry = new THREE.BoxGeometry(0.3, 1, 1.5);
                const leg = new THREE.Mesh(legGeometry, benchMaterial);
                leg.position.set(pos[0] + (i === 0 ? -2.5 : 2.5), 0.5, pos[2]);
                leg.castShadow = true;
                this.scene.add(leg);
            }
        });
        
        // Add Greek urns/amphoras
        const urnPositions = [[-25, 0, 0], [25, 0, 0], [0, 0, -25], [0, 0, 25]];
        urnPositions.forEach(pos => {
            // Urn base
            const baseGeometry = new THREE.CylinderGeometry(1, 1.5, 0.5, 12);
            const urnMaterial = new THREE.MeshLambertMaterial({ color: 0xd2b48c });
            const base = new THREE.Mesh(baseGeometry, urnMaterial);
            base.position.set(pos[0], 0.25, pos[2]);
            base.castShadow = true;
            this.scene.add(base);
            
            // Urn body
            const bodyGeometry = new THREE.CylinderGeometry(0.8, 1.2, 3, 12);
            const body = new THREE.Mesh(bodyGeometry, urnMaterial);
            body.position.set(pos[0], 2, pos[2]);
            body.castShadow = true;
            this.scene.add(body);
            
            // Urn neck
            const neckGeometry = new THREE.CylinderGeometry(0.4, 0.6, 1, 12);
            const neck = new THREE.Mesh(neckGeometry, urnMaterial);
            neck.position.set(pos[0], 4, pos[2]);
            neck.castShadow = true;
            this.scene.add(neck);
        });
        
        // Add stone pathways
        this.createPathways();
    }
    
    createPathways() {
        // Circular stone path around pond
        const pathRadius = 13;
        const stones = 36;
        
        for (let i = 0; i < stones; i++) {
            const angle = (i / stones) * Math.PI * 2;
            const x = Math.cos(angle) * pathRadius;
            const z = Math.sin(angle) * pathRadius;
            
            const stoneGeometry = new THREE.CylinderGeometry(0.8, 0.9, 0.1, 6);
            const stoneMaterial = new THREE.MeshLambertMaterial({ 
                color: 0xc0c0c0,
                transparent: true,
                opacity: 0.9
            });
            const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
            stone.position.set(x, 0.05, z);
            stone.rotation.y = Math.random() * Math.PI;
            stone.receiveShadow = true;
            this.scene.add(stone);
        }
    }
    
    createAmbientEffects() {
        // Animated grass blades
        this.createGrass();
        
        // Floating particles for atmosphere
        this.createAtmosphericParticles();
        
        // Wind swirls
        this.createWindSwirls();
    }
    
    createGrass() {
        // Create animated grass around the garden
        for (let i = 0; i < 200; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = 15 + Math.random() * 35;
            const x = Math.cos(angle) * distance;
            const z = Math.sin(angle) * distance;
            
            // Skip if too close to columns or structures
            let tooClose = false;
            for (let col of this.columnPositions) {
                if (Math.sqrt((x - col[0]) ** 2 + (z - col[2]) ** 2) < 6) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) continue;
            
            const grassHeight = 0.3 + Math.random() * 0.4;
            const grassGeometry = new THREE.CylinderGeometry(0.01, 0.02, grassHeight, 4);
            const grassMaterial = new THREE.MeshLambertMaterial({ 
                color: 0x228B22,
                transparent: true,
                opacity: 0.8
            });
            const grass = new THREE.Mesh(grassGeometry, grassMaterial);
            grass.position.set(x, grassHeight / 2, z);
            grass.userData = {
                originalPosition: { x, z },
                swayPhase: Math.random() * Math.PI * 2
            };
            
            this.grassBlades.push(grass);
            this.scene.add(grass);
        }
    }
    
    createAtmosphericParticles() {
        // Create floating dust/pollen particles
        for (let i = 0; i < 50; i++) {
            const particleGeometry = new THREE.SphereGeometry(0.02, 4, 4);
            const particleMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xffffcc,
                transparent: true,
                opacity: 0.3
            });
            const particle = new THREE.Mesh(particleGeometry, particleMaterial);
            
            particle.position.set(
                (Math.random() - 0.5) * 100,
                Math.random() * 20 + 2,
                (Math.random() - 0.5) * 100
            );
            
            particle.userData = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.02,
                    (Math.random() - 0.5) * 0.01,
                    (Math.random() - 0.5) * 0.02
                ),
                phase: Math.random() * Math.PI * 2
            };
            
            this.ambientParticles.push(particle);
            this.scene.add(particle);
        }
    }
    
    createWindSwirls() {
        // Create subtle wind effect indicators on water surface
        for (let i = 0; i < 8; i++) {
            const swirlGeometry = new THREE.RingGeometry(0.5, 0.7, 16);
            const swirlMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x87CEEB,
                transparent: true,
                opacity: 0.1,
                side: THREE.DoubleSide
            });
            const swirl = new THREE.Mesh(swirlGeometry, swirlMaterial);
            
            const angle = (i / 8) * Math.PI * 2;
            const radius = 2 + Math.random() * 6;
            swirl.position.set(
                Math.cos(angle) * radius,
                0.16, // Just above water
                Math.sin(angle) * radius
            );
            swirl.rotation.x = -Math.PI / 2;
            
            swirl.userData = {
                rotationSpeed: 0.01 + Math.random() * 0.02,
                originalPosition: swirl.position.clone(),
                phase: Math.random() * Math.PI * 2
            };
            
            this.scene.add(swirl);
        }
    }

    createPond() {
        // Pond water with texture for wind/currents
        const pondGeometry = new THREE.CircleGeometry(10, 64);
        const pondMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x4169E1,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            shininess: 100
        });
        
        this.pondWater = new THREE.Mesh(pondGeometry, pondMaterial);
        this.pondWater.rotation.x = -Math.PI / 2;
        this.pondWater.position.y = 0.15; // Slightly higher for bowl floating
        this.pondWater.receiveShadow = true;
        this.scene.add(this.pondWater);

        // Add subtle wave animation to water
        this.pondWater.userData = { originalVertices: [] };
        const vertices = pondGeometry.attributes.position.array;
        for (let i = 0; i < vertices.length; i += 3) {
            this.pondWater.userData.originalVertices.push({
                x: vertices[i],
                y: vertices[i + 1],
                z: vertices[i + 2]
            });
        }

        // Pond edge
        const edgeGeometry = new THREE.RingGeometry(10, 11.5, 32);
        const edgeMaterial = new THREE.MeshLambertMaterial({ color: 0xf5f5dc });
        const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
        edge.rotation.x = -Math.PI / 2;
        edge.position.y = 0.1;
        edge.receiveShadow = true;
        this.scene.add(edge);
    }

    createBowls() {
        const colors = [
            0xFFD700, 0xFF6B35, 0xF7931E, 0xFFE135, 0xC5A572,
            0xB8860B, 0xCD853F, 0xD2691E, 0xF4A460, 0xDEB887,
            0xF5DEB3, 0xFFE4B5, 0xFFDAB9, 0xEEE8AA, 0xF0E68C
        ];

        for (let i = 0; i < 15; i++) {
            const angle = (i / 15) * Math.PI * 2;
            const radius = 2 + Math.random() * 6;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;

            // Bowl geometry - made taller with proper thickness
            const bowlSize = 0.4 + Math.random() * 0.6;
            const bowlHeight = bowlSize * 2.5; // 250% taller
            const thickness = 0.05; // Bowl thickness
            
            // Create outer bowl shape
            const outerPoints = [];
            for (let j = 0; j <= 12; j++) {
                const t = j / 12;
                const r = bowlSize * Math.sin(t * Math.PI * 0.6);
                const y = -bowlHeight * Math.cos(t * Math.PI * 0.5) + bowlHeight;
                outerPoints.push(new THREE.Vector2(r, y));
            }
            
            // Create inner bowl shape (thinner)
            const innerPoints = [];
            for (let j = 0; j <= 12; j++) {
                const t = j / 12;
                const r = Math.max(0, (bowlSize - thickness) * Math.sin(t * Math.PI * 0.6));
                const y = -bowlHeight * Math.cos(t * Math.PI * 0.5) + bowlHeight + thickness;
                innerPoints.push(new THREE.Vector2(r, y));
            }
            
            // Combine points for solid bowl with thickness
            const allPoints = [...outerPoints];
            // Add inner surface (reversed)
            for (let j = innerPoints.length - 1; j >= 0; j--) {
                allPoints.push(innerPoints[j]);
            }
            
            const bowlGeometry = new THREE.LatheGeometry(outerPoints, 24);
            const bowlMaterial = new THREE.MeshPhongMaterial({ 
                color: colors[i],
                shininess: 100,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide
            });
            
            const bowl = new THREE.Mesh(bowlGeometry, bowlMaterial);
            // Position bowls to float ON the water surface
            bowl.position.set(x, 0.2 + bowlHeight * 0.1, z); // Adjusted to sit on water
            bowl.castShadow = true;
            bowl.receiveShadow = true;
            
            // Physics properties with momentum conservation - slower floating
            bowl.userData = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.005, // Reduced speed by 3x
                    0,
                    (Math.random() - 0.5) * 0.005  // Reduced speed by 3x
                ),
                size: bowlSize,
                mass: bowlSize * bowlSize * 10, // Heavier for more realistic floating
                // Use Lydian scale frequencies
                frequency: this.lydianScale[i % this.lydianScale.length] * (0.8 + bowlSize * 0.4),
                lastCollision: 0,
                soundGain: null, // For sustained audio
                oscillator: null,
                isVibrating: false,
                vibratingUntil: 0
            };
            
            this.bowls.push(bowl);
            this.scene.add(bowl);
        }
    }

    setupAudio() {
        // Initialize Web Audio API
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Enable audio on first user interaction
        const unlock = () => {
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        };
        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('pointerdown', unlock, { once: true });
    }

    playBowlSound(frequency, duration = 3.0, intensity = 1.0) {
        if (!this.audioContext) return;

        // Create multiple oscillators for richer bowl sound
        const oscillators = [];
        const gainNodes = [];
        
        // Fundamental frequency
        const fundamental = this.audioContext.createOscillator();
        const fundamentalGain = this.audioContext.createGain();
        
        // First harmonic (slight detune for beating effect)
        const harmonic1 = this.audioContext.createOscillator();
        const harmonic1Gain = this.audioContext.createGain();
        
        // Second harmonic
        const harmonic2 = this.audioContext.createOscillator();
        const harmonic2Gain = this.audioContext.createGain();
        
        // Connect oscillators
        fundamental.connect(fundamentalGain);
        harmonic1.connect(harmonic1Gain);
        harmonic2.connect(harmonic2Gain);
        
        fundamentalGain.connect(this.audioContext.destination);
        harmonic1Gain.connect(this.audioContext.destination);
        harmonic2Gain.connect(this.audioContext.destination);
        
        // Set frequencies
        fundamental.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        harmonic1.frequency.setValueAtTime(frequency * 1.003, this.audioContext.currentTime); // Slight detune
        harmonic2.frequency.setValueAtTime(frequency * 2.1, this.audioContext.currentTime); // Upper harmonic
        
        fundamental.type = 'sine';
        harmonic1.type = 'sine';
        harmonic2.type = 'sine';
        
        // Natural bowl sound envelope with sustain
        const attackTime = 0.05;
        const sustainLevel = 0.08 * intensity;
        const releaseTime = duration * 0.8;
        
        // Fundamental gain envelope
        fundamentalGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        fundamentalGain.gain.linearRampToValueAtTime(sustainLevel, this.audioContext.currentTime + attackTime);
        fundamentalGain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
        
        // Harmonic gain envelopes (quieter)
        harmonic1Gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        harmonic1Gain.gain.linearRampToValueAtTime(sustainLevel * 0.3, this.audioContext.currentTime + attackTime);
        harmonic1Gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration * 0.7);
        
        harmonic2Gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        harmonic2Gain.gain.linearRampToValueAtTime(sustainLevel * 0.15, this.audioContext.currentTime + attackTime);
        harmonic2Gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration * 0.5);
        
        // Start and stop oscillators
        const startTime = this.audioContext.currentTime;
        fundamental.start(startTime);
        harmonic1.start(startTime);
        harmonic2.start(startTime);
        
        fundamental.stop(startTime + duration);
        harmonic1.stop(startTime + duration * 0.7);
        harmonic2.stop(startTime + duration * 0.5);
    }

    createRipples(bowlPosition, frequency) {
        // Add subtle ripples around vibrating bowls
        if (!this.pondWater || !this.pondWater.userData.originalVertices) return;
        
        const vertices = this.pondWater.geometry.attributes.position.array;
        const originalVertices = this.pondWater.userData.originalVertices;
        const currentTime = Date.now();
        
        for (let i = 0; i < originalVertices.length; i++) {
            const orig = originalVertices[i];
            const distance = Math.sqrt(
                (orig.x - bowlPosition.x) ** 2 + 
                (orig.z - bowlPosition.z) ** 2
            );
            
            if (distance < 3) { // Only affect nearby water
                const rippleIntensity = Math.max(0, (3 - distance) / 3);
                const rippleFreq = frequency / 100; // Convert to reasonable wave frequency
                const rippleHeight = 0.01 * rippleIntensity * Math.sin(currentTime * 0.01 * rippleFreq);
                // Water mesh is rotated -90deg around X, so object Z maps to world Y (up)
                vertices[i * 3 + 2] = orig.z + rippleHeight;
            }
        }
        this.pondWater.geometry.attributes.position.needsUpdate = true;
        this.pondWater.geometry.computeVertexNormals();
    }

    updateWaterAnimation() {
        // Update wind field for water currents
        this.windField.time += 0.01;
        
        // Animate water surface to show currents
    if (this.pondWater && this.pondWater.userData.originalVertices) {
            const vertices = this.pondWater.geometry.attributes.position.array;
            const originalVertices = this.pondWater.userData.originalVertices;
            
            for (let i = 0; i < originalVertices.length; i++) {
                const orig = originalVertices[i];
                const distance = Math.sqrt(orig.x * orig.x + orig.z * orig.z);
                
                if (distance < 9.5) { // Only animate water inside pond
            const waveHeight = 0.02 * Math.sin(this.windField.time * 2 + distance * 0.5);
            // Modify object Z to change world Y due to -90deg X rotation
            vertices[i * 3 + 2] = orig.z + waveHeight;
                }
            }
            
        this.pondWater.geometry.attributes.position.needsUpdate = true;
        this.pondWater.geometry.computeVertexNormals();
        }
    }

    getWindForce(position) {
        // Generate wind force based on position and time for natural current simulation
        const x = position.x;
        const z = position.z;
        const t = this.windField.time;
        
        // Much gentler wind forces for realistic water floating
        const windX = 0.0003 * Math.sin(t * 0.3 + x * 0.05) * Math.cos(t * 0.25 + z * 0.05);
        const windZ = 0.0003 * Math.cos(t * 0.35 + x * 0.05) * Math.sin(t * 0.3 + z * 0.05);
        
        return new THREE.Vector3(windX, 0, windZ);
    }

    updateBowlPhysics() {
        const currentTime = Date.now();
        
        // Update water animation
        this.updateWaterAnimation();
        
        // Update ambient effects
        this.updateAmbientEffects();
        
        this.bowls.forEach((bowl, index) => {
            const userData = bowl.userData;
            
            // Apply wind/current forces
            const windForce = this.getWindForce(bowl.position);
            userData.velocity.add(windForce);
            
            // Update position based on velocity (momentum conservation)
            bowl.position.add(userData.velocity);
            
            // Gentle floating motion on water surface
            const floatHeight = 0.25 + Math.sin(currentTime * 0.002 + index * 0.5) * 0.05;
            bowl.position.y = floatHeight;
            
            // Subtle rotation
            bowl.rotation.y += userData.velocity.length() * 2;
            bowl.rotation.x = Math.sin(currentTime * 0.001 + index) * 0.1;
            
            // Boundary collision (pond edges) with proper momentum conservation
            const distance = Math.sqrt(bowl.position.x ** 2 + bowl.position.z ** 2);
            const pondRadius = 10.0;
            const edgeLimit = pondRadius - Math.max(0.5, userData.size * 0.6);
            if (distance > edgeLimit) {
                const normal = new THREE.Vector3(bowl.position.x, 0, bowl.position.z).normalize();
                
                // Reflect velocity with energy conservation
                const velocityDotNormal = userData.velocity.dot(normal);
                const reflection = normal.clone().multiplyScalar(2 * velocityDotNormal);
                userData.velocity.sub(reflection);
                userData.velocity.multiplyScalar(0.85); // Some energy loss on collision
                
                // Move bowl back inside pond
                const penetration = distance - edgeLimit;
                bowl.position.sub(normal.clone().multiplyScalar(penetration));
                
                // Play edge collision sound (less frequently)
                if (currentTime - userData.lastCollision > 800) {
                    this.playBowlSound(userData.frequency * 0.8, 2.0, 0.6);
                    userData.lastCollision = currentTime;
                }
            }
            
            // Bowl-to-bowl collisions with proper momentum conservation
            for (let j = index + 1; j < this.bowls.length; j++) {
                const otherBowl = this.bowls[j];
                const otherUserData = otherBowl.userData;
                const distance = bowl.position.distanceTo(otherBowl.position);
                const minDistance = (userData.size + otherUserData.size) * 1.8;
                
                if (distance < minDistance && distance > 0.01) {
                    // Calculate collision normal
                    const normal = bowl.position.clone().sub(otherBowl.position);
                    normal.y = 0; // Keep collision in horizontal plane
                    normal.normalize();
                    
                    // Relative velocity in collision normal direction
                    const relativeVelocity = userData.velocity.clone().sub(otherUserData.velocity);
                    const velocityAlongNormal = relativeVelocity.dot(normal);
                    
                    // Do not resolve if objects are separating
                    if (velocityAlongNormal > 0) continue;
                    // Calculate collision impulse with restitution
                    const e = 0.6; // coefficient of restitution (0=inelastic,1=elastic)
                    const invMass1 = 1 / userData.mass;
                    const invMass2 = 1 / otherUserData.mass;
                    const j = -(1 + e) * velocityAlongNormal / (invMass1 + invMass2);
                    const impulse = normal.clone().multiplyScalar(j);
                    // Apply impulse
                    userData.velocity.add(impulse.clone().multiplyScalar(invMass1));
                    otherUserData.velocity.sub(impulse.clone().multiplyScalar(invMass2));
                    
                    // Separate overlapping bowls
                    const overlap = minDistance - distance;
                    const separation = normal.clone().multiplyScalar(overlap * 0.5);
                    bowl.position.add(separation);
                    otherBowl.position.sub(separation);
                    
                    // Play collision sounds with intensity based on collision velocity
                    const collisionIntensity = Math.min(Math.abs(j) * 0.02, 1.0);
                    
                    if (currentTime - userData.lastCollision > 400) {
                        this.playBowlSound(userData.frequency, 2.5, collisionIntensity);
                        userData.lastCollision = currentTime;
                        userData.isVibrating = true;
                        userData.vibratingUntil = currentTime + 2500; // Vibrate for 2.5 seconds
                    }
                    if (currentTime - otherUserData.lastCollision > 400) {
                        this.playBowlSound(otherUserData.frequency, 2.5, collisionIntensity);
                        otherUserData.lastCollision = currentTime;
                        otherUserData.isVibrating = true;
                        otherUserData.vibratingUntil = currentTime + 2500; // Vibrate for 2.5 seconds
                    }
                }
            }
            
            // Natural damping (water resistance) - much stronger for realistic floating
            userData.velocity.multiplyScalar(0.995); // Water drag
            
            // Check if bowl is vibrating and update ripple effects
            if (userData.isVibrating && currentTime < userData.vibratingUntil) {
                this.createRipples(bowl.position, userData.frequency);
            } else {
                userData.isVibrating = false;
            }
            
            // Prevent bowls from becoming completely stationary
            if (userData.velocity.length() < 0.0005) { // Lower threshold
                userData.velocity.add(new THREE.Vector3(
                    (Math.random() - 0.5) * 0.0008, // Smaller random forces
                    0,
                    (Math.random() - 0.5) * 0.0008
                ));
            }
        });
    }
    
    updateAmbientEffects() {
        const currentTime = Date.now();
        
        // Animate grass swaying in the wind
        this.grassBlades.forEach(grass => {
            const windStrength = 0.1 * Math.sin(currentTime * 0.001 + grass.userData.swayPhase);
            grass.rotation.z = windStrength;
            grass.rotation.x = windStrength * 0.5;
        });
        
        // Animate floating particles
        this.ambientParticles.forEach(particle => {
            particle.position.add(particle.userData.velocity);
            
            // Gentle floating motion
            particle.position.y += 0.01 * Math.sin(currentTime * 0.002 + particle.userData.phase);
            
            // Wrap particles around the scene
            if (particle.position.x > 50) particle.position.x = -50;
            if (particle.position.x < -50) particle.position.x = 50;
            if (particle.position.z > 50) particle.position.z = -50;
            if (particle.position.z < -50) particle.position.z = 50;
            if (particle.position.y > 25) particle.position.y = 2;
            if (particle.position.y < 1) particle.position.y = 25;
        });
        
        // Animate wind swirls
        this.scene.children.forEach(child => {
            if (child.userData && child.userData.rotationSpeed) {
                child.rotation.z += child.userData.rotationSpeed;
                
                // Gentle movement
                const offset = 0.5 * Math.sin(currentTime * 0.001 + child.userData.phase);
                child.position.x = child.userData.originalPosition.x + offset;
                child.position.z = child.userData.originalPosition.z + offset * 0.7;
                
                // Fade in and out
                child.material.opacity = 0.05 + 0.05 * Math.sin(currentTime * 0.003 + child.userData.phase);
            }
        });
    }

    setupControls() {
        // Mouse controls for camera
        let mouseDown = false;
        let mouseX = 0;
        let mouseY = 0;
        
        this.container.addEventListener('mousedown', (e) => {
            mouseDown = true;
            mouseX = e.clientX;
            mouseY = e.clientY;
        });
        
        this.container.addEventListener('mouseup', () => {
            mouseDown = false;
        });
        
        this.container.addEventListener('mousemove', (e) => {
            if (!mouseDown) return;
            
            const deltaX = e.clientX - mouseX;
            const deltaY = e.clientY - mouseY;
            
            // Rotate camera around the pond
            const spherical = new THREE.Spherical();
            spherical.setFromVector3(this.camera.position);
            spherical.theta -= deltaX * 0.005;
            spherical.phi += deltaY * 0.005;
            spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
            
            this.camera.position.setFromSpherical(spherical);
            this.camera.lookAt(0, 0, 0);
            
            mouseX = e.clientX;
            mouseY = e.clientY;
        });
        
        // Zoom with mouse wheel
        this.container.addEventListener('wheel', (e) => {
            const scale = e.deltaY > 0 ? 1.1 : 0.9;
            const currentLen = this.camera.position.length();
            const desired = currentLen * scale;
            const clamped = Math.max(12, Math.min(80, desired));
            this.camera.position.setLength(clamped);
            this.camera.position.y = Math.max(5, this.camera.position.y);
        });

        // Click bowls to ring
        this.container.addEventListener('click', (e) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -(((e.clientY - rect.top) / rect.height) * 2 - 1)
            );
            this.raycaster.setFromCamera(ndc, this.camera);
            const hits = this.raycaster.intersectObjects(this.bowls, false);
            if (hits.length > 0) {
                const hit = hits[0];
                const bowl = hit.object;
                const u = bowl.userData;
                this.playBowlSound(u.frequency, 2.5, 0.9);
                u.isVibrating = true;
                u.vibratingUntil = Date.now() + 2000;
                // Add a tiny impulse away from click point to create motion
                const fromCam = new THREE.Vector3().subVectors(bowl.position, this.camera.position).setY(0).normalize();
                u.velocity.add(fromCam.multiplyScalar(0.01));
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        this.updateBowlPhysics();
        this.renderer.render(this.scene, this.camera);
    }

    handleResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
}

// Initialize the garden when the page loads
window.addEventListener('load', () => {
    const garden = new FloatingBowlsGarden();
    
    window.addEventListener('resize', () => {
        garden.handleResize();
    });
});

// Remove loading text
window.addEventListener('DOMContentLoaded', () => {
    const loading = document.querySelector('.loading');
    if (loading) loading.remove();
});