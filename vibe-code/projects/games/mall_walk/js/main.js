// ========================================
// MAIN.JS - Game Initialization & Loop
// Mall Walk '92 - Vaporwave Experience
// ========================================

import * as THREE from 'three';
import { MallScene } from './scene.js';
import { Mall } from './mall.js';
import { Decorations } from './decorations.js';
import { Stores } from './stores.js';
import { Player } from './player.js';
import { AudioManager } from './audio.js';
import { NetworkManager } from './network.js';
import { AvatarManager } from './avatars.js';

class MallWalkGame {
    constructor() {
        this.mallScene = null;
        this.mall = null;
        this.decorations = null;
        this.stores = null;
        this.player = null;
        this.audioManager = null;
        this.networkManager = null;
        this.avatarManager = null;
        
        this.isRunning = false;
        this.isPaused = false;
        this.loadingProgress = 0;
        
        // Player info
        this.playerName = 'VISITOR';
        
        // Time tracking
        this.clock = new THREE.Clock();
        this.elapsedTime = 0;
        this.simulatedTime = { hours: 12, minutes: 0 }; // Start at noon
        
        // Raycaster for interactions
        this.raycaster = new THREE.Raycaster();
        this.interactionDistance = 6;  // Max distance to interact with objects
        this.currentInteractable = null;
        
        // Push-to-talk state
        this.isTalking = false;
        this.isLoopbackActive = false;
        this.talkLocked = false; // For slide-to-lock feature
        
        // Mobile detection
        this.isMobile = this.detectMobile();
        
        // DOM elements
        this.container = null;
        this.loadingScreen = null;
        this.loadingBar = null;
        this.loadingText = null;
        this.nameScreen = null;
        this.nameInput = null;
        this.enterButton = null;
        this.startScreen = null;
        this.startButton = null;
        this.pauseMenu = null;
        this.resumeButton = null;
        this.hudTime = null;
        this.interactionHint = null;
        this.voiceIndicator = null;
        this.playerCount = null;
        this.connectionStatus = null;
        this.loopbackIndicator = null;
    }

