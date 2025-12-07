// ========================================
// SCENE.JS - Three.js Scene Setup
// Mall Walk '92 - Vaporwave Experience
// ========================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Vaporwave color palette
export const COLORS = {
    neonPink: 0xff71ce,
    neonBlue: 0x01cdfe,
    neonGreen: 0x05ffa1,
    neonPurple: 0xb967ff,
    neonYellow: 0xfffb96,
    deepPurple: 0x1a0a2e,
    softPurple: 0xdda0dd,
    coral: 0xff7f50,
    teal: 0x00ced1,
    chrome: 0xc0c0c0,
    white: 0xffffff,
    warmWhite: 0xfff5e6,
    skyPink: 0xffafbd,
    skyOrange: 0xffc3a0,
    marble: 0xf5f5f5,
    marblePink: 0xffe4e9,
    marbleTeal: 0xe0f7f7
};

// Scene dimensions
export const MALL_CONFIG = {
    width: 80,      // Mall width (X axis)
    length: 120,    // Mall length (Z axis)
    floorHeight: 8, // Height per floor (increased from 6 to give more headroom for store signs)
    floors: 2,      // Number of floors
    aisleWidth: 25, // Central aisle width
    storeDepth: 12, // Depth of stores
    railingHeight: 1.2,
    escalatorWidth: 4,
    escalatorLength: 12
};

