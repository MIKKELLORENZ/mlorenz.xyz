// Main Application Logic
let audioEngine;
let trackCounter = 0;
let currentTrack = null;
let selectedTrack = null; // Currently selected track for keyboard shortcuts
let pixelsPerSecond = 100;
let selectedRegion = null;
let isDraggingRegion = false;
let isResizingRegion = false;
let isAdjustingFade = false;
let isAdjustingRegionGain = false;
let resizeState = null;
let fadeAdjustState = null;
let regionGainAdjustState = null;
let dragGhost = null;
let dragGhostTrackElement = null;
let dragOffset = { x: 0, y: 0 };
let timelineScroll = 0;
let zoomLevel = 1.0;
const MIN_ZOOM_LEVEL = 0.05;
const MAX_ZOOM_LEVEL = 30;
let snapEnabled = true;
let snapValue = 0.25; // quarter note
let bpm = 120;
let settingsInitialized = false;

// Project save/load
let autoSaveTimeout = null;
let isLoadingProject = false;
const DB_NAME = 'AudioStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

// Undo/Redo system
let undoStack = [];
let redoStack = [];
const MAX_UNDO_LEVELS = 50;

// Loop state
let loopEnabled = false;
let loopStart = 0;
let loopEnd = 10;

// Recording state
let isRecording = false;
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingStartTime = 0;
let recordingTrack = null;

// Input metering
let inputAnalyser = null;
let inputSource = null;
let inputMeterAnimationId = null;
let activeInputMeterTrackId = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    audioEngine = new AudioEngine();
    await audioEngine.initialize();
    
    setupEventListeners();
    setupTimeline();
    startMetering();
    updateTrackControlsWidthVar();
    initializeSliderFills();
    
    // Try to load saved project from IndexedDB
    const loaded = await loadProjectFromIndexedDB();
    if (!loaded) {
        // Create default tracks if no saved project
        for (let i = 0; i < 4; i++) {
            createTrack();
        }
    }
});

// Event Listeners
function setupEventListeners() {
    // Transport controls
    document.getElementById('returnToStartBtn').addEventListener('click', () => {
        audioEngine.seek(0);
        updatePlayhead();
        updateTimeDisplay();
    });
    document.getElementById('recordBtn').addEventListener('click', toggleRecording);
    document.getElementById('playPauseBtn').addEventListener('click', togglePlayPause);
    document.getElementById('stopBtn').addEventListener('click', () => {
        // Stop recording if active
        if (isRecording) {
            stopRecording();
        }
        audioEngine.stop();
        updateTimeDisplay();
        updatePlayhead();
        updatePlayPauseButton();
    });
    
    // Loop button
    document.getElementById('loopBtn').addEventListener('click', toggleLoop);
    
    // Add track
    document.getElementById('addTrackBtn').addEventListener('click', () => createTrack());
    
    // Export
    document.getElementById('exportBtn').addEventListener('click', exportProject);
    
    // Save / Load project
    document.getElementById('saveProjectBtn').addEventListener('click', saveProjectToFile);
    document.getElementById('loadProjectBtn').addEventListener('click', loadProjectFromFile);
    document.getElementById('clearProjectBtn').addEventListener('click', clearProject);
    
    // BPM
    document.getElementById('bpmInput').addEventListener('change', (e) => {
        bpm = parseInt(e.target.value);
        updateTimelineGrid(); // Update grid when BPM changes
        scheduleAutoSave();
    });
    
    // Snap settings
    document.getElementById('snapEnabled').addEventListener('change', (e) => {
        snapEnabled = e.target.checked;
        updateTimelineGrid(); // Update grid when snap is toggled
        scheduleAutoSave();
    });
    
    document.getElementById('snapValue').addEventListener('change', (e) => {
        snapValue = parseFloat(e.target.value);
        updateTimelineGrid(); // Update grid when snap value changes
        snapAllRegionsToGrid(); // Snap existing regions to new grid
        scheduleAutoSave();
    });
    
    // Master volume
    document.getElementById('masterVolume').addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        audioEngine.masterGain.gain.value = value;
        const db = value > 0 ? 20 * Math.log10(value) : -Infinity;
        document.getElementById('masterVolumeValue').textContent = db === -Infinity ? '-∞ dB' : db.toFixed(1) + ' dB';
        // Update slider fill
        updateSliderFill(e.target, value * 100);
        scheduleAutoSave();
    });
    
    // Master settings
    document.getElementById('masterSettingsBtn').addEventListener('click', () => {
        alert('Master settings coming soon!');
    });
    
    // Modal close
    const modal = document.getElementById('trackSettingsModal');
    const closeBtn = modal.querySelector('.close');
    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        stopGRMeter();
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
            stopGRMeter();
        }
    });
    
    // Modal tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
    
    // Timeline click (on ruler)
    document.querySelector('.timeline-ruler').addEventListener('click', handleTimelineClick);
    
    // Global region dragging
    document.addEventListener('mousemove', handleRegionDrag);
    document.addEventListener('mouseup', handleRegionDragEnd);
    document.addEventListener('mousemove', handleRegionResize);
    document.addEventListener('mouseup', handleRegionResizeEnd);
    document.addEventListener('mousemove', handleRegionFadeAdjust);
    document.addEventListener('mouseup', handleRegionFadeAdjustEnd);
    document.addEventListener('mousemove', handleRegionGainAdjust);
    document.addEventListener('mouseup', handleRegionGainAdjustEnd);
    
    // Scrolling and Zooming
    const tracksWrapper = document.querySelector('.tracks-wrapper');
    tracksWrapper.addEventListener('wheel', handleWheelScroll, { passive: false });
    tracksWrapper.addEventListener('scroll', handleTracksScroll);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyPress);

    // Keep layout vars in sync
    window.addEventListener('resize', () => {
        updateTrackControlsWidthVar();
        updateTimelineZoom();
    });
}

function getTrackControlsWidth() {
    const spacer = document.querySelector('.track-controls-spacer');
    if (spacer) return spacer.offsetWidth || 200;
    const controls = document.querySelector('.track-controls');
    return controls ? controls.offsetWidth : 200;
}

function syncRulerScroll() {
    const timelineContainer = document.querySelector('.timeline-container');
    if (timelineContainer) {
        timelineContainer.scrollLeft = timelineScroll;
    }
    // Clear any residual CSS transform on the ruler
    const ruler = document.getElementById('timelineRuler');
    if (ruler) {
        ruler.style.transform = '';
    }
}

function handleTracksScroll(e) {
    timelineScroll = e.target.scrollLeft;
    syncRulerScroll();
}

function handleKeyPress(e) {
    // Ignore if typing in input fields
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    
    // Delete key to remove selected region
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRegion) {
        e.preventDefault();
        const owner = findRegionOwner(selectedRegion);
        if (owner) {
            const { track, regionData } = owner;
            const trackId = track.id;
            const regionSnapshot = cloneRegionDataForHistory(regionData);
            let activeRegionData = regionData;

            const deleteRegion = () => {
                const currentOwner = findRegionOwner(activeRegionData);
                if (!currentOwner) return;
                if (removeRegionFromTrack(currentOwner.track, currentOwner.regionData)) {
                    applyArrangementChange();
                }
            };

            const restoreRegion = () => {
                const targetTrack = audioEngine.tracks.find(t => t.id === trackId);
                if (!targetTrack) return;
                const restored = restoreRegionToTrack(regionSnapshot, targetTrack);
                if (restored) {
                    activeRegionData = restored;
                    applyArrangementChange();
                }
            };

            deleteRegion();
            recordHistoryAction('Delete Region', restoreRegion, deleteRegion);
        }
    }
    
    // Space bar to play/pause
    if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
    }
    
    // Undo: Cmd/Ctrl + Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
    }
    
    // Redo: Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        redo();
    }
    
    // M - Mute selected track
    if (e.key === 'm' || e.key === 'M') {
        if (selectedTrack) {
            const track = audioEngine.tracks.find(t => t.id === selectedTrack.dataset.trackId);
            if (track) {
                const muteBtn = selectedTrack.querySelector('.mute-btn');
                muteBtn.click();
            }
        }
    }
    
    // S - Solo selected track
    if (e.key === 's' || e.key === 'S') {
        if (selectedTrack) {
            const track = audioEngine.tracks.find(t => t.id === selectedTrack.dataset.trackId);
            if (track) {
                const soloBtn = selectedTrack.querySelector('.solo-btn');
                soloBtn.click();
            }
        }
    }
    
    // L - Toggle loop
    if (e.key === 'l' || e.key === 'L') {
        toggleLoop();
    }
    
    // R - Toggle recording
    if (e.key === 'r' || e.key === 'R') {
        toggleRecording();
    }
    
    // Enter - Return to start (or loop start if looping)
    if (e.key === 'Enter') {
        e.preventDefault();
        const seekTime = loopEnabled ? loopStart : 0;
        audioEngine.seek(seekTime);
        updatePlayhead();
        updateTimeDisplay();
    }

    // Arrow keys - Move timeline view left/right
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 400 : 120;
        const direction = e.key === 'ArrowRight' ? 1 : -1;
        const maxScroll = getTimelineMaxScroll();
        timelineScroll = Math.max(0, Math.min(maxScroll, timelineScroll + (direction * step)));
        updateTimelineScroll();
    }

    // X - Split selected region at playhead
    if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        if (selectedRegion) {
            const track = audioEngine.tracks.find(t =>
                t.regions && t.regions.some(r => r.element === selectedRegion)
            );

            if (track) {
                const regionData = track.regions.find(r => r.element === selectedRegion);
                const playheadTime = audioEngine.getCurrentTime();
                const regionEnd = regionData.startTime + regionData.duration;

                if (playheadTime > regionData.startTime && playheadTime < regionEnd) {
                    const relativeSplitTime = playheadTime - regionData.startTime;
                    const trackElement = document.querySelector(`.track[data-track-id="${track.id}"]`);
                    splitRegionAtTime(regionData, relativeSplitTime, track, trackElement);
                }
            }
        }
    }
    
    // + / = - Zoom in
    if (e.key === '+' || e.key === '=') {
        zoomLevel *= 1.2;
        zoomLevel = Math.min(MAX_ZOOM_LEVEL, zoomLevel);
        updateTimelineZoom();
    }
    
    // - - Zoom out
    if (e.key === '-') {
        zoomLevel *= 0.8;
        zoomLevel = Math.max(MIN_ZOOM_LEVEL, zoomLevel);
        updateTimelineZoom();
    }
    
    // Cmd/Ctrl + D - Duplicate selected region
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (selectedRegion) {
            const track = audioEngine.tracks.find(t => 
                t.regions && t.regions.some(r => r.element === selectedRegion)
            );
            if (track) {
                const regionData = track.regions.find(r => r.element === selectedRegion);
                const trackElement = document.querySelector(`.track[data-track-id="${track.id}"]`);
                duplicateRegion(regionData, track, trackElement);
            }
        }
    }
}

// Solo/Mute State Management
function updateSoloMuteStates() {
    const hasSoloed = audioEngine.tracks.some(t => t.isSoloed);
    
    audioEngine.tracks.forEach(track => {
        const trackElement = document.querySelector(`.track[data-track-id="${track.id}"]`);
        const volumeSlider = trackElement?.querySelector('.track-volume');
        const targetVolume = volumeSlider ? parseFloat(volumeSlider.value) : 0.8;
        
        if (track.isMuted) {
            // Muted tracks are always silent
            track.gainNode.gain.value = 0;
        } else if (hasSoloed) {
            // If any track is soloed, only soloed tracks play
            track.gainNode.gain.value = track.isSoloed ? targetVolume : 0;
        } else {
            // Normal playback
            track.gainNode.gain.value = targetVolume;
        }
    });
}

function refreshPlaybackIfActive() {
    if (audioEngine?.isPlaying) {
        audioEngine.refreshPlayback();
    }
}

function applyArrangementChange() {
    audioEngine.updateDuration();
    refreshPlaybackIfActive();
    updateTimelineZoom();
    updateTimeDisplay();
    scheduleAutoSave();
}

// ============================================
// Play/Pause Toggle and Transport Helpers
// ============================================
function togglePlayPause() {
    if (audioEngine.isPlaying) {
        // Stop recording when pausing
        if (isRecording) {
            stopRecording();
        }
        audioEngine.pause();
    } else {
        audioEngine.play();
    }
    updatePlayPauseButton();
}

function updatePlayPauseButton() {
    const btn = document.getElementById('playPauseBtn');
    if (audioEngine.isPlaying) {
        btn.innerHTML = '⏸';
        btn.classList.add('playing');
        btn.title = 'Pause (Space)';
    } else {
        btn.innerHTML = '▶';
        btn.classList.remove('playing');
        btn.title = 'Play (Space)';
    }
}

// ============================================
// Loop System
// ============================================
function toggleLoop() {
    loopEnabled = !loopEnabled;
    const loopBtn = document.getElementById('loopBtn');
    loopBtn.classList.toggle('loop-active', loopEnabled);
    
    // Update loop region display
    updateLoopDisplay();
    
    // If looping is now enabled, set default loop region if not set
    if (loopEnabled && loopEnd <= loopStart) {
        loopEnd = Math.min((audioEngine.duration || 60), loopStart + 10);
    }
}

function updateLoopDisplay() {
    // Remove existing loop region display
    document.querySelectorAll('.loop-region').forEach(el => el.remove());
    
    if (!loopEnabled) return;
    
    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    
    // Add loop region to ruler
    const ruler = document.getElementById('timelineRuler');
    const loopRegion = document.createElement('div');
    loopRegion.className = 'loop-region';
    loopRegion.style.left = `${(loopStart / duration) * totalWidth}px`;
    loopRegion.style.width = `${((loopEnd - loopStart) / duration) * totalWidth}px`;
    ruler.appendChild(loopRegion);
}

// ============================================
// Recording System
// ============================================
async function toggleRecording() {
    if (isRecording) {
        await stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    // Find an armed track
    const armedTrack = audioEngine.tracks.find(t => t.isArmed);
    if (!armedTrack) {
        showNotification('No track armed for recording. Click the ● button on a track first.');
        return;
    }
    
    // Always use the input metering stream if available, or create new one
    try {
        if (inputAnalyser && inputAnalyser._stream && inputAnalyser._stream.active) {
            // Reuse the existing stream from input metering
            recordingStream = inputAnalyser._stream;
            console.log('Reusing input metering stream for recording, active:', recordingStream.active);
        } else {
            // Create new stream and set up metering at the same time
            recordingStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            console.log('Created new stream for recording');
            
            // Also set up input metering with this stream
            await setupInputMeteringWithStream(recordingStream, armedTrack.id);
        }
    } catch (err) {
        console.error('Microphone access denied:', err);
        showNotification('Microphone access denied. Please allow microphone access to record.');
        return;
    }
    
    // Set up MediaRecorder with best available format
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/ogg';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = ''; // Let browser choose
            }
        }
    }
    
    console.log('Using MIME type:', mimeType || 'browser default');
    
    const options = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(recordingStream, options);
    recordingChunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
        console.log('Recording chunk received:', e.data.size, 'bytes');
        if (e.data.size > 0) {
            recordingChunks.push(e.data);
        }
    };
    
    mediaRecorder.onstop = async () => {
        console.log('Recording stopped, total chunks:', recordingChunks.length);
        await processRecording();
    };
    
    mediaRecorder.onerror = (e) => {
        console.error('MediaRecorder error:', e);
        showNotification('Recording error: ' + e.error?.message || 'Unknown error');
    };
    
    // Start recording
    // Apply latency compensation - MediaRecorder has ~100-200ms latency
    // We subtract this from the start time so the recording aligns properly
    const latencyCompensation = 0.247; // 250ms compensation (adjustable)
    recordingTrack = armedTrack;
    recordingStartTime = Math.max(0, audioEngine.getCurrentTime() - latencyCompensation);
    mediaRecorder.start(100); // Collect data every 100ms
    isRecording = true;
    
    // Automatically start playback when recording starts
    if (!audioEngine.isPlaying) {
        audioEngine.play();
        updatePlayPauseButton();
    }
    
    // Update UI
    updateRecordButton();
    
    // Add recording indicator to the track
    const trackElement = document.querySelector(`.track[data-track-id="${armedTrack.id}"]`);
    if (trackElement) {
        // Remove existing indicator if any
        trackElement.querySelectorAll('.recording-indicator').forEach(el => el.remove());
        const indicator = document.createElement('div');
        indicator.className = 'recording-indicator';
        trackElement.appendChild(indicator);
    }
    
    showNotification('Recording started...');
}

async function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    
    isRecording = false;
    mediaRecorder.stop();
    
    // Only stop the stream if it's not being used by input metering
    if (recordingStream && (!inputAnalyser || inputAnalyser._stream !== recordingStream)) {
        recordingStream.getTracks().forEach(track => track.stop());
    }
    recordingStream = null;
    
    // Update UI
    updateRecordButton();
    
    // Remove recording indicator
    document.querySelectorAll('.recording-indicator').forEach(el => el.remove());
}

let isProcessingRecording = false;

