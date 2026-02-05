// Audio Engine - Core audio processing and track management
class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.tracks = [];
        this.masterGain = null;
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
        this.currentTime = 0;
        this.duration = 0;
        this.analyser = null;
        this.animationFrame = null;
    }

    async initialize() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.8;
        
        // Create master analyser for metering
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
        
        return this.audioContext;
    }

    createTrack(id, name) {
        const track = new Track(id, name, this.audioContext, this.masterGain);
        this.tracks.push(track);
        return track;
    }

    removeTrack(id) {
        const index = this.tracks.findIndex(t => t.id === id);
        if (index !== -1) {
            this.tracks[index].dispose();
            this.tracks.splice(index, 1);
        }
    }

    async play() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime - this.pauseTime;

        this.tracks.forEach(track => {
            // Play if track has a buffer OR has regions with buffers
            if (track.buffer || (track.regions && track.regions.length > 0)) {
                track.play(this.pauseTime);
            }
        });

        this.updatePlayhead();
    }

    pause() {
        this.isPlaying = false;
        this.pauseTime = this.audioContext.currentTime - this.startTime;

        this.tracks.forEach(track => track.pause());
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }

    stop() {
        this.isPlaying = false;
        this.pauseTime = 0;
        this.currentTime = 0;

        this.tracks.forEach(track => track.stop());
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }

    seek(time) {
        const wasPlaying = this.isPlaying;
        
        if (this.isPlaying) {
            this.stop();
        }

        this.pauseTime = time;
        this.currentTime = time;

        if (wasPlaying) {
            this.play();
        }
    }

    updatePlayhead() {
        if (!this.isPlaying) return;

        this.currentTime = this.audioContext.currentTime - this.startTime;
        
        // Check if we've reached the end
        if (this.currentTime >= this.duration && this.duration > 0) {
            this.stop();
            return;
        }

        this.animationFrame = requestAnimationFrame(() => this.updatePlayhead());
    }

    getCurrentTime() {
        if (this.isPlaying) {
            return this.audioContext.currentTime - this.startTime;
        }
        return this.pauseTime;
    }

    updateDuration() {
        const trackDurations = this.tracks.map(track => {
            if (track.regions && track.regions.length > 0) {
                return Math.max(...track.regions.map(r => r.startTime + r.duration));
            }
            return track.duration || 0;
        });
        this.duration = Math.max(...trackDurations, 0);
    }

    async exportAudio() {
        // Create offline context for rendering
        const maxDuration = this.duration || Math.max(...this.tracks.map(t => t.duration || 0));
        const offlineContext = new OfflineAudioContext(
            2, // stereo
            maxDuration * this.audioContext.sampleRate,
            this.audioContext.sampleRate
        );

        // Create offline master gain
        const offlineMaster = offlineContext.createGain();
        offlineMaster.gain.value = this.masterGain.gain.value;
        offlineMaster.connect(offlineContext.destination);

        // Render each track
        for (const track of this.tracks) {
            if (track.buffer) {
                await track.renderOffline(offlineContext, offlineMaster);
            }
        }

        // Render the audio
        const renderedBuffer = await offlineContext.startRendering();
        
        // Convert to WAV
        const wav = this.audioBufferToWav(renderedBuffer);
        const blob = new Blob([wav], { type: 'audio/wav' });
        
        return blob;
    }

    audioBufferToWav(buffer) {
        const length = buffer.length * buffer.numberOfChannels * 2 + 44;
        const arrayBuffer = new ArrayBuffer(length);
        const view = new DataView(arrayBuffer);
        const channels = [];
        let offset = 0;
        let pos = 0;

        // Write WAV header
        const setUint16 = (data) => {
            view.setUint16(pos, data, true);
            pos += 2;
        };

        const setUint32 = (data) => {
            view.setUint32(pos, data, true);
            pos += 4;
        };

        // RIFF identifier
        setUint32(0x46464952);
        // File length
        setUint32(length - 8);
        // RIFF type
        setUint32(0x45564157);
        // Format chunk identifier
        setUint32(0x20746d66);
        // Format chunk length
        setUint32(16);
        // Sample format (PCM)
        setUint16(1);
        // Channel count
        setUint16(buffer.numberOfChannels);
        // Sample rate
        setUint32(buffer.sampleRate);
        // Byte rate
        setUint32(buffer.sampleRate * 4);
        // Block align
        setUint16(buffer.numberOfChannels * 2);
        // Bits per sample
        setUint16(16);
        // Data chunk identifier
        setUint32(0x61746164);
        // Data chunk length
        setUint32(length - pos - 4);

        // Write interleaved data
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        while (pos < length) {
            for (let i = 0; i < buffer.numberOfChannels; i++) {
                let sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }

        return arrayBuffer;
    }
}

