// ========================================
// DECORATIONS.JS - Mall Decorations
// Mall Walk '92 - Vaporwave Experience
// ========================================

import * as THREE from 'three';
import { COLORS, MALL_CONFIG } from './scene.js';

export class Decorations {
    constructor(scene) {
        this.scene = scene;
        this.animatedObjects = [];
        this.waterParticles = [];
        this.dustParticles = null;
        this.groups = [];  // Track groups for disposal
        this.lightSwitch = null;  // Physical light switch for day/night toggle
        this.lightSwitchLight = null;  // Indicator light on switch
        
        // Performance: throttle updates
        this.updateCounter = 0;
        this.particleUpdateInterval = 2; // Update particles every 2nd frame
    }

    build() {
        this.createPalmTrees();
        this.createWaterFeature();
        this.createPlanters();
        this.createSculptures();
        this.createNeonAccents();
        this.createBenches();
        this.createCouches();
        this.createBathroomSection();
        this.createDustParticles();
        this.createLightBeams();
        this.createLightSwitch();
    }

    createLightSwitch() {
        // Create a physical light switch panel on a standing pedestal
        const switchGroup = new THREE.Group();
        switchGroup.name = 'lightSwitch';
        
        // Position in the aisle, near entrance but accessible
        const switchX = 11;  // Closer to center aisle for easier access
        const switchY = 1.2;  // Switch height on pedestal
        const switchZ = 40;  // Near front entrance
        
        // Pedestal/stand that extends to ground
        const pedestalMaterial = new THREE.MeshStandardMaterial({
            color: 0x3a3a4a,
            roughness: 0.4,
            metalness: 0.6
        });
        
        // Main pedestal column (extends from ground to switch)
        const pedestalHeight = switchY - 0.4;  // Height from ground to bottom of switch panel
        const pedestalGeometry = new THREE.BoxGeometry(0.4, pedestalHeight, 0.3);
        const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
        pedestal.position.set(0, -0.4 - pedestalHeight / 2, 0);  // Position below the switch
        switchGroup.add(pedestal);
        
        // Pedestal base (wider base for stability look)
        const baseGeometry = new THREE.BoxGeometry(0.6, 0.1, 0.5);
        const base = new THREE.Mesh(baseGeometry, pedestalMaterial);
        base.position.set(0, -0.4 - pedestalHeight - 0.05, 0);
        switchGroup.add(base);
        
        // Back plate (mounted on pedestal)
        const backPlateGeometry = new THREE.BoxGeometry(0.6, 0.8, 0.08);
        const backPlateMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a3a,
            roughness: 0.3,
            metalness: 0.7
        });
        const backPlate = new THREE.Mesh(backPlateGeometry, backPlateMaterial);
        switchGroup.add(backPlate);
        
        // Chrome frame around plate
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: 0xc0c0c0,
            roughness: 0.2,
            metalness: 0.9
        });
        
        // Frame pieces
        const frameThickness = 0.05;
        const frameDepth = 0.1;
        
        // Top frame
        const topFrame = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, frameThickness, frameDepth),
            frameMaterial
        );
        topFrame.position.set(0, 0.425, 0.02);
        switchGroup.add(topFrame);
        
        // Bottom frame
        const bottomFrame = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, frameThickness, frameDepth),
            frameMaterial
        );
        bottomFrame.position.set(0, -0.425, 0.02);
        switchGroup.add(bottomFrame);
        
        // Left frame
        const leftFrame = new THREE.Mesh(
            new THREE.BoxGeometry(frameThickness, 0.9, frameDepth),
            frameMaterial
        );
        leftFrame.position.set(-0.325, 0, 0.02);
        switchGroup.add(leftFrame);
        
        // Right frame
        const rightFrame = new THREE.Mesh(
            new THREE.BoxGeometry(frameThickness, 0.9, frameDepth),
            frameMaterial
        );
        rightFrame.position.set(0.325, 0, 0.02);
        switchGroup.add(rightFrame);
        
        // The actual switch lever
        const leverGeometry = new THREE.BoxGeometry(0.15, 0.25, 0.12);
        const leverMaterial = new THREE.MeshStandardMaterial({
            color: 0xeeeeee,
            roughness: 0.4,
            metalness: 0.3
        });
        const lever = new THREE.Mesh(leverGeometry, leverMaterial);
        lever.position.set(0, 0, 0.08);
        lever.name = 'switchLever';
        switchGroup.add(lever);
        
        // Indicator light (shows current state)
        const indicatorGeometry = new THREE.CircleGeometry(0.06, 16);
        const indicatorMaterial = new THREE.MeshStandardMaterial({
            color: 0xffff00,
            emissive: 0xffff00,
            emissiveIntensity: 0.8
        });
        const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
        indicator.position.set(0, 0.25, 0.05);
        indicator.name = 'switchIndicator';
        switchGroup.add(indicator);
        this.lightSwitchLight = indicator;
        
        // Label text "LIGHTS" - using a simple box as placeholder
        const labelGeometry = new THREE.BoxGeometry(0.35, 0.08, 0.01);
        const labelMaterial = new THREE.MeshStandardMaterial({
            color: 0x444444,
            roughness: 0.8
        });
        const label = new THREE.Mesh(labelGeometry, labelMaterial);
        label.position.set(0, -0.28, 0.05);
        switchGroup.add(label);
        
        // Neon glow around the switch for visibility
        const glowRingGeometry = new THREE.RingGeometry(0.42, 0.48, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: COLORS.neonGreen,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });
        const glowRing = new THREE.Mesh(glowRingGeometry, glowMaterial);
        glowRing.position.z = 0.01;
        switchGroup.add(glowRing);
        
        // Position the switch group
        switchGroup.position.set(switchX, switchY, switchZ);
        
        // Make the whole group interactive
        switchGroup.userData.isInteractive = true;
        switchGroup.userData.interactionType = 'lightSwitch';
        
        this.scene.add(switchGroup);
        this.lightSwitch = switchGroup;
        this.groups.push(switchGroup);
        
        // Also add a second switch near the back entrance
        const backSwitch = switchGroup.clone();
        backSwitch.position.set(-switchX, switchY, -switchZ);
        backSwitch.rotation.y = Math.PI;
        backSwitch.userData.isInteractive = true;
        backSwitch.userData.interactionType = 'lightSwitch';
        this.scene.add(backSwitch);
        this.groups.push(backSwitch);
    }

    getLightSwitch() {
        // Ensure matrices are up to date for raycasting
        if (this.lightSwitch) {
            this.lightSwitch.updateMatrixWorld(true);
        }
        return this.lightSwitch;
    }

    updateLightSwitchIndicator(isNightMode) {
        // Update the indicator light color based on mode
        if (this.lightSwitchLight) {
            if (isNightMode) {
                this.lightSwitchLight.material.color.setHex(0x4444ff);
                this.lightSwitchLight.material.emissive.setHex(0x4444ff);
            } else {
                this.lightSwitchLight.material.color.setHex(0xffff00);
                this.lightSwitchLight.material.emissive.setHex(0xffff00);
            }
        }
    }

    createDustParticles() {
        // Floating dust particles in the light beams (reduced count for performance)
        const particleCount = 50; // Reduced from 150
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 50;
            positions[i * 3 + 1] = Math.random() * 12;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            velocities.push({
                x: (Math.random() - 0.5) * 0.01,
                y: (Math.random() - 0.5) * 0.005,
                z: (Math.random() - 0.5) * 0.01
            });
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.05,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
        });
        
        this.dustParticles = new THREE.Points(geometry, material);
        this.dustParticles.userData.velocities = velocities;
        this.scene.add(this.dustParticles);
    }

    createLightBeams() {
        // Volumetric light beams from skylights
        const beamGroup = new THREE.Group();
        beamGroup.name = 'lightBeams';
        
        const beamMaterial = new THREE.MeshBasicMaterial({
            color: 0xfff5e6,
            transparent: true,
            opacity: 0.03,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        
        // Light beams coming from ceiling (2 floors high = floorHeight * 2)
        const ceilingHeight = MALL_CONFIG.floorHeight * MALL_CONFIG.floors;
        const beamHeight = ceilingHeight + 2;  // Full height from floor to skylight
        
        // Create several light beams coming from skylights
        for (let z = -40; z <= 40; z += 20) {
            const beamGeometry = new THREE.CylinderGeometry(2, 5, beamHeight, 8, 1, true);
            const beam = new THREE.Mesh(beamGeometry, beamMaterial);
            beam.position.set(0, beamHeight / 2, z);  // Center vertically from floor to ceiling
            beamGroup.add(beam);
        }
        
        this.scene.add(beamGroup);
    }

    createPalmTrees() {
        const palmGroup = new THREE.Group();
        palmGroup.name = 'palmTrees';

        // Palm tree positions (reduced for performance)
        const palmPositions = [
            // Central area palms
            { x: -8, z: -25, scale: 1.2 },
            { x: 8, z: -25, scale: 1.1 },
            { x: -8, z: 25, scale: 1.2 },
            { x: 8, z: 25, scale: 1.1 },
            // Along the sides
            { x: -10, z: -45, scale: 0.9 },
            { x: 10, z: -45, scale: 1.0 },
            { x: -10, z: 45, scale: 1.0 },
            { x: 10, z: 45, scale: 0.9 }
        ];

        palmPositions.forEach(pos => {
            const palm = this.createPalmTree(pos.x, pos.z, pos.scale);
            palmGroup.add(palm);
        });

        this.scene.add(palmGroup);
    }

    createPalmTree(x, z, scale = 1) {
        const palmGroup = new THREE.Group();
        const height = 8 * scale;

        // Trunk - simplified (no rings for better performance)
        const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.35, height, 6);
        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B7355,
            roughness: 0.9
        });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = height / 2;
        palmGroup.add(trunk);

        // Palm fronds (reduced count for performance)
        const frondMaterial = new THREE.MeshStandardMaterial({
            color: 0x228B22,
            side: THREE.DoubleSide,
            roughness: 0.6
        });

        const numFronds = 5;
        for (let i = 0; i < numFronds; i++) {
            const frond = this.createPalmFrond(frondMaterial);
            const angle = (i / numFronds) * Math.PI * 2;
            // Rotate fronds to droop downward naturally (negative Z rotation + tilt)
            frond.rotation.x = Math.PI * 0.6;  // Tilt forward/outward
            frond.rotation.z = -Math.PI / 4 - Math.random() * 0.3;  // Droop down
            frond.rotation.y = angle;
            frond.position.y = height - 0.2;  // Slightly lower attachment point
            frond.position.x = Math.cos(angle) * 0.3;
            frond.position.z = Math.sin(angle) * 0.3;
            frond.scale.setScalar(scale);
            palmGroup.add(frond);

            // Store for animation
            this.animatedObjects.push({
                object: frond,
                type: 'frond',
                originalRotation: frond.rotation.z,
                speed: 0.5 + Math.random() * 0.5,
                offset: Math.random() * Math.PI * 2
            });
        }

        // Planter at base (reduced segments)
        const planterGeometry = new THREE.CylinderGeometry(0.8, 0.6, 0.8, 6);
        const planterMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.teal,
            roughness: 0.3,
            metalness: 0.5
        });
        const planter = new THREE.Mesh(planterGeometry, planterMaterial);
        planter.position.y = 0.4;
        palmGroup.add(planter);

        // Soil
        const soilGeometry = new THREE.CylinderGeometry(0.7, 0.7, 0.1, 6);
        const soilMaterial = new THREE.MeshStandardMaterial({
            color: 0x3d2817,
            roughness: 1
        });
        const soil = new THREE.Mesh(soilGeometry, soilMaterial);
        soil.position.y = 0.8;
        palmGroup.add(soil);

        palmGroup.position.set(x, 0, z);
        return palmGroup;
    }

    createPalmFrond(material) {
        const shape = new THREE.Shape();
        const length = 3;
        const width = 0.8;

        shape.moveTo(0, 0);
        shape.quadraticCurveTo(width, length * 0.3, width * 0.8, length * 0.6);
        shape.quadraticCurveTo(width * 0.5, length * 0.8, 0.1, length);
        shape.quadraticCurveTo(-width * 0.5, length * 0.8, -width * 0.8, length * 0.6);
        shape.quadraticCurveTo(-width, length * 0.3, 0, 0);

        const geometry = new THREE.ShapeGeometry(shape);
        const frond = new THREE.Mesh(geometry, material);
        frond.rotation.x = -Math.PI / 2;
        return frond;
    }

    createWaterFeature() {
        const waterGroup = new THREE.Group();
        waterGroup.name = 'waterFeature';

        // ========================================
        // MAIN FOUNTAIN BASIN - Tiered octagonal design
        // ========================================
        
        // Outer basin ring (octagonal)
        const outerBasinGeometry = new THREE.CylinderGeometry(6, 6.5, 0.8, 8);
        const basinMaterial = new THREE.MeshStandardMaterial({
            color: 0xd4c4b4,  // Cream marble
            roughness: 0.2,
            metalness: 0.1
        });
        const outerBasin = new THREE.Mesh(outerBasinGeometry, basinMaterial);
        outerBasin.position.y = 0.4;
        waterGroup.add(outerBasin);
        
        // Inner basin wall (creates the lip)
        const innerWallGeometry = new THREE.CylinderGeometry(5.2, 5.2, 0.9, 8, 1, true);
        const innerWall = new THREE.Mesh(innerWallGeometry, basinMaterial);
        innerWall.position.y = 0.45;
        waterGroup.add(innerWall);
        
        // Basin floor (darker)
        const basinFloorGeometry = new THREE.CylinderGeometry(5.2, 5.2, 0.1, 8);
        const basinFloorMaterial = new THREE.MeshStandardMaterial({
            color: 0x446688,  // Blue-ish pool floor
            roughness: 0.4
        });
        const basinFloor = new THREE.Mesh(basinFloorGeometry, basinFloorMaterial);
        basinFloor.position.y = 0.05;
        waterGroup.add(basinFloor);
        
        // ========================================
        // WATER SURFACE with ripple effect
        // ========================================
        const waterGeometry = new THREE.CircleGeometry(5, 32);
        const waterMaterial = new THREE.MeshStandardMaterial({
            color: 0x40c8d8,
            transparent: true,
            opacity: 0.75,
            roughness: 0.05,
            metalness: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const water = new THREE.Mesh(waterGeometry, waterMaterial);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.55;
        waterGroup.add(water);
        
        // Store water for ripple animation
        this.animatedObjects.push({
            object: water,
            type: 'water',
            time: 0
        });
        
        // ========================================
        // CENTER PEDESTAL AND SCULPTURE
        // ========================================
        
        // Pedestal base (in water)
        const pedestalBase = new THREE.Mesh(
            new THREE.CylinderGeometry(1.2, 1.4, 0.3, 8),
            basinMaterial
        );
        pedestalBase.position.y = 0.55;
        waterGroup.add(pedestalBase);
        
        // Pedestal column
        const pedestalColumn = new THREE.Mesh(
            new THREE.CylinderGeometry(0.6, 0.8, 2.0, 8),
            new THREE.MeshStandardMaterial({
                color: 0xc8b8a8,
                roughness: 0.25,
                metalness: 0.15
            })
        );
        pedestalColumn.position.y = 1.7;
        waterGroup.add(pedestalColumn);
        
        // Upper bowl (water flows from here)
        const upperBowlGeometry = new THREE.CylinderGeometry(1.0, 0.6, 0.4, 12);
        const upperBowl = new THREE.Mesh(upperBowlGeometry, basinMaterial);
        upperBowl.position.y = 2.9;
        waterGroup.add(upperBowl);
        
        // Upper bowl water surface
        const upperWater = new THREE.Mesh(
            new THREE.CircleGeometry(0.9, 16),
            new THREE.MeshStandardMaterial({
                color: 0x60d8e8,
                transparent: true,
                opacity: 0.8,
                roughness: 0.05
            })
        );
        upperWater.rotation.x = -Math.PI / 2;
        upperWater.position.y = 3.05;
        waterGroup.add(upperWater);
        
        // ========================================
        // CENTER SPOUT - The main water jet
        // ========================================
        const spoutGeometry = new THREE.CylinderGeometry(0.15, 0.2, 0.8, 12);
        const spoutMaterial = new THREE.MeshStandardMaterial({
            color: 0x88aacc,
            metalness: 0.8,
            roughness: 0.15
        });
        const spout = new THREE.Mesh(spoutGeometry, spoutMaterial);
        spout.position.y = 3.4;
        waterGroup.add(spout);
        
        // Decorative top finial
        const finial = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 16, 12),
            spoutMaterial
        );
        finial.position.y = 3.95;
        waterGroup.add(finial);
        
        // ========================================
        // WATER JETS - Central and cascading
        // ========================================
        this.createImprovedWaterJets(waterGroup);
        
        // ========================================
        // CASCADING WATER EFFECT (from upper bowl)
        // ========================================
        this.createCascadingWater(waterGroup);
        
        // ========================================
        // DECORATIVE ELEMENTS
        // ========================================
        
        // Neon ring around outer basin
        const neonRingGeometry = new THREE.TorusGeometry(6.3, 0.06, 8, 32);
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonBlue,
            emissive: COLORS.neonBlue,
            emissiveIntensity: 1.5
        });
        const neonRing = new THREE.Mesh(neonRingGeometry, neonMaterial);
        neonRing.rotation.x = Math.PI / 2;
        neonRing.position.y = 0.82;
        waterGroup.add(neonRing);
        
        // Secondary neon ring (pink)
        const neonRing2 = new THREE.Mesh(
            new THREE.TorusGeometry(5.8, 0.04, 8, 32),
            new THREE.MeshStandardMaterial({
                color: COLORS.neonPink,
                emissive: COLORS.neonPink,
                emissiveIntensity: 1.2
            })
        );
        neonRing2.rotation.x = Math.PI / 2;
        neonRing2.position.y = 0.1;
        waterGroup.add(neonRing2);
        
        // Underwater lights
        const underwaterLightColors = [0x00ffff, 0xff00ff, 0x00ff88, 0xffff00];
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const light = new THREE.Mesh(
                new THREE.SphereGeometry(0.15, 8, 6),
                new THREE.MeshStandardMaterial({
                    color: underwaterLightColors[i],
                    emissive: underwaterLightColors[i],
                    emissiveIntensity: 2.0,
                    transparent: true,
                    opacity: 0.8
                })
            );
            light.position.set(
                Math.cos(angle) * 3.5,
                0.25,
                Math.sin(angle) * 3.5
            );
            waterGroup.add(light);
            
            // Store for animation
            this.animatedObjects.push({
                object: light,
                type: 'underwaterLight',
                baseIntensity: 2.0,
                phase: i * Math.PI / 2,
                time: 0
            });
        }
        
        // Coin glints on bottom (pennies!)
        for (let i = 0; i < 15; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 4;
            const coin = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 0.01, 8),
                new THREE.MeshStandardMaterial({
                    color: Math.random() > 0.5 ? 0xb87333 : 0xc0c0c0,  // Copper or silver
                    metalness: 0.9,
                    roughness: 0.3
                })
            );
            coin.position.set(
                Math.cos(angle) * dist,
                0.11,
                Math.sin(angle) * dist
            );
            coin.rotation.x = Math.random() * 0.2;
            waterGroup.add(coin);
        }
        
        // Position the fountain in the mall center
        waterGroup.position.set(0, 0, -15);
        this.scene.add(waterGroup);
    }

    createImprovedWaterJets(parent) {
        // ========================================
        // CENTRAL WATER JET (main upward spray)
        // ========================================
        const mainJetGroup = new THREE.Group();
        mainJetGroup.name = 'mainWaterJet';
        
        // Main jet stream (animated cylinder)
        const jetGeometry = new THREE.CylinderGeometry(0.08, 0.12, 1.8, 12, 4, true);
        const jetMaterial = new THREE.MeshStandardMaterial({
            color: 0xaaddff,
            transparent: true,
            opacity: 0.6,
            roughness: 0.05,
            side: THREE.DoubleSide
        });
        const mainJet = new THREE.Mesh(jetGeometry, jetMaterial);
        mainJet.position.y = 4.9;
        mainJetGroup.add(mainJet);
        
        // Jet spray top (spreading water)
        const sprayTop = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({
                color: 0xcceeff,
                transparent: true,
                opacity: 0.5
            })
        );
        sprayTop.position.y = 5.8;
        sprayTop.scale.set(1, 0.5, 1);
        mainJetGroup.add(sprayTop);
        
        parent.add(mainJetGroup);
        
        // Store for animation
        this.animatedObjects.push({
            object: mainJetGroup,
            type: 'jet',
            time: 0
        });
        
        // ========================================
        // SIDE SPRAY JETS (4 angled jets)
        // ========================================
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const sideJet = new THREE.Group();
            
            // Angled water stream
            const sideJetMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.05, 0.8, 8, 2, true),
                new THREE.MeshStandardMaterial({
                    color: 0xaaddff,
                    transparent: true,
                    opacity: 0.5
                })
            );
            sideJetMesh.position.y = 0.4;
            sideJet.add(sideJetMesh);
            
            sideJet.position.set(
                Math.cos(angle) * 0.5,
                3.8,
                Math.sin(angle) * 0.5
            );
            sideJet.rotation.z = -0.5;
            sideJet.rotation.y = -angle;
            
            parent.add(sideJet);
            
            this.animatedObjects.push({
                object: sideJet,
                type: 'sideJet',
                phase: i * Math.PI / 2,
                time: 0
            });
        }
        
        // ========================================
        // WATER DROPLETS/PARTICLES
        // ========================================
        const particleCount = 40;
        const particleGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.5;
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = 4.5 + Math.random() * 2;
            positions[i * 3 + 2] = Math.sin(angle) * radius;
            
            velocities.push({
                x: (Math.random() - 0.5) * 0.08,
                y: 0.05 + Math.random() * 0.1,
                z: (Math.random() - 0.5) * 0.08,
                life: Math.random()
            });
        }
        
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const particleMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.08,
            transparent: true,
            opacity: 0.7,
            sizeAttenuation: true
        });
        
        const particles = new THREE.Points(particleGeometry, particleMaterial);
        parent.add(particles);
        
        this.waterParticles.push({
            points: particles,
            velocities: velocities,
            positions: positions,
            baseY: 4.5
        });
    }

    createCascadingWater(parent) {
        // Water falling from upper bowl to lower basin
        const cascadeCount = 8;
        
        for (let i = 0; i < cascadeCount; i++) {
            const angle = (i / cascadeCount) * Math.PI * 2;
            
            // Water stream
            const streamGeometry = new THREE.CylinderGeometry(0.04, 0.06, 2.2, 6, 4, true);
            const streamMaterial = new THREE.MeshStandardMaterial({
                color: 0xaaddff,
                transparent: true,
                opacity: 0.4,
                roughness: 0.05,
                side: THREE.DoubleSide
            });
            
            const stream = new THREE.Mesh(streamGeometry, streamMaterial);
            stream.position.set(
                Math.cos(angle) * 0.85,
                1.8,
                Math.sin(angle) * 0.85
            );
            
            // Slight outward angle
            stream.rotation.z = 0.15;
            stream.rotation.y = -angle;
            
            parent.add(stream);
            
            // Splash at bottom
            const splash = new THREE.Mesh(
                new THREE.RingGeometry(0.1, 0.25, 12),
                new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    transparent: true,
                    opacity: 0.4,
                    side: THREE.DoubleSide
                })
            );
            splash.rotation.x = -Math.PI / 2;
            splash.position.set(
                Math.cos(angle) * 1.2,
                0.58,
                Math.sin(angle) * 1.2
            );
            parent.add(splash);
            
            // Store for animation
            this.animatedObjects.push({
                object: stream,
                type: 'cascade',
                phase: i * Math.PI / 4,
                time: 0
            });
        }
    }

    createWaterJet(parent) {
        // Legacy method - now handled by createImprovedWaterJets
        // Kept for compatibility
    }

    createPlanters() {
        const planterGroup = new THREE.Group();
        planterGroup.name = 'planters';

        // Geometric planters at various locations
        const planterPositions = [
            { x: -5, z: -40, type: 'square' },
            { x: 5, z: -40, type: 'square' },
            { x: -5, z: 40, type: 'hexagon' },
            { x: 5, z: 40, type: 'hexagon' },
            { x: -12, z: 0, type: 'round' },
            { x: 12, z: 0, type: 'round' }
        ];

        planterPositions.forEach(pos => {
            const planter = this.createPlanter(pos.type);
            planter.position.set(pos.x, 0, pos.z);
            planterGroup.add(planter);
        });

        this.scene.add(planterGroup);
    }

    createPlanter(type) {
        const planterGroup = new THREE.Group();
        let geometry;

        const colors = [COLORS.teal, COLORS.neonPink, COLORS.coral];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.3,
            metalness: 0.5
        });

        switch (type) {
            case 'square':
                geometry = new THREE.BoxGeometry(1.5, 1, 1.5);
                break;
            case 'hexagon':
                geometry = new THREE.CylinderGeometry(0.8, 0.8, 1, 6);
                break;
            case 'round':
            default:
                geometry = new THREE.CylinderGeometry(0.8, 0.6, 1, 16);
        }

        const planter = new THREE.Mesh(geometry, material);
        planter.position.y = 0.5;
        planter.castShadow = true;
        planter.receiveShadow = true;
        planterGroup.add(planter);

        // Add plants/bushes
        const bushGeometry = new THREE.SphereGeometry(0.6, 8, 8);
        const bushMaterial = new THREE.MeshStandardMaterial({
            color: 0x228B22,
            roughness: 0.8
        });

        for (let i = 0; i < 3; i++) {
            const bush = new THREE.Mesh(bushGeometry, bushMaterial);
            bush.position.set(
                (Math.random() - 0.5) * 0.5,
                1.2 + Math.random() * 0.3,
                (Math.random() - 0.5) * 0.5
            );
            bush.scale.setScalar(0.6 + Math.random() * 0.4);
            planterGroup.add(bush);
        }

        // Neon accent
        const neonGeometry = new THREE.BoxGeometry(1.6, 0.05, 1.6);
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonPink,
            emissive: COLORS.neonPink,
            emissiveIntensity: 1
        });
        const neon = new THREE.Mesh(neonGeometry, neonMaterial);
        neon.position.y = 0.02;
        planterGroup.add(neon);

        return planterGroup;
    }

    createSculptures() {
        const sculptureGroup = new THREE.Group();
        sculptureGroup.name = 'sculptures';

        // 80s/90s style abstract sculptures
        // Position 1: Geometric cube stack
        const cubeStack = this.createCubeStackSculpture();
        cubeStack.position.set(-8, 0, 15);
        sculptureGroup.add(cubeStack);

        // Position 2: Abstract figure (simplified bust)
        const bust = this.createAbstractBust();
        bust.position.set(8, 0, 15);
        sculptureGroup.add(bust);

        // Position 3: Sphere pyramid
        const spherePyramid = this.createSpherePyramid();
        spherePyramid.position.set(0, 0, 35);
        sculptureGroup.add(spherePyramid);

        this.scene.add(sculptureGroup);
    }

    createCubeStackSculpture() {
        const group = new THREE.Group();

        // Pedestal
        const pedestalGeometry = new THREE.CylinderGeometry(1.2, 1.4, 1, 16);
        const pedestalMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.marble,
            roughness: 0.2,
            metalness: 0.1
        });
        const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
        pedestal.position.y = 0.5;
        group.add(pedestal);

        // Stacked cubes at angles
        const colors = [COLORS.neonPink, COLORS.neonBlue, COLORS.neonYellow];
        const sizes = [0.8, 0.6, 0.4];

        sizes.forEach((size, i) => {
            const cubeGeometry = new THREE.BoxGeometry(size, size, size);
            const cubeMaterial = new THREE.MeshStandardMaterial({
                color: colors[i],
                emissive: colors[i],
                emissiveIntensity: 0.5,
                metalness: 0.5,
                roughness: 0.2
            });
            const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
            cube.position.y = 1.5 + i * 0.7;
            cube.rotation.y = i * 0.5;
            cube.rotation.x = 0.3;
            group.add(cube);

            this.animatedObjects.push({
                object: cube,
                type: 'rotate',
                speed: 0.3 + i * 0.1
            });
        });

        return group;
    }

    createAbstractBust() {
        const group = new THREE.Group();

        // Pedestal
        const pedestalGeometry = new THREE.BoxGeometry(1.5, 1, 1.5);
        const pedestalMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.marble,
            roughness: 0.2
        });
        const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
        pedestal.position.y = 0.5;
        group.add(pedestal);

        // Abstract head shape (vaporwave style)
        const headMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.softPurple,
            roughness: 0.3,
            metalness: 0.2
        });

        // Head
        const headGeometry = new THREE.SphereGeometry(0.5, 16, 16);
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 2.5;
        head.scale.set(1, 1.3, 1);
        group.add(head);

        // Neck
        const neckGeometry = new THREE.CylinderGeometry(0.25, 0.35, 0.8, 12);
        const neck = new THREE.Mesh(neckGeometry, headMaterial);
        neck.position.y = 1.8;
        group.add(neck);

        // Shoulders
        const shoulderGeometry = new THREE.BoxGeometry(1.2, 0.4, 0.6);
        const shoulders = new THREE.Mesh(shoulderGeometry, headMaterial);
        shoulders.position.y = 1.3;
        group.add(shoulders);

        // Glowing eyes
        const eyeMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonPink,
            emissive: COLORS.neonPink,
            emissiveIntensity: 2
        });

        [-0.15, 0.15].forEach(x => {
            const eyeGeometry = new THREE.SphereGeometry(0.08, 8, 8);
            const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
            eye.position.set(x, 2.5, 0.45);
            group.add(eye);
        });

        return group;
    }

    createSpherePyramid() {
        const group = new THREE.Group();

        // Base platform
        const baseGeometry = new THREE.CylinderGeometry(2, 2.2, 0.3, 8);
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.teal,
            metalness: 0.7,
            roughness: 0.2
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.y = 0.15;
        group.add(base);

        // Pyramid of chrome spheres
        const sphereMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.95,
            roughness: 0.05,
            envMapIntensity: 1
        });

        const layers = [
            { count: 6, radius: 1.2, y: 0.7, size: 0.4 },
            { count: 3, radius: 0.6, y: 1.4, size: 0.35 },
            { count: 1, radius: 0, y: 2, size: 0.4 }
        ];

        layers.forEach(layer => {
            for (let i = 0; i < layer.count; i++) {
                const angle = (i / layer.count) * Math.PI * 2;
                const sphereGeometry = new THREE.SphereGeometry(layer.size, 16, 16);
                const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
                sphere.position.set(
                    Math.cos(angle) * layer.radius,
                    layer.y,
                    Math.sin(angle) * layer.radius
                );
                sphere.castShadow = true;
                group.add(sphere);
            }
        });

        // Neon ring
        const neonGeometry = new THREE.TorusGeometry(2.1, 0.05, 8, 32);
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonPurple,
            emissive: COLORS.neonPurple,
            emissiveIntensity: 2
        });
        const neonRing = new THREE.Mesh(neonGeometry, neonMaterial);
        neonRing.rotation.x = Math.PI / 2;
        neonRing.position.y = 0.32;
        group.add(neonRing);

        return group;
    }

    createNeonAccents() {
        const neonGroup = new THREE.Group();
        neonGroup.name = 'neonAccents';

        // Neon strips along the floor edges
        const floorNeonPositions = [
            { x: -MALL_CONFIG.aisleWidth / 2, z: 0, length: MALL_CONFIG.length - 10 },
            { x: MALL_CONFIG.aisleWidth / 2, z: 0, length: MALL_CONFIG.length - 10 }
        ];

        const neonColors = [COLORS.neonPink, COLORS.neonBlue];

        floorNeonPositions.forEach((pos, i) => {
            const neonGeometry = new THREE.BoxGeometry(0.1, 0.1, pos.length);
            const neonMaterial = new THREE.MeshStandardMaterial({
                color: neonColors[i],
                emissive: neonColors[i],
                emissiveIntensity: 1.5
            });
            const neonStrip = new THREE.Mesh(neonGeometry, neonMaterial);
            neonStrip.position.set(pos.x, 0.05, pos.z);
            neonGroup.add(neonStrip);
        });

        this.scene.add(neonGroup);
    }

    createBenches() {
        const benchGroup = new THREE.Group();
        benchGroup.name = 'benches';

        const benchPositions = [
            { x: -8, z: -5, rotation: 0 },
            { x: 8, z: -5, rotation: Math.PI },
            { x: -8, z: 20, rotation: 0 },
            { x: 8, z: 20, rotation: Math.PI }
        ];

        benchPositions.forEach(pos => {
            const bench = this.createBench();
            bench.position.set(pos.x, 0, pos.z);
            bench.rotation.y = pos.rotation;
            benchGroup.add(bench);
        });

        this.scene.add(benchGroup);
    }

    createBench() {
        const benchGroup = new THREE.Group();

        // Seat
        const seatGeometry = new THREE.BoxGeometry(2, 0.15, 0.6);
        const seatMaterial = new THREE.MeshStandardMaterial({
            color: 0x404040,
            roughness: 0.6
        });
        const seat = new THREE.Mesh(seatGeometry, seatMaterial);
        seat.position.y = 0.5;
        benchGroup.add(seat);

        // Legs
        const legGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8);
        const legMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.9,
            roughness: 0.1
        });

        [[-0.8, -0.2], [-0.8, 0.2], [0.8, -0.2], [0.8, 0.2]].forEach(([x, z]) => {
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.position.set(x, 0.25, z);
            benchGroup.add(leg);
        });

        // Backrest
        const backrestGeometry = new THREE.BoxGeometry(2, 0.5, 0.1);
        const backrest = new THREE.Mesh(backrestGeometry, seatMaterial);
        backrest.position.set(0, 0.8, -0.3);
        backrest.rotation.x = 0.2;
        benchGroup.add(backrest);

        return benchGroup;
    }

    createCouches() {
        const couchGroup = new THREE.Group();
        couchGroup.name = 'couches';

        // Couch positions in seating areas
        const couchPositions = [
            { x: 0, z: -35, rotation: 0 },           // Near fountain area
            { x: 0, z: 40, rotation: Math.PI },      // Other end of mall
            { x: -6, z: 0, rotation: Math.PI / 2 },  // Center left
            { x: 6, z: 0, rotation: -Math.PI / 2 }   // Center right
        ];

        couchPositions.forEach(pos => {
            const couch = this.createCouch();
            couch.position.set(pos.x, 0, pos.z);
            couch.rotation.y = pos.rotation;
            couchGroup.add(couch);
        });

        this.scene.add(couchGroup);
    }

    createCouch() {
        const couchGroup = new THREE.Group();

        // Couch colors - pastel 90s aesthetic
        const cushionColors = [0xDDA0DD, 0x87CEEB, 0xFFB6C1, 0x98FB98];
        const cushionColor = cushionColors[Math.floor(Math.random() * cushionColors.length)];

        const cushionMaterial = new THREE.MeshStandardMaterial({
            color: cushionColor,
            roughness: 0.8
        });

        const frameMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.5
        });

        // Base/frame
        const baseGeometry = new THREE.BoxGeometry(3, 0.3, 1.2);
        const base = new THREE.Mesh(baseGeometry, frameMaterial);
        base.position.y = 0.15;
        couchGroup.add(base);

        // Seat cushion
        const seatGeometry = new THREE.BoxGeometry(2.8, 0.25, 1);
        const seat = new THREE.Mesh(seatGeometry, cushionMaterial);
        seat.position.set(0, 0.45, 0.05);
        couchGroup.add(seat);

        // Back cushion
        const backGeometry = new THREE.BoxGeometry(2.8, 0.8, 0.25);
        const back = new THREE.Mesh(backGeometry, cushionMaterial);
        back.position.set(0, 0.7, -0.5);
        back.rotation.x = 0.1;
        couchGroup.add(back);

        // Armrests
        const armrestGeometry = new THREE.BoxGeometry(0.2, 0.5, 1);
        [-1.4, 1.4].forEach(x => {
            const armrest = new THREE.Mesh(armrestGeometry, cushionMaterial);
            armrest.position.set(x, 0.55, 0);
            couchGroup.add(armrest);
        });

        // Decorative throw pillows
        const pillowGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.15);
        const pillowColors = [0xFF69B4, 0x00CED1, 0xFFD700];
        [-0.8, 0.8].forEach((x, i) => {
            const pillowMaterial = new THREE.MeshStandardMaterial({
                color: pillowColors[i % pillowColors.length],
                roughness: 0.9
            });
            const pillow = new THREE.Mesh(pillowGeometry, pillowMaterial);
            pillow.position.set(x, 0.7, 0);
            pillow.rotation.z = (Math.random() - 0.5) * 0.3;
            couchGroup.add(pillow);
        });

        // Coffee table in front
        const tableGeometry = new THREE.BoxGeometry(1.5, 0.4, 0.6);
        const tableMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.7,
            roughness: 0.3
        });
        const table = new THREE.Mesh(tableGeometry, tableMaterial);
        table.position.set(0, 0.2, 1);
        couchGroup.add(table);

        // Decorative plant on table
        const potGeometry = new THREE.CylinderGeometry(0.12, 0.1, 0.15, 8);
        const potMaterial = new THREE.MeshStandardMaterial({ color: COLORS.coral });
        const pot = new THREE.Mesh(potGeometry, potMaterial);
        pot.position.set(0.3, 0.48, 1);
        couchGroup.add(pot);

        const plantGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        const plantMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        const plant = new THREE.Mesh(plantGeometry, plantMaterial);
        plant.position.set(0.3, 0.65, 1);
        couchGroup.add(plant);

        return couchGroup;
    }

    createBathroomSection() {
        const bathroomGroup = new THREE.Group();
        bathroomGroup.name = 'bathroom';

        // Bathroom in back-left corner of the mall (not blocking entrance)
        const hallwayWidth = 6;
        const hallwayLength = 10;
        const hallwayHeight = MALL_CONFIG.floorHeight;
        // Position in the back-left corner, extending into the store area
        const hallwayX = -MALL_CONFIG.width / 2 + hallwayWidth / 2 + 2;
        const hallwayZ = MALL_CONFIG.length / 2 - hallwayLength - 2;

        // Hallway entrance frame (connects to main mall)
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.8,
            roughness: 0.2
        });

        // Entrance arch
        const archGeometry = new THREE.BoxGeometry(hallwayWidth + 1, 0.5, 0.5);
        const arch = new THREE.Mesh(archGeometry, frameMaterial);
        arch.position.set(hallwayX, hallwayHeight - 0.5, hallwayZ);
        bathroomGroup.add(arch);

        // Side posts
        [-hallwayWidth / 2 - 0.25, hallwayWidth / 2 + 0.25].forEach(x => {
            const postGeometry = new THREE.BoxGeometry(0.5, hallwayHeight, 0.5);
            const post = new THREE.Mesh(postGeometry, frameMaterial);
            post.position.set(hallwayX + x, hallwayHeight / 2, hallwayZ);
            bathroomGroup.add(post);
        });

        // Hallway floor
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0xe8e8e8,
            roughness: 0.3
        });
        const floorGeometry = new THREE.BoxGeometry(hallwayWidth, 0.1, hallwayLength);
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.set(hallwayX, 0.05, hallwayZ + hallwayLength / 2 + 0.5);
        bathroomGroup.add(floor);

        // Hallway walls
        const wallMaterial = new THREE.MeshStandardMaterial({
            color: 0xf5f5f5,
            roughness: 0.6
        });

        // Left wall
        const wallGeometry = new THREE.BoxGeometry(0.3, hallwayHeight, hallwayLength);
        const leftWall = new THREE.Mesh(wallGeometry, wallMaterial);
        leftWall.position.set(hallwayX - hallwayWidth / 2 - 0.15, hallwayHeight / 2, hallwayZ + hallwayLength / 2 + 0.5);
        bathroomGroup.add(leftWall);

        // Right wall
        const rightWall = new THREE.Mesh(wallGeometry, wallMaterial);
        rightWall.position.set(hallwayX + hallwayWidth / 2 + 0.15, hallwayHeight / 2, hallwayZ + hallwayLength / 2 + 0.5);
        bathroomGroup.add(rightWall);

        // Back wall
        const backWallGeometry = new THREE.BoxGeometry(hallwayWidth + 0.6, hallwayHeight, 0.3);
        const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
        backWall.position.set(hallwayX, hallwayHeight / 2, hallwayZ + hallwayLength + 0.65);
        bathroomGroup.add(backWall);

        // Hallway ceiling
        const ceilingGeometry = new THREE.BoxGeometry(hallwayWidth + 0.6, 0.3, hallwayLength + 0.5);
        const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xfafafa });
        const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
        ceiling.position.set(hallwayX, hallwayHeight, hallwayZ + hallwayLength / 2 + 0.5);
        bathroomGroup.add(ceiling);

        // RESTROOMS sign with canvas text
        const signBackGeometry = new THREE.BoxGeometry(3, 0.6, 0.1);
        const signBackMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a4a,
            roughness: 0.5
        });
        const signBack = new THREE.Mesh(signBackGeometry, signBackMaterial);
        signBack.position.set(hallwayX, hallwayHeight - 1, hallwayZ + 0.3);
        bathroomGroup.add(signBack);

        // Create canvas texture for RESTROOMS text
        const signCanvas = document.createElement('canvas');
        signCanvas.width = 256;
        signCanvas.height = 64;
        const signCtx = signCanvas.getContext('2d');
        signCtx.fillStyle = '#B5D8FF';
        signCtx.fillRect(0, 0, 256, 64);
        signCtx.fillStyle = '#1a1a2e';
        signCtx.font = 'bold 32px Arial, sans-serif';
        signCtx.textAlign = 'center';
        signCtx.textBaseline = 'middle';
        signCtx.fillText('RESTROOMS', 128, 32);

        const signTexture = new THREE.CanvasTexture(signCanvas);
        signTexture.colorSpace = THREE.SRGBColorSpace;

        const signFaceGeometry = new THREE.PlaneGeometry(2.8, 0.5);
        const signFaceMaterial = new THREE.MeshStandardMaterial({
            map: signTexture,
            emissive: COLORS.neonBlue,
            emissiveIntensity: 0.2
        });
        const signFace = new THREE.Mesh(signFaceGeometry, signFaceMaterial);
        signFace.position.set(hallwayX, hallwayHeight - 1, hallwayZ + 0.36);
        bathroomGroup.add(signFace);

        // Bathroom doors
        const doorMaterial = new THREE.MeshStandardMaterial({
            color: 0x666688,
            roughness: 0.4
        });

        // Men's room door (left)
        const doorGeometry = new THREE.BoxGeometry(2, 2.5, 0.1);
        const mensDoor = new THREE.Mesh(doorGeometry, doorMaterial);
        mensDoor.position.set(hallwayX - hallwayWidth / 4, 1.25, hallwayZ + hallwayLength);
        bathroomGroup.add(mensDoor);

        // Men's sign with canvas text
        const mensCanvas = document.createElement('canvas');
        mensCanvas.width = 128;
        mensCanvas.height = 64;
        const mensCtx = mensCanvas.getContext('2d');
        mensCtx.fillStyle = '#88BBFF';
        mensCtx.fillRect(0, 0, 128, 64);
        mensCtx.fillStyle = '#1a1a2e';
        mensCtx.font = 'bold 24px Arial, sans-serif';
        mensCtx.textAlign = 'center';
        mensCtx.textBaseline = 'middle';
        mensCtx.fillText('MEN', 64, 32);
        const mensTexture = new THREE.CanvasTexture(mensCanvas);
        mensTexture.colorSpace = THREE.SRGBColorSpace;

        const mensSignGeometry = new THREE.PlaneGeometry(1, 0.4);
        const mensSignMaterial = new THREE.MeshStandardMaterial({
            map: mensTexture,
            emissive: 0x4488CC,
            emissiveIntensity: 0.2
        });
        const mensSign = new THREE.Mesh(mensSignGeometry, mensSignMaterial);
        mensSign.position.set(hallwayX - hallwayWidth / 4, 2.2, hallwayZ + hallwayLength + 0.06);
        bathroomGroup.add(mensSign);

        // Women's room door (right)
        const womensDoor = new THREE.Mesh(doorGeometry, doorMaterial);
        womensDoor.position.set(hallwayX + hallwayWidth / 4, 1.25, hallwayZ + hallwayLength);
        bathroomGroup.add(womensDoor);

        // Women's sign with canvas text
        const womensCanvas = document.createElement('canvas');
        womensCanvas.width = 128;
        womensCanvas.height = 64;
        const womensCtx = womensCanvas.getContext('2d');
        womensCtx.fillStyle = '#FFB5C5';
        womensCtx.fillRect(0, 0, 128, 64);
        womensCtx.fillStyle = '#1a1a2e';
        womensCtx.font = 'bold 20px Arial, sans-serif';
        womensCtx.textAlign = 'center';
        womensCtx.textBaseline = 'middle';
        womensCtx.fillText('WOMEN', 64, 32);
        const womensTexture = new THREE.CanvasTexture(womensCanvas);
        womensTexture.colorSpace = THREE.SRGBColorSpace;

        const womensSignMaterial = new THREE.MeshStandardMaterial({
            map: womensTexture,
            emissive: 0xCC4488,
            emissiveIntensity: 0.2
        });
        const womensSign = new THREE.Mesh(mensSignGeometry, womensSignMaterial);
        womensSign.position.set(hallwayX + hallwayWidth / 4, 2.2, hallwayZ + hallwayLength + 0.06);
        bathroomGroup.add(womensSign);

        // Ceiling lights in hallway
        const lightMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.warmWhite,
            emissive: COLORS.warmWhite,
            emissiveIntensity: 0.6
        });

        for (let z = hallwayZ + 3; z < hallwayZ + hallwayLength; z += 4) {
            const lightGeometry = new THREE.BoxGeometry(0.8, 0.1, 0.4);
            const light = new THREE.Mesh(lightGeometry, lightMaterial);
            light.position.set(hallwayX, hallwayHeight - 0.2, z);
            bathroomGroup.add(light);
        }

        // Neon accent strip along floor
        const neonStripGeometry = new THREE.BoxGeometry(0.1, 0.1, hallwayLength);
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonPink,
            emissive: COLORS.neonPink,
            emissiveIntensity: 1.5
        });
        
        [-hallwayWidth / 2 + 0.2, hallwayWidth / 2 - 0.2].forEach(x => {
            const strip = new THREE.Mesh(neonStripGeometry, neonMaterial);
            strip.position.set(hallwayX + x, 0.15, hallwayZ + hallwayLength / 2 + 0.5);
            bathroomGroup.add(strip);
        });

        this.scene.add(bathroomGroup);
    }

    update(deltaTime, time) {
        // Validate inputs to prevent NaN propagation
        if (!deltaTime || isNaN(deltaTime)) deltaTime = 0.016;
        if (!time || isNaN(time)) time = 0;
        
        // Use safe time value to prevent floating point issues with large numbers
        const safeTime = time % 10000;
        
        // Performance: increment update counter
        this.updateCounter++;
        const shouldUpdateParticles = (this.updateCounter % this.particleUpdateInterval) === 0;
        
        // Animate palm fronds and other objects (lightweight, run every frame)
        this.animatedObjects.forEach(item => {
            if (!item || !item.object) return;
            
            switch (item.type) {
                case 'frond':
                    if (item.originalRotation !== undefined) {
                        const offset = item.offset || 0;
                        const speed = item.speed || 1;
                        item.object.rotation.z = item.originalRotation + 
                            Math.sin(safeTime * speed + offset) * 0.05;
                    }
                    break;
                case 'water':
                    // Subtle wave effect on water surface with ripples
                    item.object.position.y = 0.55 + Math.sin(safeTime * 2) * 0.015 + Math.sin(safeTime * 3.7) * 0.01;
                    break;
                case 'jet':
                    // Pulsing water jet with scale and position variation
                    item.object.scale.y = 1 + Math.sin(safeTime * 5) * 0.12;
                    item.object.scale.x = 1 + Math.sin(safeTime * 4) * 0.05;
                    item.object.scale.z = 1 + Math.sin(safeTime * 4.5) * 0.05;
                    item.object.position.y = Math.sin(safeTime * 3) * 0.03;
                    break;
                case 'sideJet':
                    // Side jets pulse with phase offset
                    const phase = item.phase || 0;
                    item.object.scale.y = 0.8 + Math.sin(safeTime * 4 + phase) * 0.3;
                    break;
                case 'cascade':
                    // Cascading water slight variation
                    const cascadePhase = item.phase || 0;
                    item.object.scale.y = 1 + Math.sin(safeTime * 3 + cascadePhase) * 0.08;
                    item.object.material.opacity = 0.35 + Math.sin(safeTime * 2 + cascadePhase) * 0.1;
                    break;
                case 'underwaterLight':
                    // Pulsing underwater lights
                    const lightPhase = item.phase || 0;
                    const intensity = item.baseIntensity || 2.0;
                    item.object.material.emissiveIntensity = intensity * (0.7 + Math.sin(safeTime * 1.5 + lightPhase) * 0.3);
                    break;
                case 'rotate':
                    const rotSpeed = item.speed || 0.5;
                    item.object.rotation.y += deltaTime * rotSpeed;
                    // Prevent rotation from growing too large
                    if (item.object.rotation.y > Math.PI * 2) {
                        item.object.rotation.y -= Math.PI * 2;
                    }
                    break;
            }
        });

        // Update water particles (throttled for performance)
        if (shouldUpdateParticles) {
        this.waterParticles.forEach(particle => {
            if (!particle || !particle.points || !particle.points.geometry) return;
            
            const positions = particle.points.geometry.attributes.position;
            if (!positions) return;
            
            const posArray = positions.array;
            const velocities = particle.velocities;
            const baseY = particle.baseY || 3;
            
            if (!velocities) return;
            
            const particleCount = Math.min(posArray.length / 3, velocities.length);
            
            for (let i = 0; i < particleCount; i++) {
                const vel = velocities[i];
                if (!vel) continue;
                
                // Move particles
                posArray[i * 3] += vel.x;
                posArray[i * 3 + 1] += vel.y - 0.015; // Gravity
                posArray[i * 3 + 2] += vel.z;
                
                // Life cycle for particles
                if (vel.life !== undefined) {
                    vel.life -= deltaTime * 0.5;
                    if (vel.life <= 0) {
                        // Reset particle
                        const angle = Math.random() * Math.PI * 2;
                        const radius = Math.random() * 0.3;
                        posArray[i * 3] = Math.cos(angle) * radius;
                        posArray[i * 3 + 1] = baseY + 1 + Math.random() * 1.5;
                        posArray[i * 3 + 2] = Math.sin(angle) * radius;
                        vel.x = (Math.random() - 0.5) * 0.08;
                        vel.y = 0.03 + Math.random() * 0.08;
                        vel.z = (Math.random() - 0.5) * 0.08;
                        vel.life = 0.5 + Math.random() * 0.5;
                    }
                }

                // Reset particles that fall below water level or have invalid values
                if (posArray[i * 3 + 1] < 0.6 || isNaN(posArray[i * 3 + 1])) {
                    const angle = Math.random() * Math.PI * 2;
                    const radius = Math.random() * 0.3;
                    posArray[i * 3] = Math.cos(angle) * radius;
                    posArray[i * 3 + 1] = baseY + Math.random() * 1.5;
                    posArray[i * 3 + 2] = Math.sin(angle) * radius;
                    vel.y = Math.random() * 0.1;
                }
            }
            
            positions.needsUpdate = true;
        });
        } // end water particles throttle

        // Update dust particles (throttled for performance)
        if (shouldUpdateParticles && this.dustParticles && this.dustParticles.geometry) {
            const positions = this.dustParticles.geometry.attributes.position;
            if (!positions) return;
            
            const posArray = positions.array;
            const velocities = this.dustParticles.userData.velocities;
            
            if (!velocities || velocities.length === 0) return;
            
            const particleCount = Math.min(posArray.length / 3, velocities.length);
            
            for (let i = 0; i < particleCount; i++) {
                const vel = velocities[i];
                if (!vel) continue;
                
                posArray[i * 3] += vel.x;
                posArray[i * 3 + 1] += vel.y;
                posArray[i * 3 + 2] += vel.z;
                
                // Add gentle floating motion (use time modulo to prevent large values)
                const safeTime = time % 1000;
                posArray[i * 3 + 1] += Math.sin(safeTime + i * 0.1) * 0.002;
                
                // Wrap around bounds with safety checks
                if (posArray[i * 3] > 25 || isNaN(posArray[i * 3])) posArray[i * 3] = -25;
                if (posArray[i * 3] < -25) posArray[i * 3] = 25;
                if (posArray[i * 3 + 1] > 12 || isNaN(posArray[i * 3 + 1])) posArray[i * 3 + 1] = 0.5;
                if (posArray[i * 3 + 1] < 0.5) posArray[i * 3 + 1] = 12;
                if (posArray[i * 3 + 2] > 50 || isNaN(posArray[i * 3 + 2])) posArray[i * 3 + 2] = -50;
                if (posArray[i * 3 + 2] < -50) posArray[i * 3 + 2] = 50;
            }
            
            positions.needsUpdate = true;
        }
    }
}

export default Decorations;