async function processRecording() {
    // Guard against re-entry (e.g., MediaRecorder.onstop firing twice)
    if (isProcessingRecording) return;
    isProcessingRecording = true;

    try {
    console.log('processRecording called');
    console.log('recordingChunks.length:', recordingChunks.length);
    console.log('recordingTrack:', recordingTrack?.id);
    
    if (recordingChunks.length === 0) {
        console.log('No recording chunks to process');
        return;
    }
    
    if (!recordingTrack) {
        console.log('No recording track set');
        return;
    }
    
    const savedTrack = recordingTrack;
    const savedStartTime = recordingStartTime;
    
    // Create blob from chunks
    const totalSize = recordingChunks.reduce((acc, chunk) => acc + chunk.size, 0);
    console.log('Total chunks size:', totalSize);
    
    const blob = new Blob(recordingChunks, { type: recordingChunks[0]?.type || 'audio/webm' });
    console.log('Recording blob size:', blob.size, 'type:', blob.type);
    
    if (blob.size === 0) {
        showNotification('Recording was empty. Please try again.');
        recordingChunks = [];
        recordingTrack = null;
        return;
    }
    
    // Decode audio
    try {
        console.log('AudioContext state:', audioEngine.audioContext.state);
        
        // Resume audio context if needed
        if (audioEngine.audioContext.state === 'suspended') {
            await audioEngine.audioContext.resume();
        }
        
        const arrayBuffer = await blob.arrayBuffer();
        console.log('ArrayBuffer size:', arrayBuffer.byteLength);
        
        const audioBuffer = await audioEngine.audioContext.decodeAudioData(arrayBuffer);
        console.log('Decoded audio buffer:', audioBuffer.duration, 'seconds, channels:', audioBuffer.numberOfChannels);
        
        // Analyze the actual recorded audio levels
        const channelData = audioBuffer.getChannelData(0);
        let maxSample = 0;
        let sumSquares = 0;
        for (let i = 0; i < channelData.length; i++) {
            const abs = Math.abs(channelData[i]);
            if (abs > maxSample) maxSample = abs;
            sumSquares += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sumSquares / channelData.length);
        console.log('Recorded audio analysis - Peak:', maxSample.toFixed(4), 'RMS:', rms.toFixed(4), 'Peak dB:', (20 * Math.log10(maxSample)).toFixed(1));
        
        // Create region on the armed track
        const trackElement = document.querySelector(`.track[data-track-id="${savedTrack.id}"]`);
        console.log('Track element found:', !!trackElement);
        
        if (trackElement && audioBuffer) {
            const regionData = {
                buffer: audioBuffer,
                startTime: savedStartTime,
                duration: audioBuffer.duration,
                startOffset: 0,
                endOffset: audioBuffer.duration,
                name: `Recording ${new Date().toLocaleTimeString()}`
            };
            
            console.log('Creating region with data:', { startTime: savedStartTime, duration: audioBuffer.duration });
            createRegionFromData(regionData, savedTrack, trackElement);
            
            applyArrangementChange();
            
            showNotification(`Recording added to ${savedTrack.name}`);
        } else {
            console.error('Track element not found or audioBuffer is null');
        }
    } catch (err) {
        console.error('Failed to decode recording:', err);
        showNotification('Failed to process recording: ' + err.message);
    }
    
    // Clear state
    recordingChunks = [];
    recordingTrack = null;

    } finally {
        isProcessingRecording = false;
    }
}

// Input metering functions
async function startInputMetering(trackId) {
    // Stop any existing input metering first
    stopInputMetering();
    
    try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        
        console.log('Got microphone stream:', stream.active, stream.getAudioTracks());
        
        await setupInputMeteringWithStream(stream, trackId);
        
    } catch (err) {
        console.error('Failed to start input metering:', err);
        showNotification('Microphone access denied');
    }
}

async function setupInputMeteringWithStream(stream, trackId) {
    // Resume audio context if needed
    if (audioEngine.audioContext.state === 'suspended') {
        await audioEngine.audioContext.resume();
        console.log('Audio context resumed');
    }
    
    // Stop existing metering (but don't stop the stream)
    if (inputMeterAnimationId) {
        cancelAnimationFrame(inputMeterAnimationId);
        inputMeterAnimationId = null;
    }
    if (inputSource) {
        inputSource.disconnect();
        inputSource = null;
    }
    
    // Create analyser node
    inputAnalyser = audioEngine.audioContext.createAnalyser();
    inputAnalyser.fftSize = 2048;
    inputAnalyser.smoothingTimeConstant = 0.5;
    
    // Connect stream to analyser
    inputSource = audioEngine.audioContext.createMediaStreamSource(stream);
    inputSource.connect(inputAnalyser);
    
    // Store stream reference for cleanup
    inputAnalyser._stream = stream;
    inputAnalyser._trackId = trackId;
    activeInputMeterTrackId = trackId;
    
    // Start metering animation
    meterLogCounter = 0;
    updateInputMeter();
    
    console.log('Input metering started for track:', trackId, 'stream active:', stream.active);
}

function stopInputMetering() {
    if (inputMeterAnimationId) {
        cancelAnimationFrame(inputMeterAnimationId);
        inputMeterAnimationId = null;
    }
    
    if (inputSource) {
        inputSource.disconnect();
        inputSource = null;
    }
    
    if (inputAnalyser) {
        if (inputAnalyser._stream) {
            inputAnalyser._stream.getTracks().forEach(t => t.stop());
        }
        inputAnalyser = null;
    }

    activeInputMeterTrackId = null;
    
    // Reset all input meters
    document.querySelectorAll('.input-meter-bar').forEach(bar => {
        bar.style.width = '0%';
    });
    document.querySelectorAll('.input-meter-peak').forEach(peak => {
        peak.style.left = '0%';
    });
}

let meterLogCounter = 0;

function updateInputMeter() {
    if (!inputAnalyser) return;
    
    // Use time domain data for more accurate level metering
    const bufferLength = inputAnalyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    inputAnalyser.getByteTimeDomainData(dataArray);
    
    // Calculate peak level from waveform (centered around 128)
    let maxDeviation = 0;
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
        const deviation = Math.abs(dataArray[i] - 128);
        sum += deviation;
        if (deviation > maxDeviation) {
            maxDeviation = deviation;
        }
    }
    const avgDeviation = sum / bufferLength;
    
    // Convert to percentage (128 is max deviation from center)
    // Use a combination of peak and average for better responsiveness
    const peakLevel = (maxDeviation / 128) * 100;
    const avgLevel = (avgDeviation / 128) * 100;
    
    // Log every 60 frames (about once per second)
    meterLogCounter++;
    if (meterLogCounter % 60 === 0) {
        // Also log the first few raw samples to see actual values
        const sampleValues = Array.from(dataArray.slice(0, 10));
        console.log('Input meter - peak:', peakLevel.toFixed(1), '% avg:', avgLevel.toFixed(2), '% samples:', sampleValues);
    }
    
    // Update meter bars for armed tracks
    const trackId = activeInputMeterTrackId || inputAnalyser._trackId;
    const meterBar = document.querySelector(`.input-meter-bar[data-track-id="${trackId}"]`);
    const meterPeak = document.querySelector(`.input-meter-peak[data-track-id="${trackId}"]`);

    // Ensure only the active track reflects input meter movement
    document.querySelectorAll('.input-meter-bar').forEach(bar => {
        if (bar.dataset.trackId !== trackId) {
            bar.style.width = '0%';
        }
    });
    document.querySelectorAll('.input-meter-peak').forEach(peak => {
        if (peak.dataset.trackId !== trackId) {
            peak.style.left = '0%';
        }
    });
    
    // Log element state occasionally
    if (meterLogCounter % 120 === 1) {
        console.log('Meter elements found:', { meterBar: !!meterBar, meterPeak: !!meterPeak, trackId });
        const track = document.querySelector(`.track[data-track-id="${trackId}"]`);
        console.log('Track has armed class:', track?.classList.contains('armed'));
    }
    
    if (meterBar) {
        // Scale for good visibility - peak level * 3 gives good range
        const displayLevel = Math.min(peakLevel * 3, 100);
        meterBar.style.width = `${displayLevel}%`;
    }
    if (meterPeak) {
        // Peak hold (simplified)
        const currentPeak = parseFloat(meterPeak.style.left) || 0;
        const newPeak = Math.min(peakLevel * 3, 100);
        if (newPeak > currentPeak) {
            meterPeak.style.left = `${newPeak}%`;
        } else {
            meterPeak.style.left = `${Math.max(currentPeak - 2, 0)}%`;
        }
    }
    
    inputMeterAnimationId = requestAnimationFrame(updateInputMeter);
}

function updateRecordButton() {
    const btn = document.getElementById('recordBtn');
    if (isRecording) {
        btn.classList.add('recording');
        btn.title = 'Stop Recording (R)';
    } else {
        btn.classList.remove('recording');
        btn.title = 'Record from microphone (R)';
    }
}

function showNotification(message) {
    // Simple notification - could be enhanced with a toast system
    console.log(message);
    // Create temporary notification element
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: #2d2d30;
        color: white;
        padding: 12px 24px;
        border-radius: 6px;
        border: 1px solid #0e639c;
        z-index: 10000;
        animation: fadeInOut 3s forwards;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// ============================================
// Undo/Redo System
// ============================================
function pushUndo(description, undoFn, redoFn) {
    undoStack.push({ description, undo: undoFn, redo: redoFn });
    if (undoStack.length > MAX_UNDO_LEVELS) {
        undoStack.shift();
    }
    redoStack = []; // Clear redo stack on new action
}

function recordHistoryAction(description, undoFn, redoFn) {
    pushUndo(description, undoFn, redoFn);
}

function undo() {
    if (undoStack.length === 0) {
        showUndoIndicator('Nothing to undo');
        return;
    }
    const action = undoStack.pop();
    redoStack.push(action);
    action.redo(); // Redo function reverses the undo
    showUndoIndicator(`Undo: ${action.description}`);
}

function redo() {
    if (redoStack.length === 0) {
        showUndoIndicator('Nothing to redo');
        return;
    }
    const action = redoStack.pop();
    undoStack.push(action);
    action.undo(); // Undo function re-applies the action
    showUndoIndicator(`Redo: ${action.description}`);
}

function showUndoIndicator(message) {
    const existing = document.querySelector('.undo-indicator');
    if (existing) existing.remove();
    
    const indicator = document.createElement('div');
    indicator.className = 'undo-indicator';
    indicator.textContent = message;
    document.body.appendChild(indicator);
    
    setTimeout(() => indicator.remove(), 1500);
}

// ============================================
// Slider Fill Updates
// ============================================
function updateSliderFill(slider, percentage) {
    slider.style.setProperty('--fill', `${percentage}%`);
}

function initializeSliderFills() {
    // Initialize master volume slider fill
    const masterVolume = document.getElementById('masterVolume');
    if (masterVolume) {
        updateSliderFill(masterVolume, parseFloat(masterVolume.value) * 100);
    }
}

function getTimelineContentWidth() {
    const duration = audioEngine.duration || 60;
    const timelineWidth = duration * pixelsPerSecond * zoomLevel;
    return getTrackControlsWidth() + timelineWidth;
}

function getTimelineMaxScroll() {
    const tracksWrapper = document.querySelector('.tracks-wrapper');
    if (!tracksWrapper) return 0;
    return Math.max(0, getTimelineContentWidth() - tracksWrapper.clientWidth);
}

function handleWheelScroll(e) {
    e.preventDefault();
    
    if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + Wheel: Zoom in/out CENTERED ON CURSOR
        const tracksWrapper = document.querySelector('.tracks-wrapper');
        const rect = tracksWrapper.getBoundingClientRect();
        const trackControlsWidth = getTrackControlsWidth();
        
        // Get cursor position relative to timeline area (excluding track controls)
        const cursorX = e.clientX - rect.left - trackControlsWidth + tracksWrapper.scrollLeft;
        const duration = audioEngine.duration || 60;
        const oldTotalWidth = duration * pixelsPerSecond * zoomLevel;
        
        // Calculate what time position the cursor is over
        const cursorTime = (cursorX / oldTotalWidth) * duration;
        
        // Apply zoom
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        const oldZoom = zoomLevel;
        zoomLevel *= zoomDelta;
        zoomLevel = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, zoomLevel));
        
        // Calculate new total width
        const newTotalWidth = duration * pixelsPerSecond * zoomLevel;
        
        // Calculate new scroll position to keep cursor at same visual position
        const newCursorX = (cursorTime / duration) * newTotalWidth;
        const cursorOffsetFromViewport = e.clientX - rect.left - trackControlsWidth;
        timelineScroll = newCursorX - cursorOffsetFromViewport;
        
        // Clamp scroll
        const maxScroll = Math.max(0, (newTotalWidth + trackControlsWidth) - tracksWrapper.clientWidth);
        timelineScroll = Math.max(0, Math.min(maxScroll, timelineScroll));
        
        updateTimelineZoom();
    } else if (e.shiftKey) {
        // Shift + Wheel: Horizontal scroll
        const scrollDelta = e.deltaY;
        timelineScroll += scrollDelta;
        const maxScroll = getTimelineMaxScroll();
        timelineScroll = Math.max(0, Math.min(maxScroll, timelineScroll));
        updateTimelineScroll();
    } else if (e.altKey) {
        // Alt + Wheel: Vertical zoom (waveform amplitude) - future feature placeholder
        // For now, use as track height zoom
        const tracks = document.querySelectorAll('.track');
        const currentHeight = parseInt(getComputedStyle(tracks[0]).height) || 120;
        const newHeight = e.deltaY > 0 ? currentHeight * 0.9 : currentHeight * 1.1;
        const clampedHeight = Math.max(60, Math.min(300, newHeight));
        tracks.forEach(track => {
            track.style.height = `${clampedHeight}px`;
        });
    } else {
        // Plain wheel: Vertical scroll (native behavior)
        const tracksWrapper = document.querySelector('.tracks-wrapper');
        tracksWrapper.scrollTop += e.deltaY;
    }
}

function updateTimelineZoom() {
    updateTrackControlsWidthVar();
    // Update all track timelines width based on zoom
    const duration = audioEngine.duration || 60;
    const newWidth = duration * pixelsPerSecond * zoomLevel;
    const trackControlsWidth = getTrackControlsWidth();
    const contentWidth = trackControlsWidth + newWidth;

    const tracksContainer = document.getElementById('tracksContainer');
    if (tracksContainer) {
        tracksContainer.style.width = `${contentWidth}px`;
    }
    document.querySelectorAll('.track').forEach(track => {
        track.style.width = `${contentWidth}px`;
    });
    
    document.querySelectorAll('.track-timeline').forEach(timeline => {
        timeline.style.flex = '0 0 auto';
        timeline.style.width = `${newWidth}px`;
    });

    const tracksWrapper = document.querySelector('.tracks-wrapper');
    const maxScroll = getTimelineMaxScroll();
    timelineScroll = Math.max(0, Math.min(timelineScroll, maxScroll));
    tracksWrapper.scrollLeft = timelineScroll;

    // Also update the timeline header width to match content
    const timelineHeader = document.querySelector('.timeline-header');
    if (timelineHeader) {
        timelineHeader.style.width = `${contentWidth}px`;
    }
    
    updateTimelineRuler();
    updateAllRegions(); // Changed from updateAllWaveforms
    updateTimelineGrid();
    updatePlayhead();
}

function updateAllRegions() {
    // Update all audio regions position, width, and waveforms based on current zoom level
    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    
    document.querySelectorAll('.audio-region').forEach(region => {
        const canvas = region.querySelector('canvas');
        if (canvas && canvas.audioBuffer) {
            // Get region data from parent track
            const trackElement = region.closest('.track');
            const trackId = trackElement.dataset.trackId;
            const track = audioEngine.tracks.find(t => t.id === trackId);
            
            if (track && track.regions) {
                const regionData = track.regions.find(r => r.element === region);
                if (regionData) {
                    // Recalculate position and width
                    const left = (regionData.startTime / duration) * totalWidth;
                    const width = (regionData.duration / duration) * totalWidth;
                    
                    region.style.left = `${left}px`;
                    region.style.width = `${width}px`;
                    
                    // Redraw waveform with new dimensions
                    drawRegionWaveform(canvas, regionData.buffer, regionData.startOffset, regionData.endOffset);
                    updateRegionFadeVisuals(regionData);
                }
            }
        }
    });
}

function updateAllWaveforms() {
    // Redraw all audio region waveforms based on current zoom level
    document.querySelectorAll('.audio-region').forEach(region => {
        const canvas = region.querySelector('canvas');
        if (canvas && canvas.audioBuffer) {
            const regionData = {
                startOffset: parseFloat(region.dataset.startOffset) || 0,
                endOffset: parseFloat(region.dataset.endOffset) || canvas.audioBuffer.duration
            };
            drawRegionWaveform(canvas, canvas.audioBuffer, regionData.startOffset, regionData.endOffset);
        }
    });
}

function updateTimelineScroll() {
    // Scroll all track timelines horizontally
    const tracksWrapper = document.querySelector('.tracks-wrapper');
    const maxScroll = getTimelineMaxScroll();
    timelineScroll = Math.max(0, Math.min(timelineScroll, maxScroll));
    tracksWrapper.scrollLeft = timelineScroll;
    syncRulerScroll();
}

function snapToGrid(timeInSeconds) {
    if (!snapEnabled) return timeInSeconds;
    
    // Calculate beat duration in seconds
    const beatDuration = 60.0 / bpm;
    const snapDuration = beatDuration * snapValue * 4; // snapValue is fraction of whole note
    
    // Snap to nearest grid point
    return Math.round(timeInSeconds / snapDuration) * snapDuration;
}

function setupTimeline() {
    updateTimelineRuler();
    updateTimelineZoom();
    
    setInterval(() => {
        if (audioEngine.isPlaying) {
            updateTimeDisplay();
            updatePlayhead();
        }
    }, 50);
}

function updateTimelineRuler() {
    const ruler = document.getElementById('timelineRuler');
    const duration = audioEngine.duration || 60;
    
    // Calculate appropriate interval based on zoom
    let interval = 5;
    if (zoomLevel > 5) interval = 1;
    else if (zoomLevel > 2) interval = 2;
    else if (zoomLevel < 0.5) interval = 10;
    
    const numMarkers = Math.ceil(duration / interval);
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    
    ruler.innerHTML = '';
    ruler.style.width = `${totalWidth}px`;
    
    for (let i = 0; i <= numMarkers; i++) {
        const time = i * interval;
        const marker = document.createElement('span');
        marker.style.position = 'absolute';
        marker.style.left = `${(time / duration) * totalWidth}px`;
        marker.textContent = formatTime(time);
        ruler.appendChild(marker);
    }

    syncRulerScroll();
    updateLoopDisplay();
}