// Track Class
class Track {
    constructor(id, name, audioContext, destination) {
        this.id = id;
        this.name = name;
        this.audioContext = audioContext;
        this.destination = destination;
        
        // Audio nodes
        this.buffer = null;
        this.source = null;
        this.sources = []; // Multiple sources for regions
        this.gainNode = null;
        this.panNode = null;
        this.eqLow = null;
        this.eqLowMid = null;
        this.eqMid = null;
        this.eqHigh = null;
        this.compressor = null;
        this.delayNode = null;
        this.delayFeedback = null;
        this.delayWet = null;
        this.convolver = null;
        this.reverbWet = null;
        
        // Track properties
        this.duration = 0;
        this.startOffset = 0;
        this.isMuted = false;
        this.isSoloed = false;
        this.isArmed = false;
        this.regions = []; // Audio regions
        this.automation = {
            volume: [],
            delay: [],
            reverb: []
        };
        
        this.setupAudioChain();
    }

    setupAudioChain() {
        // Gain
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 0.8;
        
        // Panning
        this.panNode = this.audioContext.createStereoPanner();
        this.panNode.pan.value = 0;
        
        // 4-band EQ
        this.eqLow = this.audioContext.createBiquadFilter();
        this.eqLow.type = 'lowshelf';
        this.eqLow.frequency.value = 100;
        this.eqLow.Q.value = 1;
        this.eqLow.gain.value = 0;
        
        this.eqLowMid = this.audioContext.createBiquadFilter();
        this.eqLowMid.type = 'peaking';
        this.eqLowMid.frequency.value = 400;
        this.eqLowMid.Q.value = 1;
        this.eqLowMid.gain.value = 0;
        
        this.eqMid = this.audioContext.createBiquadFilter();
        this.eqMid.type = 'peaking';
        this.eqMid.frequency.value = 1000;
        this.eqMid.Q.value = 1;
        this.eqMid.gain.value = 0;
        
        this.eqHigh = this.audioContext.createBiquadFilter();
        this.eqHigh.type = 'highshelf';
        this.eqHigh.frequency.value = 8000;
        this.eqHigh.Q.value = 1;
        this.eqHigh.gain.value = 0;
        
        // Compressor
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -24;
        this.compressor.knee.value = 30;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;
        
        // Delay
        this.delayNode = this.audioContext.createDelay(5.0);
        this.delayNode.delayTime.value = 0.5;
        this.delayFeedback = this.audioContext.createGain();
        this.delayFeedback.gain.value = 0.3;
        this.delayWet = this.audioContext.createGain();
        this.delayWet.gain.value = 0;
        
        // Delay routing
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayNode.connect(this.delayWet);
        
        // Reverb (using convolver with impulse response)
        this.convolver = this.audioContext.createConvolver();
        this.reverbWet = this.audioContext.createGain();
        this.reverbWet.gain.value = 0;
        this.createReverbImpulse(2.0);
        
        this.convolver.connect(this.reverbWet);
        
        // Connect chain: gain -> pan -> EQ (4-band) -> compressor -> effects -> destination
        this.gainNode.connect(this.panNode);
        this.panNode.connect(this.eqLow);
        this.eqLow.connect(this.eqLowMid);
        this.eqLowMid.connect(this.eqMid);
        this.eqMid.connect(this.eqHigh);
        this.eqHigh.connect(this.compressor);
        
        // Parallel effects
        this.compressor.connect(this.destination); // Dry signal
        this.compressor.connect(this.delayNode);
        this.delayWet.connect(this.destination);
        this.compressor.connect(this.convolver);
        this.reverbWet.connect(this.destination);
    }