    async init() {
        console.log('Initializing Mall Walk \'92...');
        
        // Get DOM elements
        this.container = document.getElementById('game-container');
        this.loadingScreen = document.getElementById('loading-screen');
        this.loadingBar = document.getElementById('loading-bar');
        this.loadingText = document.getElementById('loading-text');
        this.nameScreen = document.getElementById('name-screen');
        this.nameInput = document.getElementById('player-name');
        this.enterButton = document.getElementById('enter-button');
        this.startScreen = document.getElementById('start-screen');
        this.startButton = document.getElementById('start-button');
        this.pauseMenu = document.getElementById('pause-menu');
        this.resumeButton = document.getElementById('resume-button');
        this.hudTime = document.getElementById('current-time');
        this.interactionHint = document.getElementById('interaction-hint');
        this.voiceIndicator = document.getElementById('voice-indicator');
        this.playerCount = document.getElementById('player-count');
        this.connectionStatus = document.getElementById('connection-status');
        this.loopbackIndicator = document.getElementById('loopback-indicator');
        
        // Mobile control elements
        this.talkButton = document.getElementById('talk-button');
        this.mobileDayNightBtn = document.getElementById('mobile-daynight-btn');
        this.nowPlaying = document.getElementById('now-playing');
        this.musicIcon = document.getElementById('music-icon');
        
        try {
            // Phase 1: Initialize scene
            this.updateLoading(5, 'Creating vaporwave atmosphere...');
            await this.delay(100);
            
            this.mallScene = new MallScene();
            this.mallScene.init(this.container);
            
            this.updateLoading(15, 'Building mall structure...');
            await this.delay(100);
            
            // Phase 2: Build mall
            this.mall = new Mall(this.mallScene.getScene());
            const collisionObjects = this.mall.build();
            
            this.updateLoading(35, 'Planting palm trees...');
            await this.delay(100);
            
            // Phase 3: Add decorations
            this.decorations = new Decorations(this.mallScene.getScene());
            this.decorations.build();
            
            this.updateLoading(55, 'Opening storefronts...');
            await this.delay(100);
            
            // Phase 4: Create stores
            this.stores = new Stores(this.mallScene.getScene());
            this.stores.build();
            
            this.updateLoading(70, 'Setting up controls...');
            await this.delay(100);
            
            // Phase 5: Initialize player
            this.player = new Player(
                this.mallScene.getCamera(),
                this.mallScene.getRenderer().domElement
            );
            this.player.setCollisionObjects(collisionObjects);
            
            // Connect escalator zones to player
            if (this.mall.escalatorZones && this.mall.escalatorZones.length > 0) {
                this.player.setEscalatorZones(this.mall.escalatorZones);
                console.log('Escalator zones connected:', this.mall.escalatorZones.length);
            }
            
            this.updateLoading(80, 'Tuning the audio system...');
            await this.delay(100);
            
            // Phase 6: Initialize audio
            this.audioManager = new AudioManager();
            await this.audioManager.init();
            
            this.updateLoading(85, 'Preparing multiplayer...');
            await this.delay(100);
            
            // Phase 7: Initialize network and avatar managers
            this.networkManager = new NetworkManager();
            this.avatarManager = new AvatarManager(this.mallScene.getScene());
            
            // Setup network callbacks
            this.setupNetworkCallbacks();
            
            this.updateLoading(90, 'Final touches...');
            await this.delay(100);
            
            // Setup event listeners
            this.setupEventListeners();
            
            this.updateLoading(100, 'Welcome to the mall!');
            await this.delay(500);
            
            // Hide loading, show name entry screen
            this.loadingScreen.classList.add('hidden');
            this.nameScreen.classList.remove('hidden');
            
            // Focus on name input
            if (this.nameInput) {
                this.nameInput.focus();
            }
            
            console.log('Mall Walk \'92 initialized successfully!');
            
        } catch (error) {
            console.error('Error initializing game:', error);
            this.loadingText.textContent = 'Error loading... Please refresh.';
        }
    }
    
    setupNetworkCallbacks() {
        // Player join handler
        this.networkManager.onPlayerJoin = (playerId, playerData) => {
            this.avatarManager.createAvatar(playerId, playerData);
            this.updatePlayerCount();
        };
        
        // Player leave handler
        this.networkManager.onPlayerLeave = (playerId) => {
            this.avatarManager.removeAvatar(playerId);
            this.updatePlayerCount();
        };
        
        // Player update handler
        this.networkManager.onPlayerUpdate = (playerId, playerData) => {
            this.avatarManager.updateAvatar(playerId, playerData);
        };
        
        // Connection status handler
        this.networkManager.onConnectionStatusChange = (connected) => {
            this.updateConnectionStatus(connected);
        };
        
        // Day/night sync handler
        this.networkManager.onDayNightChange = (isNight, fromPlayerId) => {
            console.log(`Day/night change received: isNight=${isNight}, from=${fromPlayerId}`);
            
            // Apply the day/night mode if different from current
            const currentNight = this.mallScene.isNightMode;
            console.log(`Current mode: ${currentNight ? 'Night' : 'Day'}, Requested: ${isNight ? 'Night' : 'Day'}`);
            
            if (currentNight !== isNight) {
                // Use setDayNight to set the exact state (not toggle)
                this.mallScene.setDayNight(isNight);
                
                // Update the physical switch indicator
                if (this.decorations) {
                    this.decorations.updateLightSwitchIndicator(isNight);
                }
                
                // Update parking lot backdrop texture
                if (this.mall) {
                    this.mall.updateParkingLotTexture(isNight);
                }
                
                console.log(`✓ Day/Night synced: ${isNight ? 'Night' : 'Day'} mode`);
            } else {
                console.log('Day/Night already in sync, no change needed');
            }
        };
    }
    