function updateTimelineGrid() {
    // Add/update vertical grid lines on all track timelines
    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    
    document.querySelectorAll('.track-timeline').forEach(timeline => {
        // Remove existing grid
        const existingGrid = timeline.querySelector('.timeline-grid');
        if (existingGrid) existingGrid.remove();
        
        // Create new grid container with explicit width to match timeline
        const grid = document.createElement('div');
        grid.className = 'timeline-grid';
        grid.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: ${totalWidth}px;
            height: 100%;
            pointer-events: none;
            z-index: 1;
            overflow: visible;
        `;
        
        // Calculate grid interval based on snap settings or zoom level
        let gridInterval;
        if (snapEnabled) {
            const beatDuration = 60.0 / bpm;
            gridInterval = beatDuration * snapValue * 4; // Use snap value for grid
        } else {
            // Default grid intervals based on zoom
            if (zoomLevel > 5) gridInterval = 1;
            else if (zoomLevel > 2) gridInterval = 2;
            else if (zoomLevel < 0.5) gridInterval = 10;
            else gridInterval = 5;
        }
        
        const numLines = Math.ceil(duration / gridInterval);
        
        for (let i = 0; i <= numLines; i++) {
            const time = i * gridInterval;
            const isMajor = (i % 4 === 0);
            const line = document.createElement('div');
            line.className = 'timeline-grid-line' + (isMajor ? ' major' : '');
            line.style.cssText = `
                position: absolute;
                left: ${(time / duration) * totalWidth}px;
                top: 0;
                width: 1px;
                height: 100%;
                background: ${isMajor ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.15)'};
            `;
            
            grid.appendChild(line);
        }
        
        timeline.insertBefore(grid, timeline.firstChild);
    });
}

function handleTimelineClick(e) {
    const ruler = e.currentTarget;
    const rect = ruler.getBoundingClientRect();
    const totalWidth = (audioEngine.duration || 60) * pixelsPerSecond * zoomLevel;
    const x = Math.max(0, Math.min(totalWidth, e.clientX - rect.left));
    const time = (x / totalWidth) * (audioEngine.duration || 60);
    
    audioEngine.seek(time);
    updatePlayhead();
    updateTimeDisplay();
}

function updatePlayhead() {
    const playhead = document.getElementById('playhead');
    const currentTime = audioEngine.getCurrentTime();
    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    const position = (currentTime / duration) * totalWidth;
    
    playhead.style.left = `${position}px`;
    
    // Auto-scroll to follow playhead
    const tracksWrapper = document.querySelector('.tracks-wrapper');
    const trackControlsWidth = getTrackControlsWidth();
    const wrapperWidth = tracksWrapper.clientWidth - trackControlsWidth;
    const scrollPos = tracksWrapper.scrollLeft;
    
    if (position > scrollPos + wrapperWidth - 100) {
        tracksWrapper.scrollLeft = position - wrapperWidth + 100;
        timelineScroll = tracksWrapper.scrollLeft;
        syncRulerScroll();
    } else if (position < scrollPos + 100) {
        tracksWrapper.scrollLeft = Math.max(0, position - 100);
        timelineScroll = tracksWrapper.scrollLeft;
        syncRulerScroll();
    }
}

function updateTimeDisplay() {
    const currentTime = audioEngine.getCurrentTime();
    const duration = audioEngine.duration || 0;
    
    document.getElementById('currentTime').textContent = formatTime(currentTime);
    document.getElementById('totalTime').textContent = formatTime(duration);
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// Track Management
function createTrack(options) {
    if (!options || options instanceof Event) options = {};
    
    if (options.id) {
        const idNum = parseInt(options.id.replace('track-', ''));
        if (!isNaN(idNum) && idNum > trackCounter) trackCounter = idNum;
        else if (!isNaN(idNum) && idNum === trackCounter) { /* keep */ }
        else trackCounter++;
    } else {
        trackCounter++;
    }
    
    const trackId = options.id || `track-${trackCounter}`;
    const trackName = options.name || `Track ${trackCounter}`;
    
    const track = audioEngine.createTrack(trackId, trackName);
    
    const trackElement = document.createElement('div');
    trackElement.className = 'track';
    trackElement.dataset.trackId = trackId;
    trackElement.innerHTML = `
        <div class="track-controls">
            <div class="track-name-row">
                <input type="text" class="track-name" value="${trackName}" data-track-id="${trackId}">
                <div class="track-btns">
                    <button class="record-btn" data-track-id="${trackId}" title="Arm for recording">●</button>
                    <button class="mute-btn" data-track-id="${trackId}" title="Mute (M)">M</button>
                    <button class="solo-btn" data-track-id="${trackId}" title="Solo (S)">S</button>
                </div>
            </div>
            <div class="track-controls-row">
                <div class="control-group">
                    <label>Volume</label>
                    <input type="range" class="track-volume" min="0" max="1" step="0.01" value="0.8" data-track-id="${trackId}">
                    <span class="control-value volume-value">-2 dB</span>
                </div>
            </div>
            <div class="track-controls-row">
                <div class="control-group">
                    <label>Pan</label>
                    <input type="range" class="track-pan" min="-1" max="1" step="0.01" value="0" data-track-id="${trackId}">
                    <span class="control-value pan-value">C</span>
                </div>
            </div>
            <div class="track-actions-row">
                <button class="settings-btn" data-track-id="${trackId}">
                    ⚙ FX
                </button>
                <button class="delete-track-btn" data-track-id="${trackId}" title="Delete Track">✕</button>
            </div>
            <div class="track-meter">
                <div class="track-meter-bar" data-track-id="${trackId}"></div>
            </div>
            <div class="input-meter">
                <div class="input-meter-bar" data-track-id="${trackId}"></div>
                <div class="input-meter-peak" data-track-id="${trackId}"></div>
            </div>
            <div class="effect-indicators"></div>
        </div>
        <div class="track-timeline">
            <div class="drop-zone">
                <p>Drop audio file here</p>
                <p style="font-size: 0.8em; opacity: 0.6;">MP3 / WAV</p>
            </div>
        </div>
    `;
    
    document.getElementById('tracksContainer').appendChild(trackElement);
    updateTrackControlsWidthVar();
    
    // Setup drag and drop
    setupDragAndDrop(trackElement, track);
    
    // Track name change
    const nameInput = trackElement.querySelector('.track-name');
    nameInput.addEventListener('change', (e) => {
        track.name = e.target.value;
        scheduleAutoSave();
    });
    
    // Record arm button
    const recordBtn = trackElement.querySelector('.record-btn');
    recordBtn.addEventListener('click', async (e) => {
        selectTrack(trackElement);
        const willArm = !track.isArmed;

        audioEngine.tracks.forEach(otherTrack => {
            if (otherTrack.id === track.id) return;
            if (!otherTrack.isArmed) return;

            otherTrack.isArmed = false;
            const otherTrackElement = document.querySelector(`.track[data-track-id="${otherTrack.id}"]`);
            const otherRecordBtn = otherTrackElement?.querySelector('.record-btn');
            if (otherRecordBtn) otherRecordBtn.classList.remove('active');
            if (otherTrackElement) otherTrackElement.classList.remove('armed');
        });

        track.isArmed = willArm;
        recordBtn.classList.toggle('active', track.isArmed);
        trackElement.classList.toggle('armed', track.isArmed);

        if (track.isArmed) {
            await startInputMetering(track.id);
        } else {
            stopInputMetering();
        }
    });

    // Mute button
    const muteBtn = trackElement.querySelector('.mute-btn');
    muteBtn.addEventListener('click', (e) => {
        selectTrack(trackElement);
        track.isMuted = !track.isMuted;
        if (track.isMuted) {
            track.gainNode.gain.value = 0;
            muteBtn.classList.add('active');
        } else {
            const volumeSlider = trackElement.querySelector('.track-volume');
            track.gainNode.gain.value = parseFloat(volumeSlider.value);
            muteBtn.classList.remove('active');
        }
        updateSoloMuteStates();
        scheduleAutoSave();
    });

    // Solo button
    const soloBtn = trackElement.querySelector('.solo-btn');
    soloBtn.addEventListener('click', (e) => {
        selectTrack(trackElement);
        track.isSoloed = !track.isSoloed;
        soloBtn.classList.toggle('active', track.isSoloed);
        updateSoloMuteStates();
        scheduleAutoSave();
    });

    // Delete track button
    const deleteBtn = trackElement.querySelector('.delete-track-btn');
    deleteBtn.addEventListener('click', (e) => {
        if (audioEngine.tracks.length <= 1) {
            alert('Cannot delete the last track.');
            return;
        }
        if (confirm(`Delete "${track.name}"?`)) {
            audioEngine.removeTrack(track.id);
            if (selectedTrack === trackElement) {
                selectedTrack = null;
            }
            trackElement.remove();
            applyArrangementChange();
            scheduleAutoSave();
        }
    });
    
    // Volume control
    const volumeSlider = trackElement.querySelector('.track-volume');
    const volumeValue = trackElement.querySelector('.volume-value');
    volumeSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (!track.isMuted) {
            track.gainNode.gain.value = value;
        }
        const db = value > 0 ? 20 * Math.log10(value) : -Infinity;
        volumeValue.textContent = db === -Infinity ? '-∞ dB' : db.toFixed(1) + ' dB';
        updateSliderFill(e.target, value * 100);
        scheduleAutoSave();
    });
    // Initialize fill
    updateSliderFill(volumeSlider, parseFloat(volumeSlider.value) * 100);
    
    // Pan control
    const panSlider = trackElement.querySelector('.track-pan');
    const panValue = trackElement.querySelector('.pan-value');
    panSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        track.panNode.pan.value = value;
        if (value < -0.1) {
            panValue.textContent = `L${Math.abs(value * 100).toFixed(0)}`;
        } else if (value > 0.1) {
            panValue.textContent = `R${(value * 100).toFixed(0)}`;
        } else {
            panValue.textContent = 'C';
        }
        // Pan slider uses center-based fill (handled by CSS)
        scheduleAutoSave();
    });
    
    // Track selection (click on track controls to select)
    const trackControls = trackElement.querySelector('.track-controls');
    trackControls.addEventListener('click', (e) => {
        // Keep the rename field focused without interrupting typing
        if (e.target.closest('.track-name')) return;
        selectTrack(trackElement);
    });
    
    // Settings button
    const settingsBtn = trackElement.querySelector('.settings-btn');
    settingsBtn.addEventListener('click', () => {
        selectTrack(trackElement);
        openTrackSettings(track, trackElement);
    });
    
    // Right-click context menu on timeline
    const timeline = trackElement.querySelector('.track-timeline');
    timeline.addEventListener('mousedown', (e) => {
        if (e.target.closest('.audio-region')) return;
        selectTrack(trackElement);
        if (selectedRegion) {
            selectedRegion.classList.remove('selected');
            selectedRegion = null;
        }
    });
    timeline.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, track, trackElement);
    });
}

function setupDragAndDrop(trackElement, track) {
    const timeline = trackElement.querySelector('.track-timeline');
    
    timeline.addEventListener('dragover', (e) => {
        e.preventDefault();
        trackElement.classList.add('drag-over');
    });
    
    timeline.addEventListener('dragleave', () => {
        trackElement.classList.remove('drag-over');
    });
    
    timeline.addEventListener('drop', async (e) => {
        e.preventDefault();
        trackElement.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.type === 'audio/mpeg' || file.type === 'audio/wav' || file.type === 'audio/wave') {
                // Calculate drop position in timeline
                const rect = timeline.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const duration = audioEngine.duration || 60;
                const totalWidth = duration * pixelsPerSecond * zoomLevel;
                let startTime = (x / totalWidth) * duration;
                
                // Apply snap
                startTime = snapToGrid(startTime);
                
                await loadAudioFile(track, file, trackElement, startTime);
            } else {
                alert('Please drop an MP3 or WAV file');
            }
        }
    });
}

async function loadAudioFile(track, file, trackElement, startTime = 0) {
    // Show loading overlay
    const timeline = trackElement.querySelector('.track-timeline');
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'track-loading-overlay';
    loadingOverlay.innerHTML = '<div class="track-loading-spinner"></div>';
    timeline.appendChild(loadingOverlay);
    
    try {
        const buffer = await track.loadAudio(file);
        
        // Apply snap to start time
        const snappedStartTime = snapEnabled ? snapToGrid(startTime) : startTime;
        
        // Create audio region
        createAudioRegion(track, trackElement, buffer, snappedStartTime);
        applyArrangementChange();
        
        trackElement.classList.add('has-audio');
    } catch (error) {
        console.error('Error loading audio:', error);
        alert('Error loading audio file');
    } finally {
        // Remove loading overlay
        loadingOverlay.remove();
    }
}

// Check if a region with matching properties already exists on the track.
// This prevents accidental duplicates from undo/redo bugs, double event
// fires, recording re-entry, etc.
function isRegionDuplicate(track, regionData, excludeElement) {
    if (!track.regions || track.regions.length === 0) return false;
    const TIME_TOL = 0.05; // 50 ms tolerance
    return track.regions.some(r => {
        if (excludeElement && r.element === excludeElement) return false;
        if (r === regionData) return false;
        return r.buffer === regionData.buffer &&
            Math.abs(r.startTime - regionData.startTime) < TIME_TOL &&
            Math.abs(r.startOffset - regionData.startOffset) < TIME_TOL &&
            Math.abs(r.duration - regionData.duration) < TIME_TOL;
    });
}

function getTrackElementById(trackId) {
    return document.querySelector(`.track[data-track-id="${trackId}"]`);
}

function cloneRegionDataForHistory(regionData) {
    return {
        buffer: regionData.buffer,
        startTime: regionData.startTime,
        duration: regionData.duration,
        startOffset: regionData.startOffset,
        endOffset: regionData.endOffset,
        fadeInDuration: regionData.fadeInDuration || 0,
        fadeOutDuration: regionData.fadeOutDuration || 0,
        gain: regionData.gain !== undefined ? regionData.gain : 1.0,
        crossfade: regionData.crossfade ? structuredClone(regionData.crossfade) : undefined
    };
}

function findRegionOwner(regionOrElement) {
    const element = regionOrElement?.element || regionOrElement;

    for (const track of audioEngine.tracks) {
        if (!track.regions) continue;

        for (const regionData of track.regions) {
            if (regionData === regionOrElement || regionData.element === element) {
                return {
                    track,
                    trackElement: getTrackElementById(track.id),
                    regionData
                };
            }
        }
    }

    return null;
}

function removeRegionFromTrack(track, regionData) {
    if (!track || !track.regions) return false;
    const index = track.regions.indexOf(regionData);
    if (index === -1) return false;

    track.regions.splice(index, 1);
    if (regionData.element) {
        if (selectedRegion === regionData.element) {
            selectedRegion = null;
        }
        regionData.element.remove();
    }

    return true;
}

function restoreRegionToTrack(regionSnapshot, track) {
    const trackElement = getTrackElementById(track.id);
    if (!trackElement) return null;

    const restoredData = {
        ...cloneRegionDataForHistory(regionSnapshot),
        element: null
    };

    createRegionFromData(restoredData, track, trackElement);
    return restoredData.element ? restoredData : null;
}

function applyRegionGeometry(regionData) {
    if (!regionData || !regionData.element) return;

    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    const left = (regionData.startTime / duration) * totalWidth;
    const width = (regionData.duration / duration) * totalWidth;

    regionData.element.style.left = `${left}px`;
    regionData.element.style.width = `${Math.max(1, width)}px`;
    regionData.element.dataset.startOffset = regionData.startOffset.toString();
    regionData.element.dataset.endOffset = regionData.endOffset.toString();

    const canvas = regionData.element.querySelector('canvas');
    if (canvas) {
        drawRegionWaveform(canvas, regionData.buffer, regionData.startOffset, regionData.endOffset);
    }
    updateRegionFadeVisuals(regionData);
    updateRegionGainVisuals(regionData);
}

// Remove exact-duplicate regions from a track (same buffer, position,
// offsets). Keeps only the first occurrence of each unique region.
function deduplicateTrackRegions(track) {
    if (!track.regions || track.regions.length < 2) return;
    const dominated = new Set();
    const TIME_TOL = 0.05;
    for (let i = 0; i < track.regions.length; i++) {
        if (dominated.has(i)) continue;
        for (let j = i + 1; j < track.regions.length; j++) {
            if (dominated.has(j)) continue;
            const a = track.regions[i];
            const b = track.regions[j];
            if (
                a.buffer === b.buffer &&
                Math.abs(a.startTime - b.startTime) < TIME_TOL &&
                Math.abs(a.startOffset - b.startOffset) < TIME_TOL &&
                Math.abs(a.duration - b.duration) < TIME_TOL
            ) {
                dominated.add(j);
            }
        }
    }
    if (dominated.size === 0) return;
    // Remove duplicates in reverse order to keep indices stable
    const toRemove = Array.from(dominated).sort((a, b) => b - a);
    for (const idx of toRemove) {
        const r = track.regions[idx];
        if (r.element) r.element.remove();
        track.regions.splice(idx, 1);
    }
    console.warn(`Removed ${toRemove.length} duplicate region(s) from ${track.name}`);
}

function createAudioRegion(track, trackElement, buffer, startTime = 0) {
    const timeline = trackElement.querySelector('.track-timeline');
    
    // Initialize regions array if not exists
    if (!track.regions) {
        track.regions = [];
    }
    
    const region = document.createElement('div');
    region.className = 'audio-region';
    
    // Calculate position and width based on zoom
    const duration = audioEngine.duration || 60;
    const regionDuration = buffer.duration;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    const left = (startTime / duration) * totalWidth;
    const width = (regionDuration / duration) * totalWidth;
    
    region.style.left = `${left}px`;
    region.style.width = `${width}px`;
    
    // Store region offsets as data attributes
    region.dataset.startOffset = '0';
    region.dataset.endOffset = buffer.duration.toString();
    
    // Create waveform canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'region-waveform';
    canvas.audioBuffer = buffer; // Store buffer reference on canvas
    region.appendChild(canvas);
    
    // Draw waveform
    setTimeout(() => {
        drawRegionWaveform(canvas, buffer, 0, buffer.duration);
    }, 10);
    
    // Add resize handles
    const leftHandle = document.createElement('div');
    leftHandle.className = 'region-handle left';
    const rightHandle = document.createElement('div');
    rightHandle.className = 'region-handle right';
    region.appendChild(leftHandle);
    region.appendChild(rightHandle);
    
    timeline.appendChild(region);
    
    // Store region data
    const regionData = {
        element: region,
        buffer: buffer,
        startTime: startTime,
        duration: regionDuration,
        startOffset: 0,
        endOffset: regionDuration,
        fadeInDuration: 0,
        fadeOutDuration: 0,
        gain: 1.0
    };

    // Prevent duplicate regions from being stacked
    if (isRegionDuplicate(track, regionData)) {
        console.warn('Blocked duplicate region in createAudioRegion');
        region.remove();
        return;
    }

    track.regions.push(regionData);

    addRegionFadeControls(region, regionData);
    addRegionGainControl(region, regionData);
    
    // Region interaction
    setupRegionInteraction(region, regionData, track, trackElement);
    
    // Update timeline zoom to accommodate new region
    // Timeline updates happen after duration recalculation
}

function setupRegionInteraction(region, regionData, track, trackElement) {
    // Click to select
    region.addEventListener('mousedown', (e) => {
        if (
            e.target.classList.contains('region-handle') ||
            e.target.classList.contains('fade-handle') ||
            e.target.classList.contains('region-gain-line') ||
            e.target.classList.contains('region-gain-baseline')
        ) return;
        
        e.stopPropagation();
        
        // Deselect previous
        if (selectedRegion) {
            selectedRegion.classList.remove('selected');
        }
        
        region.classList.add('selected');
        selectedRegion = region;
        region.style.zIndex = Date.now().toString();

        const owner = findRegionOwner(regionData) || { track, trackElement, regionData };
        const activeTrack = owner.track;
        const activeTrackElement = owner.trackElement;
        const activeRegionData = owner.regionData;
        
        // Alt+Click to duplicate
        if (e.altKey) {
            const duplicatedData = duplicateRegion(activeRegionData, activeTrack, activeTrackElement);
            if (duplicatedData) {
                dragOffset.regionData = duplicatedData;
                dragOffset.track = activeTrack;
                dragOffset.trackElement = activeTrackElement;
                selectedRegion = duplicatedData.element;
                selectedRegion.classList.add('selected');
                isDraggingRegion = true;
                const rect = duplicatedData.element.getBoundingClientRect();
                dragOffset.x = e.clientX - rect.left;
                dragOffset.y = e.clientY - rect.top;
                return;
            }
        }
        
        // Start dragging
        isDraggingRegion = true;
        const rect = region.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        dragOffset.track = activeTrack;
        dragOffset.trackElement = activeTrackElement;
        dragOffset.regionData = activeRegionData;
        dragOffset.originalLeftPx = parseFloat(region.style.left) || 0;
        dragOffset.startClientX = e.clientX;
        dragOffset.startClientY = e.clientY;
    });
    
    // Right-click context menu on region
    region.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const owner = findRegionOwner(regionData) || { track, trackElement, regionData };
        showRegionContextMenu(e, owner.regionData, owner.track, owner.trackElement);
    });
    
    // Double-click to split
    region.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const owner = findRegionOwner(regionData) || { track, trackElement, regionData };
        splitRegionAtPosition(region, owner.regionData, owner.track, owner.trackElement, e);
    });

    // Resize handles
    const leftHandle = region.querySelector('.region-handle.left');
    const rightHandle = region.querySelector('.region-handle.right');
    [leftHandle, rightHandle].forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            const owner = findRegionOwner(regionData) || { track, trackElement, regionData };
            startRegionResize(
                e,
                handle.classList.contains('left') ? 'left' : 'right',
                owner.regionData,
                owner.track,
                owner.trackElement
            );
        });
    });
}

function clearTrackDragPreview() {
    document.querySelectorAll('.track.drag-preview').forEach(el => el.classList.remove('drag-preview'));
}

function removeRegionDragGhost() {
    if (dragGhost) {
        dragGhost.remove();
        dragGhost = null;
    }
    dragGhostTrackElement = null;
    clearTrackDragPreview();
}

function getRegionLeftPxFromTime(regionData) {
    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    return (regionData.startTime / duration) * totalWidth;
}

function updateRegionDragGhost(targetTrackElement, leftPx) {
    const timeline = targetTrackElement.querySelector('.track-timeline');
    if (!timeline) return;

    if (!dragGhost || dragGhostTrackElement !== targetTrackElement) {
        if (dragGhost) dragGhost.remove();
        dragGhost = document.createElement('div');
        dragGhost.className = 'audio-region drag-ghost';
        dragGhost.style.width = `${selectedRegion.offsetWidth}px`;
        timeline.appendChild(dragGhost);
        dragGhostTrackElement = targetTrackElement;
    }

    dragGhost.style.left = `${Math.max(0, leftPx)}px`;
}

function handleRegionDrag(e) {
    if (isResizingRegion || isAdjustingFade || isAdjustingRegionGain || !isDraggingRegion || !selectedRegion) return;
    
    selectedRegion.classList.add('dragging');
    
    // Find which track we're over
    const tracks = document.querySelectorAll('.track');
    let targetTrack = null;
    let targetTrackElement = null;
    
    tracks.forEach(trackEl => {
        const rect = trackEl.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            targetTrackElement = trackEl;
            const trackId = trackEl.dataset.trackId;
            targetTrack = audioEngine.tracks.find(t => t.id === trackId);
        }
    });
    
    if (targetTrack && targetTrackElement) {
        const timeline = targetTrackElement.querySelector('.track-timeline');
        const rect = timeline.getBoundingClientRect();
        
        // Calculate new position accounting for zoom and scroll
        const x = e.clientX - rect.left - dragOffset.x;

        if (targetTrackElement !== dragOffset.trackElement) {
            updateRegionDragGhost(targetTrackElement, x);
            targetTrackElement.classList.add('drag-preview');
            selectedRegion.style.left = `${dragOffset.originalLeftPx}px`;
        } else {
            removeRegionDragGhost();
            selectedRegion.style.left = `${Math.max(0, x)}px`;
        }
    }
}

function handleRegionDragEnd(e) {
    if (isResizingRegion || isAdjustingFade || isAdjustingRegionGain || !isDraggingRegion || !selectedRegion) return;
    
    isDraggingRegion = false;
    selectedRegion.classList.remove('dragging');

    // If the mouse barely moved this was a click, not a drag — skip
    // repositioning to avoid snapping the region to a new location or
    // triggering unnecessary arrangement changes.
    const dxDrag = e.clientX - (dragOffset.startClientX ?? e.clientX);
    const dyDrag = e.clientY - (dragOffset.startClientY ?? e.clientY);
    if (Math.sqrt(dxDrag * dxDrag + dyDrag * dyDrag) < 4) {
        removeRegionDragGhost();
        return;
    }
    
    // Find target track
    const tracks = document.querySelectorAll('.track');
    let targetTrack = null;
    let targetTrackElement = null;
    
    tracks.forEach(trackEl => {
        const rect = trackEl.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            targetTrackElement = trackEl;
            const trackId = trackEl.dataset.trackId;
            targetTrack = audioEngine.tracks.find(t => t.id === trackId);
        }
    });
    
    if (targetTrack && targetTrackElement) {
        const timeline = targetTrackElement.querySelector('.track-timeline');
        const rect = timeline.getBoundingClientRect();

        let x;
        if (dragGhost && dragGhostTrackElement === targetTrackElement) {
            x = parseFloat(dragGhost.style.left) || 0;
        } else {
            x = e.clientX - rect.left - dragOffset.x;
        }

        // Calculate new start time from pixel position
        let newStartTime = Math.max(0, x / (pixelsPerSecond * zoomLevel));
        
        // Apply snap if enabled
        if (snapEnabled) {
            newStartTime = snapToGrid(newStartTime);
        }
        
        // Save old startTime for undo
        const oldStartTime = dragOffset.regionData.startTime;
        const oldTrack = dragOffset.track;
        
        // Update region data - startOffset and endOffset stay the same (only position changes)
        dragOffset.regionData.startTime = newStartTime;
        
        // If moved to different track
        if (targetTrack !== dragOffset.track) {
            // Remove from old track
            const oldIndex = dragOffset.track.regions.indexOf(dragOffset.regionData);
            if (oldIndex !== -1) {
                dragOffset.track.regions.splice(oldIndex, 1);
            }
            
            // Add to new track
            if (!targetTrack.regions) {
                targetTrack.regions = [];
            }
            targetTrack.regions.push(dragOffset.regionData);
            
            // Move DOM element
            selectedRegion.remove();
            timeline.appendChild(selectedRegion);
            
            // Update track reference
            dragOffset.track = targetTrack;
            dragOffset.trackElement = targetTrackElement;
        }
        
        // Recalculate position using direct time-to-pixel conversion
        const duration = audioEngine.duration || 60;
        const totalWidth = duration * pixelsPerSecond * zoomLevel;
        const left = (dragOffset.regionData.startTime / duration) * totalWidth;
        selectedRegion.style.left = `${left}px`;

        applyArrangementChange();

        const newTrack = dragOffset.track;
        const finalStartTime = dragOffset.regionData.startTime;
        const movedRegionData = dragOffset.regionData;

        const didTrackChange = oldTrack !== newTrack;
        const didTimeChange = Math.abs(oldStartTime - finalStartTime) > 0.0001;

        if (didTrackChange || didTimeChange) {
            const applyMoveState = (targetTrackId, targetStartTime) => {
                const targetTrackForMove = audioEngine.tracks.find(t => t.id === targetTrackId);
                if (!targetTrackForMove) return;

                const ownerNow = findRegionOwner(movedRegionData);
                if (!ownerNow) return;

                if (ownerNow.track !== targetTrackForMove) {
                    const ownerIndex = ownerNow.track.regions.indexOf(movedRegionData);
                    if (ownerIndex !== -1) {
                        ownerNow.track.regions.splice(ownerIndex, 1);
                    }
                    if (!targetTrackForMove.regions) {
                        targetTrackForMove.regions = [];
                    }
                    targetTrackForMove.regions.push(movedRegionData);

                    const targetTrackElementForMove = getTrackElementById(targetTrackForMove.id);
                    if (targetTrackElementForMove && movedRegionData.element) {
                        const targetTimeline = targetTrackElementForMove.querySelector('.track-timeline');
                        if (targetTimeline) {
                            movedRegionData.element.remove();
                            targetTimeline.appendChild(movedRegionData.element);
                        }
                    }
                }

                movedRegionData.startTime = targetStartTime;
                applyRegionGeometry(movedRegionData);
                applyArrangementChange();
            };

            recordHistoryAction(
                'Move Region',
                () => applyMoveState(oldTrack.id, oldStartTime),
                () => applyMoveState(newTrack.id, finalStartTime)
            );
        }
    }

    removeRegionDragGhost();
}

function startRegionResize(e, direction, regionData, track, trackElement) {
    isDraggingRegion = false;
    isResizingRegion = true;
    selectedRegion = regionData.element;
    selectedRegion.classList.add('selected');
    selectedRegion.style.zIndex = Date.now().toString();

    resizeState = {
        direction,
        regionData,
        track,
        trackElement,
        startX: e.clientX,
        startTime: regionData.startTime,
        duration: regionData.duration,
        startOffset: regionData.startOffset,
        endOffset: regionData.endOffset
    };
}

function handleRegionResize(e) {
    if (!isResizingRegion || !resizeState) return;

    const { direction, regionData } = resizeState;
    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    const deltaX = e.clientX - resizeState.startX;
    const rawDelta = (deltaX / totalWidth) * duration;
    const minDuration = 0.05;

    if (direction === 'left') {
        // Left handle: right edge (endTime, endOffset) stays fixed.
        // Clamp delta so startTime >= 0, startOffset >= 0, duration >= minDuration.
        const endTime = resizeState.startTime + resizeState.duration;
        const maxLeftExtend = Math.min(resizeState.startTime, resizeState.startOffset);
        const maxRightShrink = resizeState.duration - minDuration;
        const clampedDelta = Math.max(-maxLeftExtend, Math.min(maxRightShrink, rawDelta));

        regionData.startTime = resizeState.startTime + clampedDelta;
        regionData.startOffset = resizeState.startOffset + clampedDelta;
        regionData.duration = resizeState.duration - clampedDelta;
        regionData.endOffset = resizeState.endOffset; // Right edge never moves
    } else {
        // Right handle: left edge (startTime, startOffset) stays fixed.
        // Clamp delta so endOffset <= buffer.duration, duration >= minDuration.
        const maxRightExtend = regionData.buffer.duration - resizeState.endOffset;
        const maxLeftShrink = resizeState.duration - minDuration;
        const clampedDelta = Math.max(-maxLeftShrink, Math.min(maxRightExtend, rawDelta));

        regionData.duration = resizeState.duration + clampedDelta;
        regionData.endOffset = resizeState.endOffset + clampedDelta;
    }

    normalizeRegionFadeDurations(regionData);

    const left = (regionData.startTime / duration) * totalWidth;
    const width = (regionData.duration / duration) * totalWidth;
    regionData.element.style.left = `${left}px`;
    regionData.element.style.width = `${Math.max(1, width)}px`;
    regionData.element.dataset.startOffset = regionData.startOffset.toString();
    regionData.element.dataset.endOffset = regionData.endOffset.toString();

    const canvas = regionData.element.querySelector('canvas');
    if (canvas) {
        drawRegionWaveform(canvas, regionData.buffer, regionData.startOffset, regionData.endOffset);
    }

    updateRegionFadeVisuals(regionData);
}

function handleRegionResizeEnd() {
    if (!isResizingRegion || !resizeState) return;

    const { direction, regionData } = resizeState;
    const minDuration = 0.05;

    if (snapEnabled) {
        if (direction === 'left') {
            // Snap the left edge; right edge (endOffset, endTime) stays fixed.
            const endTime = regionData.startTime + regionData.duration;
            const endOffset = regionData.endOffset;
            const snappedStart = snapToGrid(regionData.startTime);
            let delta = snappedStart - regionData.startTime;

            // Clamp: startOffset cannot go below 0
            if (regionData.startOffset + delta < 0) {
                delta = -regionData.startOffset;
            }
            // Clamp: startTime cannot go below 0
            if (regionData.startTime + delta < 0) {
                delta = -regionData.startTime;
            }

            const newStartTime = regionData.startTime + delta;
            const newStartOffset = regionData.startOffset + delta;
            const newDuration = endTime - newStartTime;

            if (newDuration >= minDuration) {
                regionData.startTime = newStartTime;
                regionData.startOffset = newStartOffset;
                regionData.duration = newDuration;
                regionData.endOffset = endOffset; // Stays fixed
            }
        } else {
            // Snap the right edge; left edge stays fixed.
            const endTime = regionData.startTime + regionData.duration;
            const snappedEnd = snapToGrid(endTime);
            let newDuration = Math.max(minDuration, snappedEnd - regionData.startTime);
            const maxDuration = regionData.buffer.duration - regionData.startOffset;
            newDuration = Math.min(newDuration, maxDuration);
            regionData.duration = newDuration;
            regionData.endOffset = regionData.startOffset + newDuration;
        }
    }

    normalizeRegionFadeDurations(regionData);

    const oldState = {
        startTime: resizeState.startTime,
        duration: resizeState.duration,
        startOffset: resizeState.startOffset,
        endOffset: resizeState.endOffset
    };

    const newState = {
        startTime: regionData.startTime,
        duration: regionData.duration,
        startOffset: regionData.startOffset,
        endOffset: regionData.endOffset
    };

    // Update data attributes and visuals after snap
    regionData.element.dataset.startOffset = regionData.startOffset.toString();
    regionData.element.dataset.endOffset = regionData.endOffset.toString();

    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    const left = (regionData.startTime / duration) * totalWidth;
    const width = (regionData.duration / duration) * totalWidth;
    regionData.element.style.left = `${left}px`;
    regionData.element.style.width = `${Math.max(1, width)}px`;

    const canvas = regionData.element.querySelector('canvas');
    if (canvas) {
        drawRegionWaveform(canvas, regionData.buffer, regionData.startOffset, regionData.endOffset);
    }

    updateRegionFadeVisuals(regionData);

    applyArrangementChange();

    const resized =
        Math.abs(oldState.startTime - newState.startTime) > 0.0001 ||
        Math.abs(oldState.duration - newState.duration) > 0.0001 ||
        Math.abs(oldState.startOffset - newState.startOffset) > 0.0001 ||
        Math.abs(oldState.endOffset - newState.endOffset) > 0.0001;

    if (resized) {
        const applyResizeState = (state) => {
            regionData.startTime = state.startTime;
            regionData.duration = state.duration;
            regionData.startOffset = state.startOffset;
            regionData.endOffset = state.endOffset;
            normalizeRegionFadeDurations(regionData);
            applyRegionGeometry(regionData);
            applyArrangementChange();
        };

        recordHistoryAction(
            'Resize Region',
            () => applyResizeState(oldState),
            () => applyResizeState(newState)
        );
    }

    isResizingRegion = false;
    resizeState = null;
}

function splitRegionAtPosition(region, regionData, track, trackElement, e) {
    const rect = region.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const regionWidth = rect.width;
    const splitPoint = (clickX / regionWidth) * regionData.duration;
    
    // Create two new regions
    const firstRegionDuration = splitPoint;
    const secondRegionDuration = regionData.duration - splitPoint;
    
    if (firstRegionDuration < 0.1 || secondRegionDuration < 0.1) {
        return; // Too small to split
    }

    // Calculate fade distributions BEFORE removing the original region
    const originalFadeIn = regionData.fadeInDuration || 0;
    const originalFadeOut = regionData.fadeOutDuration || 0;
    const originalDuration = regionData.duration;
    const fadeOutStart = originalDuration - originalFadeOut;
    
    // Remove original region
    const regionIndex = track.regions.indexOf(regionData);
    if (regionIndex !== -1) {
        track.regions.splice(regionIndex, 1);
    }
    region.remove();
    if (selectedRegion === region) selectedRegion = null;
    
    // Create first region with correct fades pre-calculated
    const firstRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime,
        duration: firstRegionDuration,
        startOffset: regionData.startOffset,
        endOffset: regionData.startOffset + firstRegionDuration,
        fadeInDuration: Math.min(originalFadeIn, firstRegionDuration),
        fadeOutDuration: firstRegionDuration > fadeOutStart
            ? Math.min(firstRegionDuration - fadeOutStart, firstRegionDuration)
            : 0,
        gain: regionData.gain !== undefined ? regionData.gain : 1.0
    };
    
    createRegionFromData(firstRegionData, track, trackElement);
    
    // Create second region with correct fades pre-calculated
    const secondRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime + firstRegionDuration,
        duration: secondRegionDuration,
        startOffset: regionData.startOffset + firstRegionDuration,
        endOffset: regionData.endOffset,
        fadeInDuration: firstRegionDuration < originalFadeIn
            ? Math.min(originalFadeIn - firstRegionDuration, secondRegionDuration)
            : 0,
        fadeOutDuration: Math.min(originalFadeOut, secondRegionDuration),
        gain: regionData.gain !== undefined ? regionData.gain : 1.0
    };
    
    createRegionFromData(secondRegionData, track, trackElement);

    applyArrangementChange();
}

function createRegionFromData(regionData, track, trackElement) {
    const timeline = trackElement.querySelector('.track-timeline');
    
    const region = document.createElement('div');
    region.className = 'audio-region';
    
    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    const left = (regionData.startTime / duration) * totalWidth;
    const width = (regionData.duration / duration) * totalWidth;
    
    region.style.left = `${left}px`;
    region.style.width = `${width}px`;
    
    // Store region offsets as data attributes
    region.dataset.startOffset = regionData.startOffset.toString();
    region.dataset.endOffset = regionData.endOffset.toString();

    if (typeof regionData.fadeInDuration !== 'number') {
        regionData.fadeInDuration = 0;
    }
    if (typeof regionData.fadeOutDuration !== 'number') {
        regionData.fadeOutDuration = 0;
    }
    if (regionData.gain === undefined) {
        regionData.gain = 1.0;
    }
    normalizeRegionFadeDurations(regionData);
    
    const canvas = document.createElement('canvas');
    canvas.className = 'region-waveform';
    canvas.audioBuffer = regionData.buffer; // Store buffer reference on canvas
    region.appendChild(canvas);
    
    setTimeout(() => {
        drawRegionWaveform(canvas, regionData.buffer, regionData.startOffset, regionData.endOffset);
    }, 10);
    
    const leftHandle = document.createElement('div');
    leftHandle.className = 'region-handle left';
    const rightHandle = document.createElement('div');
    rightHandle.className = 'region-handle right';
    region.appendChild(leftHandle);
    region.appendChild(rightHandle);

    addRegionFadeControls(region, regionData);
    addRegionGainControl(region, regionData);
    
    timeline.appendChild(region);
    
    regionData.element = region;

    // Prevent duplicate regions from being stacked
    if (isRegionDuplicate(track, regionData)) {
        console.warn('Blocked duplicate region in createRegionFromData');
        region.remove();
        return;
    }

    track.regions.push(regionData);
    
    setupRegionInteraction(region, regionData, track, trackElement);
}

function drawRegionWaveform(canvas, buffer, startOffset = 0, endOffset = null) {
    const ctx = canvas.getContext('2d');
    
    // Get actual dimensions from parent element
    const width = canvas.parentElement.offsetWidth;
    const height = canvas.parentElement.offsetHeight;
    
    // Set canvas resolution to match display size
    canvas.width = width;
    canvas.height = height;
    
    ctx.clearRect(0, 0, width, height);
    
    const data = buffer.getChannelData(0);
    const actualEndOffset = endOffset || buffer.duration;
    const startSample = Math.floor(startOffset * buffer.sampleRate);
    const endSample = Math.floor(actualEndOffset * buffer.sampleRate);
    const sampleCount = endSample - startSample;
    
    const step = Math.ceil(sampleCount / width);
    const amp = height / 2;
    
    ctx.fillStyle = 'rgba(100, 150, 255, 0.6)';
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.9)';
    
    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        
        for (let j = 0; j < step; j++) {
            const sampleIndex = startSample + (i * step) + j;
            if (sampleIndex < data.length) {
                const datum = data[sampleIndex] || 0;
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
        }
        
        const yMin = (1 + min) * amp;
        const yMax = (1 + max) * amp;
        
        ctx.fillRect(i, yMin, 1, Math.max(1, yMax - yMin));
    }
}

// Duplicate a region
function duplicateRegion(regionData, track, trackElement) {
    // Place the duplicate after the original so it is clearly visible and
    // does not silently stack on top of the source region.
    let duplicateStart = regionData.startTime + regionData.duration;
    if (snapEnabled) {
        duplicateStart = snapToGrid(duplicateStart);
    }
    const newRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: duplicateStart,
        duration: regionData.duration,
        startOffset: regionData.startOffset,
        endOffset: regionData.endOffset,
        fadeInDuration: regionData.fadeInDuration || 0,
        fadeOutDuration: regionData.fadeOutDuration || 0,
        gain: regionData.gain !== undefined ? regionData.gain : 1.0
    };
    createRegionFromData(newRegionData, track, trackElement);
    applyArrangementChange();
    return newRegionData;
}

// Region-specific context menu
function showRegionContextMenu(e, regionData, track, trackElement) {
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    
    const items = [
        { label: 'Split at Click', action: () => splitRegionAtPosition(regionData.element, regionData, track, trackElement, e) },
        { label: 'Duplicate', shortcut: 'Alt+Drag', action: () => duplicateRegion(regionData, track, trackElement) },
        { separator: true },
        { label: 'Delete', shortcut: 'Del', action: () => {
            const regionIndex = track.regions.indexOf(regionData);
            if (regionIndex !== -1) {
                track.regions.splice(regionIndex, 1);
                regionData.element.remove();
                selectedRegion = null;
                applyArrangementChange();
            }
        }},
        { separator: true },
        { label: 'Set Color...', submenu: [
            { label: '🔵 Blue', color: 'rgba(0, 120, 212, 0.6)' },
            { label: '🟢 Green', color: 'rgba(34, 197, 94, 0.6)' },
            { label: '🟠 Orange', color: 'rgba(249, 115, 22, 0.6)' },
            { label: '🟣 Purple', color: 'rgba(168, 85, 247, 0.6)' },
            { label: '🔴 Red', color: 'rgba(239, 68, 68, 0.6)' },
        ]}
    ];
    
    items.forEach(item => {
        if (item.separator) {
            const sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            menu.appendChild(sep);
        } else if (item.submenu) {
            const submenuItem = document.createElement('div');
            submenuItem.className = 'context-menu-item has-submenu';
            submenuItem.innerHTML = `${item.label} <span class="submenu-arrow">▶</span>`;
            
            const submenu = document.createElement('div');
            submenu.className = 'context-submenu';
            item.submenu.forEach(sub => {
                const subItem = document.createElement('div');
                subItem.className = 'context-menu-item';
                subItem.textContent = sub.label;
                subItem.addEventListener('click', () => {
                    regionData.element.style.background = `linear-gradient(180deg, ${sub.color} 0%, ${sub.color.replace('0.6', '0.3')} 100%)`;
                    menu.remove();
                });
                submenu.appendChild(subItem);
            });
            submenuItem.appendChild(submenu);
            menu.appendChild(submenuItem);
        } else {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            menuItem.innerHTML = item.shortcut 
                ? `${item.label} <span class="shortcut">${item.shortcut}</span>`
                : item.label;
            menuItem.addEventListener('click', () => {
                item.action();
                menu.remove();
            });
            menu.appendChild(menuItem);
        }
    });
    
    document.body.appendChild(menu);
    
    // Position adjustment if off-screen
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - menuRect.width - 10}px`;
    }
    if (menuRect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - menuRect.height - 10}px`;
    }
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 10);
}

function showContextMenu(e, track, trackElement) {
    // Remove existing context menu
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    
    const cutItem = document.createElement('div');
    cutItem.className = 'context-menu-item';
    cutItem.textContent = 'Cut at Playhead';
    cutItem.addEventListener('click', () => {
        cutRegionAtPlayhead(track, trackElement);
        menu.remove();
    });
    
    menu.appendChild(cutItem);
    
    // Check if there are overlapping regions for crossfade option
    const overlappingRegions = findOverlappingRegions(track);
    if (overlappingRegions.length > 0) {
        const crossfadeItem = document.createElement('div');
        crossfadeItem.className = 'context-menu-item';
        crossfadeItem.textContent = 'Add Crossfade to Overlapping Regions';
        crossfadeItem.addEventListener('click', () => {
            addCrossfadeToOverlaps(track, trackElement);
            menu.remove();
        });
        menu.appendChild(crossfadeItem);
    }
    
    document.body.appendChild(menu);
    
    // Close menu on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 10);
}

function findOverlappingRegions(track) {
    if (!track.regions || track.regions.length < 2) return [];
    
    const overlaps = [];
    for (let i = 0; i < track.regions.length; i++) {
        for (let j = i + 1; j < track.regions.length; j++) {
            const r1 = track.regions[i];
            const r2 = track.regions[j];
            const r1End = r1.startTime + r1.duration;
            const r2End = r2.startTime + r2.duration;
            
            // Check if they overlap
            if ((r1.startTime < r2End && r1End > r2.startTime)) {
                overlaps.push({ region1: r1, region2: r2 });
            }
        }
    }
    return overlaps;
}

function addCrossfadeToOverlaps(track, trackElement) {
    const overlaps = findOverlappingRegions(track);
    
    overlaps.forEach(({ region1, region2 }) => {
        // Determine which is earlier
        const earlier = region1.startTime < region2.startTime ? region1 : region2;
        const later = region1.startTime < region2.startTime ? region2 : region1;
        
        const overlapStart = later.startTime;
        const overlapEnd = Math.min(earlier.startTime + earlier.duration, later.startTime + later.duration);
        const overlapDuration = overlapEnd - overlapStart;
        
        // Store crossfade info
        if (!earlier.crossfade) earlier.crossfade = {};
        if (!later.crossfade) later.crossfade = {};
        
        earlier.crossfade.fadeOut = {
            start: overlapStart,
            duration: overlapDuration
        };
        
        later.crossfade.fadeIn = {
            start: overlapStart,
            duration: overlapDuration
        };
        
        // Visual indicator
        earlier.element.style.borderColor = 'rgba(255, 200, 0, 0.8)';
        later.element.style.borderColor = 'rgba(255, 200, 0, 0.8)';
    });

    refreshPlaybackIfActive();
    
    alert(`Added crossfade to ${overlaps.length} overlapping region(s)`);
}

// Snap all regions to the grid
function snapAllRegionsToGrid() {
    if (!snapEnabled) return;
    
    // Snap all existing regions to the current grid
    const duration = audioEngine.duration || 60;
    const totalWidth = duration * pixelsPerSecond * zoomLevel;
    
    audioEngine.tracks.forEach(track => {
        if (track.regions && track.regions.length > 0) {
            track.regions.forEach(regionData => {
                // Snap the region's start time
                const snappedTime = snapToGrid(regionData.startTime);
                regionData.startTime = snappedTime;
                
                // Update visual position
                const left = (regionData.startTime / duration) * totalWidth;
                regionData.element.style.left = `${left}px`;
            });
        }
    });

    refreshPlaybackIfActive();
}

function cutRegionAtPlayhead(track, trackElement) {
    const currentTime = audioEngine.getCurrentTime();
    
    if (!track.regions || track.regions.length === 0) return;
    
    // Find region that contains the playhead
    for (let region of track.regions) {
        const regionEnd = region.startTime + region.duration;
        if (currentTime >= region.startTime && currentTime <= regionEnd) {
            const relativeTime = currentTime - region.startTime;
            splitRegionAtTime(region, relativeTime, track, trackElement);
            break;
        }
    }
}

function splitRegionAtTime(regionData, splitTime, track, trackElement) {
    const firstDuration = splitTime;
    const secondDuration = regionData.duration - splitTime;
    
    if (firstDuration < 0.01 || secondDuration < 0.01) {
        return;
    }

    // Calculate fade distributions BEFORE removing or creating anything
    const originalFadeIn = regionData.fadeInDuration || 0;
    const originalFadeOut = regionData.fadeOutDuration || 0;
    const originalDuration = regionData.duration;
    const fadeOutStart = originalDuration - originalFadeOut;
    
    const regionIndex = track.regions.indexOf(regionData);
    if (regionIndex !== -1) {
        track.regions.splice(regionIndex, 1);
    }
    if (selectedRegion === regionData.element) selectedRegion = null;
    regionData.element.remove();
    
    // Create first region with correct fades pre-calculated
    const firstRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime,
        duration: firstDuration,
        startOffset: regionData.startOffset,
        endOffset: regionData.startOffset + firstDuration,
        fadeInDuration: Math.min(originalFadeIn, firstDuration),
        fadeOutDuration: firstDuration > fadeOutStart
            ? Math.min(firstDuration - fadeOutStart, firstDuration)
            : 0,
        gain: regionData.gain !== undefined ? regionData.gain : 1.0
    };
    
    createRegionFromData(firstRegionData, track, trackElement);
    
    // Create second region with correct fades pre-calculated
    const secondRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime + firstDuration,
        duration: secondDuration,
        startOffset: regionData.startOffset + firstDuration,
        endOffset: regionData.endOffset,
        fadeInDuration: firstDuration < originalFadeIn
            ? Math.min(originalFadeIn - firstDuration, secondDuration)
            : 0,
        fadeOutDuration: Math.min(originalFadeOut, secondDuration),
        gain: regionData.gain !== undefined ? regionData.gain : 1.0
    };
    
    createRegionFromData(secondRegionData, track, trackElement);

    applyArrangementChange();
}

function normalizeRegionFadeDurations(regionData) {
    const minRemaining = 0.01;
    const maxTotalFade = Math.max(0, regionData.duration - minRemaining);

    regionData.fadeInDuration = Math.max(0, Math.min(regionData.fadeInDuration || 0, maxTotalFade));
    regionData.fadeOutDuration = Math.max(0, Math.min(regionData.fadeOutDuration || 0, maxTotalFade));

    const totalFade = regionData.fadeInDuration + regionData.fadeOutDuration;
    if (totalFade > maxTotalFade && totalFade > 0) {
        const scale = maxTotalFade / totalFade;
        regionData.fadeInDuration *= scale;
        regionData.fadeOutDuration *= scale;
    }
}

function addRegionGainControl(region, regionData) {
    if (regionData.gain === undefined) regionData.gain = 1.0;

    const baseline = document.createElement('div');
    baseline.className = 'region-gain-baseline';

    const gainLine = document.createElement('div');
    gainLine.className = 'region-gain-line';

    const gainLabel = document.createElement('span');
    gainLabel.className = 'region-gain-label';

    const startAdjust = (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDraggingRegion = false;
        isResizingRegion = false;
        isAdjustingFade = false;
        resizeState = null;
        fadeAdjustState = null;
        isAdjustingRegionGain = true;

        regionGainAdjustState = {
            regionData,
            startY: e.clientY,
            startGain: regionData.gain
        };
    };

    const resetGain = (e) => {
        e.preventDefault();
        e.stopPropagation();
        regionData.gain = 1.0;
        updateRegionGainVisuals(regionData);
    };

    gainLine.addEventListener('mousedown', startAdjust);
    baseline.addEventListener('mousedown', startAdjust);
    gainLine.addEventListener('dblclick', resetGain);
    baseline.addEventListener('dblclick', resetGain);

    region.appendChild(baseline);
    region.appendChild(gainLine);
    region.appendChild(gainLabel);

    updateRegionGainVisuals(regionData);
}

function updateRegionGainVisuals(regionData) {
    if (!regionData?.element) return;

    const baseline = regionData.element.querySelector('.region-gain-baseline');
    const gainLine = regionData.element.querySelector('.region-gain-line');
    const gainLabel = regionData.element.querySelector('.region-gain-label');
    if (!baseline || !gainLine || !gainLabel) return;

    const safeGain = Math.max(0, Math.min(4.0, regionData.gain));
    regionData.gain = safeGain;
    const db = safeGain > 0 ? 20 * Math.log10(safeGain) : -Infinity;

    const minDb = -24;
    const maxDb = 12;
    const clampedDb = db === -Infinity ? minDb : Math.max(minDb, Math.min(maxDb, db));
    const normalized = (clampedDb - minDb) / (maxDb - minDb);
    const topPercent = 100 - (normalized * 100);

    gainLine.style.top = `${topPercent}%`;
    gainLabel.style.top = `calc(${topPercent}% - 16px)`;
    gainLabel.textContent = db === -Infinity ? '-∞ dB' : `${db.toFixed(1)} dB`;
}

function handleRegionGainAdjust(e) {
    if (!isAdjustingRegionGain || !regionGainAdjustState?.regionData) return;

    const { regionData, startY, startGain } = regionGainAdjustState;
    const startDb = startGain > 0 ? 20 * Math.log10(startGain) : -24;
    const deltaDb = (startY - e.clientY) * 0.2;
    const newDb = Math.max(-24, Math.min(12, startDb + deltaDb));
    const newGain = Math.pow(10, newDb / 20);

    regionData.gain = Math.max(0, Math.min(4.0, newGain));
    updateRegionGainVisuals(regionData);

    // Live update gain node without stopping/restarting all playback
    const track = audioEngine.tracks.find(t => t.regions && t.regions.includes(regionData));
    if (track) {
        track.updateLiveRegionGain(regionData);
    }
}

function handleRegionGainAdjustEnd() {
    if (!isAdjustingRegionGain) return;
    isAdjustingRegionGain = false;
    regionGainAdjustState = null;
    scheduleAutoSave();
}

function addRegionFadeControls(region, regionData) {
    const fadeInLine = document.createElement('div');
    fadeInLine.className = 'fade-line fade-in';
    const fadeOutLine = document.createElement('div');
    fadeOutLine.className = 'fade-line fade-out';

    const fadeInHandle = document.createElement('div');
    fadeInHandle.className = 'fade-handle fade-in';
    const fadeOutHandle = document.createElement('div');
    fadeOutHandle.className = 'fade-handle fade-out';

    region.appendChild(fadeInLine);
    region.appendChild(fadeOutLine);
    region.appendChild(fadeInHandle);
    region.appendChild(fadeOutHandle);

    fadeInHandle.addEventListener('mousedown', (e) => startRegionFadeAdjust(e, 'in', regionData));
    fadeOutHandle.addEventListener('mousedown', (e) => startRegionFadeAdjust(e, 'out', regionData));

    updateRegionFadeVisuals(regionData);
}

function updateRegionFadeVisuals(regionData) {
    if (!regionData?.element) return;

    normalizeRegionFadeDurations(regionData);

    const regionWidth = regionData.element.offsetWidth || 1;
    const regionHeight = regionData.element.offsetHeight || 1;
    const fadeInRatio = regionData.duration > 0 ? regionData.fadeInDuration / regionData.duration : 0;
    const fadeOutRatio = regionData.duration > 0 ? regionData.fadeOutDuration / regionData.duration : 0;
    const fadeInPx = Math.max(0, Math.min(regionWidth, fadeInRatio * regionWidth));
    const fadeOutPx = Math.max(0, Math.min(regionWidth, fadeOutRatio * regionWidth));

    const fadeInLine = regionData.element.querySelector('.fade-line.fade-in');
    const fadeOutLine = regionData.element.querySelector('.fade-line.fade-out');
    const fadeInHandle = regionData.element.querySelector('.fade-handle.fade-in');
    const fadeOutHandle = regionData.element.querySelector('.fade-handle.fade-out');

    if (fadeInLine) {
        if (fadeInPx > 0.5) {
            const length = Math.hypot(fadeInPx, regionHeight);
            const angle = -Math.atan2(regionHeight, fadeInPx) * (180 / Math.PI);
            fadeInLine.style.opacity = '1';
            fadeInLine.style.width = `${length}px`;
            fadeInLine.style.left = '0px';
            fadeInLine.style.top = `${regionHeight}px`;
            fadeInLine.style.transform = `rotate(${angle}deg)`;
        } else {
            fadeInLine.style.opacity = '0';
            fadeInLine.style.width = '0px';
        }
    }

    if (fadeOutLine) {
        if (fadeOutPx > 0.5) {
            const length = Math.hypot(fadeOutPx, regionHeight);
            const angle = Math.atan2(regionHeight, fadeOutPx) * (180 / Math.PI);
            fadeOutLine.style.opacity = '1';
            fadeOutLine.style.width = `${length}px`;
            fadeOutLine.style.right = '0px';
            fadeOutLine.style.top = '0px';
            fadeOutLine.style.transform = `rotate(${angle}deg)`;
        } else {
            fadeOutLine.style.opacity = '0';
            fadeOutLine.style.width = '0px';
        }
    }

    if (fadeInHandle) fadeInHandle.style.left = `${Math.max(0, fadeInPx)}px`;
    if (fadeOutHandle) fadeOutHandle.style.right = `${Math.max(0, fadeOutPx)}px`;

    updateRegionGainVisuals(regionData);
}

function startRegionFadeAdjust(e, type, regionData) {
    e.preventDefault();
    e.stopPropagation();

    isDraggingRegion = false;
    isResizingRegion = false;
    resizeState = null;
    isAdjustingFade = true;

    if (selectedRegion && selectedRegion !== regionData.element) {
        selectedRegion.classList.remove('selected');
    }
    selectedRegion = regionData.element;
    selectedRegion.classList.add('selected');

    fadeAdjustState = {
        type,
        regionData,
        startX: e.clientX,
        initialFadeIn: regionData.fadeInDuration || 0,
        initialFadeOut: regionData.fadeOutDuration || 0
    };
}

function handleRegionFadeAdjust(e) {
    if (!isAdjustingFade || !fadeAdjustState?.regionData?.element) return;

    const { type, regionData, startX, initialFadeIn, initialFadeOut } = fadeAdjustState;
    const regionRect = regionData.element.getBoundingClientRect();
    const regionWidth = Math.max(1, regionRect.width);
    const secondsPerPixel = regionData.duration / regionWidth;
    const maxFadeTotal = Math.max(0, regionData.duration - 0.01);

    if (type === 'in') {
        const deltaPixels = e.clientX - startX;
        const proposedFadeIn = initialFadeIn + (deltaPixels * secondsPerPixel);
        regionData.fadeInDuration = Math.max(0, Math.min(proposedFadeIn, maxFadeTotal - (regionData.fadeOutDuration || 0)));
    } else {
        const deltaPixels = startX - e.clientX;
        const proposedFadeOut = initialFadeOut + (deltaPixels * secondsPerPixel);
        regionData.fadeOutDuration = Math.max(0, Math.min(proposedFadeOut, maxFadeTotal - (regionData.fadeInDuration || 0)));
    }

    updateRegionFadeVisuals(regionData);
    refreshPlaybackIfActive();
}

function handleRegionFadeAdjustEnd() {
    if (!isAdjustingFade) return;

    isAdjustingFade = false;
    fadeAdjustState = null;
}

// Track Settings Modal
function openTrackSettings(track, trackElement) {
    currentTrack = track;
    const modal = document.getElementById('trackSettingsModal');
    modal.classList.add('active');
    modal.dataset.trackId = trackElement.dataset.trackId;
    
    // Store reference to track element for updating indicators
    modal.dataset.trackElement = trackElement.dataset.trackId;
    
    // Load current values
    loadTrackSettingsValues(track);
    
    // Setup control listeners
    setupSettingsControls();
    
    // Start gain reduction meter
    startGRMeter();
}

function loadTrackSettingsValues(track) {
    // EQ - 4 bands
    document.querySelector('.eq-freq[data-band="low"]').value = track.eqLow.frequency.value;
    document.querySelector('.eq-gain[data-band="low"]').value = track.eqLow.gain.value;
    document.querySelector('.eq-q[data-band="low"]').value = track.eqLow.Q.value;
    
    document.querySelector('.eq-freq[data-band="lowMid"]').value = track.eqLowMid.frequency.value;
    document.querySelector('.eq-gain[data-band="lowMid"]').value = track.eqLowMid.gain.value;
    document.querySelector('.eq-q[data-band="lowMid"]').value = track.eqLowMid.Q.value;
    
    document.querySelector('.eq-freq[data-band="mid"]').value = track.eqMid.frequency.value;
    document.querySelector('.eq-gain[data-band="mid"]').value = track.eqMid.gain.value;
    document.querySelector('.eq-q[data-band="mid"]').value = track.eqMid.Q.value;
    
    document.querySelector('.eq-freq[data-band="high"]').value = track.eqHigh.frequency.value;
    document.querySelector('.eq-gain[data-band="high"]').value = track.eqHigh.gain.value;
    document.querySelector('.eq-q[data-band="high"]').value = track.eqHigh.Q.value;
    
    // Compression
    document.querySelector('.comp-threshold').value = track.compressor.threshold.value;
    document.querySelector('.comp-knee').value = track.compressor.knee.value;
    document.querySelector('.comp-ratio').value = track.compressor.ratio.value;
    document.querySelector('.comp-attack').value = track.compressor.attack.value;
    document.querySelector('.comp-release').value = track.compressor.release.value;
    
    // Effects
    document.querySelector('.delay-time').value = track.delayNode.delayTime.value;
    document.querySelector('.delay-feedback').value = track.delayFeedback.gain.value;
    document.querySelector('.delay-mix').value = track.delayWet.gain.value;
    document.querySelector('.reverb-mix').value = track.reverbWet.gain.value;

    document.querySelectorAll('.effect-toggle').forEach(btn => {
        const effect = btn.dataset.effect;
        const enabled = track.isEffectEnabled(effect);
        btn.classList.toggle('active', enabled);
        btn.textContent = enabled ? 'Enabled' : 'Enable';
    });
    
    // Update displays
    updateAllSettingsDisplays();
    
    // Update knob visuals
    updateKnobVisuals();
    
    // Draw EQ curve (with slight delay to ensure canvas is ready)
    setTimeout(() => drawEQCurve(), 50);
}

function setupSettingsControls() {
    const modal = document.getElementById('trackSettingsModal');
    if (settingsInitialized) {
        updateEffectIndicators(currentTrack, getCurrentTrackElement());
        updateKnobVisuals();
        return;
    }
    settingsInitialized = true;
    
    // Auto-save when any setting in the modal changes
    modal.addEventListener('input', () => scheduleAutoSave());
    
    // EQ Controls
    setupEQControls(modal);
    
    // Compression Controls (with knobs)
    setupCompressionControls(modal);
    
    // Setup drag-to-rotate knob interaction
    setupKnobInteraction();
    
    // Effects Controls
    setupEffectsControls(modal);

    // Effect on/off toggles
    modal.querySelectorAll('.effect-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!currentTrack) return;
            const effect = btn.dataset.effect;
            const nextState = !currentTrack.isEffectEnabled(effect);
            currentTrack.setEffectEnabled(effect, nextState);
            btn.classList.toggle('active', nextState);
            btn.textContent = nextState ? 'Enabled' : 'Enable';
            updateEffectIndicators(currentTrack, getCurrentTrackElement());
            if (effect === 'eq') drawEQCurve();
            scheduleAutoSave();
        });
    });
    
    // Update indicators initially
    updateEffectIndicators(currentTrack, getCurrentTrackElement());
    updateKnobVisuals();
}

// Update all knob visual rotations and arcs
function updateKnobVisuals() {
    const modal = document.getElementById('trackSettingsModal');
    if (!modal) return;
    
    modal.querySelectorAll('.knob-wrapper').forEach(wrapper => {
        const input = wrapper.querySelector('.knob-input');
        if (input) {
            updateSingleKnobVisual(wrapper, input);
        }
    });
}

// Update a single knob's visual (pointer rotation + conic-gradient arc)
function updateSingleKnobVisual(wrapper, input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const value = parseFloat(input.value);
    const percent = (value - min) / (max - min);
    // Rotate pointer from -135deg to 135deg (270 degree range)
    const rotation = -135 + (percent * 270);
    // Arc angle out of 270deg
    const arcDeg = percent * 270;
    
    const visual = wrapper.querySelector('.knob-visual');
    if (visual) {
        visual.style.setProperty('--knob-rotation', `${rotation}deg`);
        visual.style.setProperty('--knob-arc-deg', `${arcDeg}deg`);
    }
}

// Setup drag-to-rotate knob interaction for all knobs
function setupKnobInteraction() {
    const modal = document.getElementById('trackSettingsModal');
    if (!modal) return;

    // Track active drag state
    let activeKnob = null;
    let startY = 0;
    let startValue = 0;
    let knobMin = 0;
    let knobMax = 1;
    let knobStep = 0.01;
    let isFineMode = false;
    
    const SENSITIVITY = 200; // pixels for full range
    const FINE_MULTIPLIER = 0.15;

    modal.addEventListener('mousedown', (e) => {
        const wrapper = e.target.closest('.knob-wrapper');
        if (!wrapper) return;
        const input = wrapper.querySelector('.knob-input');
        if (!input) return;
        
        e.preventDefault();
        activeKnob = { wrapper, input };
        startY = e.clientY;
        startValue = parseFloat(input.value);
        knobMin = parseFloat(input.min);
        knobMax = parseFloat(input.max);
        knobStep = parseFloat(input.step) || ((knobMax - knobMin) / 200);
        isFineMode = e.shiftKey;
        wrapper.classList.add('active');
        document.body.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (!activeKnob) return;
        e.preventDefault();
        
        isFineMode = e.shiftKey;
        const dy = startY - e.clientY; // up = positive
        const range = knobMax - knobMin;
        const sensitivity = isFineMode ? SENSITIVITY / FINE_MULTIPLIER : SENSITIVITY;
        let newValue = startValue + (dy / sensitivity) * range;
        
        // Snap to step
        newValue = Math.round(newValue / knobStep) * knobStep;
        newValue = Math.max(knobMin, Math.min(knobMax, newValue));
        
        activeKnob.input.value = newValue;
        activeKnob.input.dispatchEvent(new Event('input', { bubbles: true }));
        updateSingleKnobVisual(activeKnob.wrapper, activeKnob.input);
    });

    document.addEventListener('mouseup', () => {
        if (activeKnob) {
            activeKnob.wrapper.classList.remove('active');
            activeKnob = null;
            document.body.style.cursor = '';
        }
    });

    // Scroll wheel support
    modal.addEventListener('wheel', (e) => {
        const wrapper = e.target.closest('.knob-wrapper');
        if (!wrapper) return;
        const input = wrapper.querySelector('.knob-input');
        if (!input) return;
        
        e.preventDefault();
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        const step = parseFloat(input.step) || ((max - min) / 100);
        const range = max - min;
        
        // Scroll up = increase, scroll down = decrease
        const direction = e.deltaY < 0 ? 1 : -1;
        const multiplier = e.shiftKey ? 0.2 : 1;
        const increment = Math.max(step, range / 100) * direction * multiplier;
        
        let newValue = parseFloat(input.value) + increment;
        newValue = Math.round(newValue / step) * step;
        newValue = Math.max(min, Math.min(max, newValue));
        
        input.value = newValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        updateSingleKnobVisual(wrapper, input);
    }, { passive: false });

    // Double-click to reset
    modal.addEventListener('dblclick', (e) => {
        const wrapper = e.target.closest('.knob-wrapper');
        if (!wrapper) return;
        const input = wrapper.querySelector('.knob-input');
        if (!input) return;
        
        const defaultVal = wrapper.dataset.default;
        if (defaultVal !== undefined) {
            input.value = defaultVal;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            updateSingleKnobVisual(wrapper, input);
        }
    });
}

// Gain Reduction Meter
let grMeterAnimationId = null;

function startGRMeter() {
    if (grMeterAnimationId) return;
    
    function updateGRMeter() {
        grMeterAnimationId = requestAnimationFrame(updateGRMeter);
        
        const bar = document.getElementById('grMeterBar');
        const valueDisplay = document.getElementById('grMeterValue');
        if (!bar || !valueDisplay) return;
        
        if (!currentTrack || !currentTrack.compressor || !currentTrack.isEffectEnabled('compressor')) {
            bar.style.width = '0%';
            valueDisplay.textContent = '0 dB';
            return;
        }
        
        // DynamicsCompressorNode.reduction is negative dB (e.g., -6 means 6dB reduction)
        const reduction = currentTrack.compressor.reduction;
        const absReduction = Math.abs(reduction);
        
        // Map 0..24 dB range to 0..100%
        const percent = Math.min(100, (absReduction / 24) * 100);
        bar.style.width = `${percent}%`;
        
        // Color the value text based on amount
        if (absReduction > 12) {
            valueDisplay.style.color = 'var(--orange)';
        } else if (absReduction > 3) {
            valueDisplay.style.color = 'var(--yellow)';
        } else {
            valueDisplay.style.color = 'var(--green)';
        }
        
        valueDisplay.textContent = reduction < -0.1 ? `${reduction.toFixed(1)} dB` : '0 dB';
    }
    
    updateGRMeter();
}

function stopGRMeter() {
    if (grMeterAnimationId) {
        cancelAnimationFrame(grMeterAnimationId);
        grMeterAnimationId = null;
    }
}

function setupEQControls(modal) {
    const bands = ['low', 'lowMid', 'mid', 'high'];
    const nodeKeys = { low: 'eqLow', lowMid: 'eqLowMid', mid: 'eqMid', high: 'eqHigh' };
    
    bands.forEach(band => {
        const freqSlider = modal.querySelector(`.eq-freq[data-band="${band}"]`);
        const gainSlider = modal.querySelector(`.eq-gain[data-band="${band}"]`);
        const qSlider = modal.querySelector(`.eq-q[data-band="${band}"]`);
        
        if (!freqSlider || !gainSlider || !qSlider) return;
        
        freqSlider.addEventListener('input', (e) => {
            if (!currentTrack) return;
            currentTrack[nodeKeys[band]].frequency.value = parseFloat(e.target.value);
            const freqValue = modal.querySelector(`.eq-band[data-band="${band}"] .eq-freq-value`);
            if (freqValue) {
                const freq = parseFloat(e.target.value);
                freqValue.textContent = freq >= 1000 ? (freq/1000).toFixed(1) + ' kHz' : freq.toFixed(0) + ' Hz';
            }
            updateEffectIndicators(currentTrack, getCurrentTrackElement());
            drawEQCurve();
        });
        
        gainSlider.addEventListener('input', (e) => {
            if (!currentTrack) return;
            currentTrack[nodeKeys[band]].gain.value = parseFloat(e.target.value);
            const gainValue = modal.querySelector(`.eq-band[data-band="${band}"] .eq-gain-value`);
            if (gainValue) {
                gainValue.textContent = parseFloat(e.target.value).toFixed(1) + ' dB';
            }
            updateEffectIndicators(currentTrack, getCurrentTrackElement());
            drawEQCurve();
        });
        
        qSlider.addEventListener('input', (e) => {
            if (!currentTrack) return;
            currentTrack[nodeKeys[band]].Q.value = parseFloat(e.target.value);
            const qValue = modal.querySelector(`.eq-band[data-band="${band}"] .eq-q-value`);
            if (qValue) {
                qValue.textContent = parseFloat(e.target.value).toFixed(1);
            }
            drawEQCurve();
        });
    });
}

// Draw EQ frequency response curve
function drawEQCurve() {
    const canvas = document.getElementById('eqCanvas');
    if (!canvas || !currentTrack) return;
    
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width || 600;
    canvas.height = rect.height || 200;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear
    ctx.clearRect(0, 0, width, height);
    
    // Draw background grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    
    // Vertical grid lines (frequency markers)
    const freqMarkers = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    freqMarkers.forEach(freq => {
        const x = freqToX(freq, width);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    });
    
    // Horizontal grid lines (dB markers)
    const dbMarkers = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '10px sans-serif';
    dbMarkers.forEach(db => {
        const y = dbToY(db, height);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        if (db === 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        }
    });
    
    // Calculate combined frequency response
    const numPoints = width;
    const response = new Array(numPoints);
    
    for (let i = 0; i < numPoints; i++) {
        const freq = xToFreq(i, width);
        let totalGain = 0;
        
        // Add contribution from each EQ band
        totalGain += calculateBandResponse(currentTrack.eqLow, freq);
        totalGain += calculateBandResponse(currentTrack.eqLowMid, freq);
        totalGain += calculateBandResponse(currentTrack.eqMid, freq);
        totalGain += calculateBandResponse(currentTrack.eqHigh, freq);
        
        response[i] = totalGain;
    }
    
    // Draw filled area under curve
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
    gradient.addColorStop(0.5, 'rgba(0, 212, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 212, 255, 0.05)');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, dbToY(0, height));
    
    for (let i = 0; i < numPoints; i++) {
        const y = dbToY(response[i], height);
        if (i === 0) {
            ctx.lineTo(i, y);
        } else {
            ctx.lineTo(i, y);
        }
    }
    
    ctx.lineTo(width, dbToY(0, height));
    ctx.closePath();
    ctx.fill();
    
    // Draw curve line
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < numPoints; i++) {
        const y = dbToY(response[i], height);
        if (i === 0) {
            ctx.moveTo(i, y);
        } else {
            ctx.lineTo(i, y);
        }
    }
    ctx.stroke();
    
    // Draw band points
    const bandColors = {
        low: '#ff6b6b',
        lowMid: '#4ecdc4',
        mid: '#ffa726',
        high: '#ab47bc'
    };
    
    const bands = [
        { node: currentTrack.eqLow, name: 'low' },
        { node: currentTrack.eqLowMid, name: 'lowMid' },
        { node: currentTrack.eqMid, name: 'mid' },
        { node: currentTrack.eqHigh, name: 'high' }
    ];
    
    bands.forEach(({ node, name }) => {
        const freq = node.frequency.value;
        const gain = node.gain.value;
        const x = freqToX(freq, width);
        const y = dbToY(gain, height);
        
        // Draw point
        ctx.fillStyle = bandColors[name];
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw outer ring
        ctx.strokeStyle = bandColors[name];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.stroke();
    });
}

// Helper functions for EQ visualization
function freqToX(freq, width) {
    const minFreq = 20;
    const maxFreq = 20000;
    return (Math.log10(freq / minFreq) / Math.log10(maxFreq / minFreq)) * width;
}

function xToFreq(x, width) {
    const minFreq = 20;
    const maxFreq = 20000;
    return minFreq * Math.pow(maxFreq / minFreq, x / width);
}

function dbToY(db, height) {
    const maxDb = 24;
    const minDb = -24;
    return ((maxDb - db) / (maxDb - minDb)) * height;
}

function calculateBandResponse(filter, freq) {
    const centerFreq = filter.frequency.value;
    const gain = filter.gain.value;
    const Q = filter.Q.value;
    const type = filter.type;
    
    if (gain === 0) return 0;
    
    const ratio = freq / centerFreq;
    
    if (type === 'lowshelf') {
        // Low shelf: full gain below frequency, tapers off above
        if (freq <= centerFreq) {
            return gain;
        } else {
            // Smooth rolloff above the shelf frequency
            const octaves = Math.log2(freq / centerFreq);
            return gain * Math.exp(-octaves * octaves * 2);
        }
    } else if (type === 'highshelf') {
        // High shelf: full gain above frequency, tapers off below
        if (freq >= centerFreq) {
            return gain;
        } else {
            // Smooth rolloff below the shelf frequency
            const octaves = Math.log2(centerFreq / freq);
            return gain * Math.exp(-octaves * octaves * 2);
        }
    } else {
        // Peaking filter - bell curve
        const bandwidth = 1 / Q;
        const logRatio = Math.log2(ratio);
        return gain * Math.exp(-Math.pow(logRatio / bandwidth, 2) * 2);
    }
}

function setupCompressionControls(modal) {
    const thresholdSlider = modal.querySelector('.comp-threshold');
    const kneeSlider = modal.querySelector('.comp-knee');
    const ratioSlider = modal.querySelector('.comp-ratio');
    const attackSlider = modal.querySelector('.comp-attack');
    const releaseSlider = modal.querySelector('.comp-release');
    const makeupSlider = modal.querySelector('.comp-makeup');
    
    // Helper to update knob visual
    const updateKnob = (input) => {
        const wrapper = input.closest('.knob-wrapper');
        if (!wrapper) return;
        updateSingleKnobVisual(wrapper, input);
    };
    
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', (e) => {
            if (!currentTrack) return;
            currentTrack.compressor.threshold.value = parseFloat(e.target.value);
            const valueSpan = modal.querySelector('.comp-threshold-value');
            if (valueSpan) valueSpan.textContent = parseFloat(e.target.value).toFixed(0) + ' dB';
            updateKnob(e.target);
            updateEffectIndicators(currentTrack, getCurrentTrackElement());
        });
    }
    
    if (kneeSlider) {
        kneeSlider.addEventListener('input', (e) => {
            if (!currentTrack) return;
            currentTrack.compressor.knee.value = parseFloat(e.target.value);
            const valueSpan = modal.querySelector('.comp-knee-value');
            if (valueSpan) valueSpan.textContent = parseFloat(e.target.value).toFixed(0) + ' dB';
            updateKnob(e.target);
        });
    }
    
    if (ratioSlider) {
        ratioSlider.addEventListener('input', (e) => {
            if (!currentTrack) return;
            currentTrack.compressor.ratio.value = parseFloat(e.target.value);
            const valueSpan = modal.querySelector('.comp-ratio-value');
            if (valueSpan) valueSpan.textContent = parseFloat(e.target.value).toFixed(1) + ':1';
            updateKnob(e.target);
            updateEffectIndicators(currentTrack, getCurrentTrackElement());
        });
    }
    
    if (attackSlider) {
        attackSlider.addEventListener('input', (e) => {
            if (!currentTrack) return;
            currentTrack.compressor.attack.value = parseFloat(e.target.value);
            const valueSpan = modal.querySelector('.comp-attack-value');
            if (valueSpan) valueSpan.textContent = (parseFloat(e.target.value) * 1000).toFixed(0) + ' ms';
            updateKnob(e.target);
        });
    }
    
    if (releaseSlider) {
        releaseSlider.addEventListener('input', (e) => {
            if (!currentTrack) return;
            currentTrack.compressor.release.value = parseFloat(e.target.value);
            const valueSpan = modal.querySelector('.comp-release-value');
            if (valueSpan) valueSpan.textContent = (parseFloat(e.target.value) * 1000).toFixed(0) + ' ms';
            updateKnob(e.target);
        });
    }
    
    if (makeupSlider) {
        makeupSlider.addEventListener('input', (e) => {
            // Note: DynamicsCompressor doesn't have makeup gain, we'd need to add a post-compressor gain node
            const valueSpan = modal.querySelector('.comp-makeup-value');
            if (valueSpan) valueSpan.textContent = parseFloat(e.target.value).toFixed(1) + ' dB';
            updateKnob(e.target);
        });
    }
}

function setupEffectsControls(modal) {
    const delayTimeSlider = modal.querySelector('.delay-time');
    const delayFeedbackSlider = modal.querySelector('.delay-feedback');
    const delayMixSlider = modal.querySelector('.delay-mix');
    const reverbDecaySlider = modal.querySelector('.reverb-decay');
    const reverbMixSlider = modal.querySelector('.reverb-mix');
    
    delayTimeSlider.addEventListener('input', (e) => {
        if (!currentTrack) return;
        currentTrack.delayNode.delayTime.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 1000).toFixed(0) + ' ms';
    });
    
    delayFeedbackSlider.addEventListener('input', (e) => {
        if (!currentTrack) return;
        currentTrack.delayFeedback.gain.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 100).toFixed(0) + '%';
    });
    
    delayMixSlider.addEventListener('input', (e) => {
        if (!currentTrack) return;
        currentTrack.delayWet.gain.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 100).toFixed(0) + '%';
        updateEffectIndicators(currentTrack, getCurrentTrackElement());
    });
    
    reverbDecaySlider.addEventListener('input', (e) => {
        const decay = parseFloat(e.target.value);
        if (!currentTrack) return;
        currentTrack.createReverbImpulse(decay);
        e.target.nextElementSibling.textContent = decay.toFixed(1) + ' s';
    });
    
    reverbMixSlider.addEventListener('input', (e) => {
        if (!currentTrack) return;
        currentTrack.reverbWet.gain.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 100).toFixed(0) + '%';
        updateEffectIndicators(currentTrack, getCurrentTrackElement());
    });
}

function setupAutomationControls(modal) {
    const addPointBtn = modal.querySelector('.add-automation-point');
    const paramSelect = modal.querySelector('.automation-param');
    
    addPointBtn.addEventListener('click', () => {
        if (!currentTrack) return;
        const param = paramSelect.value;
        const time = audioEngine.getCurrentTime();
        let value;
        
        switch (param) {
            case 'volume':
                value = currentTrack.gainNode.gain.value;
                break;
            case 'delay':
                value = currentTrack.delayWet.gain.value;
                break;
            case 'reverb':
                value = currentTrack.reverbWet.gain.value;
                break;
        }
        
        currentTrack.addAutomationPoint(param, time, value);
        updateAutomationList(currentTrack, modal);
    });
    
    paramSelect.addEventListener('change', () => {
        updateAutomationList(currentTrack, modal);
    });
    
    updateAutomationList(currentTrack, modal);
}

function updateAutomationList(track, modal) {
    const list = modal.querySelector('.automation-list');
    const paramSelect = modal.querySelector('.automation-param');
    const param = paramSelect.value;
    
    list.innerHTML = '';
    
    if (track && track.automation[param]) {
        track.automation[param].forEach((point, index) => {
            const div = document.createElement('div');
            div.className = 'automation-point';
            div.innerHTML = `
                <span>${formatTime(point.time)} - ${point.value.toFixed(2)}</span>
                <button data-index="${index}">Remove</button>
            `;
            
            const removeBtn = div.querySelector('button');
            removeBtn.addEventListener('click', () => {
                track.removeAutomationPoint(param, index);
                updateAutomationList(track, modal);
            });
            
            list.appendChild(div);
        });
    }
}

function updateAllSettingsDisplays() {
    // Update all value displays
    document.querySelectorAll('.eq-freq').forEach(el => {
        el.nextElementSibling.textContent = parseFloat(el.value).toFixed(0) + ' Hz';
    });
    
    document.querySelectorAll('.eq-gain').forEach(el => {
        el.nextElementSibling.textContent = parseFloat(el.value).toFixed(1) + ' dB';
    });
    
    document.querySelectorAll('.eq-q').forEach(el => {
        el.nextElementSibling.textContent = parseFloat(el.value).toFixed(1);
    });
    
    const compThresholdVal = document.querySelector('.comp-threshold-value');
    const compThreshold = document.querySelector('.comp-threshold');
    if (compThresholdVal) compThresholdVal.textContent = parseFloat(compThreshold.value).toFixed(0) + ' dB';
    
    const compKneeVal = document.querySelector('.comp-knee-value');
    const compKnee = document.querySelector('.comp-knee');
    if (compKneeVal) compKneeVal.textContent = parseFloat(compKnee.value).toFixed(0) + ' dB';
    
    const compRatioVal = document.querySelector('.comp-ratio-value');
    const compRatio = document.querySelector('.comp-ratio');
    if (compRatioVal) compRatioVal.textContent = parseFloat(compRatio.value).toFixed(1) + ':1';
    
    const compAttackVal = document.querySelector('.comp-attack-value');
    const compAttack = document.querySelector('.comp-attack');
    if (compAttackVal) compAttackVal.textContent = (parseFloat(compAttack.value) * 1000).toFixed(0) + ' ms';
    
    const compReleaseVal = document.querySelector('.comp-release-value');
    const compRelease = document.querySelector('.comp-release');
    if (compReleaseVal) compReleaseVal.textContent = (parseFloat(compRelease.value) * 1000).toFixed(0) + ' ms';
    
    const delayTime = document.querySelector('.delay-time');
    delayTime.nextElementSibling.textContent = (parseFloat(delayTime.value) * 1000).toFixed(0) + ' ms';
    
    const delayFeedback = document.querySelector('.delay-feedback');
    delayFeedback.nextElementSibling.textContent = (parseFloat(delayFeedback.value) * 100).toFixed(0) + '%';
    
    const delayMix = document.querySelector('.delay-mix');
    delayMix.nextElementSibling.textContent = (parseFloat(delayMix.value) * 100).toFixed(0) + '%';
    
    const reverbDecay = document.querySelector('.reverb-decay');
    reverbDecay.nextElementSibling.textContent = parseFloat(reverbDecay.value).toFixed(1) + ' s';
    
    const reverbMix = document.querySelector('.reverb-mix');
    reverbMix.nextElementSibling.textContent = (parseFloat(reverbMix.value) * 100).toFixed(0) + '%';
}

function switchTab(tabName) {
    // Switch active tab button
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });
    
    // Switch active content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabName}-tab`) {
            content.classList.add('active');
        }
    });
}

