// ========================================
// PLAYER.JS - First Person Controls
// Mall Walk '92 - Vaporwave Experience
// ========================================

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { MALL_CONFIG } from './scene.js';

export class Player {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        
        // Movement state
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        
        // Mobile touch movement (normalized -1 to 1)
        this.touchMoveX = 0;
        this.touchMoveZ = 0;
        
        // Movement settings
        this.moveSpeed = 8;
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        
        // Player properties
        this.height = 1.7; // Eye level
        this.radius = 0.5; // Collision radius
        
        // Collision
        this.collisionObjects = [];
        this.raycaster = new THREE.Raycaster();
        
        // Controls
        this.controls = null;
        this.isLocked = false;
        
        // Mobile detection
        this.isMobile = this.detectMobile();
        
        // Camera rotation for mobile
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.lookSensitivity = 0.003;
        
        // Boundaries
        this.bounds = {
            minX: -MALL_CONFIG.width / 2 + 2,
            maxX: MALL_CONFIG.width / 2 - 2,
            minZ: -MALL_CONFIG.length / 2 + 2,
            maxZ: MALL_CONFIG.length / 2 - 2
        };

        // Floor tracking
        this.currentFloor = 0;
        this.currentFloorHeight = 0;
        
        // Escalator zones (will be set by mall)
        this.escalatorZones = [];
        
