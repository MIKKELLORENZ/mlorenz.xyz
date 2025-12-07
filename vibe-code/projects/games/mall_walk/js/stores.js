// ========================================
// STORES.JS - Storefronts with Neon Signs
// Mall Walk '92 - Vaporwave Experience
// ========================================

import * as THREE from 'three';
import { COLORS, MALL_CONFIG } from './scene.js';

export class Stores {
    constructor(scene) {
        this.scene = scene;
        this.storeData = [];
        this.animatedSigns = [];
    }

    build() {
        // Define stores - inspired by 90s mall classics
        const stores = [
            // Left side - Ground floor
            { name: 'SAM GOODY', x: -MALL_CONFIG.width / 2 + 6, z: -40, side: 'left', floor: 0, color: COLORS.neonBlue, hasMusic: true, type: 'music' },
            { name: 'BLOCKBUSTER', x: -MALL_CONFIG.width / 2 + 6, z: -25, side: 'left', floor: 0, color: COLORS.neonYellow, type: 'generic' },
            { name: 'PETLAND', x: -MALL_CONFIG.width / 2 + 6, z: -10, side: 'left', floor: 0, color: COLORS.neonGreen, type: 'petstore' },
            { name: 'ARCADE', x: -MALL_CONFIG.width / 2 + 6, z: 5, side: 'left', floor: 0, color: COLORS.neonPurple, hasMusic: true, type: 'generic' },
            { name: 'SUNCOAST', x: -MALL_CONFIG.width / 2 + 6, z: 20, side: 'left', floor: 0, color: COLORS.neonPink, type: 'generic' },
            { name: "CLAIRE'S", x: -MALL_CONFIG.width / 2 + 6, z: 35, side: 'left', floor: 0, color: COLORS.neonPink, type: 'clothing' },

            // Right side - Ground floor
            { name: 'THE GAP', x: MALL_CONFIG.width / 2 - 6, z: -40, side: 'right', floor: 0, color: COLORS.neonBlue, type: 'clothing' },
            { name: "SPENCER'S", x: MALL_CONFIG.width / 2 - 6, z: -25, side: 'right', floor: 0, color: COLORS.neonPurple, type: 'generic' },
            { name: 'KB TOYS', x: MALL_CONFIG.width / 2 - 6, z: -10, side: 'right', floor: 0, color: COLORS.neonPink, type: 'generic' },
            { name: 'JAVA CAFE', x: MALL_CONFIG.width / 2 - 6, z: 5, side: 'right', floor: 0, color: COLORS.coral, hasMusic: true, type: 'cafe' },
            { name: 'HOT TOPIC', x: MALL_CONFIG.width / 2 - 6, z: 20, side: 'right', floor: 0, color: COLORS.neonPurple, type: 'clothing' },
            { name: 'FOOT LOCKER', x: MALL_CONFIG.width / 2 - 6, z: 35, side: 'right', floor: 0, color: COLORS.coral, type: 'generic' },

            // Left side - Second floor
            { name: 'WALDENBOOKS', x: -MALL_CONFIG.width / 2 + 6, z: -35, side: 'left', floor: 1, color: COLORS.neonGreen, type: 'generic' },
            { name: 'SEARS', x: -MALL_CONFIG.width / 2 + 6, z: -15, side: 'left', floor: 1, color: COLORS.neonBlue, type: 'clothing' },
            { name: 'B. DALTON', x: -MALL_CONFIG.width / 2 + 6, z: 5, side: 'left', floor: 1, color: COLORS.neonYellow, type: 'generic' },
            { name: 'JCPENNEY', x: -MALL_CONFIG.width / 2 + 6, z: 25, side: 'left', floor: 1, color: COLORS.coral, type: 'clothing' },

            // Right side - Second floor
            { name: 'MACY\'S', x: MALL_CONFIG.width / 2 - 6, z: -35, side: 'right', floor: 1, color: COLORS.neonPink, type: 'clothing' },
            { name: 'EXPRESS', x: MALL_CONFIG.width / 2 - 6, z: -15, side: 'right', floor: 1, color: COLORS.neonPurple, type: 'clothing' },
            { name: 'MUSICLAND', x: MALL_CONFIG.width / 2 - 6, z: 5, side: 'right', floor: 1, color: COLORS.neonBlue, hasMusic: true, type: 'music' },
            { name: 'LIMITED TOO', x: MALL_CONFIG.width / 2 - 6, z: 25, side: 'right', floor: 1, color: COLORS.neonPink, type: 'clothing' }
        ];

        stores.forEach(store => {
            this.createStore(store);
        });
    }