function updateEffectIndicators(track, trackElement) {
    if (!track || !trackElement) return;
    const indicatorsContainer = trackElement.querySelector('.effect-indicators');
    const settingsBtn = trackElement.querySelector('.settings-btn');
    indicatorsContainer.innerHTML = '';
    
    let hasActiveEffects = false;
    
    // Check EQ
    if (track.isEffectEnabled('eq')) {
        const indicator = document.createElement('span');
        indicator.className = 'effect-indicator';
        indicator.textContent = 'EQ';
        indicatorsContainer.appendChild(indicator);
        hasActiveEffects = true;
    }
    
    // Check Compression
    if (track.isEffectEnabled('compressor')) {
        const indicator = document.createElement('span');
        indicator.className = 'effect-indicator';
        indicator.textContent = 'COMP';
        indicatorsContainer.appendChild(indicator);
        hasActiveEffects = true;
    }
    
    // Check Delay
    if (track.isEffectEnabled('delay')) {
        const indicator = document.createElement('span');
        indicator.className = 'effect-indicator';
        indicator.textContent = 'DELAY';
        indicatorsContainer.appendChild(indicator);
        hasActiveEffects = true;
    }
    
    // Check Reverb
    if (track.isEffectEnabled('reverb')) {
        const indicator = document.createElement('span');
        indicator.className = 'effect-indicator';
        indicator.textContent = 'REVERB';
        indicatorsContainer.appendChild(indicator);
        hasActiveEffects = true;
    }
    
    // Update button appearance
    if (hasActiveEffects) {
        settingsBtn.classList.add('has-effects');
    } else {
        settingsBtn.classList.remove('has-effects');
    }
}

