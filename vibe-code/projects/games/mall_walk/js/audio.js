// ========================================
// AUDIO.JS - Spatial Audio System
// Mall Walk '92 - Vaporwave Experience
// ========================================

export class AudioManager {
    constructor() {
        this.audioContext = null;
        this.listener = null;
        this.sources = [];
        this.masterGain = null;
        this.isInitialized = false;
        this.isMuted = false;
        
        // Background music (spatial sources at entrances)
        this.bgMusicSources = [];
        this.bgMusicBuffer = null;
        
        // Audio file paths (graceful fallback if not found)
        this.audioFiles = {
            // Store music sources
            'SAM GOODY': 'assets/sounds/smooth_jazz.mp3',
            'ARCADE': 'assets/sounds/arcade_sounds.mp3',
            'ORANGE JULIUS': 'assets/sounds/80s_pop.mp3',
            'MUSICLAND': 'assets/sounds/rock_music.mp3',
            'JAVA CAFE': 'assets/sounds/cafe_jazz.mp3',
            
            // Ambient sounds
            'fountain': 'assets/sounds/water_fountain.mp3',
            'ambient': 'assets/sounds/mall_ambience.mp3',
            'hvac': 'assets/sounds/hvac_hum.mp3'
        };

        // Track names for HUD display
        this.trackNames = {
            'SAM GOODY': '♪ Smooth Jazz Hits',
            'ARCADE': '♪ Arcade Classics',
            'ORANGE JULIUS': '♪ 80s Pop Favorites',
            'MUSICLAND': '♪ Rock & Roll',
            'JAVA CAFE': '♪ Café Jazz',
            'fountain': '~ Water Fountain ~',
            'ambient': '~ Mall Ambience ~'
        };

        // Current playing info
        this.currentClosestSource = null;
        this.nowPlayingElement = null;
    }

    async init() {
        try {
            // Create audio context (with user gesture requirement handling)
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create master gain
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.7;
            this.masterGain.connect(this.audioContext.destination);
            
            this.isInitialized = true;
            console.log('Audio system initialized');
            
            return true;
        } catch (error) {
            console.warn('Audio system could not be initialized:', error);
            return false;
        }
    }

