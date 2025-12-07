// ========================================
// AVATARS.JS - Multiplayer Avatar System
// Mall Walk '92 - Vaporwave Experience
// Simple blocky avatars with name tags
// ========================================

import * as THREE from 'three';

export class AvatarManager {
    constructor(scene) {
        this.scene = scene;
        this.avatars = new Map(); // peerId -> avatar mesh group
        this.nameSprites = new Map(); // peerId -> name sprite
        
        // Avatar dimensions
        this.bodyWidth = 0.6;
        this.bodyHeight = 1.4;
        this.bodyDepth = 0.4;
        this.headRadius = 0.25;
        
        // Animation
        this.talkingAnimation = new Map(); // peerId -> animation state
    }
    
    createAvatar(playerId, playerData) {
        const { name, color, headColor, position, rotation } = playerData;
        
        // Create avatar group
        const avatarGroup = new THREE.Group();
        avatarGroup.name = `avatar_${playerId}`;
        
        // Body - simple upright rectangle
        const bodyGeometry = new THREE.BoxGeometry(
            this.bodyWidth,
            this.bodyHeight,
            this.bodyDepth
        );
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.3,
            roughness: 0.5,
            metalness: 0.2
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = this.bodyHeight / 2;
        body.castShadow = true;
        avatarGroup.add(body);
        
        // Head - sphere on top
        const headGeometry = new THREE.SphereGeometry(this.headRadius, 16, 12);
        const headMaterial = new THREE.MeshStandardMaterial({
            color: headColor,
            emissive: headColor,
            emissiveIntensity: 0.2,
            roughness: 0.4,
            metalness: 0.1
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = this.bodyHeight + this.headRadius + 0.05;
        head.castShadow = true;
        head.name = 'head';
        avatarGroup.add(head);
        
        // Talking indicator - glow ring around head (hidden by default)
        const talkingRingGeometry = new THREE.RingGeometry(
            this.headRadius + 0.05,
            this.headRadius + 0.15,
            16
        );
        const talkingRingMaterial = new THREE.MeshBasicMaterial({
            color: 0x05ffa1, // neon green
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide
        });
        const talkingRing = new THREE.Mesh(talkingRingGeometry, talkingRingMaterial);
        talkingRing.position.y = this.bodyHeight + this.headRadius + 0.05;
        talkingRing.rotation.x = -Math.PI / 2;
        talkingRing.name = 'talkingRing';
        avatarGroup.add(talkingRing);
        
        // Name tag sprite
        const nameSprite = this.createNameSprite(name, color);
        nameSprite.position.y = this.bodyHeight + this.headRadius * 2 + 0.5;
        avatarGroup.add(nameSprite);
        this.nameSprites.set(playerId, nameSprite);
        
        // Set initial position and rotation
        avatarGroup.position.set(position.x, 0, position.z);
        avatarGroup.rotation.y = rotation || 0;
        
        this.avatars.set(playerId, avatarGroup);
        this.scene.add(avatarGroup);
        
        console.log(`Created avatar for ${name} at (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`);
        
        return avatarGroup;
    }
    
    createNameSprite(name, color) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        canvas.width = 256;
        canvas.height = 64;
        
        // Background
        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.roundRect(0, 0, canvas.width, canvas.height, 8);
        context.fill();
        
        // Border with player color
        const hexColor = '#' + color.toString(16).padStart(6, '0');
        context.strokeStyle = hexColor;
        context.lineWidth = 3;
        context.roundRect(0, 0, canvas.width, canvas.height, 8);
        context.stroke();
        
        // Text
        context.fillStyle = '#ffffff';
        context.font = 'bold 24px "Press Start 2P", monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        
        // Truncate name if too long
        const displayName = name.length > 12 ? name.substring(0, 12) + '...' : name;
        context.fillText(displayName.toUpperCase(), canvas.width / 2, canvas.height / 2);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false
        });
        
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2, 0.5, 1);
        
        return sprite;
    }
    
    updateAvatar(playerId, playerData) {
        const avatar = this.avatars.get(playerId);
        if (!avatar) return;
        
        const { position, rotation, isTalking } = playerData;
        
        // Smooth position interpolation
        if (position) {
            avatar.position.x += (position.x - avatar.position.x) * 0.2;
            avatar.position.z += (position.z - avatar.position.z) * 0.2;
        }
        
        // Smooth rotation interpolation
        if (rotation !== undefined) {
            // Handle rotation wrap-around
            let targetRotation = rotation;
            let currentRotation = avatar.rotation.y;
            
            // Find shortest path for rotation
            while (targetRotation - currentRotation > Math.PI) targetRotation -= Math.PI * 2;
            while (targetRotation - currentRotation < -Math.PI) targetRotation += Math.PI * 2;
            
            avatar.rotation.y += (targetRotation - currentRotation) * 0.2;
        }
        
        // Update talking indicator
        this.updateTalkingIndicator(playerId, isTalking);
        
        // Make name tag always face camera (billboarding happens automatically with sprites)
    }
    
    updateTalkingIndicator(playerId, isTalking) {
        const avatar = this.avatars.get(playerId);
        if (!avatar) return;
        
        const talkingRing = avatar.getObjectByName('talkingRing');
        const head = avatar.getObjectByName('head');
        const nameSprite = this.nameSprites.get(playerId);
        
        if (!talkingRing || !head) return;
        
        // Get or create animation state
        let animState = this.talkingAnimation.get(playerId);
        if (!animState) {
            animState = { phase: 0, targetOpacity: 0 };
            this.talkingAnimation.set(playerId, animState);
        }
        
        // Set target opacity
        animState.targetOpacity = isTalking ? 0.8 : 0;
        
        // Animate ring opacity
        const currentOpacity = talkingRing.material.opacity;
        talkingRing.material.opacity += (animState.targetOpacity - currentOpacity) * 0.15;
        
        // Pulse animation when talking
        if (isTalking) {
            animState.phase += 0.15;
            const pulse = Math.sin(animState.phase) * 0.5 + 0.5;
            talkingRing.scale.setScalar(1 + pulse * 0.3);
            
            // Head glow pulse
            head.material.emissiveIntensity = 0.2 + pulse * 0.3;
            
            // Name tag glow - scale up slightly and increase opacity
            if (nameSprite) {
                nameSprite.scale.set(2.2 + pulse * 0.2, 0.55 + pulse * 0.05, 1);
                nameSprite.material.opacity = 1.0;
            }
        } else {
            head.material.emissiveIntensity = 0.2;
            talkingRing.scale.setScalar(1);
            
            // Reset name tag
            if (nameSprite) {
                nameSprite.scale.set(2, 0.5, 1);
                nameSprite.material.opacity = 0.9;
            }
        }
    }
    
    removeAvatar(playerId) {
        const avatar = this.avatars.get(playerId);
        if (avatar) {
            // Dispose of geometries and materials
            avatar.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
            
            this.scene.remove(avatar);
            this.avatars.delete(playerId);
            this.nameSprites.delete(playerId);
            this.talkingAnimation.delete(playerId);
            
            console.log(`Removed avatar for player ${playerId}`);
        }
    }
    
    update(deltaTime, cameraPosition) {
        // Update all avatars (animations, billboarding, etc.)
        this.avatars.forEach((avatar, playerId) => {
            // Update talking animation
            const animState = this.talkingAnimation.get(playerId);
            if (animState && animState.targetOpacity > 0) {
                this.updateTalkingIndicator(playerId, true);
            }
        });
    }
    
    dispose() {
        this.avatars.forEach((avatar, playerId) => {
            this.removeAvatar(playerId);
        });
        this.avatars.clear();
        this.nameSprites.clear();
        this.talkingAnimation.clear();
    }
}

export default AvatarManager;