function getCurrentTrackElement() {
    const modal = document.getElementById('trackSettingsModal');
    const trackId = modal.dataset.trackId;
    if (!trackId) return null;
    return document.querySelector(`.track[data-track-id="${trackId}"]`);
}

function updateTrackControlsWidthVar() {
    const width = getTrackControlsWidth();
    document.documentElement.style.setProperty('--track-controls-width', `${width}px`);
}

// Track Selection
function selectTrack(trackElement) {
    // Deselect previous
    if (selectedTrack) {
        selectedTrack.classList.remove('selected');
        selectedTrack.classList.remove('track-selected');
    }
    selectedTrack = trackElement;
    trackElement.classList.add('selected');
    trackElement.classList.add('track-selected');
}

// Metering
function startMetering() {
    const meterL = document.getElementById('masterMeterL');
    const meterR = document.getElementById('masterMeterR');
    const dataArray = new Uint8Array(audioEngine.analyser.frequencyBinCount);
    
    let clipTimeoutL = null;
    let clipTimeoutR = null;
    
    function updateMeters() {
        audioEngine.analyser.getByteTimeDomainData(dataArray);
        
        let maxL = 0;
        let maxR = 0;
        const halfLength = dataArray.length / 2;
        
        // Use peak detection instead of average for more accurate metering
        for (let i = 0; i < halfLength; i++) {
            const sample = Math.abs((dataArray[i] - 128) / 128);
            if (sample > maxL) maxL = sample;
        }
        for (let i = halfLength; i < dataArray.length; i++) {
            const sample = Math.abs((dataArray[i] - 128) / 128);
            if (sample > maxR) maxR = sample;
        }
        
        // Clipping detection (above 95%)
        const meterContainerL = meterL.parentElement;
        const meterContainerR = meterR.parentElement;
        
        if (maxL > 0.95) {
            meterL.classList.add('clipping');
            meterContainerL.classList.add('clipping');
            clearTimeout(clipTimeoutL);
            clipTimeoutL = setTimeout(() => {
                meterL.classList.remove('clipping');
                meterContainerL.classList.remove('clipping');
            }, 1000);
        }
        
        if (maxR > 0.95) {
            meterR.classList.add('clipping');
            meterContainerR.classList.add('clipping');
            clearTimeout(clipTimeoutR);
            clipTimeoutR = setTimeout(() => {
                meterR.classList.remove('clipping');
                meterContainerR.classList.remove('clipping');
            }, 1000);
        }
        
        // Smooth meter falloff
        const currentHeightL = parseFloat(meterL.style.height) || 0;
        const currentHeightR = parseFloat(meterR.style.height) || 0;
        const targetL = Math.min(maxL * 100, 100);
        const targetR = Math.min(maxR * 100, 100);
        
        // Fast attack, slow release
        const newHeightL = targetL > currentHeightL ? targetL : currentHeightL * 0.92;
        const newHeightR = targetR > currentHeightR ? targetR : currentHeightR * 0.92;
        
        meterL.style.height = `${newHeightL}%`;
        meterR.style.height = `${newHeightR}%`;
        
        // Update play button state
        updatePlayPauseButton();
        
        // Handle loop playback
        if (loopEnabled && audioEngine.isPlaying) {
            const currentTime = audioEngine.getCurrentTime();
            if (currentTime >= loopEnd) {
                audioEngine.seek(loopStart);
            }
        }
        
        // Update per-track meters (simplified - uses master signal divided by track count)
        const avgLevel = (maxL + maxR) / 2;
        document.querySelectorAll('.track-meter-bar').forEach(meterBar => {
            const currentWidth = parseFloat(meterBar.style.width) || 0;
            const targetWidth = audioEngine.isPlaying ? Math.min(avgLevel * 100, 100) : 0;
            const newWidth = targetWidth > currentWidth ? targetWidth : currentWidth * 0.9;
            meterBar.style.width = `${newWidth}%`;
        });
        
        requestAnimationFrame(updateMeters);
    }
    
    updateMeters();
}