    async resume() {
        // Resume audio context after user interaction
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('Audio context resumed');
            } catch (error) {
                console.warn('Could not resume audio context:', error);
            }
        }
    }

    async createSource(name, position, options = {}) {
        if (!this.isInitialized) {
            return this.createDummySource(name, position);
        }

        const {
            loop = true,
            maxDistance = 30,
            refDistance = 5,
            rolloffFactor = 1,
            volume = 1
        } = options;

        const audioPath = this.audioFiles[name];
        if (!audioPath) {
            console.log(`No audio file configured for: ${name}`);
            return this.createDummySource(name, position);
        }

        // Create dummy source immediately, try to load audio in background
        const dummySource = this.createDummySource(name, position);
        
        // Fire and forget - don't await, just try to load in background
        this.tryLoadAudio(name, audioPath, dummySource, position, {
            loop, maxDistance, refDistance, rolloffFactor, volume
        });
        
        return dummySource;
    }

    async tryLoadAudio(name, audioPath, dummySource, position, options) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
            
            const response = await fetch(audioPath, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.log(`Audio file not found (silent): ${name}`);
                return;
            }

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            // Create source node
            const sourceNode = this.audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.loop = options.loop;

            // Create gain node for this source
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = options.volume;

            // Create panner for 3D positioning
            const pannerNode = this.audioContext.createPanner();
            pannerNode.panningModel = 'HRTF';
            pannerNode.distanceModel = 'exponential';
            pannerNode.refDistance = options.refDistance;
            pannerNode.maxDistance = options.maxDistance;
            pannerNode.rolloffFactor = options.rolloffFactor;
            pannerNode.setPosition(position.x, position.y, position.z);

            // Connect nodes
            sourceNode.connect(gainNode);
            gainNode.connect(pannerNode);
            pannerNode.connect(this.masterGain);

            // Start playing
            sourceNode.start(0);

            // Upgrade the dummy source to a real one
            dummySource.sourceNode = sourceNode;
            dummySource.gainNode = gainNode;
            dummySource.pannerNode = pannerNode;
            dummySource.isPlaying = true;
            dummySource.isDummy = false;
            
            console.log(`Audio source loaded: ${name}`);

        } catch (error) {
            // Silently fail - the dummy source is already in place
            if (error.name !== 'AbortError') {
                console.log(`Audio unavailable (silent): ${name}`);
            }
        }
    }

    createDummySource(name, position) {
        // Create a dummy source for audio files that don't exist
        // This allows the game to run without crashing
        const pos = position.clone ? position.clone() : { x: position.x, y: position.y, z: position.z };
        const source = {
            name,
            position: pos,
            sourceNode: null,
            gainNode: null,
            pannerNode: null,
            isPlaying: false,
            isDummy: true,
            maxDistance: 30,
            baseVolume: 0
        };

        this.sources.push(source);
        return source;
    }

    setupMallAudio(storeData, fountainPosition) {
        if (!this.isInitialized) {
            console.log('Audio not initialized, skipping mall audio setup');
            return;
        }

        // Create audio sources for stores with music (non-blocking)
        const musicStores = storeData.filter(store => store.hasMusic);
        
        for (const store of musicStores) {
            this.createSource(store.name, store.position, {
                loop: true,
                maxDistance: 25,
                refDistance: 3,
                volume: 0.6
            });
        }

        // Create fountain ambient sound
        if (fountainPosition) {
            this.createSource('fountain', fountainPosition, {
                loop: true,
                maxDistance: 20,
                refDistance: 2,
                volume: 0.4
            });
        }

        // Create general mall ambience (plays quietly everywhere)
        this.createSource('ambient', { x: 0, y: 5, z: 0 }, {
            loop: true,
            maxDistance: 200,
            refDistance: 50,
            rolloffFactor: 0.5,
            volume: 0.15
        });

        console.log(`Mall audio setup initiated with ${this.sources.length} sources`);
    }

    update(playerPosition) {
        if (!this.isInitialized || this.sources.length === 0) return;
        if (!playerPosition) return;
        
        // Validate player position
        const px = playerPosition.x || 0;
        const py = playerPosition.y || 0;
        const pz = playerPosition.z || 0;
        
        if (isNaN(px) || isNaN(py) || isNaN(pz)) return;

        // Update listener position
        try {
            if (this.audioContext && this.audioContext.listener) {
                if (this.audioContext.listener.positionX) {
                    // Modern browsers
                    this.audioContext.listener.positionX.value = px;
                    this.audioContext.listener.positionY.value = py;
                    this.audioContext.listener.positionZ.value = pz;
                } else if (this.audioContext.listener.setPosition) {
                    // Legacy browsers
                    this.audioContext.listener.setPosition(px, py, pz);
                }
            }
        } catch (e) {
            // Ignore audio context errors silently
        }

        // Find closest active audio source for HUD display
        let closestSource = null;
        let closestDistance = Infinity;

        for (const source of this.sources) {
            if (!source || source.isDummy) continue;
            if (!source.position) continue;

            // Calculate distance manually to handle both Vector3 and plain objects
            const sx = source.position.x || 0;
            const sy = source.position.y || 0;
            const sz = source.position.z || 0;
            
            const dx = px - sx;
            const dy = py - sy;
            const dz = pz - sz;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            const maxDist = source.maxDistance || 30;
            if (distance < maxDist && distance < closestDistance) {
                closestDistance = distance;
                closestSource = source;
            }
        }

        // Update "Now Playing" display
        if (closestSource !== this.currentClosestSource) {
            this.currentClosestSource = closestSource;
            this.updateNowPlaying(closestSource);
        }
    }

    updateNowPlaying(source) {
        const nowPlayingElement = document.getElementById('now-playing');
        if (!nowPlayingElement) return;

        const trackNameElement = nowPlayingElement.querySelector('.track-name');
        if (!trackNameElement) return;

        if (source && this.trackNames[source.name]) {
            trackNameElement.textContent = this.trackNames[source.name];
            nowPlayingElement.style.opacity = '1';
        } else {
            trackNameElement.textContent = 'Ambient Mall Sounds';
            nowPlayingElement.style.opacity = '0.6';
        }
    }

    setMasterVolume(value) {
        if (this.masterGain) {
            this.masterGain.gain.value = Math.max(0, Math.min(1, value));
        }
    }

    mute() {
        this.isMuted = true;
        if (this.masterGain) {
            this.masterGain.gain.value = 0;
        }
    }

    unmute() {
        this.isMuted = false;
        if (this.masterGain) {
            this.masterGain.gain.value = 0.7;
        }
    }

    toggleMute() {
        if (this.isMuted) {
            this.unmute();
        } else {
            this.mute();
        }
        return !this.isMuted;
    }

    stopAll() {
        // Stop background music sources
        for (const source of this.bgMusicSources) {
            try {
                source.sourceNode.stop();
            } catch (e) {
                // Already stopped
            }
        }
        this.bgMusicSources = [];

        for (const source of this.sources) {
            if (source.sourceNode && source.isPlaying) {
                try {
                    source.sourceNode.stop();
                    source.isPlaying = false;
                } catch (e) {
                    // Already stopped
                }
            }
        }
    }

    dispose() {
        this.stopAll();
        
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        this.sources = [];
        this.isInitialized = false;
    }

    // Play background music from two spatial sources at mall entrances
    async playBackgroundMusic(path = 'assets/sounds/bg_music.mp3', volume = 0.05) {
        if (!this.isInitialized) {
            console.log('Audio not initialized, cannot play background music');
            return;
        }

        try {
            const response = await fetch(path);
            if (!response.ok) {
                console.log(`Background music not found: ${path}`);
                return;
            }

            const arrayBuffer = await response.arrayBuffer();
            this.bgMusicBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            // Stop existing background music sources
            for (const source of this.bgMusicSources) {
                try {
                    source.sourceNode.stop();
                } catch (e) {
                    // Already stopped
                }
            }
            this.bgMusicSources = [];

            // Mall entrance positions (front and back exits at Z = +60 and Z = -60)
            const entrancePositions = [
                { x: 0, y: 3, z: 60 },   // Front entrance
                { x: 0, y: 3, z: -60 }   // Back entrance
            ];

            for (const pos of entrancePositions) {
                // Create source node (need a new one for each position)
                const sourceNode = this.audioContext.createBufferSource();
                sourceNode.buffer = this.bgMusicBuffer;
                sourceNode.loop = true;

                // Create gain node capped at 25% volume
                const gainNode = this.audioContext.createGain();
                gainNode.gain.value = volume;

                // Create panner for 3D positioning (using equalpower for lower CPU usage)
                const pannerNode = this.audioContext.createPanner();
                pannerNode.panningModel = 'equalpower';  // Less CPU intensive than HRTF
                pannerNode.distanceModel = 'inverse';
                pannerNode.refDistance = 8;     // Full volume within 20 units
                pannerNode.maxDistance = 100;    // Audible up to 150 units away
                pannerNode.rolloffFactor = 1.0;  // Gentle fade with distance
                pannerNode.setPosition(pos.x, pos.y, pos.z);

                // Connect: source -> gain -> panner -> master
                sourceNode.connect(gainNode);
                gainNode.connect(pannerNode);
                pannerNode.connect(this.masterGain);

                // Start playing
                sourceNode.start(0);

                // Track this source
                this.bgMusicSources.push({
                    sourceNode,
                    gainNode,
                    pannerNode,
                    position: pos
                });
            }

            console.log('Background music started at mall entrances');

        } catch (error) {
            console.warn('Could not play background music:', error);
        }
    }

    // Play a one-shot sound effect
    async playSound(name, position = null, volume = 1) {
        if (!this.isInitialized) return;

        const audioPath = this.audioFiles[name];
        if (!audioPath) return;

        try {
            const response = await fetch(audioPath);
            if (!response.ok) return;

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            const sourceNode = this.audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;

            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = volume;

            if (position) {
                const pannerNode = this.audioContext.createPanner();
                pannerNode.setPosition(position.x, position.y, position.z);
                sourceNode.connect(gainNode);
                gainNode.connect(pannerNode);
                pannerNode.connect(this.masterGain);
            } else {
                sourceNode.connect(gainNode);
                gainNode.connect(this.masterGain);
            }

            sourceNode.start(0);
        } catch (error) {
            // Silently fail for missing sound effects
        }
    }
}

export default AudioManager;