    createStore(storeConfig) {
        const storeGroup = new THREE.Group();
        storeGroup.name = `store_${storeConfig.name}`;

        const y = storeConfig.floor * MALL_CONFIG.floorHeight;
        const storeWidth = 12;
        const storeHeight = MALL_CONFIG.floorHeight - 0.5;
        const storeDepth = MALL_CONFIG.storeDepth;

        // Determine rotation based on side
        const facingAngle = storeConfig.side === 'left' ? Math.PI / 2 : -Math.PI / 2;

        // Store back wall
        const backWallGeometry = new THREE.BoxGeometry(storeWidth, storeHeight, 0.3);
        const backWallMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.8
        });
        const backWall = new THREE.Mesh(backWallGeometry, backWallMaterial);
        backWall.position.set(0, storeHeight / 2, -storeDepth / 2);
        storeGroup.add(backWall);

        // Side walls
        const sideWallGeometry = new THREE.BoxGeometry(0.3, storeHeight, storeDepth);
        const sideWallMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a3e,
            roughness: 0.7
        });

        [-storeWidth / 2, storeWidth / 2].forEach(x => {
            const sideWall = new THREE.Mesh(sideWallGeometry, sideWallMaterial);
            sideWall.position.set(x, storeHeight / 2, 0);
            storeGroup.add(sideWall);
        });

        // Store floor
        const floorGeometry = new THREE.BoxGeometry(storeWidth - 0.6, 0.1, storeDepth);
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x333344,
            roughness: 0.5
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.y = 0.05;
        storeGroup.add(floor);

        // Glass storefront (simplified for performance)
        const glassGeometry = new THREE.BoxGeometry(storeWidth - 2, storeHeight - 1, 0.1);
        const glassMaterial = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0.2,
            roughness: 0.1,
            metalness: 0.1
        });
        const glass = new THREE.Mesh(glassGeometry, glassMaterial);
        glass.position.set(0, storeHeight / 2 + 0.3, storeDepth / 2 - 0.5);
        storeGroup.add(glass);

        // Door area (gap in glass)
        const doorFrameGeometry = new THREE.BoxGeometry(0.2, storeHeight - 1, 0.2);
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.9,
            roughness: 0.1
        });

        [-1.5, 1.5].forEach(x => {
            const frame = new THREE.Mesh(doorFrameGeometry, frameMaterial);
            frame.position.set(x, storeHeight / 2 + 0.3, storeDepth / 2 - 0.5);
            storeGroup.add(frame);
        });

        // Store header/awning - slightly recessed to make room for sign
        const headerGeometry = new THREE.BoxGeometry(storeWidth, 1.0, 0.8);
        const headerMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.5
        });
        const header = new THREE.Mesh(headerGeometry, headerMaterial);
        header.position.set(0, storeHeight - 0.5, storeDepth / 2 - 0.1);
        storeGroup.add(header);

        // Neon sign - positioned further out to avoid clipping with header
        const sign = this.createNeonSign(storeConfig.name, storeConfig.color, storeWidth);
        sign.position.set(0, storeHeight - 0.6, storeDepth / 2 + 0.8);
        storeGroup.add(sign);

        // Interior lighting removed for performance - neon signs provide enough glow

        // Interior decoration (simplified)
        this.addInteriorDecoration(storeGroup, storeConfig, storeWidth, storeHeight, storeDepth);

        // Neon border around storefront
        this.addNeonBorder(storeGroup, storeConfig.color, storeWidth, storeHeight, storeDepth);

        // Position and rotate the store
        storeGroup.position.set(storeConfig.x, y, storeConfig.z);
        storeGroup.rotation.y = facingAngle;

        this.scene.add(storeGroup);

        // Store data for audio positioning
        this.storeData.push({
            name: storeConfig.name,
            position: new THREE.Vector3(storeConfig.x, y + 1, storeConfig.z),
            hasMusic: storeConfig.hasMusic || false,
            color: storeConfig.color
        });
    }

    createNeonSign(text, color, maxWidth) {
        const signGroup = new THREE.Group();

        // Calculate dimensions based on text length
        const textLength = text.length;
        const signWidth = Math.min(maxWidth - 1, textLength * 0.6 + 1);
        const signHeight = 1.0;

        // Convert neon color to pastel version for better readability
        const pastelColors = {
            [COLORS.neonPink]: '#FFB5C5',      // Pastel pink
            [COLORS.neonBlue]: '#B5D8FF',      // Pastel blue
            [COLORS.neonGreen]: '#B5FFD8',     // Pastel green
            [COLORS.neonPurple]: '#D8B5FF',    // Pastel purple
            [COLORS.neonYellow]: '#FFF5B5',    // Pastel yellow
            [COLORS.coral]: '#FFD8B5',         // Pastel coral
            [COLORS.teal]: '#B5FFF5'           // Pastel teal
        };
        const pastelColorHex = pastelColors[color] || '#FFFFFF';

        // Main sign background (dark backing)
        const backingGeometry = new THREE.BoxGeometry(signWidth + 0.4, signHeight + 0.3, 0.15);
        const backingMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.8
        });
        const backing = new THREE.Mesh(backingGeometry, backingMaterial);
        backing.position.z = -0.05;
        signGroup.add(backing);

        // Create canvas texture for the sign text
        const canvas = document.createElement('canvas');
        const canvasWidth = 512;
        const canvasHeight = 128;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');

        // Fill background with pastel color
        ctx.fillStyle = pastelColorHex;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Draw text
        ctx.fillStyle = '#1a1a2e';  // Dark text color
        ctx.font = 'bold 48px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        // Sign face with text texture
        const signFaceGeometry = new THREE.PlaneGeometry(signWidth, signHeight);
        const signFaceMaterial = new THREE.MeshStandardMaterial({
            map: texture,
            emissive: color,
            emissiveIntensity: 0.2,
            roughness: 0.4,
            metalness: 0.1
        });
        const signFace = new THREE.Mesh(signFaceGeometry, signFaceMaterial);
        signFace.position.z = 0.03;
        signGroup.add(signFace);

        // Subtle glow light
        const glowLight = new THREE.PointLight(color, 0.5, 8);
        glowLight.position.z = 0.5;
        signGroup.add(glowLight);

        // Store for animation
        this.animatedSigns.push({
            group: signGroup,
            color: color,
            light: glowLight,
            time: Math.random() * Math.PI * 2,
            baseIntensity: 0.5
        });

        return signGroup;
    }

    addNeonBorder(storeGroup, color, width, height, depth) {
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 1.5
        });

        const thickness = 0.05;
        // Push neon border forward to avoid z-fighting with walls
        const zPos = depth / 2 + 0.1;

        // Top border
        const topGeometry = new THREE.BoxGeometry(width + 0.1, thickness, thickness);
        const top = new THREE.Mesh(topGeometry, neonMaterial);
        top.position.set(0, height + 0.6, zPos);
        storeGroup.add(top);

        // Bottom border
        const bottom = new THREE.Mesh(topGeometry, neonMaterial);
        bottom.position.set(0, 0.6, zPos);
        storeGroup.add(bottom);

        // Side borders - adjust to connect with top/bottom
        const sideGeometry = new THREE.BoxGeometry(thickness, height + 0.1, thickness);
        
        [-width / 2 - 0.025, width / 2 + 0.025].forEach(x => {
            const side = new THREE.Mesh(sideGeometry, neonMaterial);
            side.position.set(x, height / 2 + 0.55, zPos);
            storeGroup.add(side);
        });
    }

    addInteriorDecoration(storeGroup, storeConfig, width, height, depth) {
        // Create unique interiors based on store type
        const storeType = storeConfig.type || 'generic';
        
        switch (storeType) {
            case 'clothing':
                this.createClothingInterior(storeGroup, width, height, depth, storeConfig.color);
                break;
            case 'music':
                this.createMusicInterior(storeGroup, width, height, depth, storeConfig.color);
                break;
            case 'laundry':
                this.createLaundryInterior(storeGroup, width, height, depth, storeConfig.color);
                break;
            case 'cafe':
                this.createCafeInterior(storeGroup, width, height, depth, storeConfig.color);
                break;
            case 'petstore':
                this.createPetStoreInterior(storeGroup, width, height, depth, storeConfig.color);
                break;
            default:
                this.createGenericInterior(storeGroup, width, height, depth, storeConfig.color);
        }
    }

    createClothingInterior(storeGroup, width, height, depth, accentColor) {
        // Clothing racks
        const rackMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 });
        
        for (let z = -depth / 3; z <= depth / 4; z += depth / 3) {
            // Circular rack
            const rackGeometry = new THREE.TorusGeometry(1, 0.03, 8, 16);
            const rack = new THREE.Mesh(rackGeometry, rackMaterial);
            rack.rotation.x = Math.PI / 2;
            rack.position.set(z < 0 ? -2 : 2, 1.5, z);
            storeGroup.add(rack);
            
            // Pole
            const poleGeometry = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8);
            const pole = new THREE.Mesh(poleGeometry, rackMaterial);
            pole.position.set(z < 0 ? -2 : 2, 0.75, z);
            storeGroup.add(pole);
            
            // Hanging clothes (simple boxes)
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const clothGeometry = new THREE.BoxGeometry(0.4, 0.6, 0.1);
                const clothMaterial = new THREE.MeshStandardMaterial({
                    color: [0xff6b9d, 0x6bb5ff, 0xffeb6b, 0xb56bff, 0x6bffb5][i % 5]
                });
                const cloth = new THREE.Mesh(clothGeometry, clothMaterial);
                cloth.position.set(
                    (z < 0 ? -2 : 2) + Math.cos(angle) * 0.8,
                    1.2,
                    z + Math.sin(angle) * 0.8
                );
                storeGroup.add(cloth);
            }
        }
        
        // Mannequin in window
        this.createMannequin(storeGroup, 0, 0, depth / 3, accentColor);
    }

    createMusicInterior(storeGroup, width, height, depth, accentColor) {
        // Record bins
        const binMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.8 });
        
        for (let x = -width / 3; x <= width / 3; x += width / 3) {
            const binGeometry = new THREE.BoxGeometry(2, 1, 0.8);
            const bin = new THREE.Mesh(binGeometry, binMaterial);
            bin.position.set(x, 0.5, -depth / 3);
            storeGroup.add(bin);
            
            // Records in bin
            for (let r = 0; r < 8; r++) {
                const recordGeometry = new THREE.BoxGeometry(0.02, 0.8, 0.8);
                const recordMaterial = new THREE.MeshStandardMaterial({
                    color: [0x111111, 0x222222, 0x1a1a2e][r % 3]
                });
                const record = new THREE.Mesh(recordGeometry, recordMaterial);
                record.position.set(x - 0.8 + r * 0.2, 1.1, -depth / 3);
                record.rotation.z = 0.1 + Math.random() * 0.1;
                storeGroup.add(record);
            }
        }
        
        // CD wall display
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a3e });
        const wallDisplay = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, height * 0.4, 0.2), wallMaterial);
        wallDisplay.position.set(0, height * 0.5, -depth / 2 + 0.3);
        storeGroup.add(wallDisplay);
        
        // CD cases on wall
        for (let cx = -2; cx <= 2; cx++) {
            for (let cy = 0; cy < 3; cy++) {
                const cdGeometry = new THREE.BoxGeometry(0.4, 0.5, 0.05);
                const cdMaterial = new THREE.MeshStandardMaterial({
                    color: [0xff71ce, 0x01cdfe, 0xb967ff, 0x05ffa1][Math.floor(Math.random() * 4)],
                    emissive: accentColor,
                    emissiveIntensity: 0.1
                });
                const cd = new THREE.Mesh(cdGeometry, cdMaterial);
                cd.position.set(cx * 0.5, height * 0.35 + cy * 0.6, -depth / 2 + 0.5);
                storeGroup.add(cd);
            }
        }
    }

    createLaundryInterior(storeGroup, width, height, depth, accentColor) {
        // Washing machines row
        const machineMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3 });
        const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5 });
        
        for (let x = -width / 3; x <= width / 3; x += width / 4) {
            // Machine body
            const machineGeometry = new THREE.BoxGeometry(1.2, 1.5, 1);
            const machine = new THREE.Mesh(machineGeometry, machineMaterial);
            machine.position.set(x, 0.75, -depth / 3);
            storeGroup.add(machine);
            
            // Door circle
            const doorGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 16);
            const door = new THREE.Mesh(doorGeometry, doorMaterial);
            door.rotation.x = Math.PI / 2;
            door.position.set(x, 0.8, -depth / 3 + 0.55);
            storeGroup.add(door);
            
            // Blue water effect inside
            const waterGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16);
            const waterMaterial = new THREE.MeshStandardMaterial({
                color: 0x4488ff,
                emissive: 0x2244aa,
                emissiveIntensity: 0.3,
                transparent: true,
                opacity: 0.7
            });
            const water = new THREE.Mesh(waterGeometry, waterMaterial);
            water.rotation.x = Math.PI / 2;
            water.position.set(x, 0.8, -depth / 3 + 0.5);
            storeGroup.add(water);
        }
        
        // Folding table
        const tableGeometry = new THREE.BoxGeometry(width * 0.5, 0.1, 1.5);
        const tableMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });
        const table = new THREE.Mesh(tableGeometry, tableMaterial);
        table.position.set(0, 1, depth / 4);
        storeGroup.add(table);
    }

    createCafeInterior(storeGroup, width, height, depth, accentColor) {
        // Counter with coffee machines
        const counterGeometry = new THREE.BoxGeometry(width * 0.7, 1.2, 1);
        const counterMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.6 });
        const counter = new THREE.Mesh(counterGeometry, counterMaterial);
        counter.position.set(0, 0.6, -depth / 3);
        storeGroup.add(counter);
        
        // Coffee machine
        const machineGeometry = new THREE.BoxGeometry(0.6, 0.8, 0.4);
        const machineMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7 });
        const machine = new THREE.Mesh(machineGeometry, machineMaterial);
        machine.position.set(-1, 1.6, -depth / 3);
        storeGroup.add(machine);
        
        // Menu board
        const boardGeometry = new THREE.BoxGeometry(3, 1.5, 0.1);
        const boardMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
        const board = new THREE.Mesh(boardGeometry, boardMaterial);
        board.position.set(0, height * 0.6, -depth / 2 + 0.2);
        storeGroup.add(board);
        
        // Tables and chairs
        for (let t = 0; t < 2; t++) {
            const tableX = t === 0 ? -2 : 2;
            
            // Small table
            const smallTableGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.05, 8);
            const smallTable = new THREE.Mesh(smallTableGeometry, counterMaterial);
            smallTable.position.set(tableX, 0.8, depth / 4);
            storeGroup.add(smallTable);
            
            // Table leg
            const legGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8);
            const leg = new THREE.Mesh(legGeometry, machineMaterial);
            leg.position.set(tableX, 0.4, depth / 4);
            storeGroup.add(leg);
            
            // Chairs
            for (let c = 0; c < 2; c++) {
                const chairGeometry = new THREE.BoxGeometry(0.4, 0.5, 0.4);
                const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
                const chair = new THREE.Mesh(chairGeometry, chairMaterial);
                chair.position.set(tableX + (c === 0 ? -0.7 : 0.7), 0.25, depth / 4);
                storeGroup.add(chair);
            }
        }
    }

    createGenericInterior(storeGroup, width, height, depth, accentColor) {
        // Original generic interior with shelves
        const shelfMaterial = new THREE.MeshStandardMaterial({
            color: 0x444455,
            roughness: 0.7
        });

        const shelfGeometry = new THREE.BoxGeometry(width * 0.8, 0.1, 1);

        for (let y = 1.5; y < height - 1; y += 1.5) {
            const shelf = new THREE.Mesh(shelfGeometry, shelfMaterial);
            shelf.position.set(0, y, -depth / 2 + 1);
            storeGroup.add(shelf);

            // Add some "products" on shelves
            this.addProducts(storeGroup, width * 0.8, y + 0.1, -depth / 2 + 1, accentColor);
        }

        // Counter near front
        const counterGeometry = new THREE.BoxGeometry(3, 1, 1);
        const counterMaterial = new THREE.MeshStandardMaterial({
            color: 0x3a3a4a,
            roughness: 0.5
        });
        const counter = new THREE.Mesh(counterGeometry, counterMaterial);
        counter.position.set(width / 4, 0.5, depth / 4);
        storeGroup.add(counter);

        // Register on counter
        const registerGeometry = new THREE.BoxGeometry(0.5, 0.4, 0.4);
        const registerMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a3a,
            roughness: 0.6
        });
        const register = new THREE.Mesh(registerGeometry, registerMaterial);
        register.position.set(width / 4, 1.2, depth / 4);
        storeGroup.add(register);
    }

    createPetStoreInterior(storeGroup, width, height, depth, accentColor) {
        // Fish tanks along back wall
        const tankMaterial = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0.4,
            roughness: 0.1
        });
        const tankFrameMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.5
        });

        // Row of fish tanks
        for (let x = -width / 3; x <= width / 3; x += width / 3) {
            // Tank frame
            const frameGeometry = new THREE.BoxGeometry(1.8, 1.2, 0.8);
            const frame = new THREE.Mesh(frameGeometry, tankFrameMaterial);
            frame.position.set(x, 1.5, -depth / 2 + 0.8);
            storeGroup.add(frame);

            // Water/glass
            const waterGeometry = new THREE.BoxGeometry(1.6, 1.0, 0.6);
            const water = new THREE.Mesh(waterGeometry, tankMaterial);
            water.position.set(x, 1.5, -depth / 2 + 0.8);
            storeGroup.add(water);

            // Fish (small colored spheres)
            for (let f = 0; f < 3; f++) {
                const fishGeometry = new THREE.SphereGeometry(0.08, 6, 6);
                const fishMaterial = new THREE.MeshStandardMaterial({
                    color: [0xff6600, 0xffcc00, 0xff0066][f % 3],
                    emissive: [0xff6600, 0xffcc00, 0xff0066][f % 3],
                    emissiveIntensity: 0.3
                });
                const fish = new THREE.Mesh(fishGeometry, fishMaterial);
                fish.position.set(
                    x + (Math.random() - 0.5) * 1.2,
                    1.3 + Math.random() * 0.6,
                    -depth / 2 + 0.8
                );
                storeGroup.add(fish);
            }
        }

        // Bird cages
        const cageMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.8,
            roughness: 0.3
        });

        [-width / 4, width / 4].forEach((x, i) => {
            // Cage base
            const cageGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12, 1, true);
            const cage = new THREE.Mesh(cageGeometry, cageMaterial);
            cage.position.set(x, 1.5, 0);
            storeGroup.add(cage);

            // Cage top
            const topGeometry = new THREE.ConeGeometry(0.5, 0.4, 12);
            const top = new THREE.Mesh(topGeometry, cageMaterial);
            top.position.set(x, 2.4, 0);
            storeGroup.add(top);

            // Bird perch
            const perchGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6);
            const perch = new THREE.Mesh(perchGeometry, new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
            perch.rotation.z = Math.PI / 2;
            perch.position.set(x, 1.5, 0);
            storeGroup.add(perch);

            // Bird
            const birdBody = new THREE.SphereGeometry(0.12, 8, 8);
            const birdMaterial = new THREE.MeshStandardMaterial({
                color: i === 0 ? 0x00ff00 : 0xffff00
            });
            const bird = new THREE.Mesh(birdBody, birdMaterial);
            bird.position.set(x + 0.1, 1.6, 0);
            storeGroup.add(bird);
        });

        // Pet food shelves on sides
        const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
        [depth / 4].forEach(z => {
            const shelfGeometry = new THREE.BoxGeometry(width * 0.4, 0.1, 0.8);
            [-width / 3, width / 3].forEach(x => {
                const shelf = new THREE.Mesh(shelfGeometry, shelfMaterial);
                shelf.position.set(x, 1.2, z);
                storeGroup.add(shelf);

                // Pet food bags
                for (let b = 0; b < 3; b++) {
                    const bagGeometry = new THREE.BoxGeometry(0.3, 0.5, 0.2);
                    const bagMaterial = new THREE.MeshStandardMaterial({
                        color: [0xff8844, 0x44aaff, 0x88ff44][b % 3]
                    });
                    const bag = new THREE.Mesh(bagGeometry, bagMaterial);
                    bag.position.set(x - 0.4 + b * 0.4, 1.5, z);
                    storeGroup.add(bag);
                }
            });
        });

        // Counter with register
        const counterGeometry = new THREE.BoxGeometry(2.5, 1, 0.8);
        const counterMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a4a });
        const counter = new THREE.Mesh(counterGeometry, counterMaterial);
        counter.position.set(width / 4, 0.5, depth / 4);
        storeGroup.add(counter);
    }

    createMannequin(parent, x, y, z, color) {
        const mannequinMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3 });
        
        // Body
        const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.25, 0.8, 8);
        const body = new THREE.Mesh(bodyGeometry, mannequinMaterial);
        body.position.set(x, y + 1, z);
        parent.add(body);
        
        // Head
        const headGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        const head = new THREE.Mesh(headGeometry, mannequinMaterial);
        head.position.set(x, y + 1.55, z);
        parent.add(head);
        
        // Dress/shirt
        const dressGeometry = new THREE.ConeGeometry(0.35, 0.6, 8);
        const dressMaterial = new THREE.MeshStandardMaterial({ color: color });
        const dress = new THREE.Mesh(dressGeometry, dressMaterial);
        dress.position.set(x, y + 0.5, z);
        dress.rotation.x = Math.PI;
        parent.add(dress);
    }

    addProducts(parent, shelfWidth, y, z, accentColor) {
        // Add simplified product representations
        const productCount = Math.floor(shelfWidth / 0.4);
        const colors = [0x4488cc, 0xcc4488, 0x88cc44, 0xcccc44, 0x8844cc];

        for (let i = 0; i < productCount; i++) {
            const productGeometry = new THREE.BoxGeometry(
                0.2 + Math.random() * 0.15,
                0.3 + Math.random() * 0.2,
                0.15 + Math.random() * 0.1
            );
            const productMaterial = new THREE.MeshStandardMaterial({
                color: colors[i % colors.length],
                roughness: 0.7
            });
            const product = new THREE.Mesh(productGeometry, productMaterial);
            product.position.set(
                -shelfWidth / 2 + 0.3 + i * 0.35 + Math.random() * 0.1,
                y + 0.15,
                z + Math.random() * 0.2
            );
            parent.add(product);
        }
    }

    update(deltaTime, time) {
        // Validate inputs
        if (!deltaTime || isNaN(deltaTime)) deltaTime = 0.016;
        if (!time || isNaN(time)) time = 0;
        
        // Animate neon signs (subtle flicker/pulse)
        this.animatedSigns.forEach(sign => {
            if (!sign || !sign.light) return;
            
            sign.time += deltaTime;
            
            // Prevent time from growing too large (floating point issues)
            if (sign.time > 1000) {
                sign.time = sign.time % (Math.PI * 2);
            }
            
            // Random subtle flicker
            const flicker = Math.sin(sign.time * 10) * 0.1 + 
                           Math.sin(sign.time * 23) * 0.05 + 
                           Math.sin(sign.time * 47) * 0.02;
            
            sign.light.intensity = Math.max(0.5, Math.min(1.5, 1 + flicker));
        });
    }

    getStoreData() {
        return this.storeData;
    }

    getAudioSources() {
        return this.storeData.filter(store => store.hasMusic);
    }
}

export default Stores;