// Export
async function exportProject() {
    const exportBtn = document.getElementById('exportBtn');
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';
    
    try {
        audioEngine.updateDuration();
        const blob = await audioEngine.exportAudio();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audio-studio-export-${Date.now()}.wav`;
        a.click();
        URL.revokeObjectURL(url);
        
        alert('Project exported successfully!');
    } catch (error) {
        console.error('Export error:', error);
        alert('Error exporting project: ' + error.message);
    } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = 'Export Project';
    }
}

// ============================================
// Project Save/Load System
// ============================================
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
}

function scheduleAutoSave() {
    if (isLoadingProject) return;
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        saveProjectToIndexedDB().catch(err => console.warn('Auto-save failed:', err));
    }, 2000);
}

function getTrackVolumeFromUI(trackId) {
    const el = document.querySelector(`.track[data-track-id="${trackId}"] .track-volume`);
    return el ? parseFloat(el.value) : 0.8;
}

function serializeProject() {
    // Clean up any duplicate regions before serialising so they are
    // never persisted to auto-save or project files.
    audioEngine.tracks.forEach(deduplicateTrackRegions);

    return {
        version: 1,
        settings: {
            bpm,
            snapEnabled,
            snapValue,
            zoomLevel,
            masterVolume: audioEngine.masterGain.gain.value,
            loopEnabled,
            loopStart,
            loopEnd,
            trackCounter
        },
        tracks: audioEngine.tracks.map(track => ({
            id: track.id,
            name: track.name,
            volume: getTrackVolumeFromUI(track.id),
            pan: track.panNode.pan.value,
            isMuted: track.isMuted,
            isSoloed: track.isSoloed,
            effectStates: { ...track.effectStates },
            eq: {
                low: { frequency: track.eqLow.frequency.value, gain: track.eqLow.gain.value, Q: track.eqLow.Q.value },
                lowMid: { frequency: track.eqLowMid.frequency.value, gain: track.eqLowMid.gain.value, Q: track.eqLowMid.Q.value },
                mid: { frequency: track.eqMid.frequency.value, gain: track.eqMid.gain.value, Q: track.eqMid.Q.value },
                high: { frequency: track.eqHigh.frequency.value, gain: track.eqHigh.gain.value, Q: track.eqHigh.Q.value }
            },
            compressor: {
                threshold: track.compressor.threshold.value,
                knee: track.compressor.knee.value,
                ratio: track.compressor.ratio.value,
                attack: track.compressor.attack.value,
                release: track.compressor.release.value
            },
            delay: {
                time: track.delayNode.delayTime.value,
                feedback: track.delayFeedback.gain.value,
                wet: track.delayWet.gain.value
            },
            reverb: {
                wet: track.reverbWet.gain.value
            },
            automation: JSON.parse(JSON.stringify(track.automation)),
            regions: track.regions.map((r, i) => ({
                bufferId: `${track.id}_region_${i}`,
                startTime: r.startTime,
                duration: r.duration,
                startOffset: r.startOffset,
                endOffset: r.endOffset,
                fadeInDuration: r.fadeInDuration || 0,
                fadeOutDuration: r.fadeOutDuration || 0,
                gain: r.gain !== undefined ? r.gain : 1.0,
                name: r.name || '',
                crossfade: r.crossfade ? JSON.parse(JSON.stringify(r.crossfade)) : null
            }))
        }))
    };
}

function serializeAudioBuffers() {
    const audioBuffers = {};
    audioEngine.tracks.forEach(track => {
        track.regions.forEach((r, i) => {
            if (r.buffer) {
                const bufferId = `${track.id}_region_${i}`;
                const channels = [];
                for (let ch = 0; ch < r.buffer.numberOfChannels; ch++) {
                    channels.push(new Float32Array(r.buffer.getChannelData(ch)));
                }
                audioBuffers[bufferId] = {
                    channels,
                    sampleRate: r.buffer.sampleRate,
                    numberOfChannels: r.buffer.numberOfChannels,
                    length: r.buffer.length
                };
            }
        });
    });
    return audioBuffers;
}

async function saveProjectToIndexedDB() {
    try {
        const projectData = serializeProject();
        const audioBuffers = serializeAudioBuffers();

        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ projectData, audioBuffers }, 'autosave');
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
        console.log('Project auto-saved');
    } catch (err) {
        console.warn('Failed to auto-save:', err);
    }
}

async function loadProjectFromIndexedDB() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get('autosave');

        const saved = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        db.close();

        if (!saved || !saved.projectData || !saved.projectData.tracks || saved.projectData.tracks.length === 0) {
            return false;
        }

        await restoreProject(saved.projectData, saved.audioBuffers || {});
        showNotification('Project restored from auto-save');
        return true;
    } catch (err) {
        console.warn('Failed to load project from IndexedDB:', err);
        return false;
    }
}

async function restoreProject(projectData, audioBuffers) {
    isLoadingProject = true;
    try {
        // Stop playback
        if (audioEngine.isPlaying) {
            audioEngine.stop();
        }

        // Clear existing tracks
        audioEngine.tracks.forEach(t => t.dispose());
        audioEngine.tracks = [];
        document.getElementById('tracksContainer').innerHTML = '';
        selectedTrack = null;
        selectedRegion = null;
        trackCounter = 0;

        // Restore global settings
        bpm = projectData.settings.bpm || 120;
        snapEnabled = projectData.settings.snapEnabled !== undefined ? projectData.settings.snapEnabled : true;
        snapValue = projectData.settings.snapValue || 0.25;
        zoomLevel = projectData.settings.zoomLevel || 1.0;
        audioEngine.masterGain.gain.value = projectData.settings.masterVolume !== undefined ? projectData.settings.masterVolume : 0.8;
        loopEnabled = projectData.settings.loopEnabled || false;
        loopStart = projectData.settings.loopStart || 0;
        loopEnd = projectData.settings.loopEnd || 10;
        trackCounter = projectData.settings.trackCounter || 0;

        // Update UI for global settings
        document.getElementById('bpmInput').value = bpm;
        document.getElementById('snapEnabled').checked = snapEnabled;
        document.getElementById('snapValue').value = snapValue;
        const masterVolumeSlider = document.getElementById('masterVolume');
        masterVolumeSlider.value = projectData.settings.masterVolume;
        updateSliderFill(masterVolumeSlider, projectData.settings.masterVolume * 100);
        const masterDb = projectData.settings.masterVolume > 0 ? 20 * Math.log10(projectData.settings.masterVolume) : -Infinity;
        document.getElementById('masterVolumeValue').textContent = masterDb === -Infinity ? '-∞ dB' : masterDb.toFixed(1) + ' dB';

        const loopBtn = document.getElementById('loopBtn');
        loopBtn.classList.toggle('loop-active', loopEnabled);

        // Recreate tracks
        for (const trackData of projectData.tracks) {
            createTrack({ id: trackData.id, name: trackData.name });

            const track = audioEngine.tracks.find(t => t.id === trackData.id);
            const trackElement = document.querySelector(`.track[data-track-id="${trackData.id}"]`);
            if (!track || !trackElement) continue;

            // Restore volume
            const volumeSlider = trackElement.querySelector('.track-volume');
            const vol = trackData.volume !== undefined ? trackData.volume : 0.8;
            volumeSlider.value = vol;
            updateSliderFill(volumeSlider, vol * 100);
            const volumeDb = vol > 0 ? 20 * Math.log10(vol) : -Infinity;
            trackElement.querySelector('.volume-value').textContent = volumeDb === -Infinity ? '-∞ dB' : volumeDb.toFixed(1) + ' dB';

            // Restore pan
            track.panNode.pan.value = trackData.pan || 0;
            const panSlider = trackElement.querySelector('.track-pan');
            panSlider.value = trackData.pan || 0;
            const panValueEl = trackElement.querySelector('.pan-value');
            if (trackData.pan < -0.1) panValueEl.textContent = `L${Math.abs(trackData.pan * 100).toFixed(0)}`;
            else if (trackData.pan > 0.1) panValueEl.textContent = `R${(trackData.pan * 100).toFixed(0)}`;
            else panValueEl.textContent = 'C';

            // Restore mute/solo
            track.isMuted = !!trackData.isMuted;
            track.isSoloed = !!trackData.isSoloed;
            if (track.isMuted) trackElement.querySelector('.mute-btn').classList.add('active');
            if (track.isSoloed) trackElement.querySelector('.solo-btn').classList.add('active');

            // Restore EQ
            if (trackData.eq) {
                track.eqLow.frequency.value = trackData.eq.low.frequency;
                track.eqLow.gain.value = trackData.eq.low.gain;
                track.eqLow.Q.value = trackData.eq.low.Q;
                track.eqLowMid.frequency.value = trackData.eq.lowMid.frequency;
                track.eqLowMid.gain.value = trackData.eq.lowMid.gain;
                track.eqLowMid.Q.value = trackData.eq.lowMid.Q;
                track.eqMid.frequency.value = trackData.eq.mid.frequency;
                track.eqMid.gain.value = trackData.eq.mid.gain;
                track.eqMid.Q.value = trackData.eq.mid.Q;
                track.eqHigh.frequency.value = trackData.eq.high.frequency;
                track.eqHigh.gain.value = trackData.eq.high.gain;
                track.eqHigh.Q.value = trackData.eq.high.Q;
            }

            // Restore compressor
            if (trackData.compressor) {
                track.compressor.threshold.value = trackData.compressor.threshold;
                track.compressor.knee.value = trackData.compressor.knee;
                track.compressor.ratio.value = trackData.compressor.ratio;
                track.compressor.attack.value = trackData.compressor.attack;
                track.compressor.release.value = trackData.compressor.release;
            }

            // Restore delay
            if (trackData.delay) {
                track.delayNode.delayTime.value = trackData.delay.time;
                track.delayFeedback.gain.value = trackData.delay.feedback;
                track.delayWet.gain.value = trackData.delay.wet;
            }

            // Restore reverb
            if (trackData.reverb) {
                track.reverbWet.gain.value = trackData.reverb.wet;
            }

            // Restore effect states
            if (trackData.effectStates) {
                Object.keys(trackData.effectStates).forEach(effect => {
                    track.setEffectEnabled(effect, trackData.effectStates[effect]);
                });
            }

            // Restore automation
            if (trackData.automation) {
                track.automation = trackData.automation;
            }

            // Restore regions
            if (trackData.regions) {
                for (const regionInfo of trackData.regions) {
                    const bufferData = audioBuffers[regionInfo.bufferId];
                    if (bufferData) {
                        const audioBuffer = audioEngine.audioContext.createBuffer(
                            bufferData.numberOfChannels,
                            bufferData.length,
                            bufferData.sampleRate
                        );
                        for (let ch = 0; ch < bufferData.numberOfChannels; ch++) {
                            audioBuffer.copyToChannel(new Float32Array(bufferData.channels[ch]), ch);
                        }

                        track.buffer = audioBuffer; // ensure track has a buffer reference
                        trackElement.classList.add('has-audio');

                        const regionData = {
                            buffer: audioBuffer,
                            startTime: regionInfo.startTime,
                            duration: regionInfo.duration,
                            startOffset: regionInfo.startOffset,
                            endOffset: regionInfo.endOffset,
                            fadeInDuration: regionInfo.fadeInDuration || 0,
                            fadeOutDuration: regionInfo.fadeOutDuration || 0,
                            gain: regionInfo.gain !== undefined ? regionInfo.gain : 1.0,
                            name: regionInfo.name || '',
                            crossfade: regionInfo.crossfade || null
                        };

                        createRegionFromData(regionData, track, trackElement);
                    }
                }
            }

            // Update effect indicators
            updateEffectIndicators(track, trackElement);
        }

        // Apply mute/solo state
        updateSoloMuteStates();

        // Update duration and UI
        audioEngine.updateDuration();
        updateTimelineZoom();
        updateTimeDisplay();
        updateLoopDisplay();

    } finally {
        isLoadingProject = false;
    }
}

async function saveProjectToFile() {
    try {
        const projectData = serializeProject();
        const audioBuffers = serializeAudioBuffers();

        // Build binary packet
        const metadataJson = JSON.stringify(projectData);
        const metadataBytes = new TextEncoder().encode(metadataJson);

        // Build buffer manifest with byte offsets
        let audioDataSize = 0;
        const bufferEntries = [];
        for (const [id, buf] of Object.entries(audioBuffers)) {
            const entry = {
                id,
                sampleRate: buf.sampleRate,
                numberOfChannels: buf.numberOfChannels,
                length: buf.length,
                channelByteLengths: buf.channels.map(ch => ch.byteLength)
            };
            for (const ch of buf.channels) {
                audioDataSize += ch.byteLength;
            }
            bufferEntries.push(entry);
        }

        const manifestJson = JSON.stringify(bufferEntries);
        const manifestBytes = new TextEncoder().encode(manifestJson);

        // Pack: [4 bytes metadata len][metadata][4 bytes manifest len][manifest][audio data]
        const totalSize = 4 + metadataBytes.byteLength + 4 + manifestBytes.byteLength + audioDataSize;
        const fileBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(fileBuffer);
        let offset = 0;

        // Metadata
        view.setUint32(offset, metadataBytes.byteLength, true);
        offset += 4;
        new Uint8Array(fileBuffer, offset, metadataBytes.byteLength).set(metadataBytes);
        offset += metadataBytes.byteLength;

        // Manifest
        view.setUint32(offset, manifestBytes.byteLength, true);
        offset += 4;
        new Uint8Array(fileBuffer, offset, manifestBytes.byteLength).set(manifestBytes);
        offset += manifestBytes.byteLength;

        // Audio data (write as raw bytes to avoid alignment issues)
        for (const [id, buf] of Object.entries(audioBuffers)) {
            for (const ch of buf.channels) {
                const bytes = new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength);
                new Uint8Array(fileBuffer, offset, ch.byteLength).set(bytes);
                offset += ch.byteLength;
            }
        }

        const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audio-studio-project-${Date.now()}.audiostudio`;
        a.click();
        URL.revokeObjectURL(url);

        showNotification('Project saved to file');
    } catch (err) {
        console.error('Save to file failed:', err);
        showNotification('Failed to save project: ' + err.message);
    }
}

