// ========================================
// MALL.JS - Mall Structure & Geometry
// Mall Walk '92 - Vaporwave Experience
// ========================================

import * as THREE from 'three';
import { COLORS, MALL_CONFIG } from './scene.js';

export class Mall {
    constructor(scene) {
        this.scene = scene;
        this.collisionObjects = [];
        this.escalatorSteps = [];
        this.animatedObjects = [];
        this.escalatorZones = [];  // Initialize escalator zones array
        this.meshes = [];          // Track all meshes for disposal
        this.materials = [];       // Track all materials for disposal
        this.geometries = [];      // Track all geometries for disposal
        this.parkingLotBackdrops = [];  // References to both parking lot backdrops
        this.parkingLotDayTexture = null;
        this.parkingLotNightTexture = null;
        this.corridorDoorGlassMaterial = null;  // Reference for day/night updates
    }

    build() {
        this.createFloors();
        this.createWalls();
        this.createPillars();
        this.createRailings();
        this.createEscalators();
        this.createElevator();
        this.createCeiling();

        return this.collisionObjects;
    }

    createFloors() {
        // Ground floor - decorative marble pattern
        const floorGroup = new THREE.Group();
        floorGroup.name = 'floors';

        // Base floor - polished marble look (simplified for performance)
        const floorGeometry = new THREE.PlaneGeometry(MALL_CONFIG.width, MALL_CONFIG.length, 1, 1);
        
        // Create marble-like texture with MeshStandardMaterial for better performance
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.marble,
            roughness: 0.1,
            metalness: 0.1
        });

        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0;
        floor.receiveShadow = true;
        floorGroup.add(floor);
        
        // Add subtle color variation tiles for marble effect
        this.addMarbleTiles(floorGroup);

        // Decorative floor patterns
        this.createFloorPatterns(floorGroup, 0);

        // Second floor - full floor with precise holes for escalators only
        const secondFloorY = MALL_CONFIG.floorHeight;

        const walkwayMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.marble,
            roughness: 0.15,
            metalness: 0.1
        });

        // Escalator configuration
        const xOffset = MALL_CONFIG.aisleWidth / 2 + 5; // Where escalators are positioned
        const escalatorPairWidth = 8; // Width to cut out for escalator pair (2 escalators + divider)
        const escalatorHoleLength = 15; // Length of hole for escalator
        
        // Escalator hole definitions: { x, z, width, length }
        const escalatorHoles = [
            // Left side escalators at z=-25
            { x: -xOffset, z: -25, width: escalatorPairWidth, length: escalatorHoleLength },
            // Right side escalators at z=-25  
            { x: xOffset, z: -25, width: escalatorPairWidth, length: escalatorHoleLength },
            // Left side escalators at z=25
            { x: -xOffset, z: 25, width: escalatorPairWidth, length: escalatorHoleLength },
            // Right side escalators at z=25
            { x: xOffset, z: 25, width: escalatorPairWidth, length: escalatorHoleLength }
        ];

        // Create the second floor as multiple segments around escalator holes
        this.createSecondFloorWithHoles(floorGroup, walkwayMaterial, secondFloorY, escalatorHoles);

        // Add patterns to second floor
        this.createFloorPatterns(floorGroup, secondFloorY + 0.26);

        this.scene.add(floorGroup);
    }

    createSecondFloorWithHoles(parent, material, floorY, holes) {
        const mallWidth = MALL_CONFIG.width;
        const mallLength = MALL_CONFIG.length;
        const aisleWidth = MALL_CONFIG.aisleWidth;
        const floorThickness = 0.5;
        
        // Calculate walkway width on each side (space between aisle and mall edge)
        const walkwayWidth = (mallWidth - aisleWidth) / 2;
        
        // Left walkway X position (center of left walkway)
        const leftWalkwayX = -aisleWidth / 2 - walkwayWidth / 2;
        // Right walkway X position (center of right walkway)
        const rightWalkwayX = aisleWidth / 2 + walkwayWidth / 2;
        
        // Get holes for each side
        const leftHoles = holes.filter(h => h.x < 0).sort((a, b) => a.z - b.z);
        const rightHoles = holes.filter(h => h.x > 0).sort((a, b) => a.z - b.z);
        
        // Create left walkway with holes
        this.createWalkwayWithPreciseHoles(parent, material, floorY, floorThickness,
            leftWalkwayX, walkwayWidth, mallLength, leftHoles);
        
        // Create right walkway with holes
        this.createWalkwayWithPreciseHoles(parent, material, floorY, floorThickness,
            rightWalkwayX, walkwayWidth, mallLength, rightHoles);
    }
    
    createWalkwayWithPreciseHoles(parent, material, floorY, thickness, centerX, width, length, holes) {
        // Sort holes by Z position
        const sortedHoles = [...holes].sort((a, b) => a.z - b.z);
        
        let currentZ = -length / 2;
        
        for (let i = 0; i <= sortedHoles.length; i++) {
            let sectionEndZ;
            let holeAtThisZ = null;
            
            if (i < sortedHoles.length) {
                holeAtThisZ = sortedHoles[i];
                sectionEndZ = holeAtThisZ.z - holeAtThisZ.length / 2;
            } else {
                sectionEndZ = length / 2;
            }
            
            const sectionLength = sectionEndZ - currentZ;
            
            // Create solid walkway section before the hole
            if (sectionLength > 0.5) {
                const sectionGeom = new THREE.BoxGeometry(width, thickness, sectionLength);
                const section = new THREE.Mesh(sectionGeom, material);
                section.position.set(centerX, floorY, currentZ + sectionLength / 2);
                parent.add(section);
            }
            
            // If there's a hole, create floor sections on either side of it
            if (holeAtThisZ) {
                const holeLength = holeAtThisZ.length;
                const holeWidth = holeAtThisZ.width;
                const holeZCenter = holeAtThisZ.z;
                const holeCenterX = holeAtThisZ.x;
                
                // Calculate the hole's position relative to this walkway
                const walkwayLeftEdge = centerX - width / 2;
                const walkwayRightEdge = centerX + width / 2;
                const holeLeftEdge = holeCenterX - holeWidth / 2;
                const holeRightEdge = holeCenterX + holeWidth / 2;
                
                // Floor strip on the left side of the hole (toward mall edge)
                const leftStripWidth = holeLeftEdge - walkwayLeftEdge;
                if (leftStripWidth > 0.1) {
                    const leftStrip = new THREE.Mesh(
                        new THREE.BoxGeometry(leftStripWidth, thickness, holeLength),
                        material
                    );
                    leftStrip.position.set(walkwayLeftEdge + leftStripWidth / 2, floorY, holeZCenter);
                    parent.add(leftStrip);
                }
                
                // Floor strip on the right side of the hole (toward atrium)
                const rightStripWidth = walkwayRightEdge - holeRightEdge;
                if (rightStripWidth > 0.1) {
                    const rightStrip = new THREE.Mesh(
                        new THREE.BoxGeometry(rightStripWidth, thickness, holeLength),
                        material
                    );
                    rightStrip.position.set(holeRightEdge + rightStripWidth / 2, floorY, holeZCenter);
                    parent.add(rightStrip);
                }
                
                currentZ = holeZCenter + holeLength / 2;
            }
        }
    }

    createSegmentedWalkway(parent, material, walkwayWidth, floorY, side, holePositions, holeLength) {
        // This method is kept for compatibility but no longer used
        // The new createSecondFloorWithHoles method handles the entire second floor
        const xPos = side * (MALL_CONFIG.aisleWidth / 2 + walkwayWidth / 2);
        const totalLength = MALL_CONFIG.length;
        
        // Sort hole positions
        const sortedHoles = [...holePositions].sort((a, b) => a - b);
        
        let currentZ = -totalLength / 2;
        
        for (let i = 0; i <= sortedHoles.length; i++) {
            let segmentEnd;
            if (i < sortedHoles.length) {
                segmentEnd = sortedHoles[i] - holeLength / 2;
            } else {
                segmentEnd = totalLength / 2;
            }
            
            const segmentLength = segmentEnd - currentZ;
            if (segmentLength > 1) {
                const segmentGeometry = new THREE.BoxGeometry(walkwayWidth, 0.5, segmentLength);
                const segment = new THREE.Mesh(segmentGeometry, material);
                segment.position.set(xPos, floorY, currentZ + segmentLength / 2);
                parent.add(segment);
            }
            
            if (i < sortedHoles.length) {
                currentZ = sortedHoles[i] + holeLength / 2;
            }
        }
    }

    createFloorPatterns(parent, yOffset) {
        // Create geometric floor pattern inspired by 90s malls
        const patternSpacing = 15;
        const colors = [COLORS.teal, COLORS.neonPink, COLORS.neonYellow, COLORS.softPurple];
        
        // Determine if this is the second floor (y > 0)
        const isSecondFloor = yOffset > 1;
        const aisleHalfWidth = MALL_CONFIG.aisleWidth / 2; // 12.5

        for (let x = -30; x <= 30; x += patternSpacing) {
            // Skip center atrium area on second floor
            if (isSecondFloor && Math.abs(x) < aisleHalfWidth) {
                continue;
            }
            
            for (let z = -50; z <= 50; z += patternSpacing) {
                // Diamond pattern - raised slightly more to prevent z-fighting
                const diamondGeometry = new THREE.PlaneGeometry(3.5, 3.5);
                const colorIndex = Math.abs((x + z) / patternSpacing) % colors.length;
                const diamondMaterial = new THREE.MeshStandardMaterial({
                    color: colors[colorIndex],
                    roughness: 0.2,
                    metalness: 0.3,
                    polygonOffset: true,
                    polygonOffsetFactor: -1
                });

                const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
                diamond.rotation.x = -Math.PI / 2;
                diamond.rotation.z = Math.PI / 4;
                diamond.position.set(x, yOffset + 0.02, z);
                parent.add(diamond);

                // Small triangle accents - offset more to avoid overlap with diamonds
                const triangleShape = new THREE.Shape();
                triangleShape.moveTo(0, 1.2);
                triangleShape.lineTo(-1.0, -0.6);
                triangleShape.lineTo(1.0, -0.6);
                triangleShape.closePath();

                const triangleGeometry = new THREE.ShapeGeometry(triangleShape);
                const triangleMaterial = new THREE.MeshStandardMaterial({
                    color: colors[(colorIndex + 2) % colors.length],
                    roughness: 0.2,
                    metalness: 0.3,
                    polygonOffset: true,
                    polygonOffsetFactor: -2
                });

                const triangle = new THREE.Mesh(triangleGeometry, triangleMaterial);
                triangle.rotation.x = -Math.PI / 2;
                triangle.position.set(x + 5, yOffset + 0.025, z + 5);
                parent.add(triangle);
            }
        }
    }

    addMarbleTiles(parent) {
        // Marble tiles disabled for performance
        // The base floor material provides sufficient visual effect
    }

    createWalls() {
        const wallGroup = new THREE.Group();
        wallGroup.name = 'walls';

        const wallHeight = MALL_CONFIG.floorHeight * MALL_CONFIG.floors;
        const wallMaterial = new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            roughness: 0.5,
            metalness: 0
        });

        // Door opening dimensions (must match createExitDoor)
        const doorOpeningWidth = 11;  // Slightly wider than door (10)
        const doorOpeningHeight = 6;  // Slightly taller than door (5.5)

        // Back wall - with opening for entrance corridor
        // Create wall segments around the door opening
        this.createWallWithOpening(wallGroup, wallMaterial, wallHeight, 
            -MALL_CONFIG.length / 2, doorOpeningWidth, doorOpeningHeight);

        // Front wall - with opening for entrance corridor
        this.createWallWithOpening(wallGroup, wallMaterial, wallHeight, 
            MALL_CONFIG.length / 2, doorOpeningWidth, doorOpeningHeight);

        // Add exit doors at both ends
        this.createExitDoor(wallGroup, 0, -MALL_CONFIG.length / 2 + 0.3, 0);  // Back exit
        this.createExitDoor(wallGroup, 0, MALL_CONFIG.length / 2 - 0.3, Math.PI);  // Front exit

        // Left wall
        const leftWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, wallHeight, MALL_CONFIG.length),
            wallMaterial
        );
        leftWall.position.set(-MALL_CONFIG.width / 2, wallHeight / 2, 0);
        leftWall.receiveShadow = true;
        wallGroup.add(leftWall);
        this.collisionObjects.push(leftWall);

        // Right wall
        const rightWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, wallHeight, MALL_CONFIG.length),
            wallMaterial
        );
        rightWall.position.set(MALL_CONFIG.width / 2, wallHeight / 2, 0);
        rightWall.receiveShadow = true;
        wallGroup.add(rightWall);
        this.collisionObjects.push(rightWall);

        this.scene.add(wallGroup);
    }

    createWallWithOpening(parent, material, wallHeight, zPosition, openingWidth, openingHeight) {
        const totalWidth = MALL_CONFIG.width;
        const wallThickness = 0.5;
        
        // Left section of wall (from left edge to door opening)
        const leftSectionWidth = (totalWidth - openingWidth) / 2;
        if (leftSectionWidth > 0) {
            const leftSection = new THREE.Mesh(
                new THREE.BoxGeometry(leftSectionWidth, wallHeight, wallThickness),
                material
            );
            leftSection.position.set(
                -totalWidth / 2 + leftSectionWidth / 2,
                wallHeight / 2,
                zPosition
            );
            leftSection.receiveShadow = true;
            parent.add(leftSection);
            this.collisionObjects.push(leftSection);
        }
        
        // Right section of wall (from door opening to right edge)
        const rightSectionWidth = (totalWidth - openingWidth) / 2;
        if (rightSectionWidth > 0) {
            const rightSection = new THREE.Mesh(
                new THREE.BoxGeometry(rightSectionWidth, wallHeight, wallThickness),
                material
            );
            rightSection.position.set(
                totalWidth / 2 - rightSectionWidth / 2,
                wallHeight / 2,
                zPosition
            );
            rightSection.receiveShadow = true;
            parent.add(rightSection);
            this.collisionObjects.push(rightSection);
        }
        
        // Top section above door opening
        const topSectionHeight = wallHeight - openingHeight;
        if (topSectionHeight > 0) {
            const topSection = new THREE.Mesh(
                new THREE.BoxGeometry(openingWidth, topSectionHeight, wallThickness),
                material
            );
            topSection.position.set(
                0,
                openingHeight + topSectionHeight / 2,
                zPosition
            );
            topSection.receiveShadow = true;
            parent.add(topSection);
            this.collisionObjects.push(topSection);
        }
    }

    createExitDoor(parent, x, z, rotation) {
        const doorGroup = new THREE.Group();
        const doorWidth = 10;  // Narrower
        const doorHeight = 5.5;  // Lower ceiling
        const corridorLength = 18;  // Deeper corridor for more distance
        const corridorWidth = doorWidth;  // Same width as door opening
        
        // Door frame material (chrome)
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.8,
            roughness: 0.2
        });
        
        // Glass door material - simple transparent (GPU friendly)
        // Store reference for day/night updates
        this.corridorDoorGlassMaterial = new THREE.MeshBasicMaterial({
            color: 0x88ccee,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide
        });
        const doorGlassMaterial = this.corridorDoorGlassMaterial;
        
        // ===========================================
        // ENTRANCE CORRIDOR STRUCTURE
        // ===========================================
        
        // Darker wall material for corridor interior (creates depth)
        const corridorWallMaterial = new THREE.MeshStandardMaterial({
            color: 0xa0a0a0,  // Darker gray for interior
            roughness: 0.7,
            metalness: 0
        });
        
        // Left wall of corridor - full length, no gaps
        const leftCorridorWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, doorHeight + 0.5, corridorLength + 1),
            corridorWallMaterial
        );
        leftCorridorWall.position.set(-corridorWidth / 2 - 0.2, doorHeight / 2, -corridorLength / 2);
        doorGroup.add(leftCorridorWall);
        
        // Right wall of corridor - full length, no gaps
        const rightCorridorWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, doorHeight + 0.5, corridorLength + 1),
            corridorWallMaterial
        );
        rightCorridorWall.position.set(corridorWidth / 2 + 0.2, doorHeight / 2, -corridorLength / 2);
        doorGroup.add(rightCorridorWall);
        
        // Corridor ceiling - full length
        const corridorCeiling = new THREE.Mesh(
            new THREE.BoxGeometry(corridorWidth + 1, 0.3, corridorLength + 1),
            corridorWallMaterial
        );
        corridorCeiling.position.set(0, doorHeight + 0.15, -corridorLength / 2);
        doorGroup.add(corridorCeiling);
        
        // Corridor floor
        const corridorFloorMaterial = new THREE.MeshStandardMaterial({
            color: 0xb0b0b0,  // Slightly darker floor
            roughness: 0.5,
            metalness: 0.1
        });
        const corridorFloor = new THREE.Mesh(
            new THREE.BoxGeometry(corridorWidth + 0.8, 0.15, corridorLength + 1),
            corridorFloorMaterial
        );
        corridorFloor.position.set(0, 0.075, -corridorLength / 2);
        doorGroup.add(corridorFloor);
        
        // ===========================================
        // PARKING LOT IMAGE AT END OF CORRIDOR
        // ===========================================
        
        // Load parking lot textures (day and night)
        const textureLoader = new THREE.TextureLoader();
        
        // Load day texture
        this.parkingLotDayTexture = textureLoader.load('assets/parking_lot.jpg');
        this.parkingLotDayTexture.colorSpace = THREE.SRGBColorSpace;
        
        // Load night texture
        this.parkingLotNightTexture = textureLoader.load('assets/parking_lot_night.jpg');
        this.parkingLotNightTexture.colorSpace = THREE.SRGBColorSpace;
        
        // Position backdrop at end of corridor - sized to fill the view
        const backdropDistance = corridorLength + 0.3;
        const backdropWidth = corridorWidth + 10;  // Wide enough to fill peripheral vision
        const backdropHeight = doorHeight + 4;    // Taller for more sky
        
        // Use MeshBasicMaterial for true colors - start with day texture
        const backdropMaterial = new THREE.MeshBasicMaterial({
            map: this.parkingLotDayTexture,
            side: THREE.DoubleSide
        });
        
        const parkingLotBackdrop = new THREE.Mesh(
            new THREE.PlaneGeometry(backdropWidth, backdropHeight),
            backdropMaterial.clone()  // Clone material so each backdrop can be updated independently
        );
        // Position so bottom of image aligns with floor (y=0)
        parkingLotBackdrop.position.set(0, backdropHeight / 2, -backdropDistance);
        doorGroup.add(parkingLotBackdrop);
        
        // Store reference for day/night texture updates
        this.parkingLotBackdrops.push(parkingLotBackdrop);
        
        // ===========================================
        // OUTER SLIDING DOORS (at end of corridor)
        // ===========================================
        
        const outerDoorZ = -corridorLength + 0.5;
        
        // Outer door frame
        const outerTopFrame = new THREE.Mesh(
            new THREE.BoxGeometry(doorWidth + 0.5, 0.3, 0.2),
            frameMaterial
        );
        outerTopFrame.position.set(0, doorHeight - 0.15, outerDoorZ);
        doorGroup.add(outerTopFrame);
        
        // Outer side frames
        [-doorWidth / 2 - 0.1, doorWidth / 2 + 0.1].forEach(fx => {
            const sideFrame = new THREE.Mesh(
                new THREE.BoxGeometry(0.2, doorHeight, 0.2),
                frameMaterial
            );
            sideFrame.position.set(fx, doorHeight / 2, outerDoorZ);
            doorGroup.add(sideFrame);
        });
        
        // Outer glass sliding doors
        [-doorWidth / 4, doorWidth / 4].forEach(dx => {
            const outerDoor = new THREE.Mesh(
                new THREE.BoxGeometry(doorWidth / 2 - 0.3, doorHeight - 0.5, 0.05),
                doorGlassMaterial
            );
            outerDoor.position.set(dx, doorHeight / 2, outerDoorZ);
            doorGroup.add(outerDoor);
        });
        
        // ===========================================
        // INNER SLIDING DOORS (mall entrance)
        // ===========================================
        
        // Inner door frame
        const topFrame = new THREE.Mesh(
            new THREE.BoxGeometry(doorWidth + 0.5, 0.3, 0.2),
            frameMaterial
        );
        topFrame.position.set(0, doorHeight - 0.15, 0);
        doorGroup.add(topFrame);
        
        // Inner side frames
        [-doorWidth / 2 - 0.1, doorWidth / 2 + 0.1].forEach(fx => {
            const sideFrame = new THREE.Mesh(
                new THREE.BoxGeometry(0.2, doorHeight, 0.2),
                frameMaterial
            );
            sideFrame.position.set(fx, doorHeight / 2, 0);
            doorGroup.add(sideFrame);
        });
        
        // Inner glass sliding doors
        [-doorWidth / 4, doorWidth / 4].forEach(dx => {
            const door = new THREE.Mesh(
                new THREE.BoxGeometry(doorWidth / 2 - 0.3, doorHeight - 0.5, 0.05),
                doorGlassMaterial
            );
            door.position.set(dx, doorHeight / 2, 0);
            doorGroup.add(door);
        });
        
        // ===========================================
        // COLLISION BARRIER (invisible)
        // ===========================================
        
        const barrierMaterial = new THREE.MeshBasicMaterial({
            visible: false
        });
        
        // Barrier at inner door threshold
        const doorBarrier = new THREE.Mesh(
            new THREE.BoxGeometry(doorWidth + 1, doorHeight, 0.5),
            barrierMaterial
        );
        doorBarrier.position.set(0, doorHeight / 2, -0.5);
        doorGroup.add(doorBarrier);
        this.collisionObjects.push(doorBarrier);
        
        // ===========================================
        // EXIT SIGN
        // ===========================================
        
        const signBackGeometry = new THREE.BoxGeometry(2.5, 0.8, 0.2);
        const signBackMaterial = new THREE.MeshStandardMaterial({
            color: 0x660000,
            roughness: 0.5
        });
        const signBack = new THREE.Mesh(signBackGeometry, signBackMaterial);
        signBack.position.set(0, doorHeight + 0.6, 0.3);
        doorGroup.add(signBack);
        
        // EXIT text (glowing)
        const exitMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 2
        });
        
        const letterGeometry = new THREE.BoxGeometry(0.3, 0.5, 0.1);
        const exitLetters = ['E', 'X', 'I', 'T'];
        exitLetters.forEach((letter, i) => {
            const letterMesh = new THREE.Mesh(letterGeometry, exitMaterial);
            letterMesh.position.set(-0.75 + i * 0.5, doorHeight + 0.6, 0.45);
            doorGroup.add(letterMesh);
        });
        
        // ===========================================
        // NEON ACCENTS (subtle)
        // ===========================================
        
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonBlue,
            emissive: COLORS.neonBlue,
            emissiveIntensity: 1.2
        });
        
        // Neon strip above inner door
        const topNeon = new THREE.Mesh(
            new THREE.BoxGeometry(doorWidth + 0.5, 0.06, 0.06),
            neonMaterial
        );
        topNeon.position.set(0, doorHeight + 0.2, 0.12);
        doorGroup.add(topNeon);
        
        // Floor guide strips
        const floorNeonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonGreen,
            emissive: COLORS.neonGreen,
            emissiveIntensity: 0.6
        });
        
        [-corridorWidth / 2 + 0.3, corridorWidth / 2 - 0.3].forEach(nx => {
            const floorNeon = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.04, corridorLength - 1),
                floorNeonMaterial
            );
            floorNeon.position.set(nx, 0.17, -corridorLength / 2);
            doorGroup.add(floorNeon);
        });
        
        // ===========================================
        // CORRIDOR LIGHTING (gradient: dark inside, bright outside)
        // ===========================================
        
        // Dim ceiling light near mall entrance
        const dimLightMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            emissive: 0xffffee,
            emissiveIntensity: 0.2
        });
        
        const innerLight = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.08, 0.4),
            dimLightMaterial
        );
        innerLight.position.set(0, doorHeight - 0.1, -corridorLength / 4);
        doorGroup.add(innerLight);
        
        // Brighter ceiling light near outside
        const brightLightMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 0.8
        });
        
        const outerLight = new THREE.Mesh(
            new THREE.BoxGeometry(2, 0.1, 0.5),
            brightLightMaterial
        );
        outerLight.position.set(0, doorHeight - 0.1, -corridorLength * 3 / 4);
        doorGroup.add(outerLight);
        
        // Dim point light near entrance (inside mall)
        const innerPointLight = new THREE.PointLight(0xfff5e0, 0.15, 10);
        innerPointLight.position.set(0, doorHeight - 1, -2);
        doorGroup.add(innerPointLight);
        
        // Bright point light near exit (natural light coming in)
        const outerPointLight = new THREE.PointLight(0xffffff, 0.8, 15);
        outerPointLight.position.set(0, doorHeight - 1, -corridorLength + 2);
        doorGroup.add(outerPointLight);
        
        // Extra bright light at the very end to simulate daylight
        const daylightPoint = new THREE.PointLight(0xffffee, 1.0, 12);
        daylightPoint.position.set(0, doorHeight / 2, -corridorLength - 1);
        doorGroup.add(daylightPoint);
        
        // Position and rotate the entire door group
        doorGroup.position.set(x, 0, z);
        doorGroup.rotation.y = rotation;
        parent.add(doorGroup);
    }

    createPillars() {
        const pillarGroup = new THREE.Group();
        pillarGroup.name = 'pillars';

        // Main structural pillars with neon accent
        const pillarPositions = [
            [-MALL_CONFIG.aisleWidth / 2, -40],
            [MALL_CONFIG.aisleWidth / 2, -40],
            [-MALL_CONFIG.aisleWidth / 2, -20],
            [MALL_CONFIG.aisleWidth / 2, -20],
            [-MALL_CONFIG.aisleWidth / 2, 0],
            [MALL_CONFIG.aisleWidth / 2, 0],
            [-MALL_CONFIG.aisleWidth / 2, 20],
            [MALL_CONFIG.aisleWidth / 2, 20],
            [-MALL_CONFIG.aisleWidth / 2, 40],
            [MALL_CONFIG.aisleWidth / 2, 40]
        ];

        pillarPositions.forEach(([x, z], index) => {
            const pillar = this.createPillar(x, z, index);
            pillarGroup.add(pillar);
            this.collisionObjects.push(pillar.children[0]); // Main pillar body for collision
        });

        this.scene.add(pillarGroup);
    }

    createPillar(x, z, index) {
        const pillarGroup = new THREE.Group();
        const pillarHeight = MALL_CONFIG.floorHeight * MALL_CONFIG.floors;

        // Main pillar body
        const pillarGeometry = new THREE.BoxGeometry(1.5, pillarHeight, 1.5);
        const pillarMaterial = new THREE.MeshStandardMaterial({
            color: 0xe8e8e8,
            roughness: 0.3,
            metalness: 0.1
        });

        const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
        pillar.position.set(x, pillarHeight / 2, z);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        pillarGroup.add(pillar);

        // Neon strips on pillars (alternating colors) - pushed out to avoid clipping
        const neonColors = [COLORS.neonPink, COLORS.neonBlue, COLORS.teal, COLORS.neonPurple];
        const neonColor = neonColors[index % neonColors.length];

        const neonGeometry = new THREE.BoxGeometry(0.08, pillarHeight - 1, 0.08);
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: neonColor,
            emissive: neonColor,
            emissiveIntensity: 2
        });

        // Add neon strips to each corner of pillar - pushed out further
        const offsets = [
            [-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]
        ];

        offsets.forEach(([ox, oz]) => {
            const neonStrip = new THREE.Mesh(neonGeometry, neonMaterial);
            neonStrip.position.set(x + ox, pillarHeight / 2, z + oz);
            pillarGroup.add(neonStrip);
        });

        // Decorative bands - reduced size to avoid clipping with corner neon strips
        for (let y = 2; y < pillarHeight; y += 3) {
            const bandGeometry = new THREE.BoxGeometry(1.55, 0.2, 1.55);
            const bandMaterial = new THREE.MeshStandardMaterial({
                color: COLORS.teal,
                metalness: 0.8,
                roughness: 0.2
            });
            const band = new THREE.Mesh(bandGeometry, bandMaterial);
            band.position.set(x, y, z);
            pillarGroup.add(band);
        }

        return pillarGroup;
    }

    createRailings() {
        const railingGroup = new THREE.Group();
        railingGroup.name = 'railings';

        const railingY = MALL_CONFIG.floorHeight + MALL_CONFIG.railingHeight / 2;

        // Chrome railing material
        const railingMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.9,
            roughness: 0.1
        });

        // Neon underglow material
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.teal,
            emissive: COLORS.teal,
            emissiveIntensity: 1.5
        });

        // Railings now extend almost to the walls (length - 4 instead of length - 20)
        const railingLength = MALL_CONFIG.length - 4;

        // Left railing
        this.createRailingSection(
            railingGroup,
            -MALL_CONFIG.aisleWidth / 2,
            railingY,
            railingLength,
            railingMaterial,
            neonMaterial
        );

        // Right railing
        this.createRailingSection(
            railingGroup,
            MALL_CONFIG.aisleWidth / 2,
            railingY,
            railingLength,
            railingMaterial,
            neonMaterial
        );

        this.scene.add(railingGroup);
    }

    createRailingSection(parent, x, y, length, railMaterial, neonMaterial) {
        // Top rail
        const topRailGeometry = new THREE.CylinderGeometry(0.05, 0.05, length, 8);
        topRailGeometry.rotateX(Math.PI / 2);
        const topRail = new THREE.Mesh(topRailGeometry, railMaterial);
        topRail.position.set(x, y + 0.5, 0);
        parent.add(topRail);

        // Bottom rail
        const bottomRail = new THREE.Mesh(topRailGeometry, railMaterial);
        bottomRail.position.set(x, y, 0);
        parent.add(bottomRail);

        // Glass panel (simplified for performance)
        const glassGeometry = new THREE.BoxGeometry(0.02, MALL_CONFIG.railingHeight, length);
        const glassMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.25,
            roughness: 0.1
        });
        const glass = new THREE.Mesh(glassGeometry, glassMaterial);
        glass.position.set(x, y, 0);
        parent.add(glass);

        // Neon strip underneath
        const neonGeometry = new THREE.BoxGeometry(0.1, 0.1, length);
        const neonStrip = new THREE.Mesh(neonGeometry, neonMaterial);
        neonStrip.position.set(x, y - MALL_CONFIG.railingHeight / 2 - 0.1, 0);
        parent.add(neonStrip);

        // Vertical posts
        for (let z = -length / 2 + 5; z <= length / 2 - 5; z += 5) {
            const postGeometry = new THREE.CylinderGeometry(0.03, 0.03, MALL_CONFIG.railingHeight + 0.2, 8);
            const post = new THREE.Mesh(postGeometry, railMaterial);
            post.position.set(x, y, z);
            parent.add(post);
        }

        // End cap posts (thicker) to finish off the railing ends nicely
        const endCapGeometry = new THREE.CylinderGeometry(0.06, 0.06, MALL_CONFIG.railingHeight + 0.3, 8);
        [-length / 2, length / 2].forEach(zEnd => {
            const endPost = new THREE.Mesh(endCapGeometry, railMaterial);
            endPost.position.set(x, y, zEnd);
            parent.add(endPost);
        });
    }

    createEscalators() {
        const escalatorGroup = new THREE.Group();
        escalatorGroup.name = 'escalators';

        // Ensure escalator zones array is initialized
        if (!this.escalatorZones) {
            this.escalatorZones = [];
        }

        // Create paired escalators at 4 positions
        const xOffset = MALL_CONFIG.aisleWidth / 2 + 5;
        
        // Left side escalators at z=-25
        this.createEscalatorPair(escalatorGroup, -xOffset, -25);
        
        // Right side escalators at z=-25
        this.createEscalatorPair(escalatorGroup, xOffset, -25);

        // Left side escalators at z=25
        this.createEscalatorPair(escalatorGroup, -xOffset, 25);
        
        // Right side escalators at z=25
        this.createEscalatorPair(escalatorGroup, xOffset, 25);

        this.scene.add(escalatorGroup);
    }

    createEscalatorPair(parent, x, z) {
        // Create a pair of escalators (up and down) with shared structure
        const pairGroup = new THREE.Group();
        const spacing = 3.5;
        const escalatorLength = 12;
        const escalatorHeight = MALL_CONFIG.floorHeight;
        const angle = Math.atan2(escalatorHeight, escalatorLength);
        
        // Up escalator (left side of pair)
        this.createSingleEscalator(pairGroup, x - spacing / 2, z, 1, escalatorLength);
        
        // Down escalator (right side of pair)
        this.createSingleEscalator(pairGroup, x + spacing / 2, z, -1, escalatorLength);
        
        // Center divider between the two escalators
        const dividerMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.9,
            roughness: 0.1
        });
        
        const diagonalLength = Math.sqrt(escalatorLength * escalatorLength + escalatorHeight * escalatorHeight);
        const dividerGroup = new THREE.Group();
        
        const divider = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 1.0, diagonalLength),
            dividerMaterial
        );
        divider.position.y = 0.5;
        dividerGroup.add(divider);
        
        dividerGroup.rotation.x = -angle;
        dividerGroup.position.set(x, escalatorHeight / 2, z);
        pairGroup.add(dividerGroup);
        
        // Bottom landing platform
        const landingMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.marble,
            roughness: 0.2,
            metalness: 0.1
        });
        
        const bottomLanding = new THREE.Mesh(
            new THREE.BoxGeometry(spacing + 4, 0.15, 3),
            landingMaterial
        );
        bottomLanding.position.set(x, 0.075, z - escalatorLength / 2 - 1.5);
        pairGroup.add(bottomLanding);
        
        // Top landing platform  
        const topLanding = new THREE.Mesh(
            new THREE.BoxGeometry(spacing + 4, 0.15, 3),
            landingMaterial
        );
        topLanding.position.set(x, escalatorHeight + 0.075, z + escalatorLength / 2 + 1.5);
        pairGroup.add(topLanding);
        
        // Neon trim on bottom landing
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonBlue,
            emissive: COLORS.neonBlue,
            emissiveIntensity: 1.5
        });
        
        const bottomNeon = new THREE.Mesh(
            new THREE.BoxGeometry(spacing + 4.5, 0.06, 0.06),
            neonMaterial
        );
        bottomNeon.position.set(x, 0.2, z - escalatorLength / 2 - 3);
        pairGroup.add(bottomNeon);
        
        // Neon trim on top landing
        const topNeon = new THREE.Mesh(
            new THREE.BoxGeometry(spacing + 4.5, 0.06, 0.06),
            neonMaterial
        );
        topNeon.position.set(x, escalatorHeight + 0.2, z + escalatorLength / 2 + 3);
        pairGroup.add(topNeon);
        
        parent.add(pairGroup);
    }

    createSingleEscalator(parent, x, z, direction, escalatorLength) {
        const escalatorWidth = 1.3;
        const escalatorHeight = MALL_CONFIG.floorHeight;
        const angle = Math.atan2(escalatorHeight, escalatorLength);
        const diagonalLength = Math.sqrt(escalatorLength * escalatorLength + escalatorHeight * escalatorHeight);

        // Store escalator zone for player - this is the key for functionality!
        // Zone is in world XZ coordinates
        // For UP escalator (direction=1): bottom is at minZ, top is at maxZ
        // For DOWN escalator (direction=-1): top is at minZ, bottom is at maxZ
        // The escalator auto-carries the player in the Z direction
        const zStart = z - escalatorLength / 2 - 2.5;  // Entry point (larger zone for smoother entry)
        const zEnd = z + escalatorLength / 2 + 2.5;    // Exit point (larger zone for smoother exit)
        
        // Ensure escalatorZones array exists
        if (!this.escalatorZones) {
            this.escalatorZones = [];
        }
        
        this.escalatorZones.push({
            minX: x - escalatorWidth / 2 - 0.6,
            maxX: x + escalatorWidth / 2 + 0.6,
            minZ: zStart,
            maxZ: zEnd,
            direction: direction,  // 1 = UP (carry toward +Z), -1 = DOWN (carry toward -Z)
            escalatorLength: escalatorLength,
            // Height at the minZ and maxZ ends of the escalator (physical geometry)
            // The physical escalator always has ground at minZ and first floor at maxZ
            startY: 0,                // Ground level at minZ (low end)
            endY: escalatorHeight,    // First floor at maxZ (high end)
            carrySpeed: 3.5,  // Slightly faster for better feel
            centerX: x,               // Store center for debugging
            centerZ: z
        });

        // Materials
        const sideMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            metalness: 0.9,
            roughness: 0.1
        });
        
        const stepsMaterial = new THREE.MeshStandardMaterial({
            color: 0x3a3a3a,
            roughness: 0.6,
            metalness: 0.4
        });
        
        const handrailMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.3
        });
        
        const neonColor = direction > 0 ? COLORS.neonGreen : COLORS.neonPink;
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: neonColor,
            emissive: neonColor,
            emissiveIntensity: 2
        });

        // Create the tilted escalator structure
        const structureGroup = new THREE.Group();

        // Side panels
        const sideGeometry = new THREE.BoxGeometry(0.12, 0.9, diagonalLength + 0.5);
        
        const leftSide = new THREE.Mesh(sideGeometry, sideMaterial);
        leftSide.position.set(-escalatorWidth / 2 - 0.06, 0.45, 0);
        structureGroup.add(leftSide);

        const rightSide = new THREE.Mesh(sideGeometry, sideMaterial);
        rightSide.position.set(escalatorWidth / 2 + 0.06, 0.45, 0);
        structureGroup.add(rightSide);

        // Steps surface (the walking surface)
        const stepsGeometry = new THREE.BoxGeometry(escalatorWidth, 0.12, diagonalLength);
        const steps = new THREE.Mesh(stepsGeometry, stepsMaterial);
        steps.position.y = 0.06;
        structureGroup.add(steps);

        // Step lines for visual detail
        const linesMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.8
        });
        for (let i = -diagonalLength / 2 + 0.3; i < diagonalLength / 2; i += 0.35) {
            const line = new THREE.Mesh(
                new THREE.BoxGeometry(escalatorWidth - 0.1, 0.015, 0.03),
                linesMaterial
            );
            line.position.set(0, 0.13, i);
            structureGroup.add(line);
        }

        // Handrails on top of side panels
        const handrailGeometry = new THREE.BoxGeometry(0.06, 0.05, diagonalLength + 0.8);
        
        const leftHandrail = new THREE.Mesh(handrailGeometry, handrailMaterial);
        leftHandrail.position.set(-escalatorWidth / 2 - 0.06, 0.92, 0);
        structureGroup.add(leftHandrail);

        const rightHandrail = new THREE.Mesh(handrailGeometry, handrailMaterial);
        rightHandrail.position.set(escalatorWidth / 2 + 0.06, 0.92, 0);
        structureGroup.add(rightHandrail);

        // Neon accent strips on the outer sides
        const neonGeometry = new THREE.BoxGeometry(0.035, 0.035, diagonalLength + 0.3);
        
        const leftNeon = new THREE.Mesh(neonGeometry, neonMaterial);
        leftNeon.position.set(-escalatorWidth / 2 - 0.14, 0.25, 0);
        structureGroup.add(leftNeon);

        const rightNeon = new THREE.Mesh(neonGeometry, neonMaterial);
        rightNeon.position.set(escalatorWidth / 2 + 0.14, 0.25, 0);
        structureGroup.add(rightNeon);

        // Rotate the entire structure
        structureGroup.rotation.x = -angle;
        structureGroup.position.set(x, escalatorHeight / 2, z);
        parent.add(structureGroup);

        // Flat entry plate at ground level
        const entryPlate = new THREE.Mesh(
            new THREE.BoxGeometry(escalatorWidth + 0.3, 0.08, 2),
            stepsMaterial
        );
        entryPlate.position.set(x, 0.04, z - escalatorLength / 2 - 1);
        parent.add(entryPlate);

        // Flat exit plate at first floor level
        const exitPlate = new THREE.Mesh(
            new THREE.BoxGeometry(escalatorWidth + 0.3, 0.08, 2),
            stepsMaterial
        );
        exitPlate.position.set(x, escalatorHeight + 0.04, z + escalatorLength / 2 + 1);
        parent.add(exitPlate);

        // Direction arrow indicator
        const arrowMaterial = new THREE.MeshStandardMaterial({
            color: direction > 0 ? 0x00ff88 : 0xff6688,
            emissive: direction > 0 ? 0x00ff88 : 0xff6688,
            emissiveIntensity: 1
        });
        
        // Arrow pointing up or down
        const arrowGeometry = new THREE.ConeGeometry(0.15, 0.35, 4);
        const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
        arrow.rotation.x = direction > 0 ? -Math.PI / 2 : Math.PI / 2;
        arrow.position.set(x, 0.25, z - escalatorLength / 2 - 1);
        parent.add(arrow);

        // "UP" or "DOWN" label using a simple sign
        const labelGeometry = new THREE.BoxGeometry(0.8, 0.3, 0.05);
        const labelMaterial = new THREE.MeshStandardMaterial({
            color: direction > 0 ? 0x004422 : 0x440022,
            emissive: direction > 0 ? 0x00ff88 : 0xff6688,
            emissiveIntensity: 0.5
        });
        const label = new THREE.Mesh(labelGeometry, labelMaterial);
        label.position.set(x, 0.5, z - escalatorLength / 2 - 2);
        parent.add(label);
    }

    createElevator() {
        const elevatorGroup = new THREE.Group();
        elevatorGroup.name = 'elevator';

        const elevatorHeight = MALL_CONFIG.floorHeight * MALL_CONFIG.floors;

        // Glass elevator shaft (simplified for performance)
        const shaftGeometry = new THREE.CylinderGeometry(2, 2, elevatorHeight, 6);
        const shaftMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.teal,
            transparent: true,
            opacity: 0.25,
            roughness: 0.1,
            metalness: 0.3
        });

        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        shaft.position.set(0, elevatorHeight / 2, 0);
        elevatorGroup.add(shaft);

        // Frame rings
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.teal,
            metalness: 0.8,
            roughness: 0.2
        });

        for (let y = 0; y <= elevatorHeight; y += 2) {
            const ringGeometry = new THREE.TorusGeometry(2.1, 0.1, 8, 16);
            const ring = new THREE.Mesh(ringGeometry, frameMaterial);
            ring.rotation.x = Math.PI / 2;
            ring.position.set(0, y, 0);
            elevatorGroup.add(ring);
        }

        // Vertical frame elements
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const frameGeometry = new THREE.BoxGeometry(0.15, elevatorHeight, 0.15);
            const frame = new THREE.Mesh(frameGeometry, frameMaterial);
            frame.position.set(
                Math.cos(angle) * 2,
                elevatorHeight / 2,
                Math.sin(angle) * 2
            );
            elevatorGroup.add(frame);
        }

        // Neon accent ring at base and top - aligned with frame rings
        const neonMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.neonBlue,
            emissive: COLORS.neonBlue,
            emissiveIntensity: 2
        });

        [0.1, elevatorHeight - 0.1].forEach(y => {
            const neonRing = new THREE.Mesh(
                new THREE.TorusGeometry(2.25, 0.08, 8, 32),
                neonMaterial
            );
            neonRing.rotation.x = Math.PI / 2;
            neonRing.position.set(0, y, 0);
            elevatorGroup.add(neonRing);
        });

        this.scene.add(elevatorGroup);

        // Add collision for elevator shaft
        const collisionCylinder = new THREE.Mesh(
            new THREE.CylinderGeometry(2.5, 2.5, elevatorHeight, 8),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        collisionCylinder.position.set(0, elevatorHeight / 2, 0);
        this.collisionObjects.push(collisionCylinder);
    }

    createCeiling() {
        const ceilingGroup = new THREE.Group();
        ceilingGroup.name = 'ceiling';

        // Store area ceilings (not the central skylight area)
        const ceilingMaterial = new THREE.MeshStandardMaterial({
            color: 0xf5f5f5,
            roughness: 0.9
        });

        const storeAreaWidth = (MALL_CONFIG.width - MALL_CONFIG.aisleWidth) / 2;
        const ceilingHeight = MALL_CONFIG.floorHeight * MALL_CONFIG.floors;

        // Left store ceiling - extended to reach outer wall
        const leftCeiling = new THREE.Mesh(
            new THREE.BoxGeometry(storeAreaWidth + 0.25, 0.3, MALL_CONFIG.length),
            ceilingMaterial
        );
        leftCeiling.position.set(
            -(MALL_CONFIG.aisleWidth / 2 + storeAreaWidth / 2 - 0.125),
            ceilingHeight,
            0
        );
        ceilingGroup.add(leftCeiling);

        // Right store ceiling - extended to reach outer wall
        const rightCeiling = new THREE.Mesh(
            new THREE.BoxGeometry(storeAreaWidth + 0.25, 0.3, MALL_CONFIG.length),
            ceilingMaterial
        );
        rightCeiling.position.set(
            (MALL_CONFIG.aisleWidth / 2 + storeAreaWidth / 2 - 0.125),
            ceilingHeight,
            0
        );
        ceilingGroup.add(rightCeiling);

        // Recessed lighting
        this.addCeilingLights(ceilingGroup, ceilingHeight);

        this.scene.add(ceilingGroup);
    }

    addCeilingLights(parent, height) {
        const lightMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.warmWhite,
            emissive: COLORS.warmWhite,
            emissiveIntensity: 0.8
        });

        const storeAreaWidth = (MALL_CONFIG.width - MALL_CONFIG.aisleWidth) / 2;

        // Add lights on both sides
        [-1, 1].forEach(side => {
            const xBase = side * (MALL_CONFIG.aisleWidth / 2 + storeAreaWidth / 2);

            for (let z = -50; z <= 50; z += 8) {
                const lightGeometry = new THREE.BoxGeometry(1, 0.1, 1);
                const light = new THREE.Mesh(lightGeometry, lightMaterial);
                light.position.set(xBase, height - 0.1, z);
                parent.add(light);
            }
        });
    }

    update(deltaTime) {
        // Validate deltaTime
        if (!deltaTime || isNaN(deltaTime)) return;
        
        // Future: Animate escalator steps (visual effect)
        // This would be expanded for actual step animation if needed
    }

    updateParkingLotTexture(isNight) {
        // Update ALL parking lot backdrops (both entrances)
        if (this.parkingLotBackdrops && this.parkingLotBackdrops.length > 0) {
            this.parkingLotBackdrops.forEach(backdrop => {
                if (isNight && this.parkingLotNightTexture) {
                    backdrop.material.map = this.parkingLotNightTexture;
                } else if (!isNight && this.parkingLotDayTexture) {
                    backdrop.material.map = this.parkingLotDayTexture;
                }
                backdrop.material.needsUpdate = true;
            });
            console.log(`Updated ${this.parkingLotBackdrops.length} parking lot backdrops to ${isNight ? 'night' : 'day'}`);
        }
        
        // Update corridor glass doors - darker at night to not wash out parking lot
        if (this.corridorDoorGlassMaterial) {
            if (isNight) {
                this.corridorDoorGlassMaterial.color.setHex(0x203040);  // Dark blue-gray
                this.corridorDoorGlassMaterial.opacity = 0.15;  // More transparent
            } else {
                this.corridorDoorGlassMaterial.color.setHex(0x88ccee);  // Light blue
                this.corridorDoorGlassMaterial.opacity = 0.25;
            }
            this.corridorDoorGlassMaterial.needsUpdate = true;
        }
    }

    getCollisionObjects() {
        return this.collisionObjects || [];
    }

    getEscalatorZones() {
        return this.escalatorZones || [];
    }

    dispose() {
        // Clear arrays
        this.collisionObjects = [];
        this.escalatorSteps = [];
        this.animatedObjects = [];
        this.escalatorZones = [];
        
        console.log('Mall resources disposed');
    }
}

export default Mall;
