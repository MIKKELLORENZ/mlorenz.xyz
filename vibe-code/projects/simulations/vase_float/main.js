// Enhanced Greek Garden with Floating Musical Bowls
class FloatingBowlsGarden {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.bowls = [];
        this.lilyPads = [];
        this.lotusFlowers = [];
        this.fireflies = [];
        this.audioContext = null;
        this.masterGain = null;
        this.reverbInput = null;
        this.dryGain = null;
        this.wetGain = null;
        this.container = document.getElementById('container');
        this.columnPositions = [];
        this.windField = { time: 0 };
        this.windState = {
            direction: Math.random() * Math.PI * 2,
            targetDirection: Math.random() * Math.PI * 2,
            strength: 0.015,
            targetStrength: 0.015,
            changeTimer: 0,
            changeInterval: 8 + Math.random() * 12
        };
        this.grassBlades = [];
        this.ambientParticles = [];
        this.koiFish = [];
        this.rcBoat = null;
        this.boatMode = false;
        this.boatKeys = { left: false, right: false, forward: false, backward: false };
        this.boatAngle = 0;
        this.boatSpeed = 0;
        this.clock = new THREE.Clock();
        this.elapsedTime = 0;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.draggedBowl = null;
        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.25);
        this.hoveredBowl = null;
        this.mouseDown = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.mouseMoved = false;
        this.orbit = {
            theta: 0, phi: 1.1, radius: 28,
            targetTheta: 0, targetPhi: 1.1, targetRadius: 28,
            autoOrbit: true, speed: 0.06
        };
        this.dayDuration = 150;
        this.nightDuration = 90;
        this.transitionDuration = 8;
        this.dayCycleTime = this.dayDuration * 0.5;
        this.dayProgress = 0.5;
        this.targetDayProgress = 0.5;
        this.isNight = false;
        this.isMuted = false;
        this.scales = {
            lydian:      { name: 'Lydian',      notes: [523.25, 587.33, 659.25, 739.99, 783.99, 880.00, 987.77] },
            mixolydian:  { name: 'Mixolydian',  notes: [523.25, 587.33, 659.25, 698.46, 783.99, 880.00, 932.33] },
            dorian:      { name: 'Dorian',       notes: [523.25, 587.33, 622.25, 698.46, 783.99, 880.00, 932.33] },
            pentatonic:  { name: 'Pentatonic',   notes: [523.25, 587.33, 659.25, 783.99, 880.00, 523.25*2, 587.33*2] },
            aeolian:     { name: 'Aeolian',      notes: [523.25, 587.33, 622.25, 698.46, 783.99, 830.61, 932.33] },
            phrygian:    { name: 'Phrygian',     notes: [523.25, 554.37, 622.25, 698.46, 783.99, 830.61, 932.33] }
        };
        this.scaleNames = ['lydian', 'mixolydian', 'dorian', 'pentatonic', 'aeolian', 'phrygian'];
        this.currentScaleIndex = 0;
        this.lydianScale = this.scales.lydian.notes;
        this.lights = {};

        this.init();
        this.createSkyDome();
        this.createGarden();
        this.createPond();
        this.createLilyPads();
        this.createBowls();
        this.createFireflies();
        this.createKoiFish();
        this.setupAudio();
        this.setupControls();
        this.setupBoatControls();
        this.setupUI();
        this.animate();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.006);
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
        this.updateCameraFromOrbit();

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x87CEEB, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.9;
        this.container.appendChild(this.renderer.domElement);

        this.lights.hemisphere = new THREE.HemisphereLight(0x87CEEB, 0x3a5f0b, 0.3);
        this.scene.add(this.lights.hemisphere);
        this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.2);
        this.scene.add(this.lights.ambient);
        this.lights.sun = new THREE.DirectionalLight(0xfff5e0, 0.6);
        this.lights.sun.position.set(40, 60, 30);
        this.lights.sun.castShadow = true;
        this.lights.sun.shadow.mapSize.width = 2048;
        this.lights.sun.shadow.mapSize.height = 2048;
        this.lights.sun.shadow.camera.near = 0.5;
        this.lights.sun.shadow.camera.far = 200;
        this.lights.sun.shadow.camera.left = -60;
        this.lights.sun.shadow.camera.right = 60;
        this.lights.sun.shadow.camera.top = 60;
        this.lights.sun.shadow.camera.bottom = -60;
        this.lights.sun.shadow.bias = -0.001;
        this.scene.add(this.lights.sun);
        this.lights.fill = new THREE.DirectionalLight(0xffe0c0, 0.15);
        this.lights.fill.position.set(-30, 20, -20);
        this.scene.add(this.lights.fill);
        this.lights.waterGlow = new THREE.PointLight(0x4488ff, 0.3, 20);
        this.lights.waterGlow.position.set(0, -0.5, 0);
        this.scene.add(this.lights.waterGlow);
    }

    updateCameraFromOrbit() {
        const x = this.orbit.radius * Math.sin(this.orbit.phi) * Math.sin(this.orbit.theta);
        const y = this.orbit.radius * Math.cos(this.orbit.phi);
        const z = this.orbit.radius * Math.sin(this.orbit.phi) * Math.cos(this.orbit.theta);
        this.camera.position.set(x, Math.max(3, y), z);
        this.camera.lookAt(0, 1, 0);
    }

    createSkyDome() {
        const skyGeo = new THREE.SphereGeometry(200, 32, 15);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x0066aa) },
                bottomColor: { value: new THREE.Color(0xc8e6f0) },
                offset: { value: 33 },
                exponent: { value: 0.6 }
            },
            vertexShader: [
                'varying vec3 vWorldPosition;',
                'void main() {',
                '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
                '  vWorldPosition = worldPosition.xyz;',
                '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
                '}'
            ].join('\n'),
            fragmentShader: [
                'uniform vec3 topColor;',
                'uniform vec3 bottomColor;',
                'uniform float offset;',
                'uniform float exponent;',
                'varying vec3 vWorldPosition;',
                'void main() {',
                '  float h = normalize(vWorldPosition + offset).y;',
                '  gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);',
                '}'
            ].join('\n'),
            side: THREE.BackSide,
            depthWrite: false
        });
        this.skyDome = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(this.skyDome);
    }

    createGarden() {
        const groundGeo = new THREE.PlaneGeometry(120, 120, 20, 20);
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a7c59, roughness: 0.9, metalness: 0.0 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.createColumns();
        this.createFencing();
        this.createVegetation();
        this.createArchitecture();
        this.createAmbientEffects();
    }

    createColumns() {
        this.columnPositions = [
            [-40, 0, -30], [40, 0, -30], [-40, 0, 30], [40, 0, 30],
            [-30, 0, -40], [30, 0, -40], [-30, 0, 40], [30, 0, 40]
        ];
        const marbleMat = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.35, metalness: 0.05 });
        this.columnPositions.forEach(pos => {
            const baseGeo = new THREE.CylinderGeometry(2, 2.5, 1, 12);
            const base = new THREE.Mesh(baseGeo, marbleMat);
            base.position.set(pos[0], 0.5, pos[2]);
            base.castShadow = true; base.receiveShadow = true;
            this.scene.add(base);
            const shaftGeo = new THREE.CylinderGeometry(1.6, 1.8, 12, 20);
            const shaft = new THREE.Mesh(shaftGeo, marbleMat);
            shaft.position.set(pos[0], 7, pos[2]);
            shaft.castShadow = true; shaft.receiveShadow = true;
            this.scene.add(shaft);
            const capitalGeo = new THREE.CylinderGeometry(2.5, 1.6, 1.5, 12);
            const capital = new THREE.Mesh(capitalGeo, marbleMat);
            capital.position.set(pos[0], 13.75, pos[2]);
            capital.castShadow = true; capital.receiveShadow = true;
            this.scene.add(capital);
            const abacusGeo = new THREE.BoxGeometry(5.5, 0.4, 5.5);
            const abacus = new THREE.Mesh(abacusGeo, marbleMat);
            abacus.position.set(pos[0], 14.7, pos[2]);
            abacus.castShadow = true;
            this.scene.add(abacus);
        });
    }

    createFencing() {
        const fenceRadius = 55, fenceHeight = 3, posts = 24;
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x6B3A20, roughness: 0.8 });
        for (let i = 0; i < posts; i++) {
            const angle = (i / posts) * Math.PI * 2;
            const x = Math.cos(angle) * fenceRadius;
            const z = Math.sin(angle) * fenceRadius;
            const postGeo = new THREE.CylinderGeometry(0.12, 0.12, fenceHeight, 8);
            const post = new THREE.Mesh(postGeo, woodMat);
            post.position.set(x, fenceHeight / 2, z);
            post.castShadow = true;
            this.scene.add(post);
            if (i < posts - 1) {
                const nextAngle = ((i + 1) / posts) * Math.PI * 2;
                const nextX = Math.cos(nextAngle) * fenceRadius;
                const nextZ = Math.sin(nextAngle) * fenceRadius;
                const start = new THREE.Vector3(x, fenceHeight * 0.7, z);
                const end = new THREE.Vector3(nextX, fenceHeight * 0.7, nextZ);
                const dir = end.clone().sub(start);
                const dist = dir.length();
                if (dist <= 0.0001) continue;
                dir.normalize();
                const railGeo = new THREE.CylinderGeometry(0.05, 0.05, dist, 8);
                const rail = new THREE.Mesh(railGeo, woodMat);
                rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                rail.position.copy(start.clone().add(end).multiplyScalar(0.5));
                rail.castShadow = true;
                this.scene.add(rail);
                const start2 = new THREE.Vector3(x, fenceHeight * 0.35, z);
                const end2 = new THREE.Vector3(nextX, fenceHeight * 0.35, nextZ);
                const rail2 = new THREE.Mesh(railGeo, woodMat);
                rail2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                rail2.position.copy(start2.clone().add(end2).multiplyScalar(0.5));
                rail2.castShadow = true;
                this.scene.add(rail2);
            }
        }
    }

    createVegetation() {
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5C3317, roughness: 0.9 });
        const foliageColors = [0x1B7A1B, 0x228B22, 0x2E8B2E, 0x186A18, 0x2D8B2D, 0x3CB043];
        for (let i = 0; i < 18; i++) {
            const angle = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const radius = 33 + Math.random() * 14;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            let tooClose = false;
            for (let col of this.columnPositions) {
                if (Math.sqrt((x - col[0]) ** 2 + (z - col[2]) ** 2) < 8) { tooClose = true; break; }
            }
            if (tooClose) continue;
            const treeHeight = 7 + Math.random() * 4;
            const trunkGeo = new THREE.CylinderGeometry(0.4, 0.7, treeHeight, 8);
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.set(x, treeHeight / 2, z);
            trunk.castShadow = true;
            this.scene.add(trunk);
            const layers = 2 + Math.floor(Math.random() * 2);
            for (let l = 0; l < layers; l++) {
                const sz = (4 + Math.random() * 2) * (1 - l * 0.2);
                const fc = foliageColors[Math.floor(Math.random() * foliageColors.length)];
                const fm = new THREE.MeshStandardMaterial({ color: fc, roughness: 0.8 });
                const fg = new THREE.SphereGeometry(sz, 8, 6);
                const fl = new THREE.Mesh(fg, fm);
                fl.position.set(x + (Math.random() - 0.5) * 2, treeHeight + l * 2 + Math.random(), z + (Math.random() - 0.5) * 2);
                fl.castShadow = true;
                this.scene.add(fl);
            }
        }
        const bushColors = [0x32CD32, 0x228B22, 0x2E8B57, 0x3CB371];
        const flowerColors = [0xFF69B4, 0xFF6347, 0xDDA0DD, 0xFFD700, 0xFF7F50, 0xEE82EE];
        for (let i = 0; i < 28; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 12 + Math.random() * 5;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const bsz = 0.8 + Math.random() * 1.0;
            const bg = new THREE.SphereGeometry(bsz, 7, 5);
            const bm = new THREE.MeshStandardMaterial({ color: bushColors[Math.floor(Math.random() * bushColors.length)], roughness: 0.85 });
            const bush = new THREE.Mesh(bg, bm);
            bush.position.set(x, bsz * 0.6, z);
            bush.castShadow = true;
            this.scene.add(bush);
            if (Math.random() > 0.5) {
                for (let f = 0; f < 3 + Math.floor(Math.random() * 4); f++) {
                    const fgeo = new THREE.SphereGeometry(0.12, 6, 6);
                    const fc = flowerColors[Math.floor(Math.random() * flowerColors.length)];
                    const fmat = new THREE.MeshStandardMaterial({ color: fc, roughness: 0.4, emissive: fc, emissiveIntensity: 0.08 });
                    const flower = new THREE.Mesh(fgeo, fmat);
                    const fa = Math.random() * Math.PI * 2;
                    flower.position.set(x + Math.cos(fa) * bsz * 0.7, bsz * 0.8 + Math.random() * bsz * 0.5, z + Math.sin(fa) * bsz * 0.7);
                    this.scene.add(flower);
                }
            }
        }
    }

    createArchitecture() {
        const marbleMat = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.35, metalness: 0.05 });
        const benchPositions = [[-18, 0, -18], [18, 0, -18], [-18, 0, 18], [18, 0, 18]];
        benchPositions.forEach(pos => {
            const benchGeo = new THREE.BoxGeometry(6, 0.5, 2);
            const bench = new THREE.Mesh(benchGeo, marbleMat);
            bench.position.set(pos[0], 1.5, pos[2]);
            bench.castShadow = true; bench.receiveShadow = true;
            this.scene.add(bench);
            for (let i = 0; i < 2; i++) {
                const legGeo = new THREE.BoxGeometry(0.5, 1.5, 1.8);
                const leg = new THREE.Mesh(legGeo, marbleMat);
                leg.position.set(pos[0] + (i === 0 ? -2.3 : 2.3), 0.75, pos[2]);
                leg.castShadow = true;
                this.scene.add(leg);
            }
        });
        const urnMat = new THREE.MeshStandardMaterial({ color: 0xc4956a, roughness: 0.6, metalness: 0.05 });
        const urnPositions = [[-25, 0, 0], [25, 0, 0], [0, 0, -25], [0, 0, 25]];
        urnPositions.forEach(pos => {
            const baseg = new THREE.CylinderGeometry(1, 1.5, 0.5, 16);
            const basem = new THREE.Mesh(baseg, urnMat);
            basem.position.set(pos[0], 0.25, pos[2]);
            basem.castShadow = true;
            this.scene.add(basem);
            const urnPoints = [];
            for (let j = 0; j <= 20; j++) {
                const t = j / 20;
                let r;
                if (t < 0.3) r = 0.5 + t * 3.3;
                else if (t < 0.7) r = 1.5 - (t - 0.3) * 1.5;
                else r = 0.9 - (t - 0.7) * 1.5;
                r = Math.max(0.3, r);
                urnPoints.push(new THREE.Vector2(r, t * 4));
            }
            const urnGeo = new THREE.LatheGeometry(urnPoints, 16);
            const urn = new THREE.Mesh(urnGeo, urnMat);
            urn.position.set(pos[0], 0.5, pos[2]);
            urn.castShadow = true;
            this.scene.add(urn);
        });
        this.createPathways();
    }

    createPathways() {
        const pathRadius = 13, stones = 40;
        const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.7, metalness: 0.02 });
        for (let i = 0; i < stones; i++) {
            const angle = (i / stones) * Math.PI * 2;
            const x = Math.cos(angle) * pathRadius + (Math.random() - 0.5) * 0.5;
            const z = Math.sin(angle) * pathRadius + (Math.random() - 0.5) * 0.5;
            const sg = new THREE.CylinderGeometry(0.6 + Math.random() * 0.4, 0.7 + Math.random() * 0.4, 0.12, 6);
            const stone = new THREE.Mesh(sg, stoneMat);
            stone.position.set(x, 0.06, z);
            stone.rotation.y = Math.random() * Math.PI;
            stone.receiveShadow = true;
            this.scene.add(stone);
        }
        const dirs = [{ dx: 1, dz: 1 }, { dx: 1, dz: -1 }, { dx: -1, dz: 1 }, { dx: -1, dz: -1 }];
        dirs.forEach(d => {
            for (let s = 0; s < 8; s++) {
                const t = (s + 1) / 8;
                const x = d.dx * t * 16, z = d.dz * t * 16;
                const sg2 = new THREE.CylinderGeometry(0.5 + Math.random() * 0.3, 0.6 + Math.random() * 0.3, 0.1, 6);
                const sm = new THREE.Mesh(sg2, stoneMat);
                sm.position.set(x + (Math.random() - 0.5) * 0.3, 0.05, z + (Math.random() - 0.5) * 0.3);
                sm.rotation.y = Math.random() * Math.PI;
                sm.receiveShadow = true;
                this.scene.add(sm);
            }
        });
    }

    createAmbientEffects() { this.createGrass(); this.createAtmosphericParticles(); this.createWindSwirls(); }

    createGrass() {
        for (let i = 0; i < 300; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = 14 + Math.random() * 38;
            const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
            let tooClose = false;
            for (let col of this.columnPositions) {
                if (Math.sqrt((x - col[0]) ** 2 + (z - col[2]) ** 2) < 5) { tooClose = true; break; }
            }
            if (tooClose) continue;
            const gh = 0.2 + Math.random() * 0.5;
            const gg = new THREE.CylinderGeometry(0.008, 0.025, gh, 3);
            const shade = 0.3 + Math.random() * 0.3;
            const gm = new THREE.MeshStandardMaterial({ color: new THREE.Color(shade * 0.3, shade, shade * 0.2), roughness: 0.9 });
            const grass = new THREE.Mesh(gg, gm);
            grass.position.set(x, gh / 2, z);
            grass.userData = { swayPhase: Math.random() * Math.PI * 2, height: gh };
            this.grassBlades.push(grass);
            this.scene.add(grass);
        }
    }

    createAtmosphericParticles() {
        for (let i = 0; i < 80; i++) {
            const pg = new THREE.SphereGeometry(0.03 + Math.random() * 0.02, 4, 4);
            const pm = new THREE.MeshBasicMaterial({ color: 0xffffdd, transparent: true, opacity: 0.15 + Math.random() * 0.15 });
            const p = new THREE.Mesh(pg, pm);
            p.position.set((Math.random() - 0.5) * 100, 2 + Math.random() * 20, (Math.random() - 0.5) * 100);
            p.userData = {
                velocity: new THREE.Vector3((Math.random() - 0.5) * 0.015, (Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.015),
                phase: Math.random() * Math.PI * 2
            };
            this.ambientParticles.push(p);
            this.scene.add(p);
        }
    }

    createWindSwirls() {
        for (let i = 0; i < 10; i++) {
            const sg = new THREE.RingGeometry(0.3, 0.5, 16);
            const sm = new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.06, side: THREE.DoubleSide });
            const swirl = new THREE.Mesh(sg, sm);
            const angle = (i / 10) * Math.PI * 2;
            const radius = 2 + Math.random() * 7;
            swirl.position.set(Math.cos(angle) * radius, 0.17, Math.sin(angle) * radius);
            swirl.rotation.x = -Math.PI / 2;
            swirl.userData = { rotationSpeed: 0.008 + Math.random() * 0.015, originalPosition: swirl.position.clone(), phase: Math.random() * Math.PI * 2 };
            this.scene.add(swirl);
        }
    }
    createPond() {
        const deepGeo = new THREE.CircleGeometry(10, 64);
        const deepMat = new THREE.MeshStandardMaterial({ color: 0x1a3a5c, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
        const deepWater = new THREE.Mesh(deepGeo, deepMat);
        deepWater.rotation.x = -Math.PI / 2;
        deepWater.position.y = -0.05;
        deepWater.receiveShadow = true;
        this.scene.add(deepWater);

        const pondGeo = new THREE.CircleGeometry(10, 80);
        const pondMat = new THREE.MeshPhysicalMaterial({
            color: 0x3a7fb5, roughness: 0.05, metalness: 0.3,
            transparent: true, opacity: 0.65, side: THREE.DoubleSide,
            clearcoat: 0.4, clearcoatRoughness: 0.1
        });
        this.pondWater = new THREE.Mesh(pondGeo, pondMat);
        this.pondWater.rotation.x = -Math.PI / 2;
        this.pondWater.position.y = 0.15;
        this.pondWater.receiveShadow = true;
        this.scene.add(this.pondWater);
        this.pondWater.userData = { originalVertices: [] };
        const vertices = pondGeo.attributes.position.array;
        for (let i = 0; i < vertices.length; i += 3) {
            this.pondWater.userData.originalVertices.push({ x: vertices[i], y: vertices[i + 1], z: vertices[i + 2] });
        }

        const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.5, metalness: 0.02 });
        const innerEdgeGeo = new THREE.TorusGeometry(10.3, 0.4, 8, 48);
        const innerEdge = new THREE.Mesh(innerEdgeGeo, edgeMat);
        innerEdge.rotation.x = Math.PI / 2;
        innerEdge.position.y = 0.15;
        innerEdge.castShadow = true; innerEdge.receiveShadow = true;
        this.scene.add(innerEdge);
        const outerEdgeGeo = new THREE.TorusGeometry(10.8, 0.35, 8, 48);
        const outerEdge = new THREE.Mesh(outerEdgeGeo, edgeMat);
        outerEdge.rotation.x = Math.PI / 2;
        outerEdge.position.y = 0.1;
        outerEdge.castShadow = true; outerEdge.receiveShadow = true;
        this.scene.add(outerEdge);
    }

    createLilyPads() {
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const radius = 4 + Math.random() * 4.5;
            const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
            const padSize = 0.5 + Math.random() * 0.4;
            const padGeo = new THREE.CircleGeometry(padSize, 12, 0.1, Math.PI * 1.85);
            const padMat = new THREE.MeshStandardMaterial({ color: 0x2d5a1e, roughness: 0.7, side: THREE.DoubleSide });
            const pad = new THREE.Mesh(padGeo, padMat);
            pad.rotation.x = -Math.PI / 2;
            pad.rotation.z = Math.random() * Math.PI * 2;
            pad.position.set(x, 0.17, z);
            pad.userData = { baseX: x, baseZ: z, phase: Math.random() * Math.PI * 2, driftSpeed: 0.0002 + Math.random() * 0.0003 };
            this.lilyPads.push(pad);
            this.scene.add(pad);
            if (Math.random() > 0.4) {
                const flowerGroup = new THREE.Group();
                const petalColors = [0xFFB6C1, 0xFF69B4, 0xFFC0CB, 0xF8F0E3];
                const petalColor = petalColors[Math.floor(Math.random() * petalColors.length)];
                const petalMat = new THREE.MeshStandardMaterial({ color: petalColor, roughness: 0.4, side: THREE.DoubleSide, emissive: petalColor, emissiveIntensity: 0.05 });
                const petals = 6 + Math.floor(Math.random() * 4);
                for (let p = 0; p < petals; p++) {
                    const pa = (p / petals) * Math.PI * 2;
                    const petalGeo = new THREE.SphereGeometry(0.12, 6, 4);
                    petalGeo.scale(1, 0.3, 2);
                    const petal = new THREE.Mesh(petalGeo, petalMat);
                    petal.position.set(Math.cos(pa) * 0.12, 0, Math.sin(pa) * 0.12);
                    petal.rotation.y = -pa;
                    petal.rotation.x = -0.3;
                    flowerGroup.add(petal);
                }
                const centerGeo = new THREE.SphereGeometry(0.06, 8, 8);
                const centerMat = new THREE.MeshStandardMaterial({ color: 0xFFD700, roughness: 0.3, emissive: 0xFFD700, emissiveIntensity: 0.2 });
                const center = new THREE.Mesh(centerGeo, centerMat);
                center.position.y = 0.05;
                flowerGroup.add(center);
                flowerGroup.position.set(x, 0.22, z);
                flowerGroup.userData = { baseX: x, baseZ: z, phase: pad.userData.phase };
                this.lotusFlowers.push(flowerGroup);
                this.scene.add(flowerGroup);
            }
        }
    }

    createBowls() {
        const bowlPalette = [
            { color: 0xE0B15A, emissive: 0x7A5A20 },
            { color: 0xC46C4B, emissive: 0x6B3A20 },
            { color: 0xB58B5A, emissive: 0x5A3A2A },
            { color: 0xD9C56C, emissive: 0x7A6F40 },
            { color: 0xD1C7B7, emissive: 0x7A7266 },
            { color: 0xB7C1D1, emissive: 0x5C6575 },
            { color: 0x8FA7A0, emissive: 0x4A5C57 },
            { color: 0xD2A86A, emissive: 0x6B4A1E },
            { color: 0xA97155, emissive: 0x5C4033 },
            { color: 0xCFAF8B, emissive: 0x6B5847 },
            { color: 0xC39A5A, emissive: 0x6B4A1E },
            { color: 0xB88C8C, emissive: 0x5C3A3A },
            { color: 0x9FB3C8, emissive: 0x4A5A6B },
            { color: 0xC7B07B, emissive: 0x6B5A2E },
            { color: 0xA8836F, emissive: 0x5A3F34 }
        ];
        for (let i = 0; i < 15; i++) {
            const angle = (i / 15) * Math.PI * 2;
            const radius = 2 + Math.random() * 6;
            const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
            const bowlSize = 0.5 + Math.random() * 0.55;
            const bowlHeight = bowlSize * 0.7;
            const outerPoints = [];
            for (let j = 0; j <= 16; j++) {
                const t = j / 16;
                const r = bowlSize * (0.1 + 0.9 * Math.pow(t, 0.35));
                const y = bowlHeight * t;
                outerPoints.push(new THREE.Vector2(r, y));
            }
            const bowlGeo = new THREE.LatheGeometry(outerPoints, 32);
            const palette = bowlPalette[i % bowlPalette.length];
            const bowlMat = new THREE.MeshPhysicalMaterial({
                color: palette.color, metalness: 0.78, roughness: 0.2,
                clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide,
                emissive: palette.emissive, emissiveIntensity: 0.0, envMapIntensity: 1.2
            });
            const bowl = new THREE.Mesh(bowlGeo, bowlMat);
            bowl.position.set(x, 0.15 - bowlHeight * 0.35, z);
            // Interior cap to block pond water showing through the bowl
            const innerCapGeo = new THREE.CircleGeometry(bowlSize * 0.78, 24);
            const innerCapMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
            const innerCap = new THREE.Mesh(innerCapGeo, innerCapMat);
            innerCap.rotation.x = -Math.PI / 2;
            innerCap.position.y = bowlHeight * 0.72;
            bowl.add(innerCap);
            bowl.castShadow = true; bowl.receiveShadow = true;
            bowl.userData = {
                velocity: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3),
                verticalVelocity: 0,
                tilt: new THREE.Vector2(0, 0),
                tiltVelocity: new THREE.Vector2(0, 0),
                spin: 0,
                size: bowlSize, mass: bowlSize * bowlSize * 10,
                frequency: this.lydianScale[i % this.lydianScale.length] * (0.8 + bowlSize * 0.4),
                lastCollision: 0, isVibrating: false, vibratingUntil: 0,
                glowIntensity: 0, targetGlow: 0, baseEmissive: palette.emissive,
                bowlHeight: bowlHeight, originalY: 0.15 - bowlHeight * 0.35
            };
            this.bowls.push(bowl);
            this.scene.add(bowl);
        }
    }

    createFireflies() {
        for (let i = 0; i < 40; i++) {
            const ffGeo = new THREE.SphereGeometry(0.04, 6, 6);
            const ffMat = new THREE.MeshBasicMaterial({ color: 0xccff66, transparent: true, opacity: 0.0 });
            const ff = new THREE.Mesh(ffGeo, ffMat);
            const angle = Math.random() * Math.PI * 2;
            const dist = 5 + Math.random() * 40;
            ff.position.set(Math.cos(angle) * dist, 1 + Math.random() * 8, Math.sin(angle) * dist);
            ff.userData = {
                phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() * 1.5,
                amplitude: 0.3 + Math.random() * 0.5, basePosition: ff.position.clone(),
                flickerPhase: Math.random() * Math.PI * 2, flickerSpeed: 2 + Math.random() * 3
            };
            if (i < 10) {
                const ffLight = new THREE.PointLight(0xccff66, 0, 3);
                ff.add(ffLight);
                ff.userData.light = ffLight;
            }
            this.fireflies.push(ff);
            this.scene.add(ff);
        }
    }

    createKoiFish() {
        const koiColors = [
            { body: 0xE84A5F, accent: 0xFFFFFF, belly: 0xFFF1E6 },
            { body: 0xF6A04D, accent: 0xFFFFFF, belly: 0xFFF0D6 },
            { body: 0xFFFFFF, accent: 0xD7263D, belly: 0xFFFFFF },
        ];
        for (let i = 0; i < 3; i++) {
            const koiGroup = new THREE.Group();
            const palette = koiColors[i];
            const bodyMat = new THREE.MeshPhysicalMaterial({
                color: palette.body, roughness: 0.22, metalness: 0.05,
                clearcoat: 0.4, clearcoatRoughness: 0.25
            });
            const bellyMat = new THREE.MeshStandardMaterial({ color: palette.belly, roughness: 0.25 });
            const accentMat = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.25 });
            // Body — smoother lathe profile
            const bodyProfile = [];
            for (let j = 0; j <= 28; j++) {
                const t = j / 28;
                let r;
                if (t < 0.12) r = 0.03 + t * 0.6;
                else if (t < 0.5) r = 0.12 + 0.05 * Math.sin((t - 0.12) / 0.38 * Math.PI);
                else if (t < 0.8) r = 0.15 - (t - 0.5) * 0.2;
                else r = Math.max(0.02, 0.06 * (1 - (t - 0.8) / 0.2));
                bodyProfile.push(new THREE.Vector2(r, (t - 0.5) * 0.95));
            }
            const bodyGeo = new THREE.LatheGeometry(bodyProfile, 18);
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.rotation.z = Math.PI / 2;
            body.scale.set(1, 0.55, 1);
            koiGroup.add(body);
            // Belly highlight
            const bellyGeo = new THREE.SphereGeometry(0.1, 10, 8);
            bellyGeo.scale(2.3, 0.22, 0.65);
            const belly = new THREE.Mesh(bellyGeo, bellyMat);
            belly.position.set(0.02, -0.03, 0);
            koiGroup.add(belly);
            // Head + mouth
            const headGeo = new THREE.SphereGeometry(0.09, 12, 10);
            headGeo.scale(1.2, 0.9, 1.0);
            const head = new THREE.Mesh(headGeo, bodyMat);
            head.position.set(0.34, 0.015, 0);
            koiGroup.add(head);
            const mouthGeo = new THREE.ConeGeometry(0.02, 0.04, 8);
            mouthGeo.rotateZ(Math.PI / 2);
            const mouth = new THREE.Mesh(mouthGeo, bellyMat);
            mouth.position.set(0.44, 0.0, 0);
            koiGroup.add(mouth);
            // Eyes
            const eyeWhiteGeo = new THREE.SphereGeometry(0.02, 8, 8);
            const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.2 });
            const eyePupilGeo = new THREE.SphereGeometry(0.01, 6, 6);
            const eyePupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 });
            [-1, 1].forEach(side => {
                const eyeW = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
                eyeW.position.set(0.33, 0.03, side * 0.07);
                koiGroup.add(eyeW);
                const eyeP = new THREE.Mesh(eyePupilGeo, eyePupilMat);
                eyeP.position.set(0.345, 0.03, side * 0.075);
                koiGroup.add(eyeP);
            });
            // Fins
            const finMat = new THREE.MeshStandardMaterial({ color: palette.body, roughness: 0.3, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
            const dorsalShape = new THREE.Shape();
            dorsalShape.moveTo(0, 0);
            dorsalShape.lineTo(-0.16, 0.02);
            dorsalShape.lineTo(-0.02, 0.12);
            dorsalShape.lineTo(0.08, 0.08);
            dorsalShape.lineTo(0, 0);
            const dorsalGeo = new THREE.ExtrudeGeometry(dorsalShape, { depth: 0.005, bevelEnabled: false });
            const dorsal = new THREE.Mesh(dorsalGeo, finMat);
            dorsal.position.set(0.03, 0.08, -0.0025);
            koiGroup.add(dorsal);
            const pFinShape = new THREE.Shape();
            pFinShape.moveTo(0, 0);
            pFinShape.lineTo(-0.09, -0.05);
            pFinShape.lineTo(-0.02, -0.08);
            pFinShape.lineTo(0.04, -0.02);
            pFinShape.lineTo(0, 0);
            const pFinGeo = new THREE.ExtrudeGeometry(pFinShape, { depth: 0.003, bevelEnabled: false });
            const pFinL = new THREE.Mesh(pFinGeo, finMat);
            pFinL.position.set(0.16, -0.02, 0.08);
            pFinL.rotation.y = 0.3;
            pFinL.name = 'pFinL';
            koiGroup.add(pFinL);
            const pFinR = new THREE.Mesh(pFinGeo, finMat);
            pFinR.position.set(0.16, -0.02, -0.08);
            pFinR.rotation.y = -0.3;
            pFinR.name = 'pFinR';
            koiGroup.add(pFinR);
            // Tail — larger forked fan
            const tailShape = new THREE.Shape();
            tailShape.moveTo(0, 0);
            tailShape.lineTo(-0.2, 0.11);
            tailShape.lineTo(-0.12, 0.03);
            tailShape.lineTo(-0.12, -0.03);
            tailShape.lineTo(-0.2, -0.11);
            tailShape.lineTo(0, 0);
            const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.004, bevelEnabled: false });
            const tailFin = new THREE.Mesh(tailGeo, finMat);
            tailFin.position.set(-0.46, 0, -0.002);
            tailFin.name = 'tailFin';
            koiGroup.add(tailFin);
            // Accent color patches
            const numPatches = 2 + Math.floor(Math.random() * 2);
            for (let p = 0; p < numPatches; p++) {
                const pGeo = new THREE.SphereGeometry(0.045 + Math.random() * 0.03, 10, 8);
                pGeo.scale(2.2, 0.45, 0.9);
                const pMesh = new THREE.Mesh(pGeo, accentMat);
                pMesh.position.set((Math.random() - 0.25) * 0.45, 0.035, (Math.random() - 0.5) * 0.09);
                koiGroup.add(pMesh);
            }

            const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
            const radius = 2.5 + Math.random() * 4.5;
            koiGroup.position.set(Math.cos(angle) * radius, 0.08, Math.sin(angle) * radius);
            koiGroup.scale.set(0.6, 0.6, 0.6);
            koiGroup.userData = {
                angle: angle,
                speed: 0.15 + Math.random() * 0.25,
                radius: radius,
                targetRadius: radius,
                turnTimer: 0,
                turnInterval: 5 + Math.random() * 10,
                phase: Math.random() * Math.PI * 2,
                swimAngle: angle
            };
            this.koiFish.push(koiGroup);
            this.scene.add(koiGroup);
        }
    }

    updateKoiFish(delta) {
        this.koiFish.forEach(koi => {
            const ud = koi.userData;
            ud.turnTimer += delta;
            if (ud.turnTimer > ud.turnInterval) {
                ud.turnTimer = 0;
                ud.turnInterval = 4 + Math.random() * 8;
                ud.swimAngle += (Math.random() - 0.5) * 1.5;
                ud.targetRadius = 2 + Math.random() * 5.5;
            }
            ud.radius += (ud.targetRadius - ud.radius) * delta * 0.5;
            ud.angle += ud.speed * delta * (1.0 / Math.max(2, ud.radius));
            const tx = Math.cos(ud.angle) * ud.radius;
            const tz = Math.sin(ud.angle) * ud.radius;
            const dx = tx - koi.position.x;
            const dz = tz - koi.position.z;
            koi.position.x += dx * delta * 2;
            koi.position.z += dz * delta * 2;
            koi.position.y = 0.05 + Math.sin(this.elapsedTime * 1.5 + ud.phase) * 0.015;
            // Face direction of movement
            const moveAngle = Math.atan2(dz, dx);
            koi.rotation.y = -moveAngle;
            // Tail wag
            const tailFin = koi.getObjectByName('tailFin');
            const tailWag = Math.sin(this.elapsedTime * 6 + ud.phase) * 0.55;
            if (tailFin) tailFin.rotation.y = tailWag;
            // Pectoral fins paddle
            const pFinL = koi.getObjectByName('pFinL');
            const pFinR = koi.getObjectByName('pFinR');
            const finPaddle = Math.sin(this.elapsedTime * 3.5 + ud.phase) * 0.3;
            if (pFinL) pFinL.rotation.x = 0.25 + finPaddle;
            if (pFinR) pFinR.rotation.x = -0.25 - finPaddle;
            // Gentle body undulation
            koi.rotation.z = Math.sin(this.elapsedTime * 3 + ud.phase) * 0.04;
            // Avoid RC boat
            if (this.rcBoat && this.boatMode) {
                const bDist = koi.position.distanceTo(this.rcBoat.position);
                if (bDist < 2.5) {
                    const away = new THREE.Vector3().subVectors(koi.position, this.rcBoat.position);
                    away.y = 0; away.normalize();
                    const flee = (2.5 - bDist) / 2.5;
                    koi.position.x += away.x * flee * delta * 3;
                    koi.position.z += away.z * flee * delta * 3;
                    ud.speed = 0.5; // swim faster when scared
                }
            } else {
                ud.speed += (0.15 + 0.25 * Math.sin(ud.phase) * 0.5 - ud.speed) * delta * 0.3; // relax speed
            }
            // Keep inside pond
            const dist = Math.sqrt(koi.position.x ** 2 + koi.position.z ** 2);
            if (dist > 8.5) {
                const n = new THREE.Vector3(koi.position.x, 0, koi.position.z).normalize();
                koi.position.x -= n.x * (dist - 8.5);
                koi.position.z -= n.z * (dist - 8.5);
                ud.swimAngle += Math.PI * 0.5;
            }
        });
    }

    spawnRCBoat() {
        if (this.rcBoat) {
            this.scene.remove(this.rcBoat);
            this.rcBoat = null;
            this.boatMode = false;
            return;
        }
        const boatGroup = new THREE.Group();
        const redMat = new THREE.MeshStandardMaterial({ color: 0xCC0000, roughness: 0.2, metalness: 0.3 });
        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xF2F2F2, roughness: 0.25, metalness: 0.1 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.35, metalness: 0.7 });
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xCFCFCF, roughness: 0.1, metalness: 0.9 });
        // Hull — classic RC speedboat V-hull
        const hullShape = new THREE.Shape();
        hullShape.moveTo(0.6, 0);
        hullShape.lineTo(0.35, 0.16);
        hullShape.lineTo(0.1, 0.18);
        hullShape.lineTo(-0.2, 0.16);
        hullShape.lineTo(-0.48, 0.12);
        hullShape.lineTo(-0.62, 0.08);
        hullShape.lineTo(-0.62, -0.08);
        hullShape.lineTo(-0.48, -0.12);
        hullShape.lineTo(-0.2, -0.16);
        hullShape.lineTo(0.1, -0.18);
        hullShape.lineTo(0.35, -0.16);
        hullShape.lineTo(0.6, 0);
        const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.12, bevelEnabled: false });
        hullGeo.translate(0, 0, -0.06);
        const hull = new THREE.Mesh(hullGeo, redMat);
        hull.rotation.x = -Math.PI / 2;
        hull.position.set(0, 0.0, 0);
        boatGroup.add(hull);
        // Deck — raised top surface
        const deckGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.04, bevelEnabled: false });
        deckGeo.scale(0.82, 0.7, 1);
        deckGeo.translate(0.02, 0, -0.02);
        const deck = new THREE.Mesh(deckGeo, whiteMat);
        deck.rotation.x = -Math.PI / 2;
        deck.position.set(0.02, 0.05, 0);
        boatGroup.add(deck);
        // Cockpit cutout
        const cockpitGeo = new THREE.BoxGeometry(0.18, 0.015, 0.12);
        const cockpitMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });
        const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
        cockpit.position.set(0.12, 0.055, 0);
        boatGroup.add(cockpit);
        // Windshield — angled trapezoid
        const wsShape = new THREE.Shape();
        wsShape.moveTo(-0.08, 0);
        wsShape.lineTo(0.08, 0);
        wsShape.lineTo(0.05, 0.06);
        wsShape.lineTo(-0.05, 0.06);
        wsShape.lineTo(-0.08, 0);
        const wsGeo = new THREE.ExtrudeGeometry(wsShape, { depth: 0.004, bevelEnabled: false });
        const wsMat = new THREE.MeshPhysicalMaterial({ color: 0xA9D9FF, roughness: 0.0, metalness: 0.05, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
        const ws = new THREE.Mesh(wsGeo, wsMat);
        ws.rotation.set(-0.35, 0, 0);
        ws.position.set(0.2, 0.09, -0.002);
        boatGroup.add(ws);
        // Rear hatch
        const hatchGeo = new THREE.BoxGeometry(0.2, 0.03, 0.14);
        const hatch = new THREE.Mesh(hatchGeo, redMat);
        hatch.position.set(-0.18, 0.065, 0);
        boatGroup.add(hatch);
        // Side stripes
        const stripeGeo = new THREE.BoxGeometry(0.72, 0.004, 0.02);
        const stripeMat = new THREE.MeshStandardMaterial({ color: 0xFFCC00, roughness: 0.3 });
        const stripeL = new THREE.Mesh(stripeGeo, stripeMat);
        stripeL.position.set(0.0, 0.035, 0.11);
        boatGroup.add(stripeL);
        const stripeR = new THREE.Mesh(stripeGeo, stripeMat);
        stripeR.position.set(0.0, 0.035, -0.11);
        boatGroup.add(stripeR);
        // Outboard motor
        const motorBlockGeo = new THREE.BoxGeometry(0.07, 0.09, 0.05);
        const motorBlock = new THREE.Mesh(motorBlockGeo, darkMat);
        motorBlock.position.set(-0.7, -0.01, 0);
        boatGroup.add(motorBlock);
        const shaftGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6);
        const shaft = new THREE.Mesh(shaftGeo, chromeMat);
        shaft.position.set(-0.7, -0.06, 0);
        boatGroup.add(shaft);
        // Propeller
        const propGeo = new THREE.BoxGeometry(0.004, 0.012, 0.06);
        const prop = new THREE.Mesh(propGeo, chromeMat);
        prop.position.set(-0.7, -0.095, 0);
        prop.name = 'propeller';
        boatGroup.add(prop);
        // Antenna
        const antGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.15, 4);
        const ant = new THREE.Mesh(antGeo, darkMat);
        ant.position.set(-0.05, 0.16, 0.02);
        boatGroup.add(ant);
        const antTipGeo = new THREE.SphereGeometry(0.006, 4, 4);
        const antTip = new THREE.Mesh(antTipGeo, new THREE.MeshStandardMaterial({ color: 0xFF0000, emissive: 0xFF0000, emissiveIntensity: 0.6 }));
        antTip.position.set(-0.05, 0.235, 0.02);
        antTip.name = 'antTip';
        boatGroup.add(antTip);
        // Wake V-shape
        const wakeArmGeo = new THREE.PlaneGeometry(0.35, 0.025);
        const wakeMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.0, side: THREE.DoubleSide });
        const wakeL = new THREE.Mesh(wakeArmGeo, wakeMat);
        wakeL.rotation.x = -Math.PI / 2;
        wakeL.rotation.z = -0.2;
        wakeL.position.set(-0.48, 0.155, 0.06);
        wakeL.name = 'wakeL';
        boatGroup.add(wakeL);
        const wakeR = new THREE.Mesh(wakeArmGeo, wakeMat.clone());
        wakeR.rotation.x = -Math.PI / 2;
        wakeR.rotation.z = 0.2;
        wakeR.position.set(-0.48, 0.155, -0.06);
        wakeR.name = 'wakeR';
        boatGroup.add(wakeR);

        boatGroup.position.set(0, 0.14, 5);
        boatGroup.scale.set(1.0, 1.0, 1.0);
        boatGroup.userData.radius = 0.6;
        this.rcBoat = boatGroup;
        this.boatAngle = 0;
        this.boatSpeed = 0;
        this.boatMode = true;
        this.scene.add(boatGroup);
    }

    updateRCBoat(delta) {
        if (!this.rcBoat || !this.boatMode) return;
        const turnRate = 2.5;
        const accel = 3.0;
        const maxSpeed = 5.0;
        const drag = 0.97;
        if (this.boatKeys.left) this.boatAngle += turnRate * delta;
        if (this.boatKeys.right) this.boatAngle -= turnRate * delta;
        if (this.boatKeys.forward) this.boatSpeed = Math.min(maxSpeed, this.boatSpeed + accel * delta);
        if (this.boatKeys.backward) this.boatSpeed = Math.max(-maxSpeed * 0.3, this.boatSpeed - accel * 1.5 * delta);
        this.boatSpeed *= drag;
        if (Math.abs(this.boatSpeed) < 0.01) this.boatSpeed = 0;
        const vx = Math.cos(this.boatAngle) * this.boatSpeed * delta;
        const vz = -Math.sin(this.boatAngle) * this.boatSpeed * delta;
        this.rcBoat.position.x += vx;
        this.rcBoat.position.z += vz;
        // Bob on water
        this.rcBoat.position.y = 0.14 + Math.sin(this.elapsedTime * 3) * 0.008 + Math.abs(this.boatSpeed) * 0.005;
        this.rcBoat.rotation.y = this.boatAngle;
        // Lean into turns
        const targetLean = (this.boatKeys.left ? 1 : 0) - (this.boatKeys.right ? 1 : 0);
        this.rcBoat.rotation.z = targetLean * 0.12 * Math.min(1, Math.abs(this.boatSpeed));
        // Nose pitch based on speed
        this.rcBoat.rotation.x = -this.boatSpeed * 0.02;
        // Wake visibility + propeller spin
        const wakeL = this.rcBoat.getObjectByName('wakeL');
        const wakeR = this.rcBoat.getObjectByName('wakeR');
        const wakeOp = Math.min(0.4, Math.abs(this.boatSpeed) * 0.12);
        if (wakeL) { wakeL.material.opacity = wakeOp; wakeL.scale.x = 0.5 + Math.abs(this.boatSpeed) * 0.2; }
        if (wakeR) { wakeR.material.opacity = wakeOp; wakeR.scale.x = 0.5 + Math.abs(this.boatSpeed) * 0.2; }
        const prop = this.rcBoat.getObjectByName('propeller');
        if (prop) prop.rotation.y += this.boatSpeed * 15 * delta;
        // Blink antenna
        const antTip = this.rcBoat.getObjectByName('antTip');
        if (antTip) antTip.material.emissiveIntensity = 0.3 + 0.5 * Math.sin(this.elapsedTime * 4);
        // Keep in pond
        const dist = Math.sqrt(this.rcBoat.position.x ** 2 + this.rcBoat.position.z ** 2);
        if (dist > 9.0) {
            const n = new THREE.Vector3(this.rcBoat.position.x, 0, this.rcBoat.position.z).normalize();
            this.rcBoat.position.x = n.x * 9.0;
            this.rcBoat.position.z = n.z * 9.0;
            this.boatSpeed *= -0.3;
        }
        // Prevent boat from passing through bowls
        const boatRadius = this.rcBoat.userData.radius || 0.6;
        this.bowls.forEach(bowl => {
            const bd = this.rcBoat.position.distanceTo(bowl.position);
            const minD = boatRadius + bowl.userData.size * 0.9;
            if (bd < minD) {
                const n = new THREE.Vector3().subVectors(this.rcBoat.position, bowl.position);
                if (n.lengthSq() < 0.000001) n.set(1, 0, 0);
                n.y = 0; n.normalize();
                const penetration = minD - bd;
                this.rcBoat.position.addScaledVector(n, penetration);
                const pushStrength = (Math.abs(this.boatSpeed) + 0.4) * 1.2;
                bowl.userData.velocity.addScaledVector(n, -pushStrength);
                this.boatSpeed *= 0.35;
            }
        });
        // Push bowls out of the way
        this.bowls.forEach(bowl => {
            const d = this.rcBoat.position.distanceTo(bowl.position);
            if (d < 1.0 && d > 0.01) {
                const push = new THREE.Vector3().subVectors(bowl.position, this.rcBoat.position);
                push.y = 0; push.normalize();
                bowl.userData.velocity.add(push.multiplyScalar(0.65 * Math.abs(this.boatSpeed) * delta));
            }
        });
    }

    setupBoatControls() {
        document.addEventListener('keydown', (e) => {
            if (!this.boatMode) return;
            switch (e.key) {
                case 'ArrowUp': case 'w': case 'W': this.boatKeys.forward = true; break;
                case 'ArrowDown': case 's': case 'S': this.boatKeys.backward = true; break;
                case 'ArrowLeft': case 'a': case 'A': this.boatKeys.left = true; break;
                case 'ArrowRight': case 'd': case 'D': this.boatKeys.right = true; break;
            }
        });
        document.addEventListener('keyup', (e) => {
            switch (e.key) {
                case 'ArrowUp': case 'w': case 'W': this.boatKeys.forward = false; break;
                case 'ArrowDown': case 's': case 'S': this.boatKeys.backward = false; break;
                case 'ArrowLeft': case 'a': case 'A': this.boatKeys.left = false; break;
                case 'ArrowRight': case 'd': case 'D': this.boatKeys.right = false; break;
            }
        });
    }

    setupAudio() {
        this.audioContext = null;
        const unlock = () => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.createReverbChain();
            }
            if (this.audioContext.state === 'suspended') this.audioContext.resume();
        };
        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('pointerdown', unlock, { once: true });
    }

    createReverbChain() {
        if (!this.audioContext) return;
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.audioContext.destination);
        this.dryGain = this.audioContext.createGain();
        this.dryGain.gain.value = 0.7;
        this.dryGain.connect(this.masterGain);
        this.wetGain = this.audioContext.createGain();
        this.wetGain.gain.value = 0.35;
        this.wetGain.connect(this.masterGain);
        this.reverbInput = this.audioContext.createGain();
        this.reverbInput.gain.value = 1.0;
        const delayTimes = [0.03, 0.05, 0.08, 0.13, 0.21];
        const feedbackValues = [0.3, 0.25, 0.2, 0.15, 0.1];
        delayTimes.forEach((time, idx) => {
            const delay = this.audioContext.createDelay();
            delay.delayTime.value = time;
            const feedback = this.audioContext.createGain();
            feedback.gain.value = feedbackValues[idx];
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 2000 - idx * 200;
            this.reverbInput.connect(delay);
            delay.connect(filter);
            filter.connect(feedback);
            feedback.connect(delay);
            filter.connect(this.wetGain);
        });
    }

    playBowlSound(frequency, duration = 3.0, intensity = 1.0) {
        if (!this.audioContext || this.isMuted) return;
        const now = this.audioContext.currentTime;
        const vol = 0.06 * intensity;
        const osc1 = this.audioContext.createOscillator();
        const gain1 = this.audioContext.createGain();
        osc1.frequency.setValueAtTime(frequency, now);
        osc1.type = 'sine';
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(vol, now + 0.04);
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc1.connect(gain1);
        gain1.connect(this.dryGain);
        gain1.connect(this.reverbInput);
        const osc2 = this.audioContext.createOscillator();
        const gain2 = this.audioContext.createGain();
        osc2.frequency.setValueAtTime(frequency * 1.003, now);
        osc2.type = 'sine';
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(vol * 0.35, now + 0.04);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.75);
        osc2.connect(gain2);
        gain2.connect(this.dryGain);
        gain2.connect(this.reverbInput);
        const osc3 = this.audioContext.createOscillator();
        const gain3 = this.audioContext.createGain();
        osc3.frequency.setValueAtTime(frequency * 2.01, now);
        osc3.type = 'sine';
        gain3.gain.setValueAtTime(0, now);
        gain3.gain.linearRampToValueAtTime(vol * 0.15, now + 0.03);
        gain3.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.5);
        osc3.connect(gain3);
        gain3.connect(this.dryGain);
        gain3.connect(this.reverbInput);
        const osc4 = this.audioContext.createOscillator();
        const gain4 = this.audioContext.createGain();
        osc4.frequency.setValueAtTime(frequency * 3.02, now);
        osc4.type = 'sine';
        gain4.gain.setValueAtTime(0, now);
        gain4.gain.linearRampToValueAtTime(vol * 0.06, now + 0.02);
        gain4.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.35);
        osc4.connect(gain4);
        gain4.connect(this.dryGain);
        osc1.start(now); osc2.start(now); osc3.start(now); osc4.start(now);
        osc1.stop(now + duration); osc2.stop(now + duration * 0.75);
        osc3.stop(now + duration * 0.5); osc4.stop(now + duration * 0.35);
    }

    createRipples(bowlPosition, frequency) {
        if (!this.pondWater || !this.pondWater.userData.originalVertices) return;
        const vertices = this.pondWater.geometry.attributes.position.array;
        const originalVertices = this.pondWater.userData.originalVertices;
        const t = this.elapsedTime;
        for (let i = 0; i < originalVertices.length; i++) {
            const orig = originalVertices[i];
            const dist = Math.sqrt((orig.x - bowlPosition.x) ** 2 + (-orig.y - bowlPosition.z) ** 2);
            if (dist < 4) {
                const ri = Math.max(0, (4 - dist) / 4);
                const rf = frequency / 80;
                const rh = 0.015 * ri * Math.sin(t * 8.0 * rf - dist * 2);
                vertices[i * 3 + 2] = orig.z + rh;
            }
        }
        this.pondWater.geometry.attributes.position.needsUpdate = true;
    }

    updateWaterAnimation(delta) {
        this.windField.time += delta * 0.5;
        if (this.pondWater && this.pondWater.userData.originalVertices) {
            const vertices = this.pondWater.geometry.attributes.position.array;
            const ov = this.pondWater.userData.originalVertices;
            const t = this.windField.time;
            for (let i = 0; i < ov.length; i++) {
                const o = ov[i];
                const dist = Math.sqrt(o.x * o.x + o.y * o.y);
                if (dist < 9.8) {
                    const w1 = 0.015 * Math.sin(t * 1.5 + o.x * 0.3 + o.y * 0.2);
                    const w2 = 0.01 * Math.sin(t * 2.3 + o.x * 0.5 - o.y * 0.4);
                    const w3 = 0.005 * Math.cos(t * 3.1 - o.x * 0.2 + o.y * 0.6);
                    const edgeFade = Math.max(0, 1 - dist / 9.8);
                    vertices[i * 3 + 2] = o.z + (w1 + w2 + w3) * edgeFade;
                }
            }
            this.pondWater.geometry.attributes.position.needsUpdate = true;
            this.pondWater.geometry.computeVertexNormals();
        }
    }

    getWindForce(position) {
        const x = position.x, z = position.z, t = this.windField.time;
        const ws = this.windState;
        const baseX = ws.strength * Math.cos(ws.direction);
        const baseZ = ws.strength * Math.sin(ws.direction);
        // Add local turbulence
        const turbX = 0.003 * Math.sin(t * 0.5 + x * 0.1) * Math.cos(t * 0.3 + z * 0.08);
        const turbZ = 0.003 * Math.cos(t * 0.4 + x * 0.08) * Math.sin(t * 0.45 + z * 0.1);
        return new THREE.Vector3(baseX + turbX, 0, baseZ + turbZ);
    }

    updateWind(delta) {
        const ws = this.windState;
        ws.changeTimer += delta;
        if (ws.changeTimer >= ws.changeInterval) {
            ws.changeTimer = 0;
            ws.changeInterval = 8 + Math.random() * 15;
            ws.targetDirection = Math.random() * Math.PI * 2;
            ws.targetStrength = 0.008 + Math.random() * 0.02;
        }
        // Smooth interpolation toward target
        let dAngle = ws.targetDirection - ws.direction;
        while (dAngle > Math.PI) dAngle -= Math.PI * 2;
        while (dAngle < -Math.PI) dAngle += Math.PI * 2;
        ws.direction += dAngle * delta * 0.3;
        ws.strength += (ws.targetStrength - ws.strength) * delta * 0.4;
    }

    updateBowlPhysics(delta) {
        const nowMs = this.elapsedTime * 1000;
        this.updateWaterAnimation(delta);
        this.updateAmbientEffects();
        this.updateFireflies();
        this.updateLilyPads();
        const pondR = 9.5;
        const maxSpeed = 2.4;
        const linearDamping = 0.24;
        const quadDrag = 1.3;
        const tiltSpring = 12;
        const tiltDamping = 6;
        const buoyancy = 10;
        const verticalDamping = 4.5;
        this.bowls.forEach((bowl, index) => {
            const ud = bowl.userData;
            if (this.draggedBowl === bowl) {
                ud.velocity.set(0, 0, 0);
                ud.verticalVelocity = 0;
                ud.tilt.set(0, 0);
                ud.tiltVelocity.set(0, 0);
                return;
            }
            const wind = this.getWindForce(bowl.position);
            ud.velocity.addScaledVector(wind, delta);
            const speed = ud.velocity.length();
            if (speed > 0.0001) {
                const dragForce = ud.velocity.clone().multiplyScalar(-quadDrag * speed);
                ud.velocity.addScaledVector(dragForce, delta);
            }
            ud.velocity.multiplyScalar(Math.exp(-linearDamping * delta));
            if (ud.velocity.length() > maxSpeed) ud.velocity.setLength(maxSpeed);
            bowl.position.addScaledVector(ud.velocity, delta);
            const baseFloat = ud.originalY + Math.sin(this.elapsedTime * 1.5 + index * 0.7) * 0.04;
            let targetY = baseFloat;
            if (ud.isVibrating && nowMs < ud.vibratingUntil) {
                const vp = 1 - (nowMs - (ud.vibratingUntil - 2500)) / 2500;
                ud.targetGlow = Math.max(0, vp * 0.25);
                this.createRipples(bowl.position, ud.frequency);
                targetY += Math.sin(this.elapsedTime * 20 * (ud.frequency / 500)) * 0.003;
            } else { ud.isVibrating = false; ud.targetGlow = 0; }
            const yError = targetY - bowl.position.y;
            ud.verticalVelocity += yError * buoyancy * delta;
            ud.verticalVelocity *= Math.exp(-verticalDamping * delta);
            bowl.position.y += ud.verticalVelocity * delta;
            const targetTiltX = THREE.MathUtils.clamp(ud.velocity.z * 0.6, -0.35, 0.35);
            const targetTiltZ = THREE.MathUtils.clamp(-ud.velocity.x * 0.6, -0.35, 0.35);
            ud.tiltVelocity.x += (targetTiltX - ud.tilt.x) * tiltSpring * delta;
            ud.tiltVelocity.y += (targetTiltZ - ud.tilt.y) * tiltSpring * delta;
            ud.tiltVelocity.multiplyScalar(Math.exp(-tiltDamping * delta));
            ud.tilt.x += ud.tiltVelocity.x * delta;
            ud.tilt.y += ud.tiltVelocity.y * delta;
            bowl.rotation.x = ud.tilt.x;
            bowl.rotation.z = ud.tilt.y;
            ud.spin += speed * 0.6 * delta;
            ud.spin *= Math.exp(-1.8 * delta);
            bowl.rotation.y += ud.spin * delta;
            ud.glowIntensity += (ud.targetGlow - ud.glowIntensity) * 0.1;
            bowl.material.emissiveIntensity = ud.glowIntensity;
            if (this.hoveredBowl === bowl && !ud.isVibrating) {
                bowl.material.emissiveIntensity = Math.max(bowl.material.emissiveIntensity, 0.08);
            }
            const dist = Math.sqrt(bowl.position.x ** 2 + bowl.position.z ** 2);
            const edgeL = pondR - ud.size * 1.2;
            if (dist > edgeL) {
                const n = new THREE.Vector3(bowl.position.x, 0, bowl.position.z).normalize();
                const penetration = dist - edgeL;
                bowl.position.addScaledVector(n, -penetration);
                const vDotN = ud.velocity.dot(n);
                if (vDotN > 0) {
                    const restitution = 0.35;
                    const tangent = ud.velocity.clone().sub(n.clone().multiplyScalar(vDotN));
                    ud.velocity.sub(n.clone().multiplyScalar((1 + restitution) * vDotN));
                    ud.velocity.sub(tangent.multiplyScalar(0.2));
                }
                if (nowMs - ud.lastCollision > 800) {
                    this.playBowlSound(ud.frequency * 0.7, 2.0, 0.6);
                    ud.lastCollision = nowMs;
                }
            }
            for (let j = index + 1; j < this.bowls.length; j++) {
                const other = this.bowls[j];
                const od = other.userData;
                const d = bowl.position.distanceTo(other.position);
                const minD = (ud.size + od.size) * 1.05;
                if (d < minD && d > 0.0001) {
                    const n = bowl.position.clone().sub(other.position);
                    n.y = 0; n.normalize();
                    const relV = ud.velocity.clone().sub(od.velocity);
                    const vRel = relV.dot(n);
                    const invM1 = 1 / ud.mass, invM2 = 1 / od.mass;
                    if (vRel < 0) {
                        const restitution = 0.35;
                        const jN = -(1 + restitution) * vRel / (invM1 + invM2);
                        const impulse = n.clone().multiplyScalar(jN);
                        ud.velocity.add(impulse.clone().multiplyScalar(invM1));
                        od.velocity.sub(impulse.clone().multiplyScalar(invM2));
                        const tangent = relV.clone().sub(n.clone().multiplyScalar(vRel));
                        if (tangent.lengthSq() > 0.000001) {
                            tangent.normalize();
                            const jt = -relV.dot(tangent) / (invM1 + invM2);
                            const mu = 0.12;
                            const jtClamped = THREE.MathUtils.clamp(jt, -mu * jN, mu * jN);
                            const tImpulse = tangent.clone().multiplyScalar(jtClamped);
                            ud.velocity.add(tImpulse.clone().multiplyScalar(invM1));
                            od.velocity.sub(tImpulse.clone().multiplyScalar(invM2));
                        }
                        const cI = Math.min(Math.abs(jN) * 0.06, 1.0);
                        if (nowMs - ud.lastCollision > 400) {
                            this.playBowlSound(ud.frequency, 3.0, cI);
                            ud.lastCollision = nowMs; ud.isVibrating = true; ud.vibratingUntil = nowMs + 2500;
                        }
                        if (nowMs - od.lastCollision > 400) {
                            this.playBowlSound(od.frequency, 3.0, cI);
                            od.lastCollision = nowMs; od.isVibrating = true; od.vibratingUntil = nowMs + 2500;
                        }
                    }
                    const overlap = minD - d;
                    const slop = 0.01;
                    const correction = Math.max(overlap - slop, 0) / (invM1 + invM2);
                    const sep = n.clone().multiplyScalar(correction * 0.6);
                    bowl.position.add(sep.clone().multiplyScalar(invM1));
                    other.position.sub(sep.clone().multiplyScalar(invM2));
                }
            }
            if (ud.velocity.length() < 0.0004) {
                ud.velocity.add(new THREE.Vector3((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.03).multiplyScalar(delta));
            }
        });
    }

    updateFireflies() {
        const t = this.elapsedTime;
        const nightFactor = this.isNight ? 1.0 : 0.0;
        this.fireflies.forEach(ff => {
            const ud = ff.userData;
            ff.position.x = ud.basePosition.x + Math.sin(t * ud.speed * 0.3 + ud.phase) * ud.amplitude * 3;
            ff.position.y = ud.basePosition.y + Math.sin(t * ud.speed * 0.5 + ud.phase * 2) * ud.amplitude;
            ff.position.z = ud.basePosition.z + Math.cos(t * ud.speed * 0.4 + ud.phase * 1.5) * ud.amplitude * 3;
            const flicker = Math.max(0, Math.sin(t * ud.flickerSpeed + ud.flickerPhase));
            const targetOp = nightFactor * flicker * 0.8;
            ff.material.opacity += (targetOp - ff.material.opacity) * 0.1;
            if (ud.light) ud.light.intensity = nightFactor * flicker * 0.5;
        });
    }

    updateLilyPads() {
        const t = this.elapsedTime;
        this.lilyPads.forEach(pad => {
            const ud = pad.userData;
            pad.position.x = ud.baseX + Math.sin(t * 0.2 + ud.phase) * 0.15;
            pad.position.z = ud.baseZ + Math.cos(t * 0.25 + ud.phase * 1.3) * 0.15;
            pad.position.y = 0.17 + Math.sin(t * 0.8 + ud.phase) * 0.008;
            pad.rotation.x = -Math.PI / 2 + Math.sin(t * 0.5 + ud.phase) * 0.02;
        });
        this.lotusFlowers.forEach(flower => {
            const ud = flower.userData;
            flower.position.x = ud.baseX + Math.sin(t * 0.2 + ud.phase) * 0.15;
            flower.position.z = ud.baseZ + Math.cos(t * 0.25 + ud.phase * 1.3) * 0.15;
            flower.position.y = 0.22 + Math.sin(t * 0.8 + ud.phase) * 0.008;
            flower.rotation.y = t * 0.05;
        });
    }

    updateDayNight(delta) {
        const cycleDuration = this.dayDuration + this.nightDuration;
        this.dayCycleTime = (this.dayCycleTime + delta) % cycleDuration;
        this.isNight = this.dayCycleTime >= this.dayDuration;
        const dayValue = 0.5;
        const nightValue = 0.85;
        const transition = Math.min(this.transitionDuration, Math.min(this.dayDuration * 0.4, this.nightDuration * 0.4));
        const smoothstep = (x) => x * x * (3 - 2 * x);
        if (!this.isNight) {
            const t = this.dayCycleTime;
            if (t < transition) {
                const s = smoothstep(t / transition);
                this.targetDayProgress = nightValue + (dayValue - nightValue) * s;
            } else if (t > this.dayDuration - transition) {
                const s = smoothstep((t - (this.dayDuration - transition)) / transition);
                this.targetDayProgress = dayValue + (nightValue - dayValue) * s;
            } else {
                this.targetDayProgress = dayValue;
            }
        } else {
            const t = this.dayCycleTime - this.dayDuration;
            if (t < transition) {
                const s = smoothstep(t / transition);
                this.targetDayProgress = dayValue + (nightValue - dayValue) * s;
            } else if (t > this.nightDuration - transition) {
                const s = smoothstep((t - (this.nightDuration - transition)) / transition);
                this.targetDayProgress = nightValue + (dayValue - nightValue) * s;
            } else {
                this.targetDayProgress = nightValue;
            }
        }
        this.dayProgress += (this.targetDayProgress - this.dayProgress) * delta * 2.5;
        const sunElev = Math.sin(this.dayProgress * Math.PI);
        const sunAngle = this.dayProgress * Math.PI;
        this.lights.sun.position.set(40 * Math.cos(sunAngle), 60 * Math.max(0.1, sunElev), 30);
        this.lights.sun.intensity = Math.max(0.05, sunElev * 0.6);
        const warmth = 1 - sunElev;
        this.lights.sun.color.setRGB(1, 0.95 - warmth * 0.3, 0.88 - warmth * 0.5);
        this.lights.ambient.intensity = 0.08 + sunElev * 0.15;
        this.lights.hemisphere.intensity = 0.1 + sunElev * 0.25;
        this.lights.fill.intensity = sunElev * 0.15;
        this.lights.waterGlow.intensity = 0.2 + (1 - sunElev) * 0.6;
        this.lights.waterGlow.color.setHSL(0.6, 0.6, 0.5 + (1 - sunElev) * 0.2);
        if (this.skyDome) {
            const su = this.skyDome.material.uniforms;
            const dtc = new THREE.Color(0x0066aa), ntc = new THREE.Color(0x0a0a2e);
            const dbc = new THREE.Color(0xc8e6f0), nbc = new THREE.Color(0x1a1a3e);
            su.topColor.value.copy(dtc).lerp(ntc, 1 - sunElev);
            su.bottomColor.value.copy(dbc).lerp(nbc, 1 - sunElev);
        }
        const fogDay = new THREE.Color(0x87CEEB), fogNight = new THREE.Color(0x1a1a3e);
        this.scene.fog.color.copy(fogDay).lerp(fogNight, 1 - sunElev);
        this.renderer.toneMappingExposure = 0.35 + sunElev * 0.6;
        const dayNightBtn = document.getElementById('btn-daynight');
        if (dayNightBtn) dayNightBtn.classList.toggle('active', this.isNight);
    }

    updateAmbientEffects() {
        const t = this.elapsedTime;
        this.grassBlades.forEach(g => {
            const ws = 0.12 * Math.sin(t * 1.2 + g.userData.swayPhase);
            g.rotation.z = ws; g.rotation.x = ws * 0.4;
        });
        this.ambientParticles.forEach(p => {
            p.position.add(p.userData.velocity);
            p.position.y += 0.008 * Math.sin(t * 2 + p.userData.phase);
            if (p.position.x > 50) p.position.x = -50;
            if (p.position.x < -50) p.position.x = 50;
            if (p.position.z > 50) p.position.z = -50;
            if (p.position.z < -50) p.position.z = 50;
            if (p.position.y > 25) p.position.y = 2;
            if (p.position.y < 1) p.position.y = 25;
        });
        this.scene.children.forEach(child => {
            if (child.userData && child.userData.rotationSpeed) {
                child.rotation.z += child.userData.rotationSpeed;
                const offset = 0.4 * Math.sin(t + child.userData.phase);
                child.position.x = child.userData.originalPosition.x + offset;
                child.position.z = child.userData.originalPosition.z + offset * 0.6;
                if (child.material) child.material.opacity = 0.03 + 0.04 * Math.sin(t * 3 + child.userData.phase);
            }
        });
    }
    setupControls() {
        this.container.addEventListener('mousedown', (e) => {
            this.mouseDown = true;
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
            this.mouseMoved = false;
            this.updateMouseNDC(e);
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const hits = this.raycaster.intersectObjects(this.bowls, false);
            if (hits.length > 0) {
                this.draggedBowl = hits[0].object;
                this.container.style.cursor = 'grabbing';
            }
        });
        this.container.addEventListener('mouseup', (e) => {
            if (!this.mouseMoved) this.handleBowlClick(e);
            this.draggedBowl = null;
            this.mouseDown = false;
            this.container.style.cursor = 'grab';
        });
        this.container.addEventListener('mousemove', (e) => {
            this.updateMouseNDC(e);
            if (!this.mouseDown) {
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const hits = this.raycaster.intersectObjects(this.bowls, false);
                this.hoveredBowl = hits.length > 0 ? hits[0].object : null;
                this.container.style.cursor = this.hoveredBowl ? 'pointer' : 'grab';
                return;
            }
            const deltaX = e.clientX - this.mouseX;
            const deltaY = e.clientY - this.mouseY;
            if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) this.mouseMoved = true;
            if (this.draggedBowl) {
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersection = new THREE.Vector3();
                if (this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) {
                    const dist = Math.sqrt(intersection.x ** 2 + intersection.z ** 2);
                    if (dist < 9.0) {
                        const ud = this.draggedBowl.userData;
                        const prevX = this.draggedBowl.position.x;
                        const prevZ = this.draggedBowl.position.z;
                        this.draggedBowl.position.x = intersection.x;
                        this.draggedBowl.position.z = intersection.z;
                        ud.velocity.set((intersection.x - prevX) * 0.45, 0, (intersection.z - prevZ) * 0.45);
                    }
                }
            } else {
                this.orbit.targetTheta -= deltaX * 0.005;
                this.orbit.targetPhi = Math.max(0.3, Math.min(Math.PI * 0.45, this.orbit.targetPhi + deltaY * 0.005));
                this.orbit.autoOrbit = false;
                const ob = document.getElementById('btn-orbit');
                if (ob) ob.classList.remove('active');
            }
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        });
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zf = e.deltaY > 0 ? 1.08 : 0.92;
            this.orbit.targetRadius = Math.max(12, Math.min(70, this.orbit.targetRadius * zf));
        }, { passive: false });
        let touchStartX = 0, touchStartY = 0, touchDist = 0;
        this.container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                this.mouseMoved = false;
                this.updateMouseNDCFromTouch(e.touches[0]);
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const hits = this.raycaster.intersectObjects(this.bowls, false);
                if (hits.length > 0) this.draggedBowl = hits[0].object;
            } else if (e.touches.length === 2) {
                touchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            }
        }, { passive: false });
        this.container.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                const dx = e.touches[0].clientX - touchStartX;
                const dy = e.touches[0].clientY - touchStartY;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.mouseMoved = true;
                if (this.draggedBowl) {
                    this.updateMouseNDCFromTouch(e.touches[0]);
                    this.raycaster.setFromCamera(this.mouse, this.camera);
                    const intersection = new THREE.Vector3();
                    if (this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) {
                        const dist = Math.sqrt(intersection.x ** 2 + intersection.z ** 2);
                        if (dist < 9.0) {
                            const ud = this.draggedBowl.userData;
                            const prevX = this.draggedBowl.position.x;
                            const prevZ = this.draggedBowl.position.z;
                            this.draggedBowl.position.x = intersection.x;
                            this.draggedBowl.position.z = intersection.z;
                            ud.velocity.set((intersection.x - prevX) * 0.45, 0, (intersection.z - prevZ) * 0.45);
                        }
                    }
                } else {
                    this.orbit.targetTheta -= dx * 0.005;
                    this.orbit.targetPhi = Math.max(0.3, Math.min(Math.PI * 0.45, this.orbit.targetPhi + dy * 0.005));
                    this.orbit.autoOrbit = false;
                    const ob = document.getElementById('btn-orbit');
                    if (ob) ob.classList.remove('active');
                }
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                const newDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                this.orbit.targetRadius = Math.max(12, Math.min(70, this.orbit.targetRadius * (touchDist / newDist)));
                touchDist = newDist;
            }
        }, { passive: false });
        this.container.addEventListener('touchend', () => {
            if (this.draggedBowl && !this.mouseMoved) {
                const ud = this.draggedBowl.userData;
                this.playBowlSound(ud.frequency, 3.0, 1.05);
                ud.isVibrating = true;
                ud.vibratingUntil = Date.now() + 2500;
            }
            this.draggedBowl = null;
        });
        window.addEventListener('resize', () => this.handleResize());
    }

    updateMouseNDC(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    }

    updateMouseNDCFromTouch(touch) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -(((touch.clientY - rect.top) / rect.height) * 2 - 1);
    }

    handleBowlClick(e) {
        this.updateMouseNDC(e);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObjects(this.bowls, false);
        if (hits.length > 0) {
            const bowl = hits[0].object;
            const ud = bowl.userData;
            this.playBowlSound(ud.frequency, 3.0, 1.1);
            ud.isVibrating = true;
            ud.vibratingUntil = Date.now() + 2500;
            const fromCam = new THREE.Vector3().subVectors(bowl.position, this.camera.position).setY(0).normalize();
            ud.velocity.add(fromCam.multiplyScalar(0.025));
        }
    }

    setupUI() {
        const orbitBtn = document.getElementById('btn-orbit');
        const dayNightBtn = document.getElementById('btn-daynight');
        const muteBtn = document.getElementById('btn-mute');
        const boatBtn = document.getElementById('btn-boat');
        const scaleBtn = document.getElementById('btn-scale');
        if (orbitBtn) {
            orbitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.orbit.autoOrbit = !this.orbit.autoOrbit;
                orbitBtn.classList.toggle('active', this.orbit.autoOrbit);
            });
        }
        if (dayNightBtn) {
            dayNightBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isNight) {
                    this.dayCycleTime = 0;
                } else {
                    this.dayCycleTime = this.dayDuration;
                }
            });
        }
        if (muteBtn) {
            muteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.isMuted = !this.isMuted;
                muteBtn.classList.toggle('active', !this.isMuted);
                muteBtn.classList.toggle('muted', this.isMuted);
                if (this.masterGain) {
                    this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 1.0, this.audioContext.currentTime);
                }
            });
        }
        if (boatBtn) {
            boatBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.spawnRCBoat();
                boatBtn.classList.toggle('active', this.boatMode);
                if (this.boatMode) {
                    this.orbit.autoOrbit = false;
                    const ob = document.getElementById('btn-orbit');
                    if (ob) ob.classList.remove('active');
                }
            });
        }
        if (scaleBtn) {
            scaleBtn.title = 'Scale: Lydian';
            scaleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cycleScale();
                const scaleName = this.scales[this.scaleNames[this.currentScaleIndex]].name;
                scaleBtn.title = 'Scale: ' + scaleName;
                // Flash label briefly
                let label = document.getElementById('scale-label');
                if (!label) {
                    label = document.createElement('div');
                    label.id = 'scale-label';
                    label.style.cssText = 'position:absolute;bottom:80px;left:50%;transform:translateX(-50%);color:#fff;font-family:Inter,sans-serif;font-size:0.85rem;font-weight:300;background:rgba(255,255,255,0.1);backdrop-filter:blur(12px);padding:6px 16px;border-radius:20px;border:1px solid rgba(255,255,255,0.12);z-index:100;pointer-events:none;transition:opacity 0.5s;';
                    document.body.appendChild(label);
                }
                label.textContent = scaleName;
                label.style.opacity = '1';
                clearTimeout(label._hideTimer);
                label._hideTimer = setTimeout(() => { label.style.opacity = '0'; }, 1800);
            });
        }
    }

    cycleScale() {
        this.currentScaleIndex = (this.currentScaleIndex + 1) % this.scaleNames.length;
        const newScale = this.scales[this.scaleNames[this.currentScaleIndex]].notes;
        this.lydianScale = newScale;
        // Update existing bowl frequencies
        this.bowls.forEach((bowl, i) => {
            const ud = bowl.userData;
            ud.frequency = newScale[i % newScale.length] * (0.8 + ud.size * 0.4);
        });
    }

    smoothCameraUpdate(delta) {
        if (this.boatMode && this.rcBoat) {
            // Chase camera behind boat
            const camDist = 3.5;
            const camHeight = 1.8;
            const behindX = this.rcBoat.position.x - Math.cos(this.boatAngle) * camDist;
            const behindZ = this.rcBoat.position.z + Math.sin(this.boatAngle) * camDist;
            this.camera.position.x += (behindX - this.camera.position.x) * 4 * delta;
            this.camera.position.z += (behindZ - this.camera.position.z) * 4 * delta;
            this.camera.position.y += (camHeight - this.camera.position.y) * 4 * delta;
            const lookTarget = new THREE.Vector3(
                this.rcBoat.position.x + Math.cos(this.boatAngle) * 2,
                0.2,
                this.rcBoat.position.z - Math.sin(this.boatAngle) * 2
            );
            this.camera.lookAt(lookTarget);
            return;
        }
        const damping = 3.0;
        if (this.orbit.autoOrbit) this.orbit.targetTheta += this.orbit.speed * delta;
        this.orbit.theta += (this.orbit.targetTheta - this.orbit.theta) * damping * delta;
        this.orbit.phi += (this.orbit.targetPhi - this.orbit.phi) * damping * delta;
        this.orbit.radius += (this.orbit.targetRadius - this.orbit.radius) * damping * delta;
        const x = this.orbit.radius * Math.sin(this.orbit.phi) * Math.sin(this.orbit.theta);
        const y = this.orbit.radius * Math.cos(this.orbit.phi);
        const z = this.orbit.radius * Math.sin(this.orbit.phi) * Math.cos(this.orbit.theta);
        this.camera.position.set(x, Math.max(3, y), z);
        this.camera.lookAt(0, 1, 0);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = Math.min(this.clock.getDelta(), 0.05);
        this.elapsedTime += delta;
        this.updateWind(delta);
        this.smoothCameraUpdate(delta);
        this.updateDayNight(delta);
        this.updateBowlPhysics(delta);
        this.updateKoiFish(delta);
        this.updateRCBoat(delta);
        this.renderer.render(this.scene, this.camera);
    }

    handleResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
}

window.addEventListener('load', () => { new FloatingBowlsGarden(); });
window.addEventListener('DOMContentLoaded', () => { const l = document.querySelector('.loading'); if (l) l.remove(); });