async function loadProjectFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.audiostudio';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            showNotification('Loading project...');
            const arrayBuffer = await file.arrayBuffer();
            const view = new DataView(arrayBuffer);
            let offset = 0;

            // Read metadata
            const metadataLen = view.getUint32(offset, true);
            offset += 4;
            const metadataBytes = new Uint8Array(arrayBuffer, offset, metadataLen);
            const projectData = JSON.parse(new TextDecoder().decode(metadataBytes));
            offset += metadataLen;

            // Read manifest
            const manifestLen = view.getUint32(offset, true);
            offset += 4;
            const manifestBytes = new Uint8Array(arrayBuffer, offset, manifestLen);
            const bufferManifest = JSON.parse(new TextDecoder().decode(manifestBytes));
            offset += manifestLen;

            // Read audio data
            const audioBuffers = {};
            for (const entry of bufferManifest) {
                const channels = [];
                for (const byteLen of entry.channelByteLengths) {
                    const channelData = new Float32Array(arrayBuffer.slice(offset, offset + byteLen));
                    channels.push(channelData);
                    offset += byteLen;
                }
                audioBuffers[entry.id] = {
                    channels,
                    sampleRate: entry.sampleRate,
                    numberOfChannels: entry.numberOfChannels,
                    length: entry.length
                };
            }

            await restoreProject(projectData, audioBuffers);
            // Also save to IndexedDB for auto-restore on next visit
            await saveProjectToIndexedDB();
            showNotification('Project loaded from file');
        } catch (err) {
            console.error('Load from file failed:', err);
            showNotification('Failed to load project: ' + err.message);
        }
    };

    input.click();
}