    updatePlayerCount() {
        if (this.playerCount) {
            const count = this.networkManager.getPlayerCount();
            this.playerCount.textContent = count === 1 ? '1 visitor' : `${count} visitors`;
        }
    }
    
    updateConnectionStatus(connected) {
        if (this.connectionStatus) {
            const dot = this.connectionStatus.querySelector('.status-dot');
            const text = this.connectionStatus.querySelector('.status-text');
            
            if (connected) {
                dot.classList.remove('offline');
                dot.classList.add('online');
                text.textContent = 'Connected';
            } else {
                dot.classList.remove('online');
                dot.classList.add('offline');
                text.textContent = 'Reconnecting...';
            }
        }
    }

    setupEventListeners() {
        // Enter button (after name entry)
        this.enterButton.addEventListener('click', () => this.enterMall());
        
        // Name input enter key
        this.nameInput.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                this.enterMall();
            }
        });
        
        // Start button (legacy, hidden in multiplayer mode)
        this.startButton.addEventListener('click', () => this.start());
        
        // Resume button
        this.resumeButton.addEventListener('click', () => this.resume());
        
        // Click handler for interaction (light switch, etc.)
        document.addEventListener('click', () => {
            if (this.isRunning && !this.isPaused && this.currentInteractable) {
                this.interact();
            }
        });
        
        // Pause menu click to resume
        this.pauseMenu.addEventListener('click', (e) => {
            if (e.target === this.pauseMenu) {
                this.resume();
            }
        });
        
        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            // ESC handling
            if (e.code === 'Escape') {
                if (this.isRunning && !this.isPaused) {
                    // Will be handled by pointer lock
                } else if (this.isPaused) {
                    this.resume();
                }
            }
            
            // M key to toggle mute
            if (e.code === 'KeyM' && this.isRunning) {
                this.toggleMute();
            }
            
            // N key to toggle day/night
            if (e.code === 'KeyN' && this.isRunning && !this.isPaused) {
                this.toggleDayNight();
            }
            
            // E key for push-to-talk
            if (e.code === 'KeyE' && this.isRunning && !this.isPaused && !this.isTalking) {
                this.startTalking();
            }
            
            // R key for loopback test (hear yourself)
            if (e.code === 'KeyR' && this.isRunning && !this.isPaused && !this.isLoopbackActive) {
                this.startLoopback();
            }
        });
        
        // Key release handlers
        document.addEventListener('keyup', (e) => {
            // E key release to stop talking
            if (e.code === 'KeyE' && this.isTalking) {
                this.stopTalking();
            }
            
            // R key release to stop loopback
            if (e.code === 'KeyR' && this.isLoopbackActive) {
                this.stopLoopback();
            }
        });
        
        // Handle visibility change (tab switching)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isRunning) {
                this.pause();
                // Stop talking when tab is hidden
                if (this.isTalking) {
                    this.stopTalking();
                }
            }
        });
        
        // Setup mobile controls if on mobile device
        if (this.isMobile) {
            this.setupMobileControls();
        }
    }
    
    setupMobileControls() {
        // Talk button with slide-to-lock
        if (this.talkButton) {
            let talkTouchId = null;
            let startY = 0;
            const slideThreshold = 50; // Pixels to slide up to lock
            
            const handleTalkStart = (e) => {
                if (!this.isRunning || this.isPaused) return;
                e.preventDefault();
                
                // If already locked, unlock on tap
                if (this.talkLocked) {
                    this.talkLocked = false;
                    this.talkButton.classList.remove('locked');
                    this.stopTalking();
                    return;
                }
                
                const touch = e.changedTouches[0];
                talkTouchId = touch.identifier;
                startY = touch.clientY;
                
                this.talkButton.classList.add('active');
                this.startTalking();
            };
            
            const handleTalkMove = (e) => {
                if (talkTouchId === null || this.talkLocked) return;
                e.preventDefault();
                
                let touch = null;
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === talkTouchId) {
                        touch = e.touches[i];
                        break;
                    }
                }
                if (!touch) return;
                
                const deltaY = startY - touch.clientY;
                
                // Update slider thumb position visually
                const sliderThumb = document.getElementById('talk-slider-thumb');
                if (sliderThumb) {
                    const progress = Math.min(1, Math.max(0, deltaY / slideThreshold));
                    sliderThumb.style.bottom = `${2 + progress * 20}px`;
                }
                
                // Check if slid far enough to lock
                if (deltaY >= slideThreshold) {
                    this.talkLocked = true;
                    this.talkButton.classList.add('locked');
                }
            };
            
            const handleTalkEnd = (e) => {
                // Check if our touch ended
                let found = false;
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === talkTouchId) {
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    talkTouchId = null;
                    this.talkButton.classList.remove('active');
                    
                    // Only stop talking if not locked
                    if (!this.talkLocked) {
                        this.stopTalking();
                        // Reset slider thumb
                        const sliderThumb = document.getElementById('talk-slider-thumb');
                        if (sliderThumb) {
                            sliderThumb.style.bottom = '2px';
                        }
                    }
                }
            };
            
            this.talkButton.addEventListener('touchstart', handleTalkStart, { passive: false });
            this.talkButton.addEventListener('touchmove', handleTalkMove, { passive: false });
            this.talkButton.addEventListener('touchend', handleTalkEnd, { passive: false });
            this.talkButton.addEventListener('touchcancel', handleTalkEnd, { passive: false });
        }
        
        // Mobile day/night button
        if (this.mobileDayNightBtn) {
            this.mobileDayNightBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.isRunning && !this.isPaused) {
                    this.toggleDayNight();
                }
            });
        }
        
        // Now playing click to mute (works on mobile)
        if (this.nowPlaying) {
            this.nowPlaying.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.isRunning) {
                    this.toggleMute();
                }
            });
            
            // Also handle touch
            this.nowPlaying.addEventListener('touchend', (e) => {
                e.preventDefault();
                if (this.isRunning) {
                    this.toggleMute();
                }
            }, { passive: false });
        }
    }
    
    toggleMute() {
        if (!this.audioManager) return;
        
        const isMuted = this.audioManager.toggleMute();
        
        // Update UI
        if (this.nowPlaying) {
            this.nowPlaying.classList.toggle('muted', isMuted);
        }
        if (this.musicIcon) {
            this.musicIcon.textContent = isMuted ? '✖' : '♪';
        }
        
        console.log(`Audio ${isMuted ? 'muted' : 'unmuted'}`);
    }
    
    startTalking() {
        this.isTalking = true;
        this.networkManager.startTalking();
        
        if (this.voiceIndicator) {
            this.voiceIndicator.classList.remove('hidden');
        }
    }
    
    stopTalking() {
        this.isTalking = false;
        this.networkManager.stopTalking();
        
        if (this.voiceIndicator) {
            this.voiceIndicator.classList.add('hidden');
        }
    }
    
    startLoopback() {
        if (!this.networkManager) {
            console.log('Network manager not initialized');
            return;
        }
        
        // Let the network manager handle initialization if needed
        this.isLoopbackActive = true;
        const success = this.networkManager.startLoopback();
        
        if (!success) {
            // Will retry after voice chat initializes
            console.log('Loopback will start after mic permission granted');
        }
        
        // Update UI
        if (this.loopbackIndicator) {
            this.loopbackIndicator.classList.remove('hidden');
        }
    }
    
    stopLoopback() {
        if (!this.networkManager) return;
        
        this.isLoopbackActive = false;
        this.networkManager.stopLoopback();
        
        // Update UI
        if (this.loopbackIndicator) {
            this.loopbackIndicator.classList.add('hidden');
        }
    }
    
    toggleDayNight() {
        // Toggle day/night
        const isNight = this.mallScene.toggleDayNight();
        
        // Update the physical switch indicator
        if (this.decorations) {
            this.decorations.updateLightSwitchIndicator(isNight);
        }
        
        // Update parking lot backdrop texture
        if (this.mall) {
            this.mall.updateParkingLotTexture(isNight);
        }
        
        // Send to all other players
        if (this.networkManager && this.networkManager.isConnected) {
            console.log(`Sending day/night change to network: ${isNight ? 'Night' : 'Day'}`);
            this.networkManager.sendDayNight(isNight);
        } else {
            console.log('Network not connected, day/night change not synced');
        }
        
        console.log(`Lights toggled: ${isNight ? 'Night mode' : 'Day mode'}`);
    }
    
    async enterMall() {
        // Get player name
        this.playerName = this.nameInput.value.trim() || 'VISITOR';
        console.log(`Player name: ${this.playerName}`);
        
        // Hide name screen
        this.nameScreen.classList.add('hidden');
        
        // Try to connect to multiplayer server
        try {
            this.updateConnectionStatus(false);
            await this.networkManager.connect(this.playerName);
            
            // Initialize voice chat
            await this.networkManager.initVoiceChat();
            
        } catch (error) {
            console.log('Could not connect to multiplayer server, running in single-player mode:', error);
            // Game can still run without multiplayer
        }
        
        // Start the game
        this.start();
    }

    async start() {
        console.log('Starting game...');
        
        this.isRunning = true;
        this.isPaused = false;
        
        // Hide start screen immediately (in case it was shown)
        this.startScreen.classList.add('hidden');
        
        // Lock pointer and start
        this.player.lock();
        
        // Resume audio context (requires user gesture) - don't block
        this.audioManager.resume().then(() => {
            // Setup mall audio in background - completely non-blocking
            const storeData = this.stores.getStoreData();
            const fountainPosition = new THREE.Vector3(0, 1, -15);
            this.audioManager.setupMallAudio(storeData, fountainPosition);
            
            // Play background music at 5% volume from mall entrances
            this.audioManager.playBackgroundMusic('assets/sounds/bg_music.mp3', 0.15);
        }).catch((error) => {
            console.log('Audio not available, continuing without sound:', error);
        });
        
        // Reset clock to prevent large delta on first frame
        this.clock.start();
        this.clock.getDelta();  // Consume any accumulated time
        
        // Update player count display
        this.updatePlayerCount();
        
        // Start game loop
        this.animate();
    }

    pause() {
        this.isPaused = true;
        this.player.unlock();
        this.pauseMenu.classList.remove('hidden');
        
        // Stop talking when paused
        if (this.isTalking) {
            this.stopTalking();
        }
    }

    resume() {
        this.isPaused = false;
        this.pauseMenu.classList.add('hidden');
        this.player.lock();
    }

    animate() {
        if (!this.isRunning) return;
        
        requestAnimationFrame(() => this.animate());
        
        // Clamp delta time to prevent physics issues on slow frames or tab switches
        let deltaTime = this.clock.getDelta();
        deltaTime = Math.min(deltaTime, 0.1);  // Cap at 100ms (10 FPS minimum)
        
        this.elapsedTime += deltaTime;
        
        if (!this.isPaused) {
            try {
                this.update(deltaTime);
            } catch (error) {
                console.error('Error in update loop:', error);
            }
        }
        
        // Always render (wrapped in try-catch to prevent game crash)
        try {
            this.mallScene.render();
        } catch (error) {
            console.error('Error in render:', error);
        }
    }

    update(deltaTime) {
        // Update player
        if (this.player) {
            this.player.update(deltaTime);
            
            // Send position update to network
            if (this.networkManager && this.networkManager.isConnected) {
                const pos = this.player.getPosition();
                const dir = this.player.getDirection();
                const rotation = Math.atan2(dir.x, dir.z);
                
                this.networkManager.sendUpdate(
                    { x: pos.x, y: pos.y, z: pos.z },
                    rotation
                );
            }
        }
        
        // Update avatars
        if (this.avatarManager) {
            const cameraPos = this.player ? this.player.getPosition() : null;
            this.avatarManager.update(deltaTime, cameraPos);
        }
        
        // Update decorations (animations)
        if (this.decorations) {
            this.decorations.update(deltaTime, this.elapsedTime);
        }
        
        // Update stores (sign animations)
        if (this.stores) {
            this.stores.update(deltaTime, this.elapsedTime);
        }
        
        // Update audio
        if (this.audioManager && this.player) {
            const playerPosition = this.player.getPosition();
            this.audioManager.update(playerPosition);
        }
        
        // Update mall animations
        if (this.mall) {
            this.mall.update(deltaTime);
        }
        
        // Check for interactable objects in view
        this.checkInteraction();
        
        // Update HUD time
        this.updateSimulatedTime(deltaTime);
    }

    updateSimulatedTime(deltaTime) {
        // Time passes 60x faster in the mall (1 real second = 1 simulated minute)
        // Cap deltaTime to prevent huge jumps when returning from tab
        const safeDelta = Math.min(deltaTime, 1);
        this.simulatedTime.minutes += safeDelta * 60;  // 60x speed
        
        // Handle minute overflow
        while (this.simulatedTime.minutes >= 60) {
            this.simulatedTime.minutes -= 60;
            this.simulatedTime.hours++;
            
            // Handle hour overflow
            if (this.simulatedTime.hours >= 24) {
                this.simulatedTime.hours = 0;
            }
        }
        
        // Update HUD display
        if (this.hudTime) {
            const hours = Math.floor(this.simulatedTime.hours);
            const minutes = Math.floor(this.simulatedTime.minutes);
            const period = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            const displayMinutes = minutes.toString().padStart(2, '0');
            this.hudTime.textContent = `${displayHours}:${displayMinutes} ${period}`;
        }
    }

    checkInteraction() {
        // Cast ray from center of screen (camera forward direction)
        const camera = this.mallScene.getCamera();
        if (!camera) return;
        
        // Set raycaster from camera center
        this.raycaster.setFromCamera({ x: 0, y: 0 }, camera);
        
        // Get light switch from decorations
        const lightSwitch = this.decorations ? this.decorations.getLightSwitch() : null;
        
        if (!lightSwitch) {
            this.currentInteractable = null;
            if (this.interactionHint) this.interactionHint.classList.add('hidden');
            return;
        }
        
        // Check intersection with light switch - set far distance for raycaster
        this.raycaster.far = this.interactionDistance + 1;
        const intersects = this.raycaster.intersectObject(lightSwitch, true);
        
        if (intersects.length > 0 && intersects[0].distance <= this.interactionDistance) {
            // Player is looking at the light switch and close enough
            this.currentInteractable = 'lightSwitch';
            if (this.interactionHint) {
                this.interactionHint.textContent = 'Click to toggle lights (or press N)';
                this.interactionHint.classList.remove('hidden');
            }
        } else {
            this.currentInteractable = null;
            if (this.interactionHint) this.interactionHint.classList.add('hidden');
        }
        
        // Reset raycaster far
        this.raycaster.far = Infinity;
    }

    interact() {
        if (!this.currentInteractable) return;
        
        if (this.currentInteractable === 'lightSwitch') {
            this.toggleDayNight();
        }
    }

    updateLoading(progress, text) {
        this.loadingProgress = progress;
        
        if (this.loadingBar) {
            this.loadingBar.style.width = `${progress}%`;
        }
        
        if (this.loadingText) {
            this.loadingText.textContent = text;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    detectMobile() {
        return (('ontouchstart' in window) || 
                (navigator.maxTouchPoints > 0) || 
                (navigator.msMaxTouchPoints > 0) ||
                (window.matchMedia("(pointer: coarse)").matches));
    }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const game = new MallWalkGame();
    game.init();
    
    // Expose game instance for debugging
    window.mallWalkGame = game;
    
    // Expose voice chat debug function
    window.debugVoice = () => {
        if (game.network) {
            return game.network.debugVoiceChat();
        } else {
            console.log('Network not initialized');
            return null;
        }
    };
    console.log('Debug: Type debugVoice() in console to check voice chat status');
});
