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

    refreshPlayback() {
        if (!this.isPlaying) return;

        const now = this.audioContext.currentTime;
        const currentPosition = Math.max(0, this.getCurrentTime());

        this.tracks.forEach(track => track.stop());

        this.pauseTime = currentPosition;
        this.startTime = now - currentPosition;

        this.tracks.forEach(track => {
            if (track.buffer || (track.regions && track.regions.length > 0)) {
                track.play(currentPosition);
            }
        });
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
        const hasSoloed = this.tracks.some(t => t.isSoloed);

        // Calculate max duration from tracks that will actually be exported
        let maxEndTime = 0;
        for (const track of this.tracks) {
            if (track.isMuted) continue;
            if (hasSoloed && !track.isSoloed) continue;

            if (track.regions && track.regions.length > 0) {
                for (const r of track.regions) {
                    maxEndTime = Math.max(maxEndTime, r.startTime + r.duration);
                }
            } else if (track.buffer) {
                maxEndTime = Math.max(maxEndTime, track.duration || 0);
            }
        }

        if (maxEndTime === 0) {
            throw new Error('No audible audio to export. Check that tracks are not all muted.');
        }

        const offlineContext = new OfflineAudioContext(
            2, // stereo
            Math.ceil(maxEndTime * this.audioContext.sampleRate),
            this.audioContext.sampleRate
        );

        // Create offline master gain
        const offlineMaster = offlineContext.createGain();
        offlineMaster.gain.value = this.masterGain.gain.value;
        offlineMaster.connect(offlineContext.destination);

        // Render each track (skip muted, respect solo)
        for (const track of this.tracks) {
            if (track.isMuted) continue;
            if (hasSoloed && !track.isSoloed) continue;

            if ((track.regions && track.regions.length > 0) || track.buffer) {
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
        this.eqBypassGain = null;
        this.eqPathGain = null;
        this.preCompBus = null;
        this.panNode = null;
        this.compBypassGain = null;
        this.compPathGain = null;
        this.postCompBus = null;
        this.eqLow = null;
        this.eqLowMid = null;
        this.eqMid = null;
        this.delayEnableGain = null;
        this.eqHigh = null;
        this.compressor = null;
        this.reverbEnableGain = null;
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
        this.effectStates = {
            eq: false,
            compressor: false,
            delay: false,
            reverb: false
        };
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

        this.eqBypassGain = this.audioContext.createGain();
        this.eqPathGain = this.audioContext.createGain();
        this.preCompBus = this.audioContext.createGain();
        
        // Compressor
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -24;
        this.compressor.knee.value = 30;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;

        this.compBypassGain = this.audioContext.createGain();
        this.compPathGain = this.audioContext.createGain();
        this.postCompBus = this.audioContext.createGain();
        
        // Delay
        this.delayNode = this.audioContext.createDelay(5.0);
        this.delayNode.delayTime.value = 0.5;
        this.delayFeedback = this.audioContext.createGain();
        this.delayFeedback.gain.value = 0.3;
        this.delayWet = this.audioContext.createGain();
        this.delayWet.gain.value = 0;
        this.delayEnableGain = this.audioContext.createGain();
        
        // Reverb (using convolver with impulse response)
        this.convolver = this.audioContext.createConvolver();
        this.reverbWet = this.audioContext.createGain();
        this.reverbWet.gain.value = 0;
        this.reverbEnableGain = this.audioContext.createGain();
        this.createReverbImpulse(2.0);
        
        this.convolver.connect(this.reverbWet);
        this.reverbWet.connect(this.reverbEnableGain);
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayNode.connect(this.delayWet);
        this.delayWet.connect(this.delayEnableGain);
        
        // Connect chain: gain -> pan -> (EQ bypass or EQ path) -> (Comp bypass or Comp path)
        this.gainNode.connect(this.panNode);
        this.panNode.connect(this.eqBypassGain);
        this.panNode.connect(this.eqLow);
        this.eqLow.connect(this.eqLowMid);
        this.eqLowMid.connect(this.eqMid);
        this.eqMid.connect(this.eqHigh);
        this.eqHigh.connect(this.eqPathGain);

        this.eqBypassGain.connect(this.preCompBus);
        this.eqPathGain.connect(this.preCompBus);
        this.preCompBus.connect(this.compBypassGain);
        this.preCompBus.connect(this.compressor);
        this.compressor.connect(this.compPathGain);
        this.compBypassGain.connect(this.postCompBus);
        this.compPathGain.connect(this.postCompBus);
        
        // Parallel effects
        this.postCompBus.connect(this.destination); // Dry signal
        this.postCompBus.connect(this.delayNode);
        this.delayEnableGain.connect(this.destination);
        this.postCompBus.connect(this.convolver);
        this.reverbEnableGain.connect(this.destination);

        this.setEffectEnabled('eq', false);
        this.setEffectEnabled('compressor', false);
        this.setEffectEnabled('delay', false);
        this.setEffectEnabled('reverb', false);
    }

    setEffectEnabled(effectName, enabled) {
        if (!(effectName in this.effectStates)) return;

        const isEnabled = !!enabled;
        this.effectStates[effectName] = isEnabled;

        if (effectName === 'eq') {
            this.eqBypassGain.gain.value = isEnabled ? 0 : 1;
            this.eqPathGain.gain.value = isEnabled ? 1 : 0;
        } else if (effectName === 'compressor') {
            this.compBypassGain.gain.value = isEnabled ? 0 : 1;
            this.compPathGain.gain.value = isEnabled ? 1 : 0;
        } else if (effectName === 'delay') {
            this.delayEnableGain.gain.value = isEnabled ? 1 : 0;
        } else if (effectName === 'reverb') {
            this.reverbEnableGain.gain.value = isEnabled ? 1 : 0;
        }
    }

    isEffectEnabled(effectName) {
        return !!this.effectStates[effectName];
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

    applyRegionClipFades(audioParam, region, playbackStartTime, regionOffset, playbackDuration) {
        const fadeInDuration = Math.max(0, Math.min(region.fadeInDuration || 0, region.duration));
        const fadeOutDuration = Math.max(0, Math.min(region.fadeOutDuration || 0, region.duration));

        if (fadeInDuration <= 0 && fadeOutDuration <= 0) {
            audioParam.setValueAtTime(1.0, playbackStartTime);
            return;
        }

        const fadeOutStart = region.duration - fadeOutDuration;
        const playbackEndOffset = Math.min(region.duration, regionOffset + playbackDuration);

        const gainAt = (positionInRegion) => {
            let fadeInGain = 1.0;
            let fadeOutGain = 1.0;

            if (fadeInDuration > 0) {
                if (positionInRegion <= 0) fadeInGain = 0;
                else if (positionInRegion < fadeInDuration) fadeInGain = positionInRegion / fadeInDuration;
            }

            if (fadeOutDuration > 0) {
                if (positionInRegion >= region.duration) fadeOutGain = 0;
                else if (positionInRegion > fadeOutStart) fadeOutGain = (region.duration - positionInRegion) / fadeOutDuration;
            }

            return Math.max(0, Math.min(1, Math.min(fadeInGain, fadeOutGain)));
        };

        // Build a sorted list of key time points within the playback window,
        // then schedule linear ramps between each pair. This avoids conflicts
        // when fade-in and fade-out regions overlap in short clips.
        const keyPoints = new Set();
        keyPoints.add(regionOffset); // start of playback within region
        keyPoints.add(playbackEndOffset); // end of playback within region

        if (fadeInDuration > 0) {
            // Fade-in ends at fadeInDuration
            if (fadeInDuration > regionOffset && fadeInDuration < playbackEndOffset) {
                keyPoints.add(fadeInDuration);
            }
        }
        if (fadeOutDuration > 0) {
            // Fade-out starts at fadeOutStart
            if (fadeOutStart > regionOffset && fadeOutStart < playbackEndOffset) {
                keyPoints.add(fadeOutStart);
            }
        }

        const sortedPoints = Array.from(keyPoints).sort((a, b) => a - b);

        // Set initial value
        audioParam.setValueAtTime(gainAt(sortedPoints[0]), playbackStartTime);

        // Schedule ramps between consecutive key points
        for (let i = 1; i < sortedPoints.length; i++) {
            const pointTime = playbackStartTime + (sortedPoints[i] - regionOffset);
            audioParam.linearRampToValueAtTime(gainAt(sortedPoints[i]), pointTime);
        }
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

                    // Create gain node for per-clip volume
                    const regionGain = this.audioContext.createGain();
                    regionGain.gain.value = region.gain !== undefined ? region.gain : 1.0;

                    // Create gain node for this source (for clip fades)
                    const clipGain = this.audioContext.createGain();
                    clipGain.gain.value = 1.0;
                    
                    // Create gain node for this source (for crossfades)
                    const sourceGain = this.audioContext.createGain();
                    sourceGain.gain.value = 1.0;
                    source.connect(regionGain);
                    regionGain.connect(clipGain);
                    clipGain.connect(sourceGain);
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
                        // regionPlayOffset: how far into the region we start playing
                        const regionPlayOffset = sourceOffset - region.startOffset;

                        if (region.crossfade.fadeOut) {
                            const fadeOutRegionStart = region.crossfade.fadeOut.start - region.startTime;
                            const fadeOutDuration = region.crossfade.fadeOut.duration;
                            const fadeOutRegionEnd = fadeOutRegionStart + fadeOutDuration;

                            if (fadeOutRegionEnd > regionPlayOffset) {
                                const effectiveStart = Math.max(fadeOutRegionStart, regionPlayOffset);
                                const fadeStartTime = startTime + (effectiveStart - regionPlayOffset);
                                const fadeEndTime = startTime + (fadeOutRegionEnd - regionPlayOffset);

                                // Calculate gain at the effective start point
                                const progress = effectiveStart <= fadeOutRegionStart ? 0 : (effectiveStart - fadeOutRegionStart) / fadeOutDuration;
                                const startGain = 1.0 - progress;

                                sourceGain.gain.setValueAtTime(Math.max(0, startGain), fadeStartTime);
                                sourceGain.gain.linearRampToValueAtTime(0.0, fadeEndTime);
                            }
                        }
                        
                        if (region.crossfade.fadeIn) {
                            const fadeInRegionStart = region.crossfade.fadeIn.start - region.startTime;
                            const fadeInDuration = region.crossfade.fadeIn.duration;
                            const fadeInRegionEnd = fadeInRegionStart + fadeInDuration;

                            if (fadeInRegionEnd > regionPlayOffset) {
                                const effectiveStart = Math.max(fadeInRegionStart, regionPlayOffset);
                                const fadeStartTime = startTime + (effectiveStart - regionPlayOffset);
                                const fadeEndTime = startTime + (fadeInRegionEnd - regionPlayOffset);

                                // Calculate gain at the effective start point
                                const progress = effectiveStart <= fadeInRegionStart ? 0 : (effectiveStart - fadeInRegionStart) / fadeInDuration;
                                const startGain = progress;

                                sourceGain.gain.setValueAtTime(Math.max(0, startGain), startTime);
                                if (effectiveStart > regionPlayOffset) {
                                    sourceGain.gain.setValueAtTime(Math.max(0, startGain), fadeStartTime);
                                }
                                sourceGain.gain.linearRampToValueAtTime(1.0, fadeEndTime);
                            } else {
                                // Crossfade already complete at this point
                                sourceGain.gain.setValueAtTime(1.0, startTime);
                            }
                        }
                    }

                    this.applyRegionClipFades(clipGain.gain, region, startTime, sourceOffset - region.startOffset, duration);
                    
                    source.start(startTime, sourceOffset, duration);
                    this.sources.push({ source, regionGainNode: regionGain, regionData: region });
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

    updateLiveRegionGain(regionData) {
        for (const entry of this.sources) {
            if (entry.regionData === regionData && entry.regionGainNode) {
                entry.regionGainNode.gain.value = regionData.gain !== undefined ? regionData.gain : 1.0;
            }
        }
    }

    stop() {
        // Stop all region sources
        this.sources.forEach(entry => {
            try {
                entry.source.stop();
                entry.source.disconnect();
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
        const gainNode = offlineContext.createGain();
        gainNode.gain.value = this.gainNode.gain.value;

        const panNode = offlineContext.createStereoPanner();
        panNode.pan.value = this.panNode.pan.value;

        const eqLow = offlineContext.createBiquadFilter();
        eqLow.type = this.eqLow.type;
        eqLow.frequency.value = this.eqLow.frequency.value;
        eqLow.Q.value = this.eqLow.Q.value;
        eqLow.gain.value = this.eqLow.gain.value;

        const eqLowMid = offlineContext.createBiquadFilter();
        eqLowMid.type = this.eqLowMid.type;
        eqLowMid.frequency.value = this.eqLowMid.frequency.value;
        eqLowMid.Q.value = this.eqLowMid.Q.value;
        eqLowMid.gain.value = this.eqLowMid.gain.value;

        const eqMid = offlineContext.createBiquadFilter();
        eqMid.type = this.eqMid.type;
        eqMid.frequency.value = this.eqMid.frequency.value;
        eqMid.Q.value = this.eqMid.Q.value;
        eqMid.gain.value = this.eqMid.gain.value;

        const eqHigh = offlineContext.createBiquadFilter();
        eqHigh.type = this.eqHigh.type;
        eqHigh.frequency.value = this.eqHigh.frequency.value;
        eqHigh.Q.value = this.eqHigh.Q.value;
        eqHigh.gain.value = this.eqHigh.gain.value;

        const eqBypassGain = offlineContext.createGain();
        eqBypassGain.gain.value = this.effectStates.eq ? 0 : 1;
        const eqPathGain = offlineContext.createGain();
        eqPathGain.gain.value = this.effectStates.eq ? 1 : 0;
        const preCompBus = offlineContext.createGain();

        const compressor = offlineContext.createDynamicsCompressor();
        compressor.threshold.value = this.compressor.threshold.value;
        compressor.knee.value = this.compressor.knee.value;
        compressor.ratio.value = this.compressor.ratio.value;
        compressor.attack.value = this.compressor.attack.value;
        compressor.release.value = this.compressor.release.value;

        const compBypassGain = offlineContext.createGain();
        compBypassGain.gain.value = this.effectStates.compressor ? 0 : 1;
        const compPathGain = offlineContext.createGain();
        compPathGain.gain.value = this.effectStates.compressor ? 1 : 0;
        const postCompBus = offlineContext.createGain();

        const delayNode = offlineContext.createDelay(5.0);
        delayNode.delayTime.value = this.delayNode.delayTime.value;
        const delayFeedback = offlineContext.createGain();
        delayFeedback.gain.value = this.delayFeedback.gain.value;
        const delayWet = offlineContext.createGain();
        delayWet.gain.value = this.delayWet.gain.value;
        const delayEnableGain = offlineContext.createGain();
        delayEnableGain.gain.value = this.effectStates.delay ? 1 : 0;

        delayNode.connect(delayFeedback);
        delayFeedback.connect(delayNode);
        delayNode.connect(delayWet);
        delayWet.connect(delayEnableGain);

        const convolver = offlineContext.createConvolver();
        convolver.buffer = this.convolver.buffer;
        const reverbWet = offlineContext.createGain();
        reverbWet.gain.value = this.reverbWet.gain.value;
        const reverbEnableGain = offlineContext.createGain();
        reverbEnableGain.gain.value = this.effectStates.reverb ? 1 : 0;

        convolver.connect(reverbWet);
        reverbWet.connect(reverbEnableGain);

        gainNode.connect(panNode);
        panNode.connect(eqBypassGain);
        panNode.connect(eqLow);
        eqLow.connect(eqLowMid);
        eqLowMid.connect(eqMid);
        eqMid.connect(eqHigh);
        eqHigh.connect(eqPathGain);

        eqBypassGain.connect(preCompBus);
        eqPathGain.connect(preCompBus);
        preCompBus.connect(compBypassGain);
        preCompBus.connect(compressor);
        compressor.connect(compPathGain);
        compBypassGain.connect(postCompBus);
        compPathGain.connect(postCompBus);

        postCompBus.connect(destination);
        postCompBus.connect(delayNode);
        delayEnableGain.connect(destination);
        postCompBus.connect(convolver);
        reverbEnableGain.connect(destination);
        
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

            const clipGain = offlineContext.createGain();
            clipGain.gain.value = 1.0;

            // Per-clip volume
            const regionGain = offlineContext.createGain();
            regionGain.gain.value = region.gain !== undefined ? region.gain : 1.0;
            
            const sourceGain = offlineContext.createGain();
            sourceGain.gain.value = 1.0;
            source.connect(regionGain);
            regionGain.connect(clipGain);
            clipGain.connect(sourceGain);
            sourceGain.connect(gainNode);
            
            if (region.crossfade) {
                if (region.crossfade.fadeOut) {
                    const fadeOutRegionStart = region.crossfade.fadeOut.start - region.startTime;
                    const fadeOutDuration = region.crossfade.fadeOut.duration;
                    const fadeStartTime = region.startTime + fadeOutRegionStart;
                    sourceGain.gain.setValueAtTime(1.0, fadeStartTime);
                    sourceGain.gain.linearRampToValueAtTime(0.0, fadeStartTime + fadeOutDuration);
                }
                if (region.crossfade.fadeIn) {
                    const fadeInRegionStart = region.crossfade.fadeIn.start - region.startTime;
                    const fadeInDuration = region.crossfade.fadeIn.duration;
                    const fadeStartTime = region.startTime + fadeInRegionStart;
                    sourceGain.gain.setValueAtTime(0.0, region.startTime);
                    if (fadeStartTime > region.startTime) {
                        sourceGain.gain.setValueAtTime(0.0, fadeStartTime);
                    }
                    sourceGain.gain.linearRampToValueAtTime(1.0, fadeStartTime + fadeInDuration);
                }
            }

            this.applyRegionClipFades(clipGain.gain, region, region.startTime, 0, region.duration);
            
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
        if (this.eqLowMid) this.eqLowMid.disconnect();
        if (this.eqMid) this.eqMid.disconnect();
        if (this.eqHigh) this.eqHigh.disconnect();
        if (this.eqBypassGain) this.eqBypassGain.disconnect();
        if (this.eqPathGain) this.eqPathGain.disconnect();
        if (this.preCompBus) this.preCompBus.disconnect();
        if (this.compressor) this.compressor.disconnect();
        if (this.compBypassGain) this.compBypassGain.disconnect();
        if (this.compPathGain) this.compPathGain.disconnect();
        if (this.postCompBus) this.postCompBus.disconnect();
        if (this.delayNode) this.delayNode.disconnect();
        if (this.delayFeedback) this.delayFeedback.disconnect();
        if (this.delayWet) this.delayWet.disconnect();
        if (this.delayEnableGain) this.delayEnableGain.disconnect();
        if (this.convolver) this.convolver.disconnect();
        if (this.reverbWet) this.reverbWet.disconnect();
        if (this.reverbEnableGain) this.reverbEnableGain.disconnect();
    }
}