async function clearProject() {
    if (!confirm('Clear the current project? This will remove all tracks and audio. The auto-saved project will also be cleared.')) return;

    if (audioEngine.isPlaying) {
        audioEngine.stop();
    }

    // Clear IndexedDB
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete('autosave');
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (err) {
        console.warn('Failed to clear IndexedDB:', err);
    }

    // Clear all tracks
    audioEngine.tracks.forEach(t => t.dispose());
    audioEngine.tracks = [];
    document.getElementById('tracksContainer').innerHTML = '';
    selectedTrack = null;
    selectedRegion = null;
    trackCounter = 0;

    // Reset settings
    bpm = 120;
    snapEnabled = true;
    snapValue = 0.25;
    zoomLevel = 1.0;
    audioEngine.masterGain.gain.value = 0.8;
    loopEnabled = false;
    loopStart = 0;
    loopEnd = 10;

    document.getElementById('bpmInput').value = 120;
    document.getElementById('snapEnabled').checked = true;
    document.getElementById('snapValue').value = 0.25;
    const masterVolumeSlider = document.getElementById('masterVolume');
    masterVolumeSlider.value = 0.8;
    updateSliderFill(masterVolumeSlider, 80);
    document.getElementById('masterVolumeValue').textContent = '-2 dB';
    document.getElementById('loopBtn').classList.remove('loop-active');

    // Create default tracks
    for (let i = 0; i < 4; i++) {
        createTrack();
    }

    applyArrangementChange();
    showNotification('Project cleared');
}