        this.init();
    }
    
    detectMobile() {
        return (('ontouchstart' in window) || 
                (navigator.maxTouchPoints > 0) || 
                (navigator.msMaxTouchPoints > 0) ||
                (window.matchMedia("(pointer: coarse)").matches));
    }

    init() {
        // Initialize PointerLockControls
        this.controls = new PointerLockControls(this.camera, this.domElement);
        
        // Set initial position
        this.camera.position.set(0, this.height, 30);
        
        // Event listeners for pointer lock
        this.controls.addEventListener('lock', () => {
            this.isLocked = true;
            this.onLock();
        });
        
        this.controls.addEventListener('unlock', () => {
            this.isLocked = false;
            this.onUnlock();
        });
        
        // Keyboard controls
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));
        
        // Initialize mobile controls if on mobile
        if (this.isMobile) {
            this.initMobileControls();
        }
    }
    
    initMobileControls() {
        // Joystick elements
        this.joystickZone = document.getElementById('joystick-zone');
        this.joystickBase = document.getElementById('joystick-base');
        this.joystickThumb = document.getElementById('joystick-thumb');
        
        // Look zone
        this.lookZone = document.getElementById('look-zone');
        
        if (this.joystickZone && this.joystickThumb) {
            this.setupJoystick();
        }
        
        if (this.lookZone) {
            this.setupLookControls();
        }
    }
    
    setupJoystick() {
        let joystickActive = false;
        let joystickTouchId = null;
        const baseRect = () => this.joystickBase.getBoundingClientRect();
        const maxDistance = 35; // Max distance thumb can move from center
        
        const handleJoystickStart = (e) => {
            e.preventDefault();
            const touch = e.changedTouches[0];
            joystickActive = true;
            joystickTouchId = touch.identifier;
            this.joystickThumb.classList.add('active');
            handleJoystickMove(e);
        };
        
        const handleJoystickMove = (e) => {
            if (!joystickActive) return;
            e.preventDefault();
            
            let touch = null;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === joystickTouchId) {
                    touch = e.touches[i];
                    break;
                }
            }
            if (!touch) return;
            
            const rect = baseRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            let deltaX = touch.clientX - centerX;
            let deltaY = touch.clientY - centerY;
            
            // Clamp to max distance
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > maxDistance) {
                deltaX = (deltaX / distance) * maxDistance;
                deltaY = (deltaY / distance) * maxDistance;
            }
            
            // Update thumb position
            this.joystickThumb.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
            
            // Normalize to -1 to 1 range
            this.touchMoveX = deltaX / maxDistance;
            this.touchMoveZ = deltaY / maxDistance;
        };
        
        const handleJoystickEnd = (e) => {
            // Check if our touch ended
            let found = false;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === joystickTouchId) {
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                joystickActive = false;
                joystickTouchId = null;
                this.joystickThumb.classList.remove('active');
                this.joystickThumb.style.transform = 'translate(0, 0)';
                this.touchMoveX = 0;
                this.touchMoveZ = 0;
            }
        };
        
        this.joystickZone.addEventListener('touchstart', handleJoystickStart, { passive: false });
        this.joystickZone.addEventListener('touchmove', handleJoystickMove, { passive: false });
        this.joystickZone.addEventListener('touchend', handleJoystickEnd, { passive: false });
        this.joystickZone.addEventListener('touchcancel', handleJoystickEnd, { passive: false });
    }
    
    setupLookControls() {
        let lookActive = false;
        let lookTouchId = null;
        let lastX = 0;
        let lastY = 0;
        
        const handleLookStart = (e) => {
            e.preventDefault();
            const touch = e.changedTouches[0];
            lookActive = true;
            lookTouchId = touch.identifier;
            lastX = touch.clientX;
            lastY = touch.clientY;
        };
        
        const handleLookMove = (e) => {
            if (!lookActive) return;
            e.preventDefault();
            
            let touch = null;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === lookTouchId) {
                    touch = e.touches[i];
                    break;
                }
            }
            if (!touch) return;
            
            const deltaX = touch.clientX - lastX;
            const deltaY = touch.clientY - lastY;
            lastX = touch.clientX;
            lastY = touch.clientY;
            
            // Rotate camera
            this.rotateCamera(-deltaX * this.lookSensitivity, -deltaY * this.lookSensitivity);
        };
        
        const handleLookEnd = (e) => {
            let found = false;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === lookTouchId) {
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                lookActive = false;
                lookTouchId = null;
            }
        };
        
        this.lookZone.addEventListener('touchstart', handleLookStart, { passive: false });
        this.lookZone.addEventListener('touchmove', handleLookMove, { passive: false });
        this.lookZone.addEventListener('touchend', handleLookEnd, { passive: false });
        this.lookZone.addEventListener('touchcancel', handleLookEnd, { passive: false });
    }
    
    rotateCamera(yaw, pitch) {
        this.euler.setFromQuaternion(this.camera.quaternion);
        
        this.euler.y += yaw;
        this.euler.x += pitch;
        
        // Clamp vertical rotation
        this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
        
        this.camera.quaternion.setFromEuler(this.euler);
    }
    
    // Set touch movement from external source (for mobile joystick)
    setTouchMovement(x, z) {
        this.touchMoveX = x;
        this.touchMoveZ = z;
    }

    onKeyDown(event) {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                this.moveForward = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                this.moveBackward = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                this.moveLeft = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                this.moveRight = true;
                break;
        }
    }

    onKeyUp(event) {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                this.moveForward = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                this.moveBackward = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                this.moveLeft = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                this.moveRight = false;
                break;
        }
    }

    onLock() {
        // Called when pointer is locked (desktop) or game starts (mobile)
        // Hide menus, show HUD
        document.getElementById('start-screen')?.classList.add('hidden');
        document.getElementById('name-screen')?.classList.add('hidden');
        document.getElementById('pause-menu')?.classList.add('hidden');
        document.getElementById('hud')?.classList.remove('hidden');
    }

    onUnlock() {
        // Called when pointer is unlocked (desktop only)
        // On mobile, we don't pause on unlock
        if (this.isMobile) return;
        
        // Show pause menu
        if (document.getElementById('start-screen')?.classList.contains('hidden') &&
            document.getElementById('name-screen')?.classList.contains('hidden')) {
            document.getElementById('pause-menu')?.classList.remove('hidden');
        }
    }

    lock() {
        if (this.isMobile) {
            // On mobile, just set locked state and show HUD
            this.isLocked = true;
            this.onLock();
        } else {
            this.controls.lock();
        }
    }

    unlock() {
        if (this.isMobile) {
            this.isLocked = false;
            this.onUnlock();
        } else {
            this.controls.unlock();
        }
    }

    setCollisionObjects(objects) {
        this.collisionObjects = objects;
    }

    update(deltaTime) {
        // On mobile, we don't require pointer lock
        if (!this.isLocked && !this.isMobile) return;

        // Clamp deltaTime to prevent huge jumps
        const dt = Math.min(deltaTime, 0.1);

        // Calculate target velocity based on input
        let targetVelX = 0;
        let targetVelZ = 0;

        // Keyboard input
        if (this.moveForward) targetVelZ = -this.moveSpeed;
        if (this.moveBackward) targetVelZ = this.moveSpeed;
        if (this.moveLeft) targetVelX = -this.moveSpeed;
        if (this.moveRight) targetVelX = this.moveSpeed;
        
        // Touch input (overrides keyboard if active)
        if (this.touchMoveX !== 0 || this.touchMoveZ !== 0) {
            targetVelX = this.touchMoveX * this.moveSpeed;
            targetVelZ = this.touchMoveZ * this.moveSpeed;
        }

        // Normalize diagonal movement
        if (targetVelX !== 0 && targetVelZ !== 0) {
            const factor = 0.7071067811865476; // 1/sqrt(2) - more precise
            targetVelX *= factor;
            targetVelZ *= factor;
        }

        // Smooth acceleration/deceleration (frame-rate independent)
        // Using exponential decay: lerp factor = 1 - e^(-speed * dt)
        const smoothingSpeed = 12;
        const lerpFactor = 1 - Math.exp(-smoothingSpeed * dt);
        this.velocity.x += (targetVelX - this.velocity.x) * lerpFactor;
        this.velocity.z += (targetVelZ - this.velocity.z) * lerpFactor;
        
        // Clamp velocity to prevent numerical issues
        const maxVel = this.moveSpeed * 1.5;
        this.velocity.x = Math.max(-maxVel, Math.min(maxVel, this.velocity.x));
        this.velocity.z = Math.max(-maxVel, Math.min(maxVel, this.velocity.z));

        // Store old position for collision
        const oldPosition = this.camera.position.clone();

        // Move the controls using smoothed velocity
        if (this.isMobile) {
            // For mobile, manually move based on camera direction
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();
            
            const right = new THREE.Vector3();
            right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
            
            // Apply movement relative to camera direction
            this.camera.position.addScaledVector(right, this.velocity.x * dt);
            this.camera.position.addScaledVector(forward, -this.velocity.z * dt);
        } else {
            this.controls.moveRight(this.velocity.x * dt);
            this.controls.moveForward(-this.velocity.z * dt);
        }

        // Check collisions and boundaries
        this.checkCollisions(oldPosition);
        this.enforceBoundaries();

        // Keep Y position stable (no head bob for smoother experience)
        this.camera.position.y = this.currentFloorHeight + this.height;

        // Check escalator (pass deltaTime for auto-carry)
        this.checkEscalator(dt);
    }

    checkCollisions(oldPosition) {
        if (!this.collisionObjects || this.collisionObjects.length === 0) return;

        const newPosition = this.camera.position.clone();
        // Check collisions at multiple heights for the player
        const checkHeights = [0.3, this.height / 2, this.height - 0.2];

        for (const object of this.collisionObjects) {
            if (!object || !object.geometry) continue;

            try {
                // Ensure bounding box is computed
                if (!object.geometry.boundingBox) {
                    object.geometry.computeBoundingBox();
                }
                if (!object.geometry.boundingBox) continue;

                // Update world matrix if needed
                if (!object.matrixWorld) continue;
                object.updateMatrixWorld(true);

                // Get bounding box in world space
                const bbox = object.geometry.boundingBox.clone();
                bbox.applyMatrix4(object.matrixWorld);

                // Expand bbox by player radius
                bbox.expandByScalar(this.radius);

                // Check if player is inside bbox at any height
                for (const checkY of checkHeights) {
                    const playerPos = new THREE.Vector3(
                        newPosition.x, 
                        this.currentFloorHeight + checkY, 
                        newPosition.z
                    );
                    
                    if (bbox.containsPoint(playerPos)) {
                        // Collision detected - try sliding along the obstacle
                        const slideX = new THREE.Vector3(newPosition.x, this.currentFloorHeight + checkY, oldPosition.z);
                        const slideZ = new THREE.Vector3(oldPosition.x, this.currentFloorHeight + checkY, newPosition.z);
                        
                        // Try sliding on X axis
                        if (!bbox.containsPoint(slideX)) {
                            this.camera.position.z = oldPosition.z;
                            this.velocity.z = 0;
                            return;
                        }
                        
                        // Try sliding on Z axis
                        if (!bbox.containsPoint(slideZ)) {
                            this.camera.position.x = oldPosition.x;
                            this.velocity.x = 0;
                            return;
                        }
                        
                        // Can't slide - revert completely
                        this.camera.position.copy(oldPosition);
                        this.velocity.set(0, 0, 0);
                        return;
                    }
                }
            } catch (error) {
                // Skip problematic objects
                console.warn('Collision check error for object:', error);
                continue;
            }
        }
    }

    enforceBoundaries() {
        // Keep player within mall bounds
        // On second floor, restrict to walkway areas only
        if (this.currentFloor === 1) {
            // Second floor walkways are on the sides, not in the center aisle
            const walkwayWidth = (MALL_CONFIG.width - MALL_CONFIG.aisleWidth) / 2;
            const walkwayInnerEdge = MALL_CONFIG.aisleWidth / 2;
            const walkwayOuterEdge = MALL_CONFIG.width / 2 - 1;
            
            // Check if in valid second floor area (left or right walkway, or escalator area)
            const absX = Math.abs(this.camera.position.x);
            if (absX < walkwayInnerEdge - 2) {
                // Player is over the open center area - push them toward nearest walkway
                // But allow escalator zones
                let onEscalator = false;
                for (const zone of this.escalatorZones) {
                    if (this.camera.position.x >= zone.minX && this.camera.position.x <= zone.maxX &&
                        this.camera.position.z >= zone.minZ && this.camera.position.z <= zone.maxZ) {
                        onEscalator = true;
                        break;
                    }
                }
                
                if (!onEscalator) {
                    // Gradually push toward nearest side
                    const pushDirection = this.camera.position.x > 0 ? 1 : -1;
                    this.camera.position.x = pushDirection * (walkwayInnerEdge - 1);
                }
            }
        }
        
        this.camera.position.x = Math.max(this.bounds.minX, 
            Math.min(this.bounds.maxX, this.camera.position.x));
        this.camera.position.z = Math.max(this.bounds.minZ, 
            Math.min(this.bounds.maxZ, this.camera.position.z));

        // Floor height validation
        if (this.camera.position.y < this.height) {
            this.camera.position.y = this.height;
        }
        
        // Maximum height check (can't go above second floor)
        const maxHeight = MALL_CONFIG.floorHeight + this.height + 0.5;
        if (this.camera.position.y > maxHeight) {
            this.camera.position.y = maxHeight;
        }
    }

    updateFloorLevel() {
        // Determine which floor the player is on based on position
        this.currentFloor = Math.floor((this.camera.position.y - this.height + 0.5) / MALL_CONFIG.floorHeight);
    }

    checkEscalator(deltaTime) {
        // Check if player is on an escalator
        const pos = this.camera.position;
        
        // Safety check for escalator zones
        if (!this.escalatorZones || this.escalatorZones.length === 0) {
            const targetHeight = this.currentFloor * MALL_CONFIG.floorHeight;
            this.currentFloorHeight += (targetHeight - this.currentFloorHeight) * 0.2;
            return;
        }
        
        for (const zone of this.escalatorZones) {
            // Skip invalid zones
            if (!zone || zone.minX === undefined || zone.maxX === undefined) continue;
            
            if (pos.x >= zone.minX && pos.x <= zone.maxX &&
                pos.z >= zone.minZ && pos.z <= zone.maxZ) {
                
                // Calculate position along escalator (0 to 1)
                const zoneLength = zone.maxZ - zone.minZ;
                if (zoneLength <= 0) continue; // Prevent division by zero
                
                const posInZone = Math.max(0, Math.min(1, (pos.z - zone.minZ) / zoneLength));
                
                // Get start/end heights (with fallback for backward compatibility)
                const startY = zone.startY !== undefined ? zone.startY : 0;
                const endY = zone.endY !== undefined ? zone.endY : MALL_CONFIG.floorHeight;
                
                // Target height based on position in zone
                // Interpolate between startY (at minZ) and endY (at maxZ)
                const targetHeight = startY + posInZone * (endY - startY);
                
                // Smoothly move to target height with improved interpolation
                // Use a smoother, more responsive lerp for better feel
                const baseLerpFactor = 0.15;
                const speedBoost = Math.abs(this.velocity.z) * 0.02; // Move faster when walking
                const lerpFactor = Math.min(0.4, baseLerpFactor + speedBoost + deltaTime * 6);
                this.currentFloorHeight += (targetHeight - this.currentFloorHeight) * lerpFactor;
                
                // Clamp floor height to valid range
                this.currentFloorHeight = Math.max(0, Math.min(MALL_CONFIG.floorHeight, this.currentFloorHeight));
                
                // AUTO-CARRY: Escalator moves the player along Z axis
                // UP escalator (direction=1) carries toward +Z (toward maxZ)
                // DOWN escalator (direction=-1) carries toward -Z (toward minZ)
                const carrySpeed = zone.carrySpeed || 2.5;
                const carryAmount = carrySpeed * deltaTime * zone.direction;
                
                // Only carry if not at the end of the escalator
                const endBuffer = 0.3;
                const atEnd = (zone.direction > 0 && pos.z >= zone.maxZ - endBuffer) ||
                              (zone.direction < 0 && pos.z <= zone.minZ + endBuffer);
                
                if (!atEnd) {
                    this.camera.position.z += carryAmount;
                }
                
                // Update current floor based on height with hysteresis to prevent flickering
                if (this.currentFloorHeight > MALL_CONFIG.floorHeight * 0.6) {
                    this.currentFloor = 1;
                } else if (this.currentFloorHeight < MALL_CONFIG.floorHeight * 0.4) {
                    this.currentFloor = 0;
                }
                return;
            }
        }
        
        // Not on escalator - smoothly snap to nearest floor
        const targetHeight = this.currentFloor * MALL_CONFIG.floorHeight;
        const lerpFactor = Math.min(0.2, deltaTime * 5);
        this.currentFloorHeight += (targetHeight - this.currentFloorHeight) * lerpFactor;
    }

    setEscalatorZones(zones) {
        this.escalatorZones = zones;
    }

    getPosition() {
        return this.camera.position.clone();
    }

    getDirection() {
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        return direction;
    }

    getControls() {
        return this.controls;
    }

    isMoving() {
        return this.moveForward || this.moveBackward || this.moveLeft || this.moveRight ||
               this.touchMoveX !== 0 || this.touchMoveZ !== 0;
    }

    dispose() {
        // Remove event listeners
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        
        // Dispose controls
        if (this.controls) {
            this.controls.dispose();
        }
        
        // Clear references
        this.collisionObjects = [];
        this.escalatorZones = [];
        
        console.log('Player resources disposed');
    }
}

export default Player;
