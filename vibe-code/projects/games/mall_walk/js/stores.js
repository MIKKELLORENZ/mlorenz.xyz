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
        this.petStoreAnimations = {
            dog: null,
            dogTarget: { x: 0, z: 0 },
            dogSpeed: 0.8,
            dogWaitTime: 0,
            fish: [],
            hamsterWheel: null,
            hamster: null,
            hamsterTarget: { x: 0, z: 0 },
            hamsterSpeed: 0.4,
            hamsterWaitTime: 0,
            hamsterBounds: null
        };
    }

    build() {
        // Define stores - inspired by 90s mall classics
        const stores = [
            // Left side - Ground floor
            { name: 'SAM GOODY', x: -MALL_CONFIG.width / 2 + 6, z: -40, side: 'left', floor: 0, color: COLORS.neonBlue, hasMusic: true, type: 'music' },
            { name: 'BLOCKBUSTER', x: -MALL_CONFIG.width / 2 + 6, z: -25, side: 'left', floor: 0, color: COLORS.neonYellow, type: 'generic' },
            { name: 'PETLAND', x: -MALL_CONFIG.width / 2 + 6, z: -10, side: 'left', floor: 0, color: COLORS.neonGreen, type: 'petstore' },
            { name: 'ARCADE', x: -MALL_CONFIG.width / 2 + 6, z: 5, side: 'left', floor: 0, color: COLORS.neonPurple, hasMusic: true, type: 'arcade' },
            { name: 'SUNCOAST', x: -MALL_CONFIG.width / 2 + 6, z: 20, side: 'left', floor: 0, color: COLORS.neonPink, type: 'generic' },
            { name: "CLAIRE'S", x: -MALL_CONFIG.width / 2 + 6, z: 35, side: 'left', floor: 0, color: COLORS.neonPink, type: 'clothing' },

            // Right side - Ground floor
            { name: 'FOOT LOCKER', x: MALL_CONFIG.width / 2 - 6, z: -40, side: 'right', floor: 0, color: COLORS.neonBlue, type: 'shoes' },
            { name: "SPENCER'S", x: MALL_CONFIG.width / 2 - 6, z: -25, side: 'right', floor: 0, color: COLORS.neonPurple, type: 'generic' },
            { name: 'KB TOYS', x: MALL_CONFIG.width / 2 - 6, z: -10, side: 'right', floor: 0, color: COLORS.neonPink, type: 'generic' },
            { name: 'JAVA CAFE', x: MALL_CONFIG.width / 2 - 6, z: 5, side: 'right', floor: 0, color: COLORS.coral, hasMusic: true, type: 'cafe' },
            { name: 'HOT TOPIC', x: MALL_CONFIG.width / 2 - 6, z: 20, side: 'right', floor: 0, color: COLORS.neonPurple, type: 'clothing' },
            { name: 'FOOT LOCKER', x: MALL_CONFIG.width / 2 - 6, z: 35, side: 'right', floor: 0, color: COLORS.coral, type: 'generic' },

            // Left side - Second floor
            { name: 'WALDENBOOKS', x: -MALL_CONFIG.width / 2 + 6, z: -35, side: 'left', floor: 1, color: COLORS.neonGreen, type: 'generic' },
            { name: 'SUDS LAUNDRY', x: -MALL_CONFIG.width / 2 + 6, z: -15, side: 'left', floor: 1, color: COLORS.neonBlue, type: 'laundromat' },
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
            case 'arcade':
                this.createArcadeInterior(storeGroup, width, height, depth, storeConfig.color);
                break;
            case 'laundromat':
                this.createLaundromatInterior(storeGroup, width, height, depth, storeConfig.color);
                break;
            case 'shoes':
                this.createShoeStoreInterior(storeGroup, width, height, depth, storeConfig.color);
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

    createShoeStoreInterior(storeGroup, width, height, depth, accentColor) {
        // ========================================
        // FOOT LOCKER - Detailed 90s Shoe Store
        // ========================================
        
        // ========================================
        // CHECKERED FLOOR (classic Foot Locker style)
        // ========================================
        const tileSize = 0.8;
        const blackTile = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
        const whiteTile = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3 });
        const tileGeometry = new THREE.BoxGeometry(tileSize, 0.02, tileSize);
        
        for (let x = -width / 2 + tileSize / 2; x < width / 2; x += tileSize) {
            for (let z = -depth / 2 + tileSize / 2; z < depth / 2; z += tileSize) {
                const isBlack = (Math.floor(x / tileSize) + Math.floor(z / tileSize)) % 2 === 0;
                const tile = new THREE.Mesh(tileGeometry, isBlack ? blackTile : whiteTile);
                tile.position.set(x, 0.01, z);
                storeGroup.add(tile);
            }
        }
        
        // ========================================
        // WALL SHOE DISPLAYS (Back wall)
        // ========================================
        const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
        const shelfBackMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
        
        // Back wall display unit
        const backDisplay = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.9, height * 0.7, 0.15),
            shelfBackMaterial
        );
        backDisplay.position.set(0, height * 0.4, -depth / 2 + 0.2);
        storeGroup.add(backDisplay);
        
        // Shelves on back wall
        const shelfRows = 4;
        const shelfCols = 5;
        for (let row = 0; row < shelfRows; row++) {
            const shelfY = 0.5 + row * 0.8;
            const shelf = new THREE.Mesh(
                new THREE.BoxGeometry(width * 0.85, 0.04, 0.35),
                shelfMaterial
            );
            shelf.position.set(0, shelfY, -depth / 2 + 0.35);
            storeGroup.add(shelf);
            
            // Shoes on each shelf
            for (let col = 0; col < shelfCols; col++) {
                const shoeX = -width * 0.35 + col * (width * 0.7 / (shelfCols - 1));
                this.createDisplayShoe(storeGroup, shoeX, shelfY + 0.08, -depth / 2 + 0.35, row, col);
            }
        }
        
        // ========================================
        // SIDE WALL DISPLAYS
        // ========================================
        [-1, 1].forEach(side => {
            const sideX = side * (width / 2 - 0.5);
            
            // Side display unit
            const sideDisplay = new THREE.Mesh(
                new THREE.BoxGeometry(0.15, height * 0.5, depth * 0.6),
                shelfBackMaterial
            );
            sideDisplay.position.set(sideX, height * 0.3, -depth / 6);
            storeGroup.add(sideDisplay);
            
            // Side shelves
            for (let row = 0; row < 3; row++) {
                const sideShelf = new THREE.Mesh(
                    new THREE.BoxGeometry(0.35, 0.03, depth * 0.55),
                    shelfMaterial
                );
                sideShelf.position.set(sideX - side * 0.1, 0.4 + row * 0.6, -depth / 6);
                storeGroup.add(sideShelf);
            }
        });
        
        // ========================================
        // CENTER SHOE DISPLAYS (Low tables)
        // ========================================
        const createShoeTable = (x, z) => {
            const tableGroup = new THREE.Group();
            
            // Table top
            const tableTop = new THREE.Mesh(
                new THREE.BoxGeometry(1.2, 0.06, 0.8),
                new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4 })
            );
            tableTop.position.y = 0.5;
            tableGroup.add(tableTop);
            
            // Table legs
            [[-0.5, -0.3], [-0.5, 0.3], [0.5, -0.3], [0.5, 0.3]].forEach(([lx, lz]) => {
                const leg = new THREE.Mesh(
                    new THREE.BoxGeometry(0.05, 0.5, 0.05),
                    new THREE.MeshStandardMaterial({ color: 0x333333 })
                );
                leg.position.set(lx, 0.25, lz);
                tableGroup.add(leg);
            });
            
            // Shoes on table
            this.createDisplayShoe(tableGroup, -0.3, 0.58, 0, 0, 0);
            this.createDisplayShoe(tableGroup, 0.3, 0.58, 0, 1, 1);
            
            tableGroup.position.set(x, 0, z);
            return tableGroup;
        };
        
        storeGroup.add(createShoeTable(-1.5, 0));
        storeGroup.add(createShoeTable(1.5, 0));
        
        // ========================================
        // TRY-ON BENCH
        // ========================================
        const benchGroup = new THREE.Group();
        
        // Bench seat (padded)
        const benchSeat = new THREE.Mesh(
            new THREE.BoxGeometry(2.5, 0.15, 0.6),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })
        );
        benchSeat.position.y = 0.45;
        benchGroup.add(benchSeat);
        
        // Bench padding
        const benchPad = new THREE.Mesh(
            new THREE.BoxGeometry(2.4, 0.08, 0.55),
            new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 })
        );
        benchPad.position.y = 0.56;
        benchGroup.add(benchPad);
        
        // Bench legs
        [[-1.1, -0.2], [-1.1, 0.2], [1.1, -0.2], [1.1, 0.2]].forEach(([lx, lz]) => {
            const benchLeg = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.4, 0.08),
                new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.3 })
            );
            benchLeg.position.set(lx, 0.2, lz);
            benchGroup.add(benchLeg);
        });
        
        benchGroup.position.set(0, 0, depth / 3);
        storeGroup.add(benchGroup);
        
        // ========================================
        // FOOT MEASURING DEVICE
        // ========================================
        const measureDevice = new THREE.Group();
        
        const measureBase = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.03, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 })
        );
        measureDevice.add(measureBase);
        
        // Slide rule
        const slideRail = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.02, 0.45),
            new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.7 })
        );
        slideRail.position.set(0.12, 0.025, 0);
        measureDevice.add(slideRail);
        
        // Heel stop
        const heelStop = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.06, 0.03),
            new THREE.MeshStandardMaterial({ color: 0x666666 })
        );
        heelStop.position.set(0, 0.04, -0.22);
        measureDevice.add(heelStop);
        
        measureDevice.position.set(0.8, 0, depth / 3 + 0.5);
        storeGroup.add(measureDevice);
        
        // ========================================
        // SHOE BOXES STACKED
        // ========================================
        const createShoeBoxStack = (x, z, count) => {
            const stackGroup = new THREE.Group();
            const boxColors = [0xff0000, 0x0066cc, 0x333333, 0xffffff, 0xff6600];
            
            for (let i = 0; i < count; i++) {
                const box = new THREE.Mesh(
                    new THREE.BoxGeometry(0.35, 0.12, 0.22),
                    new THREE.MeshStandardMaterial({ color: boxColors[i % boxColors.length] })
                );
                box.position.y = 0.06 + i * 0.12;
                // Slight offset for natural look
                box.position.x = (Math.random() - 0.5) * 0.03;
                box.rotation.y = (Math.random() - 0.5) * 0.1;
                stackGroup.add(box);
            }
            
            stackGroup.position.set(x, 0, z);
            return stackGroup;
        };
        
        storeGroup.add(createShoeBoxStack(-width / 2 + 0.5, -depth / 4, 4));
        storeGroup.add(createShoeBoxStack(-width / 2 + 0.5, 0, 3));
        storeGroup.add(createShoeBoxStack(width / 2 - 0.5, -depth / 4, 5));
        
        // ========================================
        // PROMOTIONAL POSTERS
        // ========================================
        const posterMaterial = new THREE.MeshStandardMaterial({
            color: 0xff6600,
            emissive: 0xff3300,
            emissiveIntensity: 0.2
        });
        
        const poster1 = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 2, 0.02),
            posterMaterial
        );
        poster1.position.set(-width / 3, height * 0.55, -depth / 2 + 0.1);
        storeGroup.add(poster1);
        
        const poster2 = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 2, 0.02),
            new THREE.MeshStandardMaterial({
                color: 0x0066cc,
                emissive: 0x003366,
                emissiveIntensity: 0.2
            })
        );
        poster2.position.set(width / 3, height * 0.55, -depth / 2 + 0.1);
        storeGroup.add(poster2);
        
        // ========================================
        // MIRROR
        // ========================================
        const mirrorFrame = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 2.5, 0.08),
            new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.3 })
        );
        mirrorFrame.position.set(width / 2 - 0.5, height * 0.4, depth / 4);
        mirrorFrame.rotation.y = -Math.PI / 2;
        storeGroup.add(mirrorFrame);
        
        const mirrorGlass = new THREE.Mesh(
            new THREE.BoxGeometry(1.0, 2.3, 0.02),
            new THREE.MeshStandardMaterial({
                color: 0xaaccee,
                metalness: 0.9,
                roughness: 0.05
            })
        );
        mirrorGlass.position.set(width / 2 - 0.45, height * 0.4, depth / 4);
        mirrorGlass.rotation.y = -Math.PI / 2;
        storeGroup.add(mirrorGlass);
    }
    
    createDisplayShoe(parent, x, y, z, styleIndex, colorIndex) {
        // Create a stylized sneaker/athletic shoe
        const shoeGroup = new THREE.Group();
        
        const shoeColors = [
            0xff0000, 0x0066ff, 0x00cc00, 0xff6600, 0x9900cc,
            0xffff00, 0x00ffff, 0xff00ff, 0xffffff, 0x000000
        ];
        const soleColor = 0xeeeeee;
        const mainColor = shoeColors[(styleIndex + colorIndex) % shoeColors.length];
        const accentColor = shoeColors[(styleIndex + colorIndex + 3) % shoeColors.length];
        
        // Sole
        const sole = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.025, 0.28),
            new THREE.MeshStandardMaterial({ color: soleColor, roughness: 0.6 })
        );
        shoeGroup.add(sole);
        
        // Main body (tapered)
        const bodyShape = new THREE.Shape();
        bodyShape.moveTo(-0.05, 0);
        bodyShape.lineTo(0.05, 0);
        bodyShape.lineTo(0.04, 0.06);
        bodyShape.lineTo(-0.04, 0.06);
        bodyShape.closePath();
        
        const bodyGeom = new THREE.ExtrudeGeometry(bodyShape, { depth: 0.25, bevelEnabled: false });
        const body = new THREE.Mesh(bodyGeom, new THREE.MeshStandardMaterial({ color: mainColor }));
        body.rotation.x = -Math.PI / 2;
        body.position.set(0, 0.012, -0.125);
        shoeGroup.add(body);
        
        // Toe cap
        const toeCap = new THREE.Mesh(
            new THREE.SphereGeometry(0.045, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: soleColor })
        );
        toeCap.rotation.x = Math.PI / 2;
        toeCap.position.set(0, 0.04, 0.11);
        shoeGroup.add(toeCap);
        
        // Heel counter
        const heelCounter = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.05, 0.03),
            new THREE.MeshStandardMaterial({ color: accentColor })
        );
        heelCounter.position.set(0, 0.04, -0.12);
        shoeGroup.add(heelCounter);
        
        // Swoosh/stripe accent
        const stripe = new THREE.Mesh(
            new THREE.BoxGeometry(0.008, 0.025, 0.12),
            new THREE.MeshStandardMaterial({ color: accentColor })
        );
        stripe.position.set(0.05, 0.04, 0);
        stripe.rotation.z = 0.3;
        shoeGroup.add(stripe);
        
        // Laces area
        const lacesArea = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.01, 0.1),
            new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        lacesArea.position.set(0, 0.065, 0.02);
        shoeGroup.add(lacesArea);
        
        // Position and slight rotation for display
        shoeGroup.position.set(x, y, z);
        shoeGroup.rotation.y = (Math.random() - 0.5) * 0.4;
        
        parent.add(shoeGroup);
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

    createLaundromatInterior(storeGroup, width, height, depth, accentColor) {
        // ========================================
        // SUDS LAUNDRY - Detailed 90s Laundromat
        // ========================================
        
        // Initialize laundromat animations storage
        this.laundromatAnimations = this.laundromatAnimations || { drums: [] };
        
        // ========================================
        // LINOLEUM FLOOR
        // ========================================
        const floorTileSize = 1.0;
        const floorMaterial1 = new THREE.MeshStandardMaterial({ color: 0xddd8cc, roughness: 0.7 });
        const floorMaterial2 = new THREE.MeshStandardMaterial({ color: 0xc8c3b7, roughness: 0.7 });
        const floorTileGeometry = new THREE.BoxGeometry(floorTileSize, 0.02, floorTileSize);
        
        for (let x = -width / 2 + floorTileSize / 2; x < width / 2; x += floorTileSize) {
            for (let z = -depth / 2 + floorTileSize / 2; z < depth / 2; z += floorTileSize) {
                const isAlt = (Math.floor(x / floorTileSize) + Math.floor(z / floorTileSize)) % 2 === 0;
                const tile = new THREE.Mesh(floorTileGeometry, isAlt ? floorMaterial1 : floorMaterial2);
                tile.position.set(x, 0.01, z);
                storeGroup.add(tile);
            }
        }
        
        // ========================================
        // WASHING MACHINES (Back wall - animated drums)
        // ========================================
        const createWashingMachine = (x, z, isRunning) => {
            const machineGroup = new THREE.Group();
            
            const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3 });
            const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 });
            const blackMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
            
            // Machine body
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.7, 1.0, 0.65),
                whiteMaterial
            );
            body.position.set(0, 0.5, 0);
            machineGroup.add(body);
            
            // Top panel (slightly darker)
            const topPanel = new THREE.Mesh(
                new THREE.BoxGeometry(0.72, 0.05, 0.67),
                new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.4 })
            );
            topPanel.position.set(0, 1.025, 0);
            machineGroup.add(topPanel);
            
            // Control panel at top
            const controlPanel = new THREE.Mesh(
                new THREE.BoxGeometry(0.65, 0.12, 0.05),
                new THREE.MeshStandardMaterial({ color: 0x333333 })
            );
            controlPanel.position.set(0, 0.9, 0.35);
            machineGroup.add(controlPanel);
            
            // Control knobs
            [-0.2, 0, 0.2].forEach((xOff, i) => {
                const knob = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.025, 0.03, 0.03, 12),
                    new THREE.MeshStandardMaterial({ color: [0x4488ff, 0xffffff, 0xff4444][i] })
                );
                knob.rotation.x = Math.PI / 2;
                knob.position.set(xOff, 0.9, 0.38);
                machineGroup.add(knob);
            });
            
            // Status light
            const statusLight = new THREE.Mesh(
                new THREE.SphereGeometry(0.015, 8, 6),
                new THREE.MeshStandardMaterial({
                    color: isRunning ? 0x00ff00 : 0x444444,
                    emissive: isRunning ? 0x00ff00 : 0x000000,
                    emissiveIntensity: isRunning ? 0.8 : 0
                })
            );
            statusLight.position.set(-0.25, 0.9, 0.37);
            machineGroup.add(statusLight);
            
            // Door frame (circular, chrome)
            const doorFrame = new THREE.Mesh(
                new THREE.TorusGeometry(0.25, 0.03, 12, 24),
                metalMaterial
            );
            doorFrame.position.set(0, 0.5, 0.33);
            machineGroup.add(doorFrame);
            
            // Door glass (transparent)
            const doorGlass = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.22, 0.02, 24),
                new THREE.MeshStandardMaterial({
                    color: 0x88aacc,
                    transparent: true,
                    opacity: 0.3,
                    roughness: 0.1
                })
            );
            doorGlass.rotation.x = Math.PI / 2;
            doorGlass.position.set(0, 0.5, 0.34);
            machineGroup.add(doorGlass);
            
            // Drum inside (this will spin!)
            const drumGroup = new THREE.Group();
            drumGroup.name = 'washerDrum';
            
            const drum = new THREE.Mesh(
                new THREE.CylinderGeometry(0.2, 0.2, 0.15, 16, 1, true),
                new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, side: THREE.DoubleSide })
            );
            drum.rotation.x = Math.PI / 2;
            drumGroup.add(drum);
            
            // Drum holes pattern
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const hole = new THREE.Mesh(
                    new THREE.CircleGeometry(0.02, 6),
                    blackMaterial
                );
                hole.position.set(
                    Math.cos(angle) * 0.15,
                    Math.sin(angle) * 0.15,
                    0.08
                );
                drumGroup.add(hole);
            }
            
            // Clothes inside drum (colorful blobs)
            if (isRunning) {
                const clothColors = [0xff6699, 0x6699ff, 0x66ff99, 0xffff66];
                clothColors.forEach((color, i) => {
                    const cloth = new THREE.Mesh(
                        new THREE.SphereGeometry(0.04 + Math.random() * 0.02, 6, 4),
                        new THREE.MeshStandardMaterial({ color: color })
                    );
                    const angle = (i / clothColors.length) * Math.PI * 2;
                    cloth.position.set(
                        Math.cos(angle) * 0.08,
                        Math.sin(angle) * 0.08,
                        0
                    );
                    drumGroup.add(cloth);
                });
                
                // Water effect
                const water = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16),
                    new THREE.MeshStandardMaterial({
                        color: 0x4488ff,
                        transparent: true,
                        opacity: 0.4,
                        emissive: 0x2244aa,
                        emissiveIntensity: 0.2
                    })
                );
                water.rotation.x = Math.PI / 2;
                drumGroup.add(water);
            }
            
            drumGroup.position.set(0, 0.5, 0.25);
            machineGroup.add(drumGroup);
            
            // Store reference for animation
            if (isRunning) {
                this.laundromatAnimations.drums.push({
                    drum: drumGroup,
                    speed: 2 + Math.random() * 2,
                    direction: Math.random() > 0.5 ? 1 : -1,
                    phase: Math.random() * Math.PI * 2,
                    changeTimer: 0,
                    changeDuration: 2 + Math.random() * 3
                });
            }
            
            // Feet
            [[-0.25, -0.25], [-0.25, 0.25], [0.25, -0.25], [0.25, 0.25]].forEach(([fx, fz]) => {
                const foot = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.03, 0.04, 0.05, 8),
                    blackMaterial
                );
                foot.position.set(fx, 0.025, fz);
                machineGroup.add(foot);
            });
            
            machineGroup.position.set(x, 0.03, z);  // Raised slightly above linoleum floor
            return machineGroup;
        };
        
        // Row of washing machines along back wall
        const backZ = -depth / 2 + 0.6;
        for (let i = 0; i < 5; i++) {
            const x = -2 + i * 1;
            const isRunning = Math.random() > 0.3; // 70% chance of running
            storeGroup.add(createWashingMachine(x, backZ, isRunning));
        }
        
        // ========================================
        // DRYERS (Side wall)
        // ========================================
        const createDryer = (x, z, rotation, isRunning) => {
            const dryerGroup = new THREE.Group();
            
            const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 });
            const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7 });
            
            // Body
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.75, 1.1, 0.7),
                whiteMaterial
            );
            body.position.set(0, 0.55, 0);
            dryerGroup.add(body);
            
            // Large door
            const doorFrame = new THREE.Mesh(
                new THREE.TorusGeometry(0.3, 0.03, 12, 24),
                metalMaterial
            );
            doorFrame.position.set(0, 0.5, 0.36);
            dryerGroup.add(doorFrame);
            
            // Door window
            const doorGlass = new THREE.Mesh(
                new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24),
                new THREE.MeshStandardMaterial({
                    color: 0x666666,
                    transparent: true,
                    opacity: 0.5
                })
            );
            doorGlass.rotation.x = Math.PI / 2;
            doorGlass.position.set(0, 0.5, 0.37);
            dryerGroup.add(doorGlass);
            
            // Clothes tumbling inside (if running)
            if (isRunning) {
                const tumbleGroup = new THREE.Group();
                const clothColors = [0xffffff, 0xddddff, 0xffdddd, 0xddffdd];
                clothColors.forEach((color, i) => {
                    const cloth = new THREE.Mesh(
                        new THREE.BoxGeometry(0.08, 0.05, 0.03),
                        new THREE.MeshStandardMaterial({ color: color })
                    );
                    const angle = (i / clothColors.length) * Math.PI * 2;
                    cloth.position.set(
                        Math.cos(angle) * 0.12,
                        Math.sin(angle) * 0.12,
                        0
                    );
                    tumbleGroup.add(cloth);
                });
                tumbleGroup.position.set(0, 0.5, 0.25);
                dryerGroup.add(tumbleGroup);
                
                // Store for animation
                this.laundromatAnimations.drums.push({
                    drum: tumbleGroup,
                    speed: 1.5 + Math.random(),
                    direction: Math.random() > 0.5 ? 1 : -1,
                    phase: Math.random() * Math.PI * 2,
                    changeTimer: 0,
                    changeDuration: 3 + Math.random() * 4
                });
            }
            
            // Control panel
            const controlPanel = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.15, 0.03),
                new THREE.MeshStandardMaterial({ color: 0x333333 })
            );
            controlPanel.position.set(0, 1.0, 0.37);
            dryerGroup.add(controlPanel);
            
            // Coin slot
            const coinSlot = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.03, 0.02),
                metalMaterial
            );
            coinSlot.position.set(0.15, 1.0, 0.39);
            dryerGroup.add(coinSlot);
            
            dryerGroup.position.set(x, 0.03, z);  // Raised slightly above linoleum floor
            dryerGroup.rotation.y = rotation;
            return dryerGroup;
        };
        
        // Dryers on left wall
        const leftWallX = -width / 2 + 0.6;
        for (let i = 0; i < 3; i++) {
            const z = -1 + i * 1.2;
            const isRunning = Math.random() > 0.4;
            storeGroup.add(createDryer(leftWallX, z, Math.PI / 2, isRunning));
        }
        
        // ========================================
        // FOLDING TABLES
        // ========================================
        const tableMaterial = new THREE.MeshStandardMaterial({ color: 0xb8a090, roughness: 0.6 });
        const tableLegMaterial = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.5 });
        
        // Long folding table in center
        const tableTop = new THREE.Mesh(
            new THREE.BoxGeometry(3, 0.05, 1),
            tableMaterial
        );
        tableTop.position.set(0.5, 0.85, 0.5);
        storeGroup.add(tableTop);
        
        // Table legs
        [[-1, -0.4], [-1, 0.4], [1, -0.4], [1, 0.4]].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.85, 8),
                tableLegMaterial
            );
            leg.position.set(0.5 + lx, 0.425, 0.5 + lz);
            storeGroup.add(leg);
        });
        
        // Laundry baskets on/near table
        const createBasket = (x, y, z, hasClothes) => {
            const basketGroup = new THREE.Group();
            
            // Basket body
            const basket = new THREE.Mesh(
                new THREE.CylinderGeometry(0.25, 0.2, 0.35, 12, 1, true),
                new THREE.MeshStandardMaterial({ color: 0x4488cc, roughness: 0.8, side: THREE.DoubleSide })
            );
            basket.position.y = 0.175;
            basketGroup.add(basket);
            
            // Basket bottom
            const bottom = new THREE.Mesh(
                new THREE.CircleGeometry(0.2, 12),
                new THREE.MeshStandardMaterial({ color: 0x4488cc, roughness: 0.8 })
            );
            bottom.rotation.x = -Math.PI / 2;
            bottom.position.y = 0.01;
            basketGroup.add(bottom);
            
            // Handles
            [-0.22, 0.22].forEach(xOff => {
                const handle = new THREE.Mesh(
                    new THREE.TorusGeometry(0.05, 0.015, 6, 8, Math.PI),
                    new THREE.MeshStandardMaterial({ color: 0x3377aa })
                );
                handle.rotation.y = Math.PI / 2;
                handle.position.set(xOff, 0.3, 0);
                basketGroup.add(handle);
            });
            
            // Clothes inside
            if (hasClothes) {
                const clothesPile = new THREE.Mesh(
                    new THREE.SphereGeometry(0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
                    new THREE.MeshStandardMaterial({ color: 0xffffff })
                );
                clothesPile.position.y = 0.25;
                basketGroup.add(clothesPile);
                
                // Colorful clothes peeking out
                [0xff6699, 0x6699ff, 0x99ff66].forEach((color, i) => {
                    const cloth = new THREE.Mesh(
                        new THREE.BoxGeometry(0.08, 0.03, 0.1),
                        new THREE.MeshStandardMaterial({ color: color })
                    );
                    const angle = (i / 3) * Math.PI * 2;
                    cloth.position.set(Math.cos(angle) * 0.12, 0.32, Math.sin(angle) * 0.12);
                    cloth.rotation.y = angle;
                    basketGroup.add(cloth);
                });
            }
            
            basketGroup.position.set(x, y, z);
            return basketGroup;
        };
        
        storeGroup.add(createBasket(-0.8, 0.88, 0.5, true));
        storeGroup.add(createBasket(0.2, 0.88, 0.3, false));
        storeGroup.add(createBasket(1.5, 0, 1.2, true));
        
        // ========================================
        // VENDING MACHINES
        // ========================================
        
        // Detergent vending machine
        const vendingMachine = new THREE.Group();
        
        const vendBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 1.8, 0.6),
            new THREE.MeshStandardMaterial({ color: 0x2244aa })
        );
        vendBody.position.set(0, 0.9, 0);
        vendingMachine.add(vendBody);
        
        // Display window
        const vendWindow = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 0.8, 0.02),
            new THREE.MeshStandardMaterial({
                color: 0xaaddff,
                transparent: true,
                opacity: 0.5
            })
        );
        vendWindow.position.set(0, 1.2, 0.31);
        vendingMachine.add(vendWindow);
        
        // Product rows inside
        [0, 0.25, 0.5].forEach((yOff, row) => {
            [-0.15, 0.15].forEach((xOff, col) => {
                const product = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.06, 0.06, 0.15, 8),
                    new THREE.MeshStandardMaterial({ color: row === 0 ? 0xff6600 : (row === 1 ? 0x00ff66 : 0x6600ff) })
                );
                product.position.set(xOff, 0.9 + yOff, 0.1);
                vendingMachine.add(product);
            });
        });
        
        // Coin slot
        const vendCoinSlot = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.02, 0.02),
            new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7 })
        );
        vendCoinSlot.position.set(0.25, 1.0, 0.31);
        vendingMachine.add(vendCoinSlot);
        
        // Dispensing tray
        const vendTray = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.08, 0.2),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        vendTray.position.set(0, 0.3, 0.4);
        vendingMachine.add(vendTray);
        
        vendingMachine.position.set(width / 2 - 0.6, 0, -depth / 4);
        storeGroup.add(vendingMachine);
        
        // ========================================
        // SEATING AREA
        // ========================================
        
        // Plastic chairs
        const createChair = (x, z, rotation) => {
            const chairGroup = new THREE.Group();
            const chairMaterial = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.5 });
            
            // Seat
            const seat = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.04, 0.4),
                chairMaterial
            );
            seat.position.y = 0.45;
            chairGroup.add(seat);
            
            // Back
            const back = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.5, 0.04),
                chairMaterial
            );
            back.position.set(0, 0.7, -0.18);
            chairGroup.add(back);
            
            // Legs
            const legMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 });
            [[-0.15, 0.15], [-0.15, -0.15], [0.15, 0.15], [0.15, -0.15]].forEach(([lx, lz]) => {
                const leg = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6),
                    legMaterial
                );
                leg.position.set(lx, 0.225, lz);
                chairGroup.add(leg);
            });
            
            chairGroup.position.set(x, 0, z);
            chairGroup.rotation.y = rotation;
            return chairGroup;
        };
        
        // Row of chairs near front
        storeGroup.add(createChair(-1.5, depth / 2 - 1, 0));
        storeGroup.add(createChair(-0.7, depth / 2 - 1, 0));
        storeGroup.add(createChair(0.1, depth / 2 - 1, 0));
        
        // ========================================
        // BULLETIN BOARD
        // ========================================
        const bulletinBoard = new THREE.Group();
        
        const board = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.9, 0.05),
            new THREE.MeshStandardMaterial({ color: 0x8b6914 })
        );
        bulletinBoard.add(board);
        
        // Cork surface
        const cork = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 0.8, 0.02),
            new THREE.MeshStandardMaterial({ color: 0xc4a35a, roughness: 0.9 })
        );
        cork.position.z = 0.035;
        bulletinBoard.add(cork);
        
        // Pinned notes
        const noteColors = [0xffffcc, 0xccffcc, 0xffcccc, 0xccccff];
        noteColors.forEach((color, i) => {
            const note = new THREE.Mesh(
                new THREE.BoxGeometry(0.15, 0.2, 0.005),
                new THREE.MeshStandardMaterial({ color: color })
            );
            note.position.set(-0.3 + (i % 2) * 0.5, 0.15 - Math.floor(i / 2) * 0.35, 0.05);
            note.rotation.z = (Math.random() - 0.5) * 0.3;
            bulletinBoard.add(note);
            
            // Pin
            const pin = new THREE.Mesh(
                new THREE.SphereGeometry(0.02, 6, 4),
                new THREE.MeshStandardMaterial({ color: 0xff0000 })
            );
            pin.position.set(note.position.x, note.position.y + 0.08, 0.06);
            bulletinBoard.add(pin);
        });
        
        bulletinBoard.position.set(width / 2 - 0.1, 1.5, depth / 4);
        bulletinBoard.rotation.y = -Math.PI / 2;
        storeGroup.add(bulletinBoard);
        
        // ========================================
        // FLUORESCENT CEILING LIGHTS
        // ========================================
        const lightFixtureMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffee,
            emissiveIntensity: 0.8
        });
        
        [-1.5, 1.5].forEach(x => {
            const fixture = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.05, 2),
                lightFixtureMaterial
            );
            fixture.position.set(x, height - 0.3, 0);
            storeGroup.add(fixture);
        });
        
        // ========================================
        // SOAP DISPENSER ON WALL
        // ========================================
        const soapDispenser = new THREE.Group();
        
        const dispenserBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.35, 0.12),
            new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        dispenserBody.position.y = 0;
        soapDispenser.add(dispenserBody);
        
        // Window showing soap
        const soapWindow = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.15, 0.02),
            new THREE.MeshStandardMaterial({
                color: 0x4488ff,
                transparent: true,
                opacity: 0.6
            })
        );
        soapWindow.position.set(0, 0.05, 0.07);
        soapDispenser.add(soapWindow);
        
        // Lever
        const lever = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.03, 0.08),
            new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 })
        );
        lever.position.set(0, -0.12, 0.08);
        soapDispenser.add(lever);
        
        soapDispenser.position.set(-width / 2 + 0.1, 1.3, -depth / 4);
        soapDispenser.rotation.y = Math.PI / 2;
        storeGroup.add(soapDispenser);
        
        // ========================================
        // CLOCK ON WALL
        // ========================================
        const clockGroup = new THREE.Group();
        
        const clockFace = new THREE.Mesh(
            new THREE.CylinderGeometry(0.25, 0.25, 0.05, 24),
            new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        clockFace.rotation.x = Math.PI / 2;
        clockGroup.add(clockFace);
        
        // Clock rim
        const clockRim = new THREE.Mesh(
            new THREE.TorusGeometry(0.25, 0.02, 8, 24),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        clockGroup.add(clockRim);
        
        // Hour marks
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const mark = new THREE.Mesh(
                new THREE.BoxGeometry(0.02, 0.04, 0.01),
                new THREE.MeshStandardMaterial({ color: 0x333333 })
            );
            mark.position.set(Math.sin(angle) * 0.2, Math.cos(angle) * 0.2, 0.03);
            mark.rotation.z = -angle;
            clockGroup.add(mark);
        }
        
        // Hour hand
        const hourHand = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 0.12, 0.01),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        hourHand.position.set(0, 0.05, 0.04);
        hourHand.rotation.z = -Math.PI / 4; // 10:30
        clockGroup.add(hourHand);
        
        // Minute hand
        const minuteHand = new THREE.Mesh(
            new THREE.BoxGeometry(0.015, 0.18, 0.01),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        minuteHand.position.set(0.07, 0, 0.04);
        minuteHand.rotation.z = Math.PI / 2;
        clockGroup.add(minuteHand);
        
        clockGroup.position.set(0, height - 0.8, -depth / 2 + 0.1);
        storeGroup.add(clockGroup);
    }

    createCafeInterior(storeGroup, width, height, depth, accentColor) {
        // ========================================
        // JAVA CAFE - Rich 90s Coffee Shop Interior
        // ========================================
        
        // Floor - checkered tile pattern
        const floorTileSize = 0.8;
        const tileMaterial1 = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.7 });
        const tileMaterial2 = new THREE.MeshStandardMaterial({ color: 0xf5e6d3, roughness: 0.7 });
        const tileGeometry = new THREE.BoxGeometry(floorTileSize, 0.02, floorTileSize);
        
        for (let x = -width / 2 + floorTileSize / 2; x < width / 2; x += floorTileSize) {
            for (let z = -depth / 2 + floorTileSize / 2; z < depth / 2; z += floorTileSize) {
                const isWhite = (Math.floor(x / floorTileSize) + Math.floor(z / floorTileSize)) % 2 === 0;
                const tile = new THREE.Mesh(tileGeometry, isWhite ? tileMaterial2 : tileMaterial1);
                tile.position.set(x, 0.02, z);
                storeGroup.add(tile);
            }
        }
        
        // ========================================
        // MAIN COUNTER WITH DISPLAY CASE
        // ========================================
        const counterWoodMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x4a2c17, 
            roughness: 0.5 
        });
        const counterTopMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x2a1810, 
            roughness: 0.3,
            metalness: 0.1
        });
        
        // Main counter base
        const counterBase = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.75, 1.0, 1.2),
            counterWoodMaterial
        );
        counterBase.position.set(0, 0.5, -depth / 3);
        storeGroup.add(counterBase);
        
        // Counter top (darker wood)
        const counterTop = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.78, 0.08, 1.3),
            counterTopMaterial
        );
        counterTop.position.set(0, 1.04, -depth / 3);
        storeGroup.add(counterTop);
        
        // Glass display case for pastries
        const glassMaterial = new THREE.MeshStandardMaterial({
            color: 0xaaddff,
            transparent: true,
            opacity: 0.3,
            roughness: 0.1
        });
        
        // Display case frame
        const displayCaseWidth = 1.8;
        const displayCaseHeight = 0.6;
        const displayCaseDepth = 0.8;
        
        // Glass panels
        const frontGlass = new THREE.Mesh(
            new THREE.BoxGeometry(displayCaseWidth, displayCaseHeight, 0.02),
            glassMaterial
        );
        frontGlass.position.set(1.5, 1.4, -depth / 3 + 0.6);
        storeGroup.add(frontGlass);
        
        const topGlass = new THREE.Mesh(
            new THREE.BoxGeometry(displayCaseWidth, 0.02, displayCaseDepth),
            glassMaterial
        );
        topGlass.position.set(1.5, 1.7, -depth / 3 + 0.2);
        storeGroup.add(topGlass);
        
        // Display case shelf
        const displayShelf = new THREE.Mesh(
            new THREE.BoxGeometry(displayCaseWidth - 0.1, 0.03, displayCaseDepth - 0.1),
            counterTopMaterial
        );
        displayShelf.position.set(1.5, 1.1, -depth / 3 + 0.2);
        storeGroup.add(displayShelf);
        
        // Pastries in display case
        const pastryColors = [0xd4a574, 0x8B4513, 0xf5deb3, 0xcd853f, 0xdeb887];
        for (let i = 0; i < 5; i++) {
            // Muffins/pastries
            const pastryGeometry = new THREE.SphereGeometry(0.12, 8, 6);
            pastryGeometry.scale(1, 0.7, 1);
            const pastry = new THREE.Mesh(pastryGeometry, new THREE.MeshStandardMaterial({ 
                color: pastryColors[i],
                roughness: 0.9
            }));
            pastry.position.set(1.0 + i * 0.25, 1.2, -depth / 3 + 0.1 + (i % 2) * 0.25);
            storeGroup.add(pastry);
        }
        
        // Croissants
        for (let i = 0; i < 3; i++) {
            const croissantGeometry = new THREE.TorusGeometry(0.08, 0.04, 6, 8, Math.PI);
            const croissant = new THREE.Mesh(croissantGeometry, new THREE.MeshStandardMaterial({
                color: 0xd4a574,
                roughness: 0.8
            }));
            croissant.rotation.x = Math.PI / 2;
            croissant.position.set(1.8 + i * 0.2, 1.18, -depth / 3 + 0.35);
            storeGroup.add(croissant);
        }
        
        // ========================================
        // ESPRESSO MACHINE (Detailed)
        // ========================================
        const espressoGroup = new THREE.Group();
        
        const chromeMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xc0c0c0, 
            metalness: 0.9, 
            roughness: 0.2 
        });
        const blackMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x1a1a1a, 
            roughness: 0.3 
        });
        
        // Main body
        const espressoBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.7, 0.5),
            chromeMaterial
        );
        espressoBody.position.y = 0.35;
        espressoGroup.add(espressoBody);
        
        // Top section
        const espressoTop = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, 0.2, 0.55),
            blackMaterial
        );
        espressoTop.position.y = 0.8;
        espressoGroup.add(espressoTop);
        
        // Portafilter handles
        [-0.2, 0.2].forEach(x => {
            const handle = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8),
                blackMaterial
            );
            handle.rotation.z = Math.PI / 2;
            handle.position.set(x, 0.3, 0.3);
            espressoGroup.add(handle);
        });
        
        // Steam wand
        const steamWand = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.015, 0.25, 6),
            chromeMaterial
        );
        steamWand.rotation.x = Math.PI / 6;
        steamWand.position.set(0.45, 0.2, 0.2);
        espressoGroup.add(steamWand);
        
        // Cup warming tray on top
        const cupTray = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.02, 0.4),
            chromeMaterial
        );
        cupTray.position.y = 0.91;
        espressoGroup.add(cupTray);
        
        // Cups on tray
        const cupMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
        for (let i = 0; i < 4; i++) {
            const cup = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.035, 0.08, 8),
                cupMaterial
            );
            cup.position.set(-0.2 + i * 0.13, 0.96, 0);
            // Flip cups upside down
            cup.rotation.x = Math.PI;
            espressoGroup.add(cup);
        }
        
        espressoGroup.position.set(-1.5, 1.04, -depth / 3);
        storeGroup.add(espressoGroup);
        
        // ========================================
        // COFFEE GRINDER
        // ========================================
        const grinderGroup = new THREE.Group();
        
        // Base
        const grinderBase = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.25, 0.25),
            blackMaterial
        );
        grinderBase.position.y = 0.125;
        grinderGroup.add(grinderBase);
        
        // Hopper (bean container)
        const hopper = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.08, 0.25, 8),
            new THREE.MeshStandardMaterial({ 
                color: 0x444444, 
                transparent: true, 
                opacity: 0.7 
            })
        );
        hopper.position.y = 0.375;
        grinderGroup.add(hopper);
        
        // Coffee beans visible in hopper
        for (let i = 0; i < 8; i++) {
            const bean = new THREE.Mesh(
                new THREE.SphereGeometry(0.025, 6, 4),
                new THREE.MeshStandardMaterial({ color: 0x3d2314 })
            );
            bean.scale.set(1, 0.6, 0.7);
            bean.position.set(
                (Math.random() - 0.5) * 0.12,
                0.35 + Math.random() * 0.1,
                (Math.random() - 0.5) * 0.12
            );
            grinderGroup.add(bean);
        }
        
        grinderGroup.position.set(-0.5, 1.04, -depth / 3);
        storeGroup.add(grinderGroup);
        
        // ========================================
        // MENU BOARD WITH CHALK-STYLE TEXT
        // ========================================
        const menuBoard = new THREE.Mesh(
            new THREE.BoxGeometry(4, 2, 0.1),
            new THREE.MeshStandardMaterial({ color: 0x1a2a1a })
        );
        menuBoard.position.set(0, height * 0.65, -depth / 2 + 0.15);
        storeGroup.add(menuBoard);
        
        // Decorative frame
        const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.7 });
        const frameThickness = 0.08;
        
        // Frame pieces
        const topFrame = new THREE.Mesh(
            new THREE.BoxGeometry(4.2, frameThickness, 0.12),
            frameMaterial
        );
        topFrame.position.set(0, height * 0.65 + 1.04, -depth / 2 + 0.15);
        storeGroup.add(topFrame);
        
        const bottomFrame = new THREE.Mesh(
            new THREE.BoxGeometry(4.2, frameThickness, 0.12),
            frameMaterial
        );
        bottomFrame.position.set(0, height * 0.65 - 1.04, -depth / 2 + 0.15);
        storeGroup.add(bottomFrame);
        
        // Chalk text simulation - bright white/cream chalk
        const chalkMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xfffef0, 
            emissive: 0xfffef0,
            emissiveIntensity: 0.4
        });
        
        // Large "COFFEE" title at top
        const titleGroup = new THREE.Group();
        const letterSpacing = 0.35;
        const titleY = height * 0.65 + 0.75;
        
        // C
        const letterC = new THREE.Mesh(
            new THREE.TorusGeometry(0.12, 0.04, 6, 12, Math.PI * 1.5),
            chalkMaterial
        );
        letterC.rotation.z = Math.PI * 0.25;
        letterC.position.set(-1.0, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterC);
        
        // O
        const letterO = new THREE.Mesh(
            new THREE.TorusGeometry(0.12, 0.04, 6, 16),
            chalkMaterial
        );
        letterO.position.set(-1.0 + letterSpacing, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterO);
        
        // F (two lines)
        const letterF1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.02), chalkMaterial);
        letterF1.position.set(-1.0 + letterSpacing * 2 - 0.05, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterF1);
        const letterF2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.02), chalkMaterial);
        letterF2.position.set(-1.0 + letterSpacing * 2 + 0.02, titleY + 0.12, -depth / 2 + 0.22);
        storeGroup.add(letterF2);
        const letterF3 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.02), chalkMaterial);
        letterF3.position.set(-1.0 + letterSpacing * 2, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterF3);
        
        // Second F
        const letterF4 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.02), chalkMaterial);
        letterF4.position.set(-1.0 + letterSpacing * 3 - 0.05, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterF4);
        const letterF5 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.02), chalkMaterial);
        letterF5.position.set(-1.0 + letterSpacing * 3 + 0.02, titleY + 0.12, -depth / 2 + 0.22);
        storeGroup.add(letterF5);
        const letterF6 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.02), chalkMaterial);
        letterF6.position.set(-1.0 + letterSpacing * 3, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterF6);
        
        // E
        const letterE1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.02), chalkMaterial);
        letterE1.position.set(-1.0 + letterSpacing * 4 - 0.05, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterE1);
        const letterE2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.02), chalkMaterial);
        letterE2.position.set(-1.0 + letterSpacing * 4 + 0.02, titleY + 0.12, -depth / 2 + 0.22);
        storeGroup.add(letterE2);
        const letterE3 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.02), chalkMaterial);
        letterE3.position.set(-1.0 + letterSpacing * 4, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterE3);
        const letterE4 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.02), chalkMaterial);
        letterE4.position.set(-1.0 + letterSpacing * 4 + 0.02, titleY - 0.12, -depth / 2 + 0.22);
        storeGroup.add(letterE4);
        
        // Second E
        const letterE5 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.02), chalkMaterial);
        letterE5.position.set(-1.0 + letterSpacing * 5 - 0.05, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterE5);
        const letterE6 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.02), chalkMaterial);
        letterE6.position.set(-1.0 + letterSpacing * 5 + 0.02, titleY + 0.12, -depth / 2 + 0.22);
        storeGroup.add(letterE6);
        const letterE7 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.02), chalkMaterial);
        letterE7.position.set(-1.0 + letterSpacing * 5, titleY, -depth / 2 + 0.22);
        storeGroup.add(letterE7);
        const letterE8 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.02), chalkMaterial);
        letterE8.position.set(-1.0 + letterSpacing * 5 + 0.02, titleY - 0.12, -depth / 2 + 0.22);
        storeGroup.add(letterE8);
        
        // Decorative underline under title
        const titleUnderline = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.03, 0.02),
            chalkMaterial
        );
        titleUnderline.position.set(0, titleY - 0.25, -depth / 2 + 0.22);
        storeGroup.add(titleUnderline);
        
        // Menu item lines with decorative bullets
        const menuItems = [
            { name: 1.6, price: 0.5 },  // Espresso
            { name: 1.4, price: 0.5 },  // Latte
            { name: 1.5, price: 0.5 },  // Cappuccino
            { name: 1.2, price: 0.5 },  // Mocha
            { name: 1.0, price: 0.5 }   // Tea
        ];
        
        menuItems.forEach((item, i) => {
            // Bullet point (coffee bean shape)
            const bullet = new THREE.Mesh(
                new THREE.SphereGeometry(0.04, 6, 4),
                chalkMaterial
            );
            bullet.scale.set(1, 0.6, 0.7);
            bullet.position.set(-1.7, height * 0.65 + 0.35 - i * 0.25, -depth / 2 + 0.22);
            storeGroup.add(bullet);
            
            // Item name line
            const textLine = new THREE.Mesh(
                new THREE.BoxGeometry(item.name, 0.06, 0.02),
                chalkMaterial
            );
            textLine.position.set(-0.7, height * 0.65 + 0.35 - i * 0.25, -depth / 2 + 0.22);
            storeGroup.add(textLine);
            
            // Dotted line to price
            for (let d = 0; d < 4; d++) {
                const dot = new THREE.Mesh(
                    new THREE.BoxGeometry(0.04, 0.04, 0.02),
                    chalkMaterial
                );
                dot.position.set(0.5 + d * 0.15, height * 0.65 + 0.35 - i * 0.25, -depth / 2 + 0.22);
                storeGroup.add(dot);
            }
            
            // Price
            const priceLine = new THREE.Mesh(
                new THREE.BoxGeometry(item.price, 0.06, 0.02),
                chalkMaterial
            );
            priceLine.position.set(1.4, height * 0.65 + 0.35 - i * 0.25, -depth / 2 + 0.22);
            storeGroup.add(priceLine);
        });
        
        // ========================================
        // SEATING AREA - Cozy Tables and Chairs
        // ========================================
        const tablePositions = [
            { x: -2.5, z: depth / 4 },
            { x: 0, z: depth / 4 + 0.5 },
            { x: 2.5, z: depth / 4 }
        ];
        
        tablePositions.forEach((pos, tableIndex) => {
            // Round wooden table
            const tableTop = new THREE.Mesh(
                new THREE.CylinderGeometry(0.55, 0.55, 0.06, 16),
                counterTopMaterial
            );
            tableTop.position.set(pos.x, 0.75, pos.z);
            storeGroup.add(tableTop);
            
            // Decorative table edge
            const tableEdge = new THREE.Mesh(
                new THREE.TorusGeometry(0.55, 0.03, 8, 24),
                new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.5 })
            );
            tableEdge.rotation.x = Math.PI / 2;
            tableEdge.position.set(pos.x, 0.75, pos.z);
            storeGroup.add(tableEdge);
            
            // Ornate table leg (pedestal style)
            const tablePedestal = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.12, 0.65, 8),
                counterWoodMaterial
            );
            tablePedestal.position.set(pos.x, 0.38, pos.z);
            storeGroup.add(tablePedestal);
            
            // Table base
            const tableBase = new THREE.Mesh(
                new THREE.CylinderGeometry(0.25, 0.28, 0.06, 12),
                counterWoodMaterial
            );
            tableBase.position.set(pos.x, 0.05, pos.z);
            storeGroup.add(tableBase);
            
            // Coffee cup on table
            const coffeeColor = [0x3d2314, 0x5c3d2e, 0x4a2c17][tableIndex];
            const mug = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.05, 0.1, 12),
                new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 })
            );
            mug.position.set(pos.x + 0.15, 0.83, pos.z - 0.1);
            storeGroup.add(mug);
            
            // Coffee inside mug
            const coffee = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12),
                new THREE.MeshStandardMaterial({ color: coffeeColor, roughness: 0.8 })
            );
            coffee.position.set(pos.x + 0.15, 0.87, pos.z - 0.1);
            storeGroup.add(coffee);
            
            // Mug handle
            const mugHandle = new THREE.Mesh(
                new THREE.TorusGeometry(0.03, 0.01, 6, 8, Math.PI),
                new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 })
            );
            mugHandle.rotation.y = Math.PI / 2;
            mugHandle.position.set(pos.x + 0.22, 0.83, pos.z - 0.1);
            storeGroup.add(mugHandle);
            
            // Bistro chairs (2 per table)
            const chairOffsets = [
                { x: -0.7, z: 0, rot: Math.PI / 2 },
                { x: 0.7, z: 0, rot: -Math.PI / 2 }
            ];
            
            chairOffsets.forEach(offset => {
                const chairGroup = new THREE.Group();
                
                const chairWoodMaterial = new THREE.MeshStandardMaterial({ 
                    color: 0x5c3d2e, 
                    roughness: 0.6 
                });
                const chairLegMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1810, metalness: 0.3 });
                
                // Seat (round wooden seat)
                const seat = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.2, 0.2, 0.035, 16),
                    chairWoodMaterial
                );
                seat.position.y = 0.45;
                chairGroup.add(seat);
                
                // Four legs extending from seat to floor
                // Back legs extend higher to form the back posts
                const legData = [
                    { x: 0.12, z: 0.12, height: 0.45, isBack: false },   // Front right
                    { x: -0.12, z: 0.12, height: 0.45, isBack: false },  // Front left
                    { x: 0.12, z: -0.12, height: 0.88, isBack: true },   // Back right
                    { x: -0.12, z: -0.12, height: 0.88, isBack: true }   // Back left
                ];
                
                legData.forEach(leg => {
                    const legMesh = new THREE.Mesh(
                        new THREE.CylinderGeometry(0.018, 0.022, leg.height, 6),
                        chairLegMaterial
                    );
                    // Position: back legs start at floor, go up to back height
                    // Front legs start at floor, go up to seat
                    legMesh.position.set(leg.x, leg.height / 2, leg.z);
                    chairGroup.add(legMesh);
                });
                
                // Top back rail connecting the two back posts
                const topBackRail = new THREE.Mesh(
                    new THREE.BoxGeometry(0.26, 0.05, 0.025),
                    chairLegMaterial
                );
                topBackRail.position.set(0, 0.86, -0.12);
                chairGroup.add(topBackRail);
                
                // Middle back rail
                const midBackRail = new THREE.Mesh(
                    new THREE.BoxGeometry(0.26, 0.04, 0.02),
                    chairLegMaterial
                );
                midBackRail.position.set(0, 0.7, -0.12);
                chairGroup.add(midBackRail);
                
                // Lower back rail (just above seat)
                const lowerBackRail = new THREE.Mesh(
                    new THREE.BoxGeometry(0.26, 0.03, 0.02),
                    chairLegMaterial
                );
                lowerBackRail.position.set(0, 0.54, -0.12);
                chairGroup.add(lowerBackRail);
                
                // Three vertical slats between rails
                [-0.07, 0, 0.07].forEach(xOff => {
                    const slat = new THREE.Mesh(
                        new THREE.BoxGeometry(0.03, 0.30, 0.015),
                        chairWoodMaterial
                    );
                    slat.position.set(xOff, 0.70, -0.12);
                    chairGroup.add(slat);
                });
                
                // Front stretcher between front legs
                const frontStretcher = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6),
                    chairLegMaterial
                );
                frontStretcher.rotation.z = Math.PI / 2;
                frontStretcher.position.set(0, 0.15, 0.12);
                chairGroup.add(frontStretcher);
                
                // Side stretchers
                const sideStretcherGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6);
                
                const rightStretcher = new THREE.Mesh(sideStretcherGeo, chairLegMaterial);
                rightStretcher.rotation.x = Math.PI / 2;
                rightStretcher.position.set(0.12, 0.15, 0);
                chairGroup.add(rightStretcher);
                
                const leftStretcher = new THREE.Mesh(sideStretcherGeo, chairLegMaterial);
                leftStretcher.rotation.x = Math.PI / 2;
                leftStretcher.position.set(-0.12, 0.15, 0);
                chairGroup.add(leftStretcher);
                
                // Back stretcher
                const backStretcher = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6),
                    chairLegMaterial
                );
                backStretcher.rotation.z = Math.PI / 2;
                backStretcher.position.set(0, 0.15, -0.12);
                chairGroup.add(backStretcher);
                
                chairGroup.position.set(pos.x + offset.x, 0, pos.z + offset.z);
                chairGroup.rotation.y = offset.rot;
                storeGroup.add(chairGroup);
            });
        });
        
        // ========================================
        // DECORATIVE ELEMENTS
        // ========================================
        
        // Hanging pendant lights over counter
        const lightFixtureMaterial = new THREE.MeshStandardMaterial({
            color: 0xd4a574,
            emissive: 0xffaa44,
            emissiveIntensity: 0.4
        });
        
        [-2, 0, 2].forEach(x => {
            // Light cord
            const cord = new THREE.Mesh(
                new THREE.CylinderGeometry(0.01, 0.01, 1.5, 4),
                new THREE.MeshStandardMaterial({ color: 0x111111 })
            );
            cord.position.set(x, height - 0.75, -depth / 3);
            storeGroup.add(cord);
            
            // Pendant shade (cone)
            const shade = new THREE.Mesh(
                new THREE.ConeGeometry(0.2, 0.25, 12, 1, true),
                lightFixtureMaterial
            );
            shade.rotation.x = Math.PI;
            shade.position.set(x, height - 1.6, -depth / 3);
            storeGroup.add(shade);
            
            // Light bulb glow
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: 0xffffee,
                    emissive: 0xffdd88,
                    emissiveIntensity: 0.8
                })
            );
            bulb.position.set(x, height - 1.7, -depth / 3);
            storeGroup.add(bulb);
        });
        
        // ========================================
        // DECORATIVE POTTED PLANTS
        // ========================================
        
        // Counter plant - Fern style
        const createFernPlant = (x, y, z, scale = 1) => {
            const plantGroup = new THREE.Group();
            
            // Terracotta pot
            const potMaterial = new THREE.MeshStandardMaterial({ color: 0xc45a3a, roughness: 0.8 });
            const pot = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1 * scale, 0.07 * scale, 0.12 * scale, 8),
                potMaterial
            );
            pot.position.y = 0.06 * scale;
            plantGroup.add(pot);
            
            // Pot rim
            const potRim = new THREE.Mesh(
                new THREE.TorusGeometry(0.1 * scale, 0.015 * scale, 6, 12),
                potMaterial
            );
            potRim.rotation.x = Math.PI / 2;
            potRim.position.y = 0.12 * scale;
            plantGroup.add(potRim);
            
            // Soil
            const soil = new THREE.Mesh(
                new THREE.CylinderGeometry(0.09 * scale, 0.09 * scale, 0.02 * scale, 8),
                new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 1 })
            );
            soil.position.y = 0.11 * scale;
            plantGroup.add(soil);
            
            // Fern fronds (multiple arching leaves)
            const leafMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x228B22, 
                roughness: 0.7,
                side: THREE.DoubleSide
            });
            const darkLeafMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x1a6b1a, 
                roughness: 0.7,
                side: THREE.DoubleSide
            });
            
            for (let i = 0; i < 12; i++) {
                const angle = (i / 12) * Math.PI * 2;
                const frondGroup = new THREE.Group();
                
                // Main stem
                const stemLength = (0.15 + Math.random() * 0.08) * scale;
                const stem = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.005 * scale, 0.008 * scale, stemLength, 4),
                    new THREE.MeshStandardMaterial({ color: 0x2d5a2d })
                );
                stem.position.y = stemLength / 2;
                frondGroup.add(stem);
                
                // Leaflets along the frond
                const numLeaflets = 5 + Math.floor(Math.random() * 3);
                for (let j = 0; j < numLeaflets; j++) {
                    const t = (j + 1) / numLeaflets;
                    const leaflet = new THREE.Mesh(
                        new THREE.PlaneGeometry(0.04 * scale, 0.02 * scale),
                        j % 2 === 0 ? leafMaterial : darkLeafMaterial
                    );
                    leaflet.position.y = stemLength * t * 0.9;
                    leaflet.position.x = (j % 2 === 0 ? 1 : -1) * 0.025 * scale;
                    leaflet.rotation.z = (j % 2 === 0 ? 1 : -1) * 0.4;
                    leaflet.rotation.y = (j % 2 === 0 ? 1 : -1) * 0.3;
                    frondGroup.add(leaflet);
                }
                
                frondGroup.position.y = 0.12 * scale;
                frondGroup.rotation.x = -0.3 - Math.random() * 0.4;
                frondGroup.rotation.y = angle;
                plantGroup.add(frondGroup);
            }
            
            plantGroup.position.set(x, y, z);
            return plantGroup;
        };
        
        // Counter fern
        storeGroup.add(createFernPlant(0.5, 1.08, -depth / 3, 1));
        
        // Floor plants (larger, in decorative planters)
        const createFloorPlant = (x, z) => {
            const plantGroup = new THREE.Group();
            
            // Large decorative planter
            const planterMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.7 });
            const planter = new THREE.Mesh(
                new THREE.CylinderGeometry(0.25, 0.18, 0.4, 10),
                planterMaterial
            );
            planter.position.y = 0.2;
            plantGroup.add(planter);
            
            // Planter rim
            const planterRim = new THREE.Mesh(
                new THREE.TorusGeometry(0.26, 0.03, 6, 16),
                planterMaterial
            );
            planterRim.rotation.x = Math.PI / 2;
            planterRim.position.y = 0.4;
            plantGroup.add(planterRim);
            
            // Decorative band on planter
            const band = new THREE.Mesh(
                new THREE.TorusGeometry(0.22, 0.015, 6, 16),
                new THREE.MeshStandardMaterial({ color: 0x8b7355 })
            );
            band.rotation.x = Math.PI / 2;
            band.position.y = 0.25;
            plantGroup.add(band);
            
            // Soil mound
            const soil = new THREE.Mesh(
                new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
                new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 1 })
            );
            soil.position.y = 0.38;
            plantGroup.add(soil);
            
            // Bushy foliage (multiple spherical clusters)
            const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2d8b2d, roughness: 0.8 });
            const darkFoliageMaterial = new THREE.MeshStandardMaterial({ color: 0x1a5a1a, roughness: 0.8 });
            
            // Central bush
            const centerFoliage = new THREE.Mesh(
                new THREE.SphereGeometry(0.25, 8, 6),
                foliageMaterial
            );
            centerFoliage.scale.set(1, 0.9, 1);
            centerFoliage.position.y = 0.75;
            plantGroup.add(centerFoliage);
            
            // Surrounding smaller foliage clusters
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const cluster = new THREE.Mesh(
                    new THREE.SphereGeometry(0.12 + Math.random() * 0.05, 6, 5),
                    i % 2 === 0 ? foliageMaterial : darkFoliageMaterial
                );
                cluster.position.set(
                    Math.cos(angle) * 0.2,
                    0.6 + Math.random() * 0.15,
                    Math.sin(angle) * 0.2
                );
                plantGroup.add(cluster);
            }
            
            plantGroup.position.set(x, 0, z);
            return plantGroup;
        };
        
        // Two floor plants - positioned in corners away from seating
        storeGroup.add(createFloorPlant(-width / 2 + 0.8, depth / 2 - 0.8));
        storeGroup.add(createFloorPlant(width / 2 - 0.8, depth / 2 - 0.8));
        
        // Cash register
        const registerMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.5 });
        const register = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.25, 0.35),
            registerMaterial
        );
        register.position.set(2.8, 1.2, -depth / 3);
        storeGroup.add(register);
        
        // Register screen
        const screen = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.15, 0.02),
            new THREE.MeshStandardMaterial({ 
                color: 0x88ff88, 
                emissive: 0x44aa44,
                emissiveIntensity: 0.3
            })
        );
        screen.rotation.x = -0.3;
        screen.position.set(2.8, 1.4, -depth / 3 + 0.1);
        storeGroup.add(register);
        storeGroup.add(screen);
        
        // Tip jar
        const tipJar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.07, 0.15, 12),
            new THREE.MeshStandardMaterial({ 
                color: 0xaaddff, 
                transparent: true, 
                opacity: 0.5 
            })
        );
        tipJar.position.set(3.2, 1.15, -depth / 3 + 0.3);
        storeGroup.add(tipJar);
        
        // ========================================
        // CEILING FAN
        // ========================================
        const ceilingFanGroup = new THREE.Group();
        ceilingFanGroup.name = 'ceilingFan';
        
        // Mounting plate
        const mountPlate = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.15, 0.05, 12),
            new THREE.MeshStandardMaterial({ color: 0xd4a574, metalness: 0.6 })
        );
        mountPlate.position.y = 0;
        ceilingFanGroup.add(mountPlate);
        
        // Down rod
        const downRod = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6),
            new THREE.MeshStandardMaterial({ color: 0xd4a574, metalness: 0.6 })
        );
        downRod.position.y = -0.22;
        ceilingFanGroup.add(downRod);
        
        // Motor housing
        const motorHousing = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.15, 0.15, 12),
            new THREE.MeshStandardMaterial({ color: 0xd4a574, metalness: 0.5 })
        );
        motorHousing.position.y = -0.5;
        ceilingFanGroup.add(motorHousing);
        
        // Fan blades (5 blades)
        const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.7 });
        for (let i = 0; i < 5; i++) {
            const bladeGroup = new THREE.Group();
            const blade = new THREE.Mesh(
                new THREE.BoxGeometry(0.6, 0.02, 0.12),
                bladeMaterial
            );
            blade.position.x = 0.35;
            bladeGroup.add(blade);
            
            // Blade mount
            const bladeMount = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.04, 0.08),
                new THREE.MeshStandardMaterial({ color: 0xd4a574, metalness: 0.5 })
            );
            bladeMount.position.x = 0.05;
            bladeGroup.add(bladeMount);
            
            bladeGroup.rotation.y = (i / 5) * Math.PI * 2;
            bladeGroup.position.y = -0.55;
            ceilingFanGroup.add(bladeGroup);
        }
        
        // Light fixture underneath
        const fanLight = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 12, 8),
            new THREE.MeshStandardMaterial({
                color: 0xfffef0,
                emissive: 0xffdd88,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.9
            })
        );
        fanLight.position.y = -0.7;
        ceilingFanGroup.add(fanLight);
        
        ceilingFanGroup.position.set(0, height - 0.1, depth / 4);
        storeGroup.add(ceilingFanGroup);
        
        // Store reference for animation
        this.cafeAnimations = this.cafeAnimations || {};
        this.cafeAnimations.ceilingFan = ceilingFanGroup;
        
        // ========================================
        // WALL ART - Vintage Coffee Posters
        // ========================================
        
        // Left wall - abstract coffee art
        const createWallArt = (x, y, z, rotY, width, artHeight, frameColor, artColors) => {
            const artGroup = new THREE.Group();
            
            // Frame
            const frameMaterial = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.5 });
            const frameWidth = 0.04;
            
            // Frame pieces
            const topFrame = new THREE.Mesh(
                new THREE.BoxGeometry(width + frameWidth * 2, frameWidth, 0.03),
                frameMaterial
            );
            topFrame.position.y = artHeight / 2 + frameWidth / 2;
            artGroup.add(topFrame);
            
            const bottomFrame = new THREE.Mesh(
                new THREE.BoxGeometry(width + frameWidth * 2, frameWidth, 0.03),
                frameMaterial
            );
            bottomFrame.position.y = -artHeight / 2 - frameWidth / 2;
            artGroup.add(bottomFrame);
            
            const leftFrame = new THREE.Mesh(
                new THREE.BoxGeometry(frameWidth, artHeight, 0.03),
                frameMaterial
            );
            leftFrame.position.x = -width / 2 - frameWidth / 2;
            artGroup.add(leftFrame);
            
            const rightFrame = new THREE.Mesh(
                new THREE.BoxGeometry(frameWidth, artHeight, 0.03),
                frameMaterial
            );
            rightFrame.position.x = width / 2 + frameWidth / 2;
            artGroup.add(rightFrame);
            
            // Canvas background
            const canvas = new THREE.Mesh(
                new THREE.BoxGeometry(width, artHeight, 0.02),
                new THREE.MeshStandardMaterial({ color: artColors.bg })
            );
            canvas.position.z = -0.01;
            artGroup.add(canvas);
            
            // Abstract art elements
            if (artColors.circle) {
                const circle = new THREE.Mesh(
                    new THREE.CircleGeometry(width * 0.3, 16),
                    new THREE.MeshStandardMaterial({ color: artColors.circle })
                );
                circle.position.set(0, 0, 0.01);
                artGroup.add(circle);
            }
            
            if (artColors.accent1) {
                const accent1 = new THREE.Mesh(
                    new THREE.BoxGeometry(width * 0.6, artHeight * 0.1, 0.015),
                    new THREE.MeshStandardMaterial({ color: artColors.accent1 })
                );
                accent1.position.set(0, artHeight * 0.25, 0.01);
                artGroup.add(accent1);
            }
            
            if (artColors.accent2) {
                const accent2 = new THREE.Mesh(
                    new THREE.BoxGeometry(width * 0.4, artHeight * 0.08, 0.015),
                    new THREE.MeshStandardMaterial({ color: artColors.accent2 })
                );
                accent2.position.set(-width * 0.1, -artHeight * 0.2, 0.01);
                artGroup.add(accent2);
            }
            
            artGroup.position.set(x, y, z);
            artGroup.rotation.y = rotY;
            return artGroup;
        };
        
        // Wall art on left side
        storeGroup.add(createWallArt(
            -width / 2 + 0.15, height * 0.55, 0,
            Math.PI / 2, 0.8, 1.0,
            0x3a2a1a,
            { bg: 0xf5e6d3, circle: 0x8b4513, accent1: 0xd4a574 }
        ));
        
        // Another piece on left wall
        storeGroup.add(createWallArt(
            -width / 2 + 0.15, height * 0.55, depth / 3,
            Math.PI / 2, 0.6, 0.8,
            0x2a1a10,
            { bg: 0x2a1a10, circle: 0xd4a574, accent2: 0xf5e6d3 }
        ));
        
        // Art on right wall
        storeGroup.add(createWallArt(
            width / 2 - 0.15, height * 0.55, 0,
            -Math.PI / 2, 0.9, 0.7,
            0x4a3a2a,
            { bg: 0x3d2314, accent1: 0xf5e6d3, accent2: 0xd4a574 }
        ));
        
        // ========================================
        // WINDOW WITH BLINDS (back of store simulation)
        // ========================================
        const windowGroup = new THREE.Group();
        
        // Window frame
        const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.6 });
        const windowWidth = 2;
        const windowHeight = 1.5;
        
        // Frame pieces
        const wTopFrame = new THREE.Mesh(
            new THREE.BoxGeometry(windowWidth + 0.15, 0.08, 0.06),
            windowFrameMaterial
        );
        wTopFrame.position.y = windowHeight / 2;
        windowGroup.add(wTopFrame);
        
        const wBottomFrame = new THREE.Mesh(
            new THREE.BoxGeometry(windowWidth + 0.15, 0.08, 0.06),
            windowFrameMaterial
        );
        wBottomFrame.position.y = -windowHeight / 2;
        windowGroup.add(wBottomFrame);
        
        const wLeftFrame = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, windowHeight, 0.06),
            windowFrameMaterial
        );
        wLeftFrame.position.x = -windowWidth / 2;
        windowGroup.add(wLeftFrame);
        
        const wRightFrame = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, windowHeight, 0.06),
            windowFrameMaterial
        );
        wRightFrame.position.x = windowWidth / 2;
        windowGroup.add(wRightFrame);
        
        // "Window" glass (light blue to simulate outside)
        const windowGlass = new THREE.Mesh(
            new THREE.BoxGeometry(windowWidth - 0.1, windowHeight - 0.1, 0.02),
            new THREE.MeshStandardMaterial({
                color: 0x87ceeb,
                emissive: 0x87ceeb,
                emissiveIntensity: 0.15,
                transparent: true,
                opacity: 0.7
            })
        );
        windowGlass.position.z = -0.02;
        windowGroup.add(windowGlass);
        
        // Venetian blinds
        const blindMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5dc, roughness: 0.6 });
        const numBlinds = 12;
        for (let i = 0; i < numBlinds; i++) {
            const blind = new THREE.Mesh(
                new THREE.BoxGeometry(windowWidth - 0.2, 0.04, 0.02),
                blindMaterial
            );
            blind.position.y = windowHeight / 2 - 0.15 - i * (windowHeight - 0.2) / numBlinds;
            blind.position.z = 0.02;
            blind.rotation.x = 0.2; // Slightly angled
            windowGroup.add(blind);
        }
        
        // Blind cords
        [-0.8, 0.8].forEach(xPos => {
            const cord = new THREE.Mesh(
                new THREE.CylinderGeometry(0.008, 0.008, windowHeight, 4),
                new THREE.MeshStandardMaterial({ color: 0xf5f5dc })
            );
            cord.position.set(xPos, 0, 0.04);
            windowGroup.add(cord);
        });
        
        windowGroup.position.set(width / 2 - 0.1, height * 0.5, -depth / 6);
        windowGroup.rotation.y = -Math.PI / 2;
        storeGroup.add(windowGroup);
    }

    createArcadeInterior(storeGroup, width, height, depth, accentColor) {
        // ========================================
        // DARK ATMOSPHERIC FLOOR WITH NEON PATTERN
        // ========================================
        
        // Dark carpet base
        const carpetGeometry = new THREE.PlaneGeometry(width - 0.2, depth - 0.2);
        const carpetMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a0a2e,
            roughness: 0.95
        });
        const carpet = new THREE.Mesh(carpetGeometry, carpetMaterial);
        carpet.rotation.x = -Math.PI / 2;
        carpet.position.set(0, 0.01, 0);
        storeGroup.add(carpet);
        
        // Neon carpet pattern (geometric shapes)
        const patternMaterial = new THREE.MeshStandardMaterial({
            color: 0xff00ff,
            emissive: 0xff00ff,
            emissiveIntensity: 0.15
        });
        const patternMaterial2 = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x00ffff,
            emissiveIntensity: 0.15
        });
        
        // Create zig-zag pattern on floor
        for (let z = -depth / 2 + 1; z < depth / 2 - 1; z += 1.5) {
            for (let x = -width / 2 + 1; x < width / 2 - 1; x += 2) {
                const triangle = new THREE.Mesh(
                    new THREE.CircleGeometry(0.15, 3),
                    (x + z) % 3 === 0 ? patternMaterial : patternMaterial2
                );
                triangle.rotation.x = -Math.PI / 2;
                triangle.rotation.z = Math.random() * Math.PI;
                triangle.position.set(x + Math.random() * 0.5, 0.02, z + Math.random() * 0.5);
                storeGroup.add(triangle);
            }
        }
        
        // ========================================
        // ARCADE CABINET CREATION FUNCTION
        // ========================================
        const createArcadeCabinet = (x, z, rotation, screenColor, cabinetColor, gameName) => {
            const cabinetGroup = new THREE.Group();
            
            const woodMaterial = new THREE.MeshStandardMaterial({ color: cabinetColor, roughness: 0.6 });
            const blackMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
            const screenMaterial = new THREE.MeshStandardMaterial({
                color: screenColor,
                emissive: screenColor,
                emissiveIntensity: 0.8
            });
            
            // Main cabinet body
            const bodyLower = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 1.0, 0.7),
                woodMaterial
            );
            bodyLower.position.set(0, 0.5, 0);
            cabinetGroup.add(bodyLower);
            
            // Control panel section (angled)
            const controlPanel = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 0.15, 0.5),
                blackMaterial
            );
            controlPanel.position.set(0, 1.0, 0.15);
            controlPanel.rotation.x = -0.3;
            cabinetGroup.add(controlPanel);
            
            // Joystick
            const joystickBase = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.05, 0.03, 8),
                blackMaterial
            );
            joystickBase.position.set(-0.15, 1.08, 0.2);
            cabinetGroup.add(joystickBase);
            
            const joystickStick = new THREE.Mesh(
                new THREE.CylinderGeometry(0.015, 0.015, 0.1, 6),
                new THREE.MeshStandardMaterial({ color: 0xff0000 })
            );
            joystickStick.position.set(-0.15, 1.15, 0.2);
            cabinetGroup.add(joystickStick);
            
            const joystickBall = new THREE.Mesh(
                new THREE.SphereGeometry(0.025, 8, 6),
                new THREE.MeshStandardMaterial({ color: 0xff0000 })
            );
            joystickBall.position.set(-0.15, 1.22, 0.2);
            cabinetGroup.add(joystickBall);
            
            // Buttons (colorful arcade buttons)
            const buttonColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00];
            buttonColors.forEach((color, i) => {
                const button = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12),
                    new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.3 })
                );
                button.position.set(0.05 + i * 0.08, 1.1, 0.18);
                cabinetGroup.add(button);
            });
            
            // Screen housing (upper body)
            const screenHousing = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 1.2, 0.5),
                woodMaterial
            );
            screenHousing.position.set(0, 1.7, -0.1);
            cabinetGroup.add(screenHousing);
            
            // Screen bezel
            const bezel = new THREE.Mesh(
                new THREE.BoxGeometry(0.65, 0.85, 0.05),
                blackMaterial
            );
            bezel.position.set(0, 1.75, 0.18);
            cabinetGroup.add(bezel);
            
            // Screen (glowing)
            const screen = new THREE.Mesh(
                new THREE.PlaneGeometry(0.55, 0.7),
                screenMaterial
            );
            screen.position.set(0, 1.75, 0.21);
            cabinetGroup.add(screen);
            
            // Scanlines effect on screen
            for (let i = 0; i < 12; i++) {
                const scanline = new THREE.Mesh(
                    new THREE.PlaneGeometry(0.55, 0.015),
                    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
                );
                scanline.position.set(0, 1.45 + i * 0.05, 0.22);
                cabinetGroup.add(scanline);
            }
            
            // Marquee (top sign with game name)
            const marquee = new THREE.Mesh(
                new THREE.BoxGeometry(0.75, 0.25, 0.08),
                new THREE.MeshStandardMaterial({
                    color: screenColor,
                    emissive: screenColor,
                    emissiveIntensity: 0.6
                })
            );
            marquee.position.set(0, 2.45, 0.05);
            cabinetGroup.add(marquee);
            
            // Marquee back-light glow
            const marqueeGlow = new THREE.PointLight(screenColor, 0.5, 2);
            marqueeGlow.position.set(0, 2.45, 0.3);
            cabinetGroup.add(marqueeGlow);
            
            // Side art panels (decorative stripes)
            const sideArtMaterial = new THREE.MeshStandardMaterial({
                color: screenColor,
                emissive: screenColor,
                emissiveIntensity: 0.2
            });
            
            [-0.41, 0.41].forEach(xOff => {
                for (let i = 0; i < 3; i++) {
                    const stripe = new THREE.Mesh(
                        new THREE.BoxGeometry(0.02, 0.4, 0.4),
                        sideArtMaterial
                    );
                    stripe.position.set(xOff, 1.2 + i * 0.5, 0);
                    cabinetGroup.add(stripe);
                }
            });
            
            // Coin slot area
            const coinSlotPanel = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.15, 0.05),
                blackMaterial
            );
            coinSlotPanel.position.set(0, 0.6, 0.38);
            cabinetGroup.add(coinSlotPanel);
            
            // Coin slot
            const coinSlot = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.02, 0.03),
                new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 })
            );
            coinSlot.position.set(0, 0.6, 0.4);
            cabinetGroup.add(coinSlot);
            
            // Speaker grille at bottom
            const grille = new THREE.Mesh(
                new THREE.PlaneGeometry(0.4, 0.15),
                new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 })
            );
            grille.position.set(0, 0.15, 0.36);
            cabinetGroup.add(grille);
            
            // Grille holes
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 8; col++) {
                    const hole = new THREE.Mesh(
                        new THREE.CircleGeometry(0.01, 6),
                        new THREE.MeshBasicMaterial({ color: 0x111111 })
                    );
                    hole.position.set(-0.14 + col * 0.04, 0.1 + row * 0.04, 0.37);
                    cabinetGroup.add(hole);
                }
            }
            
            cabinetGroup.position.set(x, 0, z);
            cabinetGroup.rotation.y = rotation;
            return cabinetGroup;
        };
        
        // ========================================
        // PLACE ARCADE CABINETS
        // ========================================
        
        // Back row - facing forward (against back wall)
        const backRowZ = -depth / 2 + 0.8;
        storeGroup.add(createArcadeCabinet(-2.5, backRowZ, 0, 0xff0066, 0x2a1a4a, 'SPACE BLASTER'));
        storeGroup.add(createArcadeCabinet(-0.8, backRowZ, 0, 0x00ff66, 0x1a2a4a, 'ALIEN ATTACK'));
        storeGroup.add(createArcadeCabinet(0.8, backRowZ, 0, 0x6600ff, 0x4a1a2a, 'CYBER RACER'));
        storeGroup.add(createArcadeCabinet(2.5, backRowZ, 0, 0xff6600, 0x2a4a1a, 'DRAGON QUEST'));
        
        // Left wall - facing into store (rotated to face +X)
        const leftX = -width / 2 + 0.8;
        storeGroup.add(createArcadeCabinet(leftX, -depth / 4 + 0.5, Math.PI / 2, 0x00ffff, 0x1a4a4a, 'NEON FIGHTER'));
        storeGroup.add(createArcadeCabinet(leftX, depth / 6, Math.PI / 2, 0xff00ff, 0x4a1a4a, 'PIXEL DUNGEON'));
        
        // Right wall - facing into store (rotated to face -X)
        const rightX = width / 2 - 0.8;
        storeGroup.add(createArcadeCabinet(rightX, -depth / 4 + 0.5, -Math.PI / 2, 0xffff00, 0x4a4a1a, 'TURBO DRIFT'));
        storeGroup.add(createArcadeCabinet(rightX, depth / 6, -Math.PI / 2, 0x00ff00, 0x1a4a1a, 'ZOMBIE HUNT'));
        
        // ========================================
        // PINBALL MACHINES
        // ========================================
        const createPinballMachine = (x, z, rotation, color) => {
            const pinballGroup = new THREE.Group();
            
            const cabinetMaterial = new THREE.MeshStandardMaterial({ color: color, roughness: 0.5 });
            const glassMaterial = new THREE.MeshStandardMaterial({
                color: 0xaaddff,
                transparent: true,
                opacity: 0.4,
                roughness: 0.1
            });
            
            // Lower cabinet
            const lowerCabinet = new THREE.Mesh(
                new THREE.BoxGeometry(0.7, 0.9, 1.4),
                cabinetMaterial
            );
            lowerCabinet.position.set(0, 0.45, 0);
            pinballGroup.add(lowerCabinet);
            
            // Playfield (angled)
            const playfield = new THREE.Mesh(
                new THREE.BoxGeometry(0.65, 0.05, 1.2),
                new THREE.MeshStandardMaterial({
                    color: 0x228844,
                    emissive: 0x114422,
                    emissiveIntensity: 0.3
                })
            );
            playfield.position.set(0, 1.0, 0.1);
            playfield.rotation.x = -0.3;
            pinballGroup.add(playfield);
            
            // Glass cover
            const glass = new THREE.Mesh(
                new THREE.BoxGeometry(0.65, 0.02, 1.2),
                glassMaterial
            );
            glass.position.set(0, 1.15, 0.1);
            glass.rotation.x = -0.3;
            pinballGroup.add(glass);
            
            // Backbox (vertical display)
            const backbox = new THREE.Mesh(
                new THREE.BoxGeometry(0.65, 0.7, 0.15),
                cabinetMaterial
            );
            backbox.position.set(0, 1.55, -0.55);
            pinballGroup.add(backbox);
            
            // Backbox display
            const backDisplay = new THREE.Mesh(
                new THREE.PlaneGeometry(0.55, 0.5),
                new THREE.MeshStandardMaterial({
                    color: color,
                    emissive: color,
                    emissiveIntensity: 0.7
                })
            );
            backDisplay.position.set(0, 1.55, -0.47);
            pinballGroup.add(backDisplay);
            
            // Flipper buttons (sides)
            [-0.38, 0.38].forEach(xOff => {
                const button = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8),
                    new THREE.MeshStandardMaterial({ color: 0xff0000 })
                );
                button.rotation.z = Math.PI / 2;
                button.position.set(xOff, 0.9, 0.5);
                pinballGroup.add(button);
            });
            
            // Coin door
            const coinDoor = new THREE.Mesh(
                new THREE.BoxGeometry(0.25, 0.3, 0.03),
                new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6 })
            );
            coinDoor.position.set(0, 0.3, 0.72);
            pinballGroup.add(coinDoor);
            
            pinballGroup.position.set(x, 0, z);
            pinballGroup.rotation.y = rotation;
            return pinballGroup;
        };
        
        // Place pinball machines near front, rotated to face forward
        storeGroup.add(createPinballMachine(-1.5, depth / 2 - 1.5, Math.PI, 0xff3366));
        storeGroup.add(createPinballMachine(1.5, depth / 2 - 1.5, Math.PI, 0x3366ff));
        
        // ========================================
        // PRIZE/TICKET COUNTER
        // ========================================
        const counterGroup = new THREE.Group();
        
        // Counter base
        const counterBase = new THREE.Mesh(
            new THREE.BoxGeometry(3, 1.1, 0.8),
            new THREE.MeshStandardMaterial({ color: 0x2a1a4a, roughness: 0.6 })
        );
        counterBase.position.set(0, 0.55, 0);
        counterGroup.add(counterBase);
        
        // Counter top (glass display)
        const counterTop = new THREE.Mesh(
            new THREE.BoxGeometry(3.1, 0.08, 0.9),
            new THREE.MeshStandardMaterial({
                color: 0x88aaff,
                transparent: true,
                opacity: 0.5,
                roughness: 0.1
            })
        );
        counterTop.position.set(0, 1.14, 0);
        counterGroup.add(counterTop);
        
        // Neon trim on counter
        const counterNeon = new THREE.Mesh(
            new THREE.BoxGeometry(3.2, 0.03, 0.03),
            new THREE.MeshStandardMaterial({
                color: 0xff00ff,
                emissive: 0xff00ff,
                emissiveIntensity: 1
            })
        );
        counterNeon.position.set(0, 1.0, 0.42);
        counterGroup.add(counterNeon);
        
        // Prize displays behind counter (shelves with toys)
        const prizeShelfMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3a5a });
        
        for (let shelfY = 0; shelfY < 3; shelfY++) {
            const shelf = new THREE.Mesh(
                new THREE.BoxGeometry(3.5, 0.05, 0.5),
                prizeShelfMaterial
            );
            shelf.position.set(0, 1.5 + shelfY * 0.8, -0.5);
            counterGroup.add(shelf);
            
            // Prizes on shelf (stuffed animals, toys)
            const prizeColors = [0xff6699, 0x66ff99, 0x9966ff, 0xffff66, 0x66ffff];
            for (let i = 0; i < 5; i++) {
                // Stuffed animal (simple sphere with ears)
                const toyGroup = new THREE.Group();
                
                const body = new THREE.Mesh(
                    new THREE.SphereGeometry(0.12, 8, 6),
                    new THREE.MeshStandardMaterial({ color: prizeColors[i] })
                );
                toyGroup.add(body);
                
                // Ears
                [-0.08, 0.08].forEach(xOff => {
                    const ear = new THREE.Mesh(
                        new THREE.SphereGeometry(0.04, 6, 4),
                        new THREE.MeshStandardMaterial({ color: prizeColors[i] })
                    );
                    ear.position.set(xOff, 0.1, 0);
                    toyGroup.add(ear);
                });
                
                // Eyes
                [-0.04, 0.04].forEach(xOff => {
                    const eye = new THREE.Mesh(
                        new THREE.SphereGeometry(0.02, 6, 4),
                        new THREE.MeshStandardMaterial({ color: 0x111111 })
                    );
                    eye.position.set(xOff, 0.02, 0.1);
                    toyGroup.add(eye);
                });
                
                toyGroup.position.set(-1.4 + i * 0.7, 1.62 + shelfY * 0.8, -0.5);
                toyGroup.rotation.y = Math.random() * 0.5 - 0.25;
                counterGroup.add(toyGroup);
            }
        }
        
        // Ticket dispenser
        const ticketDispenser = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.5, 0.3),
            new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.3 })
        );
        ticketDispenser.position.set(1.2, 1.4, 0);
        counterGroup.add(ticketDispenser);
        
        // Ticket slot
        const ticketSlot = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.02, 0.05),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        ticketSlot.position.set(1.2, 1.2, 0.16);
        counterGroup.add(ticketSlot);
        
        // Some tickets coming out
        const tickets = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.3, 0.01),
            new THREE.MeshStandardMaterial({ color: 0xffffcc })
        );
        tickets.position.set(1.2, 1.05, 0.2);
        tickets.rotation.x = 0.2;
        counterGroup.add(tickets);
        
        counterGroup.position.set(0, 0, -depth / 2 + 1.2);
        storeGroup.add(counterGroup);
        
        // ========================================
        // NEON LIGHTING AND ATMOSPHERE
        // ========================================
        
        // Ceiling neon tubes
        const neonTubeColors = [0xff00ff, 0x00ffff, 0xff0066, 0x00ff66];
        neonTubeColors.forEach((color, i) => {
            const tube = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, width - 2, 8),
                new THREE.MeshStandardMaterial({
                    color: color,
                    emissive: color,
                    emissiveIntensity: 1
                })
            );
            tube.rotation.z = Math.PI / 2;
            tube.position.set(0, height - 0.5, -depth / 3 + i * (depth / 5));
            storeGroup.add(tube);
            
            // Point light for each tube
            const tubeLight = new THREE.PointLight(color, 0.4, 6);
            tubeLight.position.set(0, height - 0.8, -depth / 3 + i * (depth / 5));
            storeGroup.add(tubeLight);
        });
        
        // Wall neon accents
        const wallNeonMaterial = new THREE.MeshStandardMaterial({
            color: 0xff00ff,
            emissive: 0xff00ff,
            emissiveIntensity: 1.2
        });
        
        // Vertical neon strips on back wall
        [-width / 3, 0, width / 3].forEach(x => {
            const strip = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, height - 1, 0.04),
                wallNeonMaterial
            );
            strip.position.set(x, height / 2, -depth / 2 + 0.1);
            storeGroup.add(strip);
        });
        
        // "ARCADE" sign on back wall (neon letters represented as glowing boxes)
        const signColors = [0xff0000, 0xff7700, 0xffff00, 0x00ff00, 0x00ffff, 0xff00ff];
        const letterPositions = [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5];
        letterPositions.forEach((xPos, i) => {
            const letter = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.5, 0.08),
                new THREE.MeshStandardMaterial({
                    color: signColors[i],
                    emissive: signColors[i],
                    emissiveIntensity: 0.8
                })
            );
            letter.position.set(xPos, height - 1.2, -depth / 2 + 0.15);
            storeGroup.add(letter);
        });
        
        // ========================================
        // CLAW MACHINE
        // ========================================
        const clawMachineGroup = new THREE.Group();
        
        // Base cabinet
        const clawBase = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.8, 1.0),
            new THREE.MeshStandardMaterial({ color: 0x3a2a5a })
        );
        clawBase.position.set(0, 0.4, 0);
        clawMachineGroup.add(clawBase);
        
        // Glass box
        const glassBoxMaterial = new THREE.MeshStandardMaterial({
            color: 0xaaddff,
            transparent: true,
            opacity: 0.25,
            roughness: 0.05
        });
        
        // Glass sides
        const glassFront = new THREE.Mesh(
            new THREE.BoxGeometry(1.15, 1.2, 0.02),
            glassBoxMaterial
        );
        glassFront.position.set(0, 1.4, 0.48);
        clawMachineGroup.add(glassFront);
        
        const glassBack = new THREE.Mesh(
            new THREE.BoxGeometry(1.15, 1.2, 0.02),
            glassBoxMaterial
        );
        glassBack.position.set(0, 1.4, -0.48);
        clawMachineGroup.add(glassBack);
        
        const glassLeft = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 1.2, 0.94),
            glassBoxMaterial
        );
        glassLeft.position.set(-0.57, 1.4, 0);
        clawMachineGroup.add(glassLeft);
        
        const glassRight = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 1.2, 0.94),
            glassBoxMaterial
        );
        glassRight.position.set(0.57, 1.4, 0);
        clawMachineGroup.add(glassRight);
        
        // Top frame
        const clawTop = new THREE.Mesh(
            new THREE.BoxGeometry(1.25, 0.15, 1.05),
            new THREE.MeshStandardMaterial({ color: 0x5a3a7a })
        );
        clawTop.position.set(0, 2.05, 0);
        clawMachineGroup.add(clawTop);
        
        // Claw mechanism
        const clawArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
            new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 })
        );
        clawArm.position.set(0, 1.8, 0);
        clawMachineGroup.add(clawArm);
        
        // Claw fingers
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const finger = new THREE.Mesh(
                new THREE.BoxGeometry(0.02, 0.15, 0.03),
                new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 })
            );
            finger.position.set(
                Math.cos(angle) * 0.05,
                1.52,
                Math.sin(angle) * 0.05
            );
            finger.rotation.x = 0.4;
            finger.rotation.z = angle;
            clawMachineGroup.add(finger);
        }
        
        // Prizes inside (colorful balls)
        const prizeColors2 = [0xff6699, 0x66ff99, 0x9966ff, 0xffff66, 0xff9966, 0x66ffff];
        for (let i = 0; i < 15; i++) {
            const prize = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 6),
                new THREE.MeshStandardMaterial({ color: prizeColors2[i % prizeColors2.length] })
            );
            prize.position.set(
                (Math.random() - 0.5) * 0.8,
                0.88 + Math.random() * 0.2,
                (Math.random() - 0.5) * 0.7
            );
            clawMachineGroup.add(prize);
        }
        
        // Control joystick panel
        const controlBox = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.25, 0.15),
            new THREE.MeshStandardMaterial({ color: 0x222222 })
        );
        controlBox.position.set(0, 0.9, 0.55);
        clawMachineGroup.add(controlBox);
        
        // Joystick on control box
        const clawJoystick = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
        );
        clawJoystick.position.set(0, 1.05, 0.55);
        clawMachineGroup.add(clawJoystick);
        
        // Big button
        const bigButton = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12),
            new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.5 })
        );
        bigButton.position.set(0.15, 1.02, 0.55);
        clawMachineGroup.add(bigButton);
        
        // Position claw machine in front-right corner, facing into store
        clawMachineGroup.position.set(width / 2 - 1.2, 0, depth / 2 - 1.2);
        clawMachineGroup.rotation.y = Math.PI;
        storeGroup.add(clawMachineGroup);
        
        // ========================================
        // AIR HOCKEY TABLE (center attraction)
        // ========================================
        const airHockeyGroup = new THREE.Group();
        
        // Table base
        const hockeyBase = new THREE.Mesh(
            new THREE.BoxGeometry(1.8, 0.8, 1.2),
            new THREE.MeshStandardMaterial({ color: 0x2a3a5a })
        );
        hockeyBase.position.set(0, 0.4, 0);
        airHockeyGroup.add(hockeyBase);
        
        // Playing surface
        const hockeySurface = new THREE.Mesh(
            new THREE.BoxGeometry(1.7, 0.05, 1.1),
            new THREE.MeshStandardMaterial({
                color: 0x1166ff,
                emissive: 0x0044aa,
                emissiveIntensity: 0.3
            })
        );
        hockeySurface.position.set(0, 0.825, 0);
        airHockeyGroup.add(hockeySurface);
        
        // Center line
        const centerLine = new THREE.Mesh(
            new THREE.BoxGeometry(1.7, 0.01, 0.02),
            new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        centerLine.position.set(0, 0.86, 0);
        airHockeyGroup.add(centerLine);
        
        // Goal areas
        [-0.5, 0.5].forEach(zPos => {
            const goal = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.01, 0.08),
                new THREE.MeshStandardMaterial({ color: 0xff0000 })
            );
            goal.position.set(0, 0.86, zPos);
            airHockeyGroup.add(goal);
        });
        
        // Side rails
        const railMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5 });
        
        // Long rails
        [-0.88, 0.88].forEach(x => {
            const rail = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.1, 1.15),
                railMaterial
            );
            rail.position.set(x, 0.9, 0);
            airHockeyGroup.add(rail);
        });
        
        // Short rails (with goal gaps)
        [-0.57, 0.57].forEach(z => {
            [-0.65, 0.65].forEach(x => {
                const rail = new THREE.Mesh(
                    new THREE.BoxGeometry(0.45, 0.1, 0.06),
                    railMaterial
                );
                rail.position.set(x, 0.9, z);
                airHockeyGroup.add(rail);
            });
        });
        
        // Puck
        const puck = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
        );
        puck.position.set(0.2, 0.87, 0.1);
        airHockeyGroup.add(puck);
        
        // Mallets
        [[-0.4, -0.3], [0.3, 0.25]].forEach(([x, z]) => {
            const malletGroup = new THREE.Group();
            
            const malletTop = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16),
                new THREE.MeshStandardMaterial({ color: z < 0 ? 0xff0000 : 0x00ff00 })
            );
            malletTop.position.y = 0.04;
            malletGroup.add(malletTop);
            
            const malletHandle = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8),
                new THREE.MeshStandardMaterial({ color: 0x333333 })
            );
            malletHandle.position.y = 0.085;
            malletGroup.add(malletHandle);
            
            malletGroup.position.set(x, 0.86, z);
            airHockeyGroup.add(malletGroup);
        });
        
        airHockeyGroup.position.set(0, 0, depth / 8);
        storeGroup.add(airHockeyGroup);
        
        // ========================================
        // CHANGE MACHINE
        // ========================================
        const changeMachine = new THREE.Group();
        
        const changeBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 1.6, 0.5),
            new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.4 })
        );
        changeBody.position.set(0, 0.8, 0);
        changeMachine.add(changeBody);
        
        // "CHANGE" sign
        const changeSign = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.15, 0.05),
            new THREE.MeshStandardMaterial({
                color: 0xff0000,
                emissive: 0xff0000,
                emissiveIntensity: 0.6
            })
        );
        changeSign.position.set(0, 1.5, 0.28);
        changeMachine.add(changeSign);
        
        // Bill slot
        const billSlot = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.01, 0.04),
            new THREE.MeshStandardMaterial({ color: 0x111111 })
        );
        billSlot.position.set(0, 1.2, 0.26);
        changeMachine.add(billSlot);
        
        // Coin dispenser tray
        const coinTray = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.08, 0.15),
            new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 })
        );
        coinTray.position.set(0, 0.4, 0.32);
        changeMachine.add(coinTray);
        
        // Position change machine in front-left corner, facing into store
        changeMachine.position.set(-width / 2 + 0.6, 0, depth / 2 - 0.8);
        changeMachine.rotation.y = Math.PI;
        storeGroup.add(changeMachine);
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
        // ========================================
        // FENCED DOG PLAY AREA
        // ========================================
        const playAreaGroup = new THREE.Group();
        playAreaGroup.name = 'dogPlayArea';
        
        // Fence parameters
        const fenceWidth = 2.5;
        const fenceDepth = 2.0;
        const fenceHeight = 0.5;
        const fencePostRadius = 0.03;
        const fenceX = -width / 4;
        const fenceZ = -depth / 4;
        
        const fenceMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.6
        });
        
        // Create fence posts and rails
        const postPositions = [
            [-fenceWidth/2, -fenceDepth/2], [0, -fenceDepth/2], [fenceWidth/2, -fenceDepth/2],
            [-fenceWidth/2, fenceDepth/2], [0, fenceDepth/2], [fenceWidth/2, fenceDepth/2],
            [-fenceWidth/2, 0], [fenceWidth/2, 0]
        ];
        
        postPositions.forEach(([px, pz]) => {
            const postGeometry = new THREE.CylinderGeometry(fencePostRadius, fencePostRadius, fenceHeight, 6);
            const post = new THREE.Mesh(postGeometry, fenceMaterial);
            post.position.set(fenceX + px, fenceHeight / 2, fenceZ + pz);
            playAreaGroup.add(post);
        });
        
        // Horizontal rails
        const railGeometry = new THREE.CylinderGeometry(0.015, 0.015, fenceWidth, 6);
        const sideRailGeometry = new THREE.CylinderGeometry(0.015, 0.015, fenceDepth, 6);
        
        // Front and back rails
        [-fenceDepth/2, fenceDepth/2].forEach(z => {
            [0.15, 0.35].forEach(y => {
                const rail = new THREE.Mesh(railGeometry, fenceMaterial);
                rail.rotation.z = Math.PI / 2;
                rail.position.set(fenceX, y, fenceZ + z);
                playAreaGroup.add(rail);
            });
        });
        
        // Side rails
        [-fenceWidth/2, fenceWidth/2].forEach(x => {
            [0.15, 0.35].forEach(y => {
                const rail = new THREE.Mesh(sideRailGeometry, fenceMaterial);
                rail.rotation.x = Math.PI / 2;
                rail.position.set(fenceX + x, y, fenceZ);
                playAreaGroup.add(rail);
            });
        });
        
        // Green grass floor for play area
        const grassGeometry = new THREE.PlaneGeometry(fenceWidth - 0.1, fenceDepth - 0.1);
        const grassMaterial = new THREE.MeshStandardMaterial({
            color: 0x4a7c23,
            roughness: 0.9
        });
        const grass = new THREE.Mesh(grassGeometry, grassMaterial);
        grass.rotation.x = -Math.PI / 2;
        grass.position.set(fenceX, 0.02, fenceZ);
        playAreaGroup.add(grass);
        
        // Create tiny dog
        const dogGroup = new THREE.Group();
        dogGroup.name = 'petStoreDog';
        
        // Dog body (elongated sphere)
        const dogBodyGeometry = new THREE.SphereGeometry(0.12, 8, 8);
        dogBodyGeometry.scale(1.3, 0.9, 0.8);
        const dogMaterial = new THREE.MeshStandardMaterial({
            color: 0xc4a467, // Golden/tan color
            roughness: 0.8
        });
        const dogBody = new THREE.Mesh(dogBodyGeometry, dogMaterial);
        dogBody.position.y = 0.12;
        dogGroup.add(dogBody);
        
        // Dog head
        const dogHeadGeometry = new THREE.SphereGeometry(0.08, 8, 8);
        const dogHead = new THREE.Mesh(dogHeadGeometry, dogMaterial);
        dogHead.position.set(0.14, 0.18, 0);
        dogGroup.add(dogHead);
        
        // Dog snout
        const snoutGeometry = new THREE.SphereGeometry(0.04, 6, 6);
        snoutGeometry.scale(1.2, 0.8, 0.8);
        const snout = new THREE.Mesh(snoutGeometry, dogMaterial);
        snout.position.set(0.22, 0.16, 0);
        dogGroup.add(snout);
        
        // Dog nose
        const noseGeometry = new THREE.SphereGeometry(0.015, 6, 6);
        const noseMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.position.set(0.26, 0.16, 0);
        dogGroup.add(nose);
        
        // Dog ears
        const earGeometry = new THREE.SphereGeometry(0.04, 6, 6);
        earGeometry.scale(0.6, 1.2, 0.4);
        [-0.05, 0.05].forEach(z => {
            const ear = new THREE.Mesh(earGeometry, dogMaterial);
            ear.position.set(0.1, 0.26, z);
            ear.rotation.x = z > 0 ? -0.3 : 0.3;
            dogGroup.add(ear);
        });
        
        // Dog tail (small cone)
        const tailGeometry = new THREE.ConeGeometry(0.03, 0.12, 6);
        const tail = new THREE.Mesh(tailGeometry, dogMaterial);
        tail.rotation.z = Math.PI / 3;
        tail.position.set(-0.18, 0.2, 0);
        tail.name = 'dogTail';
        dogGroup.add(tail);
        
        // Dog legs
        const legGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6);
        const legPositions = [
            [0.08, 0.05, 0.06], [0.08, 0.05, -0.06],
            [-0.08, 0.05, 0.06], [-0.08, 0.05, -0.06]
        ];
        legPositions.forEach(([x, y, z]) => {
            const leg = new THREE.Mesh(legGeometry, dogMaterial);
            leg.position.set(x, y, z);
            dogGroup.add(leg);
        });
        
        // Position dog in play area (raised slightly above ground)
        dogGroup.position.set(fenceX, 0.1, fenceZ);
        playAreaGroup.add(dogGroup);
        
        // Store dog reference for animation
        this.petStoreAnimations.dog = dogGroup;
        this.petStoreAnimations.dogBounds = {
            minX: fenceX - fenceWidth / 2 + 0.2,
            maxX: fenceX + fenceWidth / 2 - 0.2,
            minZ: fenceZ - fenceDepth / 2 + 0.2,
            maxZ: fenceZ + fenceDepth / 2 - 0.2
        };
        this.petStoreAnimations.dogTarget = { x: fenceX, z: fenceZ };
        
        storeGroup.add(playAreaGroup);
        
        // ========================================
        // AQUARIUM WITH FISH
        // ========================================
        const aquariumGroup = new THREE.Group();
        aquariumGroup.name = 'aquarium';
        
        // Large aquarium tank
        const tankWidth = 2.4;
        const tankHeight = 1.0;
        const tankDepth = 0.7;
        const tankX = width / 4;
        const tankZ = -depth / 2 + 0.8;
        const tableHeight = 0.9;
        const tankY = tableHeight + tankHeight / 2 + 0.08;
        
        // Table/stand for aquarium
        const tableMaterial = new THREE.MeshStandardMaterial({
            color: 0x4a3728,
            roughness: 0.7
        });
        
        // Table top
        const tableTop = new THREE.Mesh(
            new THREE.BoxGeometry(tankWidth + 0.2, 0.08, tankDepth + 0.2),
            tableMaterial
        );
        tableTop.position.set(tankX, tableHeight, tankZ);
        aquariumGroup.add(tableTop);
        
        // Table legs
        const tableLegGeometry = new THREE.BoxGeometry(0.1, tableHeight, 0.1);
        const tableLegPositions = [
            [tankX - tankWidth / 2, tableHeight / 2, tankZ - tankDepth / 2 + 0.1],
            [tankX + tankWidth / 2, tableHeight / 2, tankZ - tankDepth / 2 + 0.1],
            [tankX - tankWidth / 2, tableHeight / 2, tankZ + tankDepth / 2 - 0.1],
            [tankX + tankWidth / 2, tableHeight / 2, tankZ + tankDepth / 2 - 0.1]
        ];
        tableLegPositions.forEach(([lx, ly, lz]) => {
            const tableLeg = new THREE.Mesh(tableLegGeometry, tableMaterial);
            tableLeg.position.set(lx, ly, lz);
            aquariumGroup.add(tableLeg);
        });
        
        // Tank frame
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.4,
            metalness: 0.3
        });
        
        // Bottom frame
        const bottomFrame = new THREE.Mesh(
            new THREE.BoxGeometry(tankWidth + 0.1, 0.08, tankDepth + 0.1),
            frameMaterial
        );
        bottomFrame.position.set(tankX, tankY - tankHeight / 2 - 0.04, tankZ);
        aquariumGroup.add(bottomFrame);
        
        // Top frame
        const topFrame = new THREE.Mesh(
            new THREE.BoxGeometry(tankWidth + 0.1, 0.05, tankDepth + 0.1),
            frameMaterial
        );
        topFrame.position.set(tankX, tankY + tankHeight / 2 + 0.025, tankZ);
        aquariumGroup.add(topFrame);
        
        // Water (transparent blue)
        const waterMaterial = new THREE.MeshStandardMaterial({
            color: 0x3399ff,
            transparent: true,
            opacity: 0.35,
            roughness: 0.1
        });
        const water = new THREE.Mesh(
            new THREE.BoxGeometry(tankWidth, tankHeight, tankDepth),
            waterMaterial
        );
        water.position.set(tankX, tankY, tankZ);
        aquariumGroup.add(water);
        
        // Gravel at bottom
        const gravelMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B7355,
            roughness: 0.9
        });
        const gravel = new THREE.Mesh(
            new THREE.BoxGeometry(tankWidth - 0.05, 0.08, tankDepth - 0.05),
            gravelMaterial
        );
        gravel.position.set(tankX, tankY - tankHeight / 2 + 0.04, tankZ);
        aquariumGroup.add(gravel);
        
        // Aquarium plants
        const plantMaterial = new THREE.MeshStandardMaterial({
            color: 0x228B22,
            roughness: 0.7
        });
        [-0.8, 0, 0.7].forEach(offsetX => {
            const plantGroup = new THREE.Group();
            for (let i = 0; i < 3; i++) {
                const leafGeometry = new THREE.ConeGeometry(0.04, 0.3 + Math.random() * 0.2, 4);
                const leaf = new THREE.Mesh(leafGeometry, plantMaterial);
                leaf.position.set(
                    (Math.random() - 0.5) * 0.1,
                    0.15 + i * 0.05,
                    (Math.random() - 0.5) * 0.1
                );
                leaf.rotation.x = (Math.random() - 0.5) * 0.3;
                plantGroup.add(leaf);
            }
            plantGroup.position.set(tankX + offsetX, tankY - tankHeight / 2 + 0.1, tankZ);
            aquariumGroup.add(plantGroup);
        });
        
        // Create fish
        const fishColors = [0xff6600, 0xffcc00, 0xff0066, 0x00ccff, 0x9933ff];
        this.petStoreAnimations.fish = [];
        
        for (let f = 0; f < 5; f++) {
            const fishGroup = new THREE.Group();
            fishGroup.name = `fish_${f}`;
            
            // Fish body
            const fishBodyGeometry = new THREE.SphereGeometry(0.06, 8, 8);
            fishBodyGeometry.scale(1.5, 1, 0.6);
            const fishMaterial = new THREE.MeshStandardMaterial({
                color: fishColors[f],
                emissive: fishColors[f],
                emissiveIntensity: 0.2
            });
            const fishBody = new THREE.Mesh(fishBodyGeometry, fishMaterial);
            fishGroup.add(fishBody);
            
            // Fish tail
            const tailGeometry = new THREE.ConeGeometry(0.04, 0.08, 4);
            tailGeometry.rotateZ(Math.PI / 2);
            const fishTail = new THREE.Mesh(tailGeometry, fishMaterial);
            fishTail.position.x = -0.1;
            fishTail.name = 'fishTail';
            fishGroup.add(fishTail);
            
            // Fish eye
            const eyeGeometry = new THREE.SphereGeometry(0.015, 6, 6);
            const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
            eye.position.set(0.05, 0.02, 0.03);
            fishGroup.add(eye);
            
            // Random starting position in tank
            const startX = tankX + (Math.random() - 0.5) * (tankWidth - 0.3);
            const startY = tankY + (Math.random() - 0.5) * (tankHeight - 0.3);
            const startZ = tankZ + (Math.random() - 0.5) * (tankDepth - 0.2);
            fishGroup.position.set(startX, startY, startZ);
            
            aquariumGroup.add(fishGroup);
            
            // Store fish data for animation
            this.petStoreAnimations.fish.push({
                mesh: fishGroup,
                velocity: { x: (Math.random() - 0.5) * 0.3, y: (Math.random() - 0.5) * 0.1, z: 0 },
                bounds: {
                    minX: tankX - tankWidth / 2 + 0.15,
                    maxX: tankX + tankWidth / 2 - 0.15,
                    minY: tankY - tankHeight / 2 + 0.15,
                    maxY: tankY + tankHeight / 2 - 0.1,
                    minZ: tankZ - tankDepth / 2 + 0.1,
                    maxZ: tankZ + tankDepth / 2 - 0.1
                },
                turnTimer: Math.random() * 2
            });
        }
        
        // Aquarium light on top
        const lightFixture = new THREE.Mesh(
            new THREE.BoxGeometry(tankWidth - 0.2, 0.04, tankDepth - 0.1),
            new THREE.MeshStandardMaterial({
                color: 0x6699ff,
                emissive: 0x3366ff,
                emissiveIntensity: 0.5
            })
        );
        lightFixture.position.set(tankX, tankY + tankHeight / 2 + 0.07, tankZ);
        aquariumGroup.add(lightFixture);
        
        storeGroup.add(aquariumGroup);
        
        // ========================================
        // HAMSTER CAGE WITH WHEEL (on display table)
        // ========================================
        const hamsterCageGroup = new THREE.Group();
        hamsterCageGroup.name = 'hamsterCage';
        
        const cageX = 0;
        const cageZ = depth / 4;
        const cageWidth = 1.2;
        const cageHeight = 0.8;
        const cageDepth = 0.8;
        const cageTableHeight = 0.9;  // Height of the display table
        const cageY = cageTableHeight + cageHeight / 2 + 0.05;  // Cage sits on top of table
        
        // ========================================
        // DISPLAY TABLE FOR HAMSTER CAGE
        // ========================================
        const cageTableMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b4513,  // Wood brown
            roughness: 0.7
        });
        const cageTableLegMaterial = new THREE.MeshStandardMaterial({
            color: 0x654321,
            roughness: 0.8
        });
        
        // Table top
        const cageTableTop = new THREE.Mesh(
            new THREE.BoxGeometry(cageWidth + 0.3, 0.05, cageDepth + 0.3),
            cageTableMaterial
        );
        cageTableTop.position.set(cageX, cageTableHeight, cageZ);
        hamsterCageGroup.add(cageTableTop);
        
        // Table legs (4 corners)
        const cageLegPositions = [
            [-cageWidth / 2 - 0.05, -cageDepth / 2 - 0.05],
            [-cageWidth / 2 - 0.05, cageDepth / 2 + 0.05],
            [cageWidth / 2 + 0.05, -cageDepth / 2 - 0.05],
            [cageWidth / 2 + 0.05, cageDepth / 2 + 0.05]
        ];
        cageLegPositions.forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, cageTableHeight, 0.06),
                cageTableLegMaterial
            );
            leg.position.set(cageX + lx, cageTableHeight / 2, cageZ + lz);
            hamsterCageGroup.add(leg);
        });
        
        // Table shelf (lower level for supplies)
        const shelf = new THREE.Mesh(
            new THREE.BoxGeometry(cageWidth + 0.2, 0.03, cageDepth + 0.2),
            cageTableMaterial
        );
        shelf.position.set(cageX, cageTableHeight * 0.4, cageZ);
        hamsterCageGroup.add(shelf);
        
        // Small bag of hamster food on shelf
        const foodBag = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.2, 0.1),
            new THREE.MeshStandardMaterial({ color: 0xffcc00 })
        );
        foodBag.position.set(cageX - 0.3, cageTableHeight * 0.4 + 0.115, cageZ);
        hamsterCageGroup.add(foodBag);
        
        // Small water bottle on shelf
        const waterBottle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8),
            new THREE.MeshStandardMaterial({ color: 0x4488ff, transparent: true, opacity: 0.6 })
        );
        waterBottle.position.set(cageX + 0.3, cageTableHeight * 0.4 + 0.105, cageZ);
        hamsterCageGroup.add(waterBottle)
        
        // Cage base (plastic tray)
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x66cc99,
            roughness: 0.5
        });
        const cageBase = new THREE.Mesh(
            new THREE.BoxGeometry(cageWidth, 0.1, cageDepth),
            baseMaterial
        );
        cageBase.position.set(cageX, cageY - cageHeight / 2 + 0.05, cageZ);
        hamsterCageGroup.add(cageBase);
        
        // Bedding
        const beddingMaterial = new THREE.MeshStandardMaterial({
            color: 0xdeb887,
            roughness: 1
        });
        const bedding = new THREE.Mesh(
            new THREE.BoxGeometry(cageWidth - 0.1, 0.08, cageDepth - 0.1),
            beddingMaterial
        );
        bedding.position.set(cageX, cageY - cageHeight / 2 + 0.12, cageZ);
        hamsterCageGroup.add(bedding);
        
        // Wire cage (transparent with grid pattern)
        const wireMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.8,
            roughness: 0.3,
            transparent: true,
            opacity: 0.6
        });
        
        // Vertical wires
        for (let x = -cageWidth / 2 + 0.1; x <= cageWidth / 2; x += 0.15) {
            const wire = new THREE.Mesh(
                new THREE.CylinderGeometry(0.008, 0.008, cageHeight - 0.15, 4),
                wireMaterial
            );
            wire.position.set(cageX + x, cageY, cageZ + cageDepth / 2);
            hamsterCageGroup.add(wire);
            
            const wireBack = wire.clone();
            wireBack.position.z = cageZ - cageDepth / 2;
            hamsterCageGroup.add(wireBack);
        }
        
        // Side wires
        for (let z = -cageDepth / 2 + 0.1; z <= cageDepth / 2; z += 0.15) {
            [-cageWidth / 2, cageWidth / 2].forEach(xSide => {
                const wire = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.008, 0.008, cageHeight - 0.15, 4),
                    wireMaterial
                );
                wire.position.set(cageX + xSide, cageY, cageZ + z);
                hamsterCageGroup.add(wire);
            });
        }
        
        // Cage top
        const topMaterial = new THREE.MeshStandardMaterial({
            color: 0x66cc99,
            roughness: 0.5
        });
        const cageTop = new THREE.Mesh(
            new THREE.BoxGeometry(cageWidth, 0.05, cageDepth),
            topMaterial
        );
        cageTop.position.set(cageX, cageY + cageHeight / 2 - 0.025, cageZ);
        hamsterCageGroup.add(cageTop);
        
        // Hamster wheel
        // Create a parent group for the whole wheel assembly (includes stand)
        const wheelAssembly = new THREE.Group();
        wheelAssembly.name = 'hamsterWheelAssembly';
        
        // Create a separate group for ONLY the spinning parts
        const spinningWheel = new THREE.Group();
        spinningWheel.name = 'hamsterWheel';
        
        const wheelRadius = 0.18;
        const wheelThickness = 0.18; // Wide enough for hamster to fit inside
        
        // Wheel ring (torus) - front ring
        const wheelGeometry = new THREE.TorusGeometry(wheelRadius, 0.02, 8, 24);
        const wheelMaterial = new THREE.MeshStandardMaterial({
            color: 0xff6699,
            roughness: 0.3
        });
        const wheelRingFront = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheelRingFront.position.z = wheelThickness / 2; // Front of wheel
        spinningWheel.add(wheelRingFront);
        
        // Back ring
        const wheelRingBack = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheelRingBack.position.z = -wheelThickness / 2; // Back of wheel
        spinningWheel.add(wheelRingBack);
        
        // Connecting bars between front and back rings (the running surface)
        for (let i = 0; i < 16; i++) {
            const barAngle = (i / 16) * Math.PI * 2;
            const barGeometry = new THREE.CylinderGeometry(0.008, 0.008, wheelThickness, 4);
            const bar = new THREE.Mesh(barGeometry, wheelMaterial);
            bar.rotation.x = Math.PI / 2; // Orient along Z axis
            bar.position.set(
                Math.cos(barAngle) * wheelRadius,
                Math.sin(barAngle) * wheelRadius,
                0
            );
            spinningWheel.add(bar);
        }
        
        // Wheel spokes - radiate out from center (on back plate)
        for (let i = 0; i < 8; i++) {
            const spokeGeometry = new THREE.CylinderGeometry(0.008, 0.008, wheelRadius * 2, 4);
            const spoke = new THREE.Mesh(spokeGeometry, wheelMaterial);
            spoke.rotation.z = (i / 8) * Math.PI;
            spoke.position.z = -wheelThickness / 2; // On back
            spinningWheel.add(spoke);
        }
        
        // Wheel back plate - solid circle behind the wheel
        const backPlateGeometry = new THREE.CircleGeometry(wheelRadius - 0.02, 16);
        const backPlateMaterial = new THREE.MeshStandardMaterial({
            color: 0xffaacc,
            side: THREE.DoubleSide
        });
        const backPlate = new THREE.Mesh(backPlateGeometry, backPlateMaterial);
        backPlate.position.z = -wheelThickness / 2 - 0.01;
        spinningWheel.add(backPlate);
        
        // Rotate the entire spinning wheel to face sideways (so hamster runs facing along X)
        spinningWheel.rotation.y = Math.PI / 2;
        
        // Add spinning wheel to assembly
        wheelAssembly.add(spinningWheel);
        
        // Wheel stand (NOT part of spinning group - stays stationary)
        const standMaterial = new THREE.MeshStandardMaterial({
            color: 0x666666,
            metalness: 0.5
        });
        
        // Vertical post
        const standPost = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, wheelRadius + 0.08, 0.06),
            standMaterial
        );
        standPost.position.set(wheelThickness / 2 + 0.02, -0.02, 0);
        wheelAssembly.add(standPost);
        
        // Base of stand
        const standBase = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.03, 0.12),
            standMaterial
        );
        standBase.position.set(wheelThickness / 2 + 0.02, -wheelRadius / 2 - 0.06, 0);
        wheelAssembly.add(standBase);
        
        // Axle (connects stand to wheel center)
        const axle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.012, wheelThickness + 0.04, 8),
            standMaterial
        );
        axle.rotation.z = Math.PI / 2;
        axle.position.set(wheelThickness / 4, 0, 0);
        wheelAssembly.add(axle);
        
        // Position wheel assembly in cage
        wheelAssembly.position.set(cageX - cageWidth / 4, cageY - cageHeight / 2 + wheelRadius + 0.12, cageZ);
        hamsterCageGroup.add(wheelAssembly);
        
        // Store ONLY the spinning wheel reference for animation (not the whole assembly)
        this.petStoreAnimations.hamsterWheel = spinningWheel;
        
        // Create hamster
        const hamsterGroup = new THREE.Group();
        
        // Hamster body
        const hamsterBodyGeometry = new THREE.SphereGeometry(0.06, 8, 8);
        hamsterBodyGeometry.scale(1.2, 0.9, 1);
        const hamsterMaterial = new THREE.MeshStandardMaterial({
            color: 0xd4a574,
            roughness: 0.9
        });
        const hamsterBody = new THREE.Mesh(hamsterBodyGeometry, hamsterMaterial);
        hamsterGroup.add(hamsterBody);
        
        // Hamster head
        const hamsterHeadGeometry = new THREE.SphereGeometry(0.04, 8, 8);
        const hamsterHead = new THREE.Mesh(hamsterHeadGeometry, hamsterMaterial);
        hamsterHead.position.set(0.06, 0.02, 0);
        hamsterGroup.add(hamsterHead);
        
        // Hamster ears
        const hamsterEarGeometry = new THREE.SphereGeometry(0.015, 6, 6);
        [-0.025, 0.025].forEach(z => {
            const ear = new THREE.Mesh(hamsterEarGeometry, hamsterMaterial);
            ear.position.set(0.06, 0.06, z);
            hamsterGroup.add(ear);
        });
        
        // Hamster eyes
        const hamsterEyeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
        [0.015, -0.015].forEach(z => {
            const eye = new THREE.Mesh(
                new THREE.SphereGeometry(0.008, 6, 6),
                hamsterEyeMaterial
            );
            eye.position.set(0.09, 0.03, z);
            hamsterGroup.add(eye);
        });
        
        // Position hamster in center of cage (will run around)
        const hamsterStartX = cageX;
        const hamsterStartZ = cageZ;
        hamsterGroup.position.set(
            hamsterStartX,
            cageY - cageHeight / 2 + 0.20,
            hamsterStartZ
        );
        hamsterCageGroup.add(hamsterGroup);
        
        // Store hamster reference for animation
        this.petStoreAnimations.hamster = hamsterGroup;
        this.petStoreAnimations.hamsterBounds = {
            minX: cageX - cageWidth / 2 + 0.15,
            maxX: cageX + cageWidth / 2 - 0.15,
            minZ: cageZ - cageDepth / 2 + 0.15,
            maxZ: cageZ + cageDepth / 2 - 0.15
        };
        this.petStoreAnimations.hamsterTarget = { x: hamsterStartX, z: hamsterStartZ };
        
        // Water bottle
        const bottleMaterial = new THREE.MeshStandardMaterial({
            color: 0x99ccff,
            transparent: true,
            opacity: 0.6
        });
        const bottle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.15, 8),
            bottleMaterial
        );
        bottle.position.set(cageX + cageWidth / 3, cageY, cageZ - cageDepth / 2 + 0.05);
        hamsterCageGroup.add(bottle);
        
        // Food dish
        const dishMaterial = new THREE.MeshStandardMaterial({
            color: 0xffcc66,
            roughness: 0.5
        });
        const dish = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.06, 0.04, 12),
            dishMaterial
        );
        dish.position.set(cageX + cageWidth / 4, cageY - cageHeight / 2 + 0.14, cageZ + 0.1);
        hamsterCageGroup.add(dish);
        
        storeGroup.add(hamsterCageGroup);
        
        // ========================================
        // BIRD CAGES (simplified from original)
        // ========================================
        const cageMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.8,
            roughness: 0.3
        });

        [width / 3].forEach((x, i) => {
            // Cage base
            const birdCageGeometry = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 12, 1, true);
            const birdCage = new THREE.Mesh(birdCageGeometry, cageMaterial);
            birdCage.position.set(x, 1.4, 0);
            storeGroup.add(birdCage);

            // Cage top
            const birdTopGeometry = new THREE.ConeGeometry(0.4, 0.35, 12);
            const birdTop = new THREE.Mesh(birdTopGeometry, cageMaterial);
            birdTop.position.set(x, 2.15, 0);
            storeGroup.add(birdTop);

            // Bird perch
            const perchGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6);
            const perch = new THREE.Mesh(perchGeometry, new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
            perch.rotation.z = Math.PI / 2;
            perch.position.set(x, 1.4, 0);
            storeGroup.add(perch);

            // Bird
            const birdBody = new THREE.SphereGeometry(0.1, 8, 8);
            const birdMaterial = new THREE.MeshStandardMaterial({
                color: 0x00ff00,
                emissive: 0x00ff00,
                emissiveIntensity: 0.1
            });
            const bird = new THREE.Mesh(birdBody, birdMaterial);
            bird.position.set(x + 0.08, 1.5, 0);
            storeGroup.add(bird);
        });

        // Counter with register
        const counterGeometry = new THREE.BoxGeometry(2.0, 1, 0.7);
        const counterMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a4a });
        const counter = new THREE.Mesh(counterGeometry, counterMaterial);
        counter.position.set(-width / 3, 0.5, depth / 3);
        storeGroup.add(counter);

        // Pet food shelf
        const petFoodShelfMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
        const petFoodShelfGeometry = new THREE.BoxGeometry(width * 0.3, 0.08, 0.5);
        const petFoodShelf = new THREE.Mesh(petFoodShelfGeometry, petFoodShelfMaterial);
        petFoodShelf.position.set(width / 3, 1.0, depth / 4);
        storeGroup.add(petFoodShelf);

        // Pet food bags on shelf
        for (let b = 0; b < 3; b++) {
            const bagGeometry = new THREE.BoxGeometry(0.25, 0.4, 0.15);
            const bagMaterial = new THREE.MeshStandardMaterial({
                color: [0xff8844, 0x44aaff, 0x88ff44][b % 3]
            });
            const bag = new THREE.Mesh(bagGeometry, bagMaterial);
            bag.position.set(width / 3 - 0.3 + b * 0.3, 1.3, depth / 4);
            storeGroup.add(bag);
        }
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

        // ========================================
        // PET STORE ANIMATIONS
        // ========================================
        
        // Animate dog running stochastically
        if (this.petStoreAnimations.dog && this.petStoreAnimations.dogBounds) {
            const dog = this.petStoreAnimations.dog;
            const bounds = this.petStoreAnimations.dogBounds;
            const target = this.petStoreAnimations.dogTarget;
            
            // Check if dog needs a new target
            const dx = target.x - dog.position.x;
            const dz = target.z - dog.position.z;
            const distToTarget = Math.sqrt(dx * dx + dz * dz);
            
            // Decrease wait time
            if (this.petStoreAnimations.dogWaitTime > 0) {
                this.petStoreAnimations.dogWaitTime -= deltaTime;
            } else if (distToTarget < 0.1) {
                // Reached target, pick new random target after a wait
                this.petStoreAnimations.dogWaitTime = 0.5 + Math.random() * 2; // Wait 0.5-2.5 seconds
                target.x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
                target.z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
            } else {
                // Move towards target
                const speed = this.petStoreAnimations.dogSpeed * deltaTime;
                const angle = Math.atan2(dz, dx);
                
                dog.position.x += Math.cos(angle) * speed;
                dog.position.z += Math.sin(angle) * speed;
                
                // Rotate dog to face movement direction
                // Dog model faces +X, so rotate by -angle to face the movement direction
                dog.rotation.y = -angle;
                
                // Animate tail wagging
                const tail = dog.getObjectByName('dogTail');
                if (tail) {
                    tail.rotation.y = Math.sin(time * 15) * 0.5;
                }
                
                // Bob up and down while running (keep above ground level 0.1)
                dog.position.y = 0.1 + Math.abs(Math.sin(time * 12)) * 0.03;
            }
        }
        
        // Animate fish swimming
        if (this.petStoreAnimations.fish && this.petStoreAnimations.fish.length > 0) {
            this.petStoreAnimations.fish.forEach(fishData => {
                const fish = fishData.mesh;
                const velocity = fishData.velocity;
                const bounds = fishData.bounds;
                
                // Update turn timer
                fishData.turnTimer -= deltaTime;
                if (fishData.turnTimer <= 0) {
                    // Random direction change
                    velocity.x = (Math.random() - 0.5) * 0.4;
                    velocity.y = (Math.random() - 0.5) * 0.15;
                    fishData.turnTimer = 1 + Math.random() * 3; // Turn every 1-4 seconds
                }
                
                // Move fish
                fish.position.x += velocity.x * deltaTime;
                fish.position.y += velocity.y * deltaTime;
                
                // Add slight wobble
                fish.position.y += Math.sin(time * 3 + fish.position.x * 5) * 0.002;
                
                // Bounce off bounds
                if (fish.position.x < bounds.minX) {
                    fish.position.x = bounds.minX;
                    velocity.x = Math.abs(velocity.x);
                } else if (fish.position.x > bounds.maxX) {
                    fish.position.x = bounds.maxX;
                    velocity.x = -Math.abs(velocity.x);
                }
                
                if (fish.position.y < bounds.minY) {
                    fish.position.y = bounds.minY;
                    velocity.y = Math.abs(velocity.y);
                } else if (fish.position.y > bounds.maxY) {
                    fish.position.y = bounds.maxY;
                    velocity.y = -Math.abs(velocity.y);
                }
                
                // Rotate fish to face movement direction
                if (velocity.x !== 0) {
                    fish.rotation.y = velocity.x > 0 ? 0 : Math.PI;
                }
                
                // Animate tail
                const tail = fish.getObjectByName('fishTail');
                if (tail) {
                    tail.rotation.y = Math.sin(time * 10) * 0.3;
                }
            });
        }
        
        // Animate hamster wheel spinning
        // The wheel is rotated 90° around Y, so we spin around local X axis (which appears as Z in world space)
        if (this.petStoreAnimations.hamsterWheel) {
            this.petStoreAnimations.hamsterWheel.rotation.x += deltaTime * 5; // Constant spinning
        }
        
        // Animate hamster running stochastically
        if (this.petStoreAnimations.hamster && this.petStoreAnimations.hamsterBounds) {
            const hamster = this.petStoreAnimations.hamster;
            const bounds = this.petStoreAnimations.hamsterBounds;
            const target = this.petStoreAnimations.hamsterTarget;
            
            // Check if hamster needs a new target
            const dx = target.x - hamster.position.x;
            const dz = target.z - hamster.position.z;
            const distToTarget = Math.sqrt(dx * dx + dz * dz);
            
            // Decrease wait time
            if (this.petStoreAnimations.hamsterWaitTime > 0) {
                this.petStoreAnimations.hamsterWaitTime -= deltaTime;
            } else if (distToTarget < 0.05) {
                // Reached target, pick new random target after a wait
                this.petStoreAnimations.hamsterWaitTime = 0.3 + Math.random() * 1.5; // Wait 0.3-1.8 seconds
                target.x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
                target.z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
            } else {
                // Move towards target
                const speed = this.petStoreAnimations.hamsterSpeed * deltaTime;
                const angle = Math.atan2(dz, dx);
                
                hamster.position.x += Math.cos(angle) * speed;
                hamster.position.z += Math.sin(angle) * speed;
                
                // Rotate hamster to face movement direction (hamster model faces +X)
                hamster.rotation.y = -angle;
            }
        }
        
        // ========================================
        // CAFE ANIMATIONS
        // ========================================
        
        // Animate ceiling fan spinning
        if (this.cafeAnimations && this.cafeAnimations.ceilingFan) {
            const fan = this.cafeAnimations.ceilingFan;
            // Rotate the fan blades (children 4-8 are the blade groups)
            fan.children.forEach((child, index) => {
                if (index >= 4 && index < 9) { // Blade groups
                    child.rotation.y += deltaTime * 2.5; // Slow, lazy spin
                }
            });
        }
        
        // ========================================
        // LAUNDROMAT ANIMATIONS
        // ========================================
        
        // Animate washing machine and dryer drums spinning stochastically
        if (this.laundromatAnimations && this.laundromatAnimations.drums) {
            this.laundromatAnimations.drums.forEach(drumData => {
                if (!drumData.drum) return;
                
                // Update change timer for stochastic direction changes
                drumData.changeTimer += deltaTime;
                
                if (drumData.changeTimer >= drumData.changeDuration) {
                    // Randomly change direction
                    drumData.direction = Math.random() > 0.5 ? 1 : -1;
                    drumData.changeDuration = 2 + Math.random() * 4; // 2-6 seconds between changes
                    drumData.changeTimer = 0;
                    
                    // Also vary the speed slightly
                    drumData.speed = 1.5 + Math.random() * 2.5;
                }
                
                // Spin the drum around Z axis (front-facing rotation)
                drumData.drum.rotation.z += drumData.direction * drumData.speed * deltaTime;
            });
        }
    }

    getStoreData() {
        return this.storeData;
    }

    getAudioSources() {
        return this.storeData.filter(store => store.hasMusic);
    }
}

export default Stores;