    createReverbImpulse(duration) {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);
        const leftChannel = impulse.getChannelData(0);
        const rightChannel = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const decay = Math.pow(1 - i / length, 2);
            leftChannel[i] = (Math.random() * 2 - 1) * decay;
            rightChannel[i] = (Math.random() * 2 - 1) * decay;
        }

        this.convolver.buffer = impulse;
    }

    async loadAudio(file) {
        const arrayBuffer = await file.arrayBuffer();
        this.buffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.duration = this.buffer.duration;
        return this.buffer;
    }

    play(offset = 0) {
        this.stop();
        
        // Play all regions
        if (this.regions && this.regions.length > 0) {
            // Sort regions by z-index (most recently selected/moved on top)
            const sortedRegions = [...this.regions].sort((a, b) => {
                const zA = a.element ? (parseInt(a.element.style.zIndex) || 0) : 0;
                const zB = b.element ? (parseInt(b.element.style.zIndex) || 0) : 0;
                return zA - zB; // Lower z-index plays first, will be overridden by higher
            });
            
            sortedRegions.forEach(region => {
                // Skip regions without a buffer
                if (!region.buffer) {
                    console.warn('Region has no buffer, skipping:', region);
                    return;
                }
                
                if (region.startTime + region.duration > offset) {
                    const source = this.audioContext.createBufferSource();
                    source.buffer = region.buffer;
                    
                    // Create gain node for this source (for crossfades)
                    const sourceGain = this.audioContext.createGain();
                    sourceGain.gain.value = 1.0;
                    source.connect(sourceGain);
                    sourceGain.connect(this.gainNode);
                    
                    // Calculate when to start and what offset to use
                    const regionEnd = region.startTime + region.duration;
                    let startTime = this.audioContext.currentTime;
                    let sourceOffset = region.startOffset;
                    let duration = region.duration;
                    
                    if (offset < region.startTime) {
                        // Start in the future
                        const delay = region.startTime - offset;
                        startTime = this.audioContext.currentTime + delay;
                    } else if (offset < regionEnd) {
                        // Start now with offset
                        const playOffset = offset - region.startTime;
                        sourceOffset = region.startOffset + playOffset;
                        duration = region.duration - playOffset;
                    }
                    
                    // Apply crossfade if exists
                    if (region.crossfade) {
                        if (region.crossfade.fadeOut) {
                            const fadeOutStart = region.crossfade.fadeOut.start - region.startTime;
                            const fadeOutDuration = region.crossfade.fadeOut.duration;
                            const fadeStartTime = startTime + fadeOutStart;
                            
                            sourceGain.gain.setValueAtTime(1.0, fadeStartTime);
                            sourceGain.gain.linearRampToValueAtTime(0.0, fadeStartTime + fadeOutDuration);
                        }
                        
                        if (region.crossfade.fadeIn) {
                            const fadeInStart = region.crossfade.fadeIn.start - region.startTime;
                            const fadeInDuration = region.crossfade.fadeIn.duration;
                            const fadeStartTime = startTime + fadeInStart;
                            
                            sourceGain.gain.setValueAtTime(0.0, startTime);
                            sourceGain.gain.setValueAtTime(0.0, fadeStartTime);
                            sourceGain.gain.linearRampToValueAtTime(1.0, fadeStartTime + fadeInDuration);
                        }
                    }
                    
                    source.start(startTime, sourceOffset, duration);
                    this.sources.push(source);
                }
            });
        } else if (this.buffer) {
            // Legacy: play single buffer
            this.source = this.audioContext.createBufferSource();
            this.source.buffer = this.buffer;
            this.source.connect(this.gainNode);
            this.source.start(0, offset);
        }
        
        // Apply automation
        this.applyAutomation(offset);
    }

    pause() {
        this.stop();
    }

    stop() {
        // Stop all region sources
        this.sources.forEach(source => {
            try {
                source.stop();
                source.disconnect();
            } catch (e) {
                // Already stopped
            }
        });
        this.sources = [];
        
        // Stop legacy source
        if (this.source) {
            try {
                this.source.stop();
                this.source.disconnect();
            } catch (e) {
                // Already stopped
            }
            this.source = null;
        }
    }

    applyAutomation(startTime) {
        const currentTime = this.audioContext.currentTime;
        
        // Volume automation
        if (this.automation.volume.length > 0) {
            this.gainNode.gain.cancelScheduledValues(currentTime);
            this.automation.volume.forEach(point => {
                if (point.time >= startTime) {
                    const scheduleTime = currentTime + (point.time - startTime);
                    this.gainNode.gain.linearRampToValueAtTime(point.value, scheduleTime);
                }
            });
        }
        
        // Delay automation
        if (this.automation.delay.length > 0) {
            this.delayWet.gain.cancelScheduledValues(currentTime);
            this.automation.delay.forEach(point => {
                if (point.time >= startTime) {
                    const scheduleTime = currentTime + (point.time - startTime);
                    this.delayWet.gain.linearRampToValueAtTime(point.value, scheduleTime);
                }
            });
        }
        
        // Reverb automation
        if (this.automation.reverb.length > 0) {
            this.reverbWet.gain.cancelScheduledValues(currentTime);
            this.automation.reverb.forEach(point => {
                if (point.time >= startTime) {
                    const scheduleTime = currentTime + (point.time - startTime);
                    this.reverbWet.gain.linearRampToValueAtTime(point.value, scheduleTime);
                }
            });
        }
    }

    addAutomationPoint(param, time, value) {
        if (!this.automation[param]) {
            this.automation[param] = [];
        }
        
        this.automation[param].push({ time, value });
        this.automation[param].sort((a, b) => a.time - b.time);
    }

    removeAutomationPoint(param, index) {
        if (this.automation[param]) {
            this.automation[param].splice(index, 1);
        }
    }

    async renderOffline(offlineContext, destination) {
        // Recreate the effects chain for offline rendering
        const gainNode = offlineContext.createGain();
        gainNode.gain.value = this.gainNode.gain.value;
        
        const panNode = offlineContext.createStereoPanner();
        panNode.pan.value = this.panNode.pan.value;
        
        // EQ
        const eqLow = offlineContext.createBiquadFilter();
        eqLow.type = 'peaking';
        eqLow.frequency.value = this.eqLow.frequency.value;
        eqLow.Q.value = this.eqLow.Q.value;
        eqLow.gain.value = this.eqLow.gain.value;
        
        const eqMid = offlineContext.createBiquadFilter();
        eqMid.type = 'peaking';
        eqMid.frequency.value = this.eqMid.frequency.value;
        eqMid.Q.value = this.eqMid.Q.value;
        eqMid.gain.value = this.eqMid.gain.value;
        
        const eqHigh = offlineContext.createBiquadFilter();
        eqHigh.type = 'peaking';
        eqHigh.frequency.value = this.eqHigh.frequency.value;
        eqHigh.Q.value = this.eqHigh.Q.value;
        eqHigh.gain.value = this.eqHigh.gain.value;
        
        // Compressor
        const compressor = offlineContext.createDynamicsCompressor();
        compressor.threshold.value = this.compressor.threshold.value;
        compressor.knee.value = this.compressor.knee.value;
        compressor.ratio.value = this.compressor.ratio.value;
        compressor.attack.value = this.compressor.attack.value;
        compressor.release.value = this.compressor.release.value;
        
        // Delay
        const delayNode = offlineContext.createDelay(5.0);
        delayNode.delayTime.value = this.delayNode.delayTime.value;
        const delayFeedback = offlineContext.createGain();
        delayFeedback.gain.value = this.delayFeedback.gain.value;
        const delayWet = offlineContext.createGain();
        delayWet.gain.value = this.delayWet.gain.value;
        delayNode.connect(delayFeedback);
        delayFeedback.connect(delayNode);
        delayNode.connect(delayWet);
        
        // Reverb
        const convolver = offlineContext.createConvolver();
        convolver.buffer = this.convolver.buffer;
        const reverbWet = offlineContext.createGain();
        reverbWet.gain.value = this.reverbWet.gain.value;
        convolver.connect(reverbWet);
        
        // Connect chain
        gainNode.connect(panNode);
        panNode.connect(eqLow);
        eqLow.connect(eqMid);
        eqMid.connect(eqHigh);
        eqHigh.connect(compressor);
        compressor.connect(destination); // Dry
        compressor.connect(delayNode);
        delayWet.connect(destination);
        compressor.connect(convolver);
        reverbWet.connect(destination);
        
        // Automation (offline)
        const applyOfflineAutomation = (audioParam, points, defaultValue) => {
            audioParam.setValueAtTime(defaultValue, 0);
            if (points && points.length > 0) {
                points.forEach(point => {
                    audioParam.linearRampToValueAtTime(point.value, point.time);
                });
            }
        };
        applyOfflineAutomation(gainNode.gain, this.automation.volume, this.gainNode.gain.value);
        applyOfflineAutomation(delayWet.gain, this.automation.delay, this.delayWet.gain.value);
        applyOfflineAutomation(reverbWet.gain, this.automation.reverb, this.reverbWet.gain.value);
        
        const renderRegion = (region) => {
            const source = offlineContext.createBufferSource();
            source.buffer = region.buffer;
            
            const sourceGain = offlineContext.createGain();
            sourceGain.gain.value = 1.0;
            source.connect(sourceGain);
            sourceGain.connect(gainNode);
            
            if (region.crossfade) {
                if (region.crossfade.fadeOut) {
                    const fadeOutStart = region.crossfade.fadeOut.start - region.startTime;
                    const fadeOutDuration = region.crossfade.fadeOut.duration;
                    const fadeStartTime = region.startTime + fadeOutStart;
                    sourceGain.gain.setValueAtTime(1.0, fadeStartTime);
                    sourceGain.gain.linearRampToValueAtTime(0.0, fadeStartTime + fadeOutDuration);
                }
                if (region.crossfade.fadeIn) {
                    const fadeInStart = region.crossfade.fadeIn.start - region.startTime;
                    const fadeInDuration = region.crossfade.fadeIn.duration;
                    const fadeStartTime = region.startTime + fadeInStart;
                    sourceGain.gain.setValueAtTime(0.0, region.startTime);
                    sourceGain.gain.setValueAtTime(0.0, fadeStartTime);
                    sourceGain.gain.linearRampToValueAtTime(1.0, fadeStartTime + fadeInDuration);
                }
            }
            
            source.start(region.startTime, region.startOffset, region.duration);
        };
        
        if (this.regions && this.regions.length > 0) {
            this.regions.forEach(renderRegion);
        } else if (this.buffer) {
            renderRegion({
                buffer: this.buffer,
                startTime: 0,
                startOffset: 0,
                duration: this.buffer.duration
            });
        }
    }

    dispose() {
        this.stop();
        
        if (this.gainNode) this.gainNode.disconnect();
        if (this.panNode) this.panNode.disconnect();
        if (this.eqLow) this.eqLow.disconnect();
        if (this.eqMid) this.eqMid.disconnect();
        if (this.eqHigh) this.eqHigh.disconnect();
        if (this.compressor) this.compressor.disconnect();
        if (this.delayNode) this.delayNode.disconnect();
        if (this.delayFeedback) this.delayFeedback.disconnect();
        if (this.delayWet) this.delayWet.disconnect();
        if (this.convolver) this.convolver.disconnect();
        if (this.reverbWet) this.reverbWet.disconnect();
    }
}