// Scene class
export class MallScene {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.clock = new THREE.Clock();
        this.container = null;
        this.daySkyTexture = null;
        this.nightSkyTexture = null;
        this.isNightMode = false;  // Start in day mode
    }

    init(container) {
        this.container = container;

        // Create scene - start in daytime
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xd4e6f1);  // Light blue daytime sky

        // Add fog for atmosphere - lighter for daytime
        this.scene.fog = new THREE.FogExp2(0xd4e6f1, 0.004);
        
        // Load sky textures for day/night backgrounds
        this.loadSkyTextures();

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            500
        );
        this.camera.position.set(0, 2, 0);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Limit pixel ratio for performance
        this.renderer.shadowMap.enabled = false; // Disable shadows for better performance
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;  // Ensure proper color output

        container.appendChild(this.renderer.domElement);

        // Setup post-processing for bloom effect
        this.setupPostProcessing();

        // Setup lighting
        this.setupLighting();

        // Create skylight
        this.createSkylight();

        // Handle window resize with debouncing
        this.resizeTimeout = null;
        window.addEventListener('resize', () => {
            // Debounce resize events
            if (this.resizeTimeout) {
                clearTimeout(this.resizeTimeout);
            }
            this.resizeTimeout = setTimeout(() => this.onWindowResize(), 100);
        });

        return this;
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Bloom disabled for better performance - neon glow achieved via emissive materials
        // Uncomment below to re-enable bloom if needed:
        /*
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
            0.3,   // Bloom strength
            0.2,   // Radius
            0.95   // Threshold
        );
        this.composer.addPass(bloomPass);
        */
    }

    loadSkyTextures() {
        const textureLoader = new THREE.TextureLoader();
        
        // Load day sky texture
        textureLoader.load(
            'assets/sky.jpg',
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.mapping = THREE.EquirectangularReflectionMapping;
                this.daySkyTexture = texture;
                // Apply day sky immediately if in day mode
                if (!this.isNightMode) {
                    this.scene.background = this.daySkyTexture;
                }
            },
            undefined,
            (error) => {
                console.log('Day sky texture not found, using fallback color');
            }
        );
        
        // Load night sky texture with stars
        textureLoader.load(
            'assets/night.jpg',
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.mapping = THREE.EquirectangularReflectionMapping;
                this.nightSkyTexture = texture;
            },
            undefined,
            (error) => {
                console.log('Night sky texture not found, using fallback color');
            }
        );
    }

    setupLighting() {
        // Store lights for day/night toggle
        this.lights = {
            ambient: null,
            skylight: null,
            fill: null,
            hemi: null,
            accents: []
        };
        
        this.isNightMode = false;
        
        // Ambient light - bright for daytime
        this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.lights.ambient);

        // Main skylight - warm white from above (bright for day)
        this.lights.skylight = new THREE.DirectionalLight(0xfffaf0, 1.2);
        this.lights.skylight.position.set(0, 50, 0);
        this.scene.add(this.lights.skylight);

        // Secondary fill light - subtle in day
        this.lights.fill = new THREE.DirectionalLight(0xfff5e6, 0.4);
        this.lights.fill.position.set(-30, 20, 20);
        this.scene.add(this.lights.fill);

        // Hemisphere light for natural sky/ground color blend
        this.lights.hemi = new THREE.HemisphereLight(
            0x87CEEB,         // Day sky color (light blue)
            COLORS.marble,    // Ground color
            0.5
        );
        this.scene.add(this.lights.hemi);

        // Add colored accent lights throughout the mall
        this.addAccentLights();
    }

    toggleDayNight() {
        this.isNightMode = !this.isNightMode;
        
        if (this.isNightMode) {
            // Night mode - cool blue vaporwave aesthetic with night sky
            this.scene.fog = new THREE.FogExp2(0x0a1628, 0.008);  // Dark blue fog
            
            // Set night sky background
            if (this.nightSkyTexture) {
                this.scene.background = this.nightSkyTexture;
            } else {
                this.scene.background = new THREE.Color(0x0a1628);  // Dark blue
            }
            
            this.lights.ambient.color.setHex(0x8090b0);  // Cool blue-gray ambient
            this.lights.ambient.intensity = 0.35;
            
            this.lights.skylight.color.setHex(0xc0d0e0);  // Cool white
            this.lights.skylight.intensity = 0.4;
            
            this.lights.fill.color.setHex(0x4080c0);  // Blue fill instead of pink
            this.lights.fill.intensity = 0.25;
            
            this.lights.hemi.color.setHex(0x6080a0);  // Cool blue hemisphere
            this.lights.hemi.intensity = 0.35;
            
            // Make accent lights more visible
            this.lights.accents.forEach(light => {
                light.intensity = 1.5;
            });
            
            // Update skylight plane to night sky
            if (this.skylightPlane && this.skylightNightMaterial) {
                this.skylightPlane.material = this.skylightNightMaterial;
            } else if (this.skylightPlane) {
                this.skylightPlane.material.color.setHex(0x0a1628);  // Dark blue
            }
        } else {
            // Day mode - bright mall with day sky
            if (this.daySkyTexture) {
                this.scene.background = this.daySkyTexture;
            } else {
                this.scene.background = new THREE.Color(0xd4e6f1);
            }
            this.scene.fog = new THREE.FogExp2(0xd4e6f1, 0.004);
            
            this.lights.ambient.color.setHex(0xffffff);
            this.lights.ambient.intensity = 0.6;
            
            this.lights.skylight.color.setHex(0xfffaf0);
            this.lights.skylight.intensity = 1.2;
            
            this.lights.fill.color.setHex(0xfff5e6);
            this.lights.fill.intensity = 0.4;
            
            this.lights.hemi.color.setHex(0x87CEEB);
            this.lights.hemi.intensity = 0.5;
            
            // Dim accent lights for day
            this.lights.accents.forEach(light => {
                light.intensity = 0.5;
            });
            
            // Update skylight plane to day sky
            if (this.skylightPlane && this.skylightDayMaterial) {
                this.skylightPlane.material = this.skylightDayMaterial;
            } else if (this.skylightPlane) {
                this.skylightPlane.material.color.setHex(0x87CEEB);
            }
        }
        
        return this.isNightMode;
    }
    
    // Set day/night mode directly (for network sync)
    setDayNight(isNight) {
        if (this.isNightMode !== isNight) {
            this.toggleDayNight();
        }
        return this.isNightMode;
    }

    addAccentLights() {
        const accentPositions = [
            { pos: [-15, 8, -30], color: COLORS.neonPink },
            { pos: [15, 8, -30], color: COLORS.neonBlue },
            { pos: [-15, 8, 0], color: COLORS.neonPurple },
            { pos: [15, 8, 0], color: COLORS.neonGreen },
            { pos: [-15, 8, 30], color: COLORS.neonBlue },
            { pos: [15, 8, 30], color: COLORS.neonPink },
            { pos: [0, 8, -45], color: COLORS.neonPurple },
            { pos: [0, 8, 45], color: COLORS.teal }
        ];

        accentPositions.forEach(({ pos, color }) => {
            const light = new THREE.PointLight(color, 0.5, 30);  // Dimmer for daytime
            light.position.set(...pos);
            this.scene.add(light);
            this.lights.accents.push(light);
        });
    }

    createSkylight() {
        // Glass skylight structure
        const skylightGroup = new THREE.Group();
        skylightGroup.name = 'skylight';

        // Load sky texture for realistic sky behind glass (with fallback)
        const textureLoader = new THREE.TextureLoader();
        
        // Create sky geometry
        const skyGeometry = new THREE.PlaneGeometry(120, 180);
        
        // Create a fallback gradient material
        const fallbackSkyMaterial = new THREE.MeshBasicMaterial({
            color: 0x87CEEB,  // Light blue sky color
            side: THREE.DoubleSide
        });

        this.skylightPlane = new THREE.Mesh(skyGeometry, fallbackSkyMaterial);
        this.skylightPlane.rotation.x = Math.PI / 2;
        this.skylightPlane.position.y = MALL_CONFIG.floorHeight * MALL_CONFIG.floors + 5;
        skylightGroup.add(this.skylightPlane);
        
        // Store texture references for skylight
        this.skylightDayMaterial = null;
        this.skylightNightMaterial = null;
        
        // Try to load day sky texture asynchronously (non-blocking)
        textureLoader.load(
            'assets/sky.jpg',
            (skyTexture) => {
                skyTexture.colorSpace = THREE.SRGBColorSpace;
                this.skylightDayMaterial = new THREE.MeshBasicMaterial({
                    map: skyTexture,
                    side: THREE.DoubleSide
                });
                // Apply if in day mode
                if (!this.isNightMode && this.skylightPlane) {
                    this.skylightPlane.material.dispose();
                    this.skylightPlane.material = this.skylightDayMaterial;
                }
            },
            undefined,
            (error) => {
                console.log('Sky texture not found, using fallback color');
            }
        );
        
        // Load night sky texture
        textureLoader.load(
            'assets/night.jpg',
            (nightTexture) => {
                nightTexture.colorSpace = THREE.SRGBColorSpace;
                this.skylightNightMaterial = new THREE.MeshBasicMaterial({
                    map: nightTexture,
                    side: THREE.DoubleSide
                });
            },
            undefined,
            (error) => {
                console.log('Night sky texture not found, using fallback color');
            }
        );

        // Glass panels (simplified for performance) - extend to full mall length
        const glassGeometry = new THREE.PlaneGeometry(MALL_CONFIG.aisleWidth, MALL_CONFIG.length);
        const glassMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.white,
            transparent: true,
            opacity: 0.15,
            roughness: 0.1
        });

        const glass = new THREE.Mesh(glassGeometry, glassMaterial);
        glass.rotation.x = -Math.PI / 2;
        glass.position.y = MALL_CONFIG.floorHeight * MALL_CONFIG.floors + 2;
        skylightGroup.add(glass);

        // Skylight frame/beams
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.teal,
            metalness: 0.8,
            roughness: 0.2
        });

        const ceilingHeight = MALL_CONFIG.floorHeight * MALL_CONFIG.floors;
        const storeAreaWidth = (MALL_CONFIG.width - MALL_CONFIG.aisleWidth) / 2;
        
        // Add extra length to beams so they embed into walls (walls are 0.5 thick)
        const beamLengthZ = MALL_CONFIG.length + 1;  // Extra length to meet/embed in walls
        const beamLengthX = MALL_CONFIG.width + 1;   // Extra width to meet/embed in walls

        // Longitudinal beams over the glass skylight area - extend to full mall length
        for (let i = -2; i <= 2; i++) {
            const beamGeometry = new THREE.BoxGeometry(0.3, 0.5, beamLengthZ);
            const beam = new THREE.Mesh(beamGeometry, frameMaterial);
            beam.position.set(i * (MALL_CONFIG.aisleWidth / 8), ceilingHeight + 2.3, 0);
            skylightGroup.add(beam);
        }

        // Additional longitudinal beams over store areas (reaching from front to back wall)
        [-1, 1].forEach(side => {
            // Beams over store ceilings - 2 beams per side
            for (let offset = 1; offset <= 2; offset++) {
                const storeBeam = new THREE.Mesh(
                    new THREE.BoxGeometry(0.3, 0.4, beamLengthZ),
                    frameMaterial
                );
                storeBeam.position.set(
                    side * (MALL_CONFIG.aisleWidth / 2 + (storeAreaWidth / 3) * offset),
                    ceilingHeight + 0.2,
                    0
                );
                skylightGroup.add(storeBeam);
            }
        });

        // Cross beams - EXTEND TO FULL MALL WIDTH (reaching outer walls)
        for (let z = -MALL_CONFIG.length / 2; z <= MALL_CONFIG.length / 2; z += 10) {
            const crossBeamGeometry = new THREE.BoxGeometry(beamLengthX, 0.3, 0.3);
            const crossBeam = new THREE.Mesh(crossBeamGeometry, frameMaterial);
            crossBeam.position.set(0, ceilingHeight + 0.15, z);  // At ceiling level
            skylightGroup.add(crossBeam);
        }

        // Edge beams along skylight opening edges (where glass meets solid ceiling)
        const edgeBeamMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.teal,
            metalness: 0.8,
            roughness: 0.2
        });

        // Left and right edge beams at the skylight opening - running the length of the mall
        [-1, 1].forEach(side => {
            const edgeBeam = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.5, beamLengthZ),
                edgeBeamMaterial
            );
            edgeBeam.position.set(
                side * (MALL_CONFIG.aisleWidth / 2),
                ceilingHeight + 0.25,
                0
            );
            skylightGroup.add(edgeBeam);
        });

        // Outer wall edge beams - where ceiling meets outer walls
        [-1, 1].forEach(side => {
            const outerBeam = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.5, beamLengthZ),
                edgeBeamMaterial
            );
            outerBeam.position.set(
                side * (MALL_CONFIG.width / 2 - 0.25),
                ceilingHeight + 0.25,
                0
            );
            skylightGroup.add(outerBeam);
        });

        // Front and back wall edge beams
        [-1, 1].forEach(side => {
            const endBeam = new THREE.Mesh(
                new THREE.BoxGeometry(beamLengthX, 0.5, 0.5),
                edgeBeamMaterial
            );
            endBeam.position.set(
                0,
                ceilingHeight + 0.25,
                side * (MALL_CONFIG.length / 2 - 0.25)
            );
            skylightGroup.add(endBeam);
        });

        // Corner posts at outer mall corners
        const cornerPostMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.teal,
            metalness: 0.7,
            roughness: 0.3
        });

        [-1, 1].forEach(sideX => {
            [-1, 1].forEach(sideZ => {
                const post = new THREE.Mesh(
                    new THREE.BoxGeometry(0.4, ceilingHeight + 0.5, 0.4),
                    cornerPostMaterial
                );
                post.position.set(
                    sideX * (MALL_CONFIG.width / 2 - 0.5),
                    (ceilingHeight + 0.5) / 2,
                    sideZ * (MALL_CONFIG.length / 2 - 0.5)
                );
                skylightGroup.add(post);
            });
        });

        // Corner posts at skylight opening corners
        [-1, 1].forEach(sideX => {
            [-1, 1].forEach(sideZ => {
                const post = new THREE.Mesh(
                    new THREE.BoxGeometry(0.3, ceilingHeight + 0.5, 0.3),
                    cornerPostMaterial
                );
                post.position.set(
                    sideX * (MALL_CONFIG.aisleWidth / 2 - 0.3),
                    (ceilingHeight + 0.5) / 2,
                    sideZ * (MALL_CONFIG.length / 2 - 0.5)
                );
                skylightGroup.add(post);
            });
        });

        this.scene.add(skylightGroup);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        // Use composer for bloom effect
        this.composer.render();
    }

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.camera;
    }

    getRenderer() {
        return this.renderer;
    }

    getClock() {
        return this.clock;
    }

    dispose() {
        // Clean up resize listener
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        
        // Dispose of composer passes
        if (this.composer) {
            this.composer.passes.forEach(pass => {
                if (pass.dispose) pass.dispose();
            });
        }
        
        // Dispose of renderer
        if (this.renderer) {
            this.renderer.dispose();
        }
        
        // Traverse scene and dispose of all geometries and materials
        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => {
                            if (material.map) material.map.dispose();
                            material.dispose();
                        });
                    } else {
                        if (object.material.map) object.material.map.dispose();
                        object.material.dispose();
                    }
                }
            });
        }
        
        console.log('Scene resources disposed');
    }
}

export default MallScene;
