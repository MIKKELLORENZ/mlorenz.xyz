// Main Application Logic
let audioEngine;
let trackCounter = 0;
let currentTrack = null;
let selectedTrack = null; // Currently selected track for keyboard shortcuts
let pixelsPerSecond = 100;
let selectedRegion = null;
let isDraggingRegion = false;
let isResizingRegion = false;
let resizeState = null;
let dragOffset = { x: 0, y: 0 };
let timelineScroll = 0;
let zoomLevel = 1.0;
let snapEnabled = true;
let snapValue = 0.25; // quarter note
let bpm = 120;
let settingsInitialized = false;

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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    audioEngine = new AudioEngine();
    await audioEngine.initialize();
    
    // Create default tracks
    for (let i = 0; i < 4; i++) {
        createTrack();
    }
    
    setupEventListeners();
    setupTimeline();
    startMetering();
    updateTrackControlsWidthVar();
    initializeSliderFills();
});

// Event Listeners
function setupEventListeners() {
    // Transport controls
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
    document.getElementById('addTrackBtn').addEventListener('click', createTrack);
    
    // Export
    document.getElementById('exportBtn').addEventListener('click', exportProject);
    
    // BPM
    document.getElementById('bpmInput').addEventListener('change', (e) => {
        bpm = parseInt(e.target.value);
        updateTimelineGrid(); // Update grid when BPM changes
    });
    
    // Snap settings
    document.getElementById('snapEnabled').addEventListener('change', (e) => {
        snapEnabled = e.target.checked;
        updateTimelineGrid(); // Update grid when snap is toggled
    });
    
    document.getElementById('snapValue').addEventListener('change', (e) => {
        snapValue = parseFloat(e.target.value);
        updateTimelineGrid(); // Update grid when snap value changes
        snapAllRegionsToGrid(); // Snap existing regions to new grid
    });
    
    // Master volume
    document.getElementById('masterVolume').addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        audioEngine.masterGain.gain.value = value;
        const db = value > 0 ? 20 * Math.log10(value) : -Infinity;
        document.getElementById('masterVolumeValue').textContent = db === -Infinity ? '-∞ dB' : db.toFixed(1) + ' dB';
        // Update slider fill
        updateSliderFill(e.target, value * 100);
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
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
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
    const ruler = document.getElementById('timelineRuler');
    if (ruler) {
        ruler.style.transform = `translateX(${-timelineScroll}px)`;
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
        const track = audioEngine.tracks.find(t => 
            t.regions && t.regions.some(r => r.element === selectedRegion)
        );
        if (track) {
            const regionData = track.regions.find(r => r.element === selectedRegion);
            pushUndo('Delete Region', () => {
                const regionIndex = track.regions.findIndex(r => r.element === selectedRegion);
                if (regionIndex !== -1) {
                    track.regions.splice(regionIndex, 1);
                    selectedRegion.remove();
                    selectedRegion = null;
                    audioEngine.updateDuration();
                    updateTimelineZoom();
                    updateTimeDisplay();
                }
            }, () => {
                // Redo: recreate region
                const trackElement = document.querySelector(`.track[data-track-id="${track.id}"]`);
                createRegionFromData({...regionData, element: null}, track, trackElement);
            });
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
    
    // + / = - Zoom in
    if (e.key === '+' || e.key === '=') {
        zoomLevel *= 1.2;
        zoomLevel = Math.min(10, zoomLevel);
        updateTimelineZoom();
    }
    
    // - - Zoom out
    if (e.key === '-') {
        zoomLevel *= 0.8;
        zoomLevel = Math.max(0.5, zoomLevel);
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

async function processRecording() {
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
            
            // Update duration
            audioEngine.updateDuration();
            updateTimelineZoom();
            updateTimeDisplay();
            
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
    const trackId = inputAnalyser._trackId;
    const meterBar = document.querySelector(`.input-meter-bar[data-track-id="${trackId}"]`);
    const meterPeak = document.querySelector(`.input-meter-peak[data-track-id="${trackId}"]`);
    
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
    
    // Execute the action
    undoFn();
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
        zoomLevel = Math.max(0.5, Math.min(10, zoomLevel));
        
        // Calculate new total width
        const newTotalWidth = duration * pixelsPerSecond * zoomLevel;
        
        // Calculate new scroll position to keep cursor at same visual position
        const newCursorX = (cursorTime / duration) * newTotalWidth;
        const cursorOffsetFromViewport = e.clientX - rect.left - trackControlsWidth;
        timelineScroll = newCursorX - cursorOffsetFromViewport;
        
        // Clamp scroll
        const maxScroll = Math.max(0, newTotalWidth - (tracksWrapper.clientWidth - trackControlsWidth));
        timelineScroll = Math.max(0, Math.min(maxScroll, timelineScroll));
        
        updateTimelineZoom();
    } else if (e.shiftKey) {
        // Shift + Wheel: Horizontal scroll
        const scrollDelta = e.deltaY;
        timelineScroll += scrollDelta;
        const duration = audioEngine.duration || 60;
        const totalWidth = duration * pixelsPerSecond * zoomLevel;
        const tracksWrapper = document.querySelector('.tracks-wrapper');
        const maxScroll = Math.max(0, totalWidth - tracksWrapper.clientWidth);
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
    
    document.querySelectorAll('.track-timeline').forEach(timeline => {
        timeline.style.width = `${newWidth}px`;
    });

    const tracksWrapper = document.querySelector('.tracks-wrapper');
    const maxScroll = Math.max(0, newWidth - tracksWrapper.clientWidth);
    timelineScroll = Math.min(timelineScroll, maxScroll);
    tracksWrapper.scrollLeft = timelineScroll;
    
    updateTimelineRuler();
    updateAllRegions(); // Changed from updateAllWaveforms
    updateTimelineGrid();
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
    const tracksWrapper = document.querySelector('.tracks-wrapper');
    const x = e.clientX - rect.left + tracksWrapper.scrollLeft;
    const totalWidth = (audioEngine.duration || 60) * pixelsPerSecond * zoomLevel;
    const percentage = x / totalWidth;
    let time = percentage * (audioEngine.duration || 60);
    
    // Apply snap if enabled
    time = snapToGrid(time);
    
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
function createTrack() {
    trackCounter++;
    const trackId = `track-${trackCounter}`;
    const trackName = `Track ${trackCounter}`;
    
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
    });
    
    // Record arm button
    const recordBtn = trackElement.querySelector('.record-btn');
    recordBtn.addEventListener('click', async (e) => {
        track.isArmed = !track.isArmed;
        recordBtn.classList.toggle('active', track.isArmed);
        trackElement.classList.toggle('armed', track.isArmed);
        
        // Start/stop input metering
        if (track.isArmed) {
            await startInputMetering(track.id);
        } else {
            stopInputMetering();
        }
    });

    // Mute button
    const muteBtn = trackElement.querySelector('.mute-btn');
    muteBtn.addEventListener('click', (e) => {
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
    });

    // Solo button
    const soloBtn = trackElement.querySelector('.solo-btn');
    soloBtn.addEventListener('click', (e) => {
        track.isSoloed = !track.isSoloed;
        soloBtn.classList.toggle('active', track.isSoloed);
        updateSoloMuteStates();
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
            trackElement.remove();
            audioEngine.updateDuration();
            updateTimelineZoom();
            updateTimeDisplay();
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
    });
    
    // Track selection (click on track controls to select)
    const trackControls = trackElement.querySelector('.track-controls');
    trackControls.addEventListener('click', (e) => {
        // Don't select if clicking on a button or input
        if (e.target.closest('button') || e.target.closest('input')) return;
        selectTrack(trackElement);
    });
    
    // Settings button
    const settingsBtn = trackElement.querySelector('.settings-btn');
    settingsBtn.addEventListener('click', () => {
        openTrackSettings(track, trackElement);
    });
    
    // Right-click context menu on timeline
    const timeline = trackElement.querySelector('.track-timeline');
    timeline.addEventListener('mousedown', (e) => {
        if (e.target.closest('.audio-region')) return;
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
        audioEngine.updateDuration();
        updateTimelineZoom();
        
        trackElement.classList.add('has-audio');
        updateTimeDisplay();
    } catch (error) {
        console.error('Error loading audio:', error);
        alert('Error loading audio file');
    } finally {
        // Remove loading overlay
        loadingOverlay.remove();
    }
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
        endOffset: regionDuration
    };
    track.regions.push(regionData);
    
    // Region interaction
    setupRegionInteraction(region, regionData, track, trackElement);
    
    // Update timeline zoom to accommodate new region
    // Timeline updates happen after duration recalculation
}

function setupRegionInteraction(region, regionData, track, trackElement) {
    // Click to select
    region.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('region-handle')) return;
        
        e.stopPropagation();
        
        // Deselect previous
        if (selectedRegion) {
            selectedRegion.classList.remove('selected');
        }
        
        region.classList.add('selected');
        selectedRegion = region;
        region.style.zIndex = Date.now().toString();
        
        // Alt+Click to duplicate
        if (e.altKey) {
            const duplicatedData = duplicateRegion(regionData, track, trackElement);
            if (duplicatedData) {
                dragOffset.regionData = duplicatedData;
                dragOffset.track = track;
                dragOffset.trackElement = trackElement;
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
        dragOffset.track = track;
        dragOffset.trackElement = trackElement;
        dragOffset.regionData = regionData;
    });
    
    // Right-click context menu on region
    region.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showRegionContextMenu(e, regionData, track, trackElement);
    });
    
    // Double-click to split
    region.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        splitRegionAtPosition(region, regionData, track, trackElement, e);
    });

    // Resize handles
    const leftHandle = region.querySelector('.region-handle.left');
    const rightHandle = region.querySelector('.region-handle.right');
    [leftHandle, rightHandle].forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startRegionResize(e, handle.classList.contains('left') ? 'left' : 'right', regionData, track, trackElement);
        });
    });
}

function handleRegionDrag(e) {
    if (isResizingRegion || !isDraggingRegion || !selectedRegion) return;
    
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
        
        selectedRegion.style.left = `${Math.max(0, x)}px`;
    }
}

function handleRegionDragEnd(e) {
    if (isResizingRegion || !isDraggingRegion || !selectedRegion) return;
    
    isDraggingRegion = false;
    selectedRegion.classList.remove('dragging');
    
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
        
        // Calculate new start time
        const x = e.clientX - rect.left - dragOffset.x;
        const duration = audioEngine.duration || 60;
        const totalWidth = duration * pixelsPerSecond * zoomLevel;
        let newStartTime = (x / totalWidth) * duration;
        
        // Apply snap if enabled
        if (snapEnabled) {
            newStartTime = snapToGrid(Math.max(0, newStartTime));
        } else {
            newStartTime = Math.max(0, newStartTime);
        }
        
        // Update region data
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
        
        // Recalculate position based on snap
        const left = (dragOffset.regionData.startTime / duration) * totalWidth;
        selectedRegion.style.left = `${left}px`;

        audioEngine.updateDuration();
        updateTimelineZoom();
        updateTimeDisplay();
    }
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
    const deltaTime = (deltaX / totalWidth) * duration;
    const minDuration = 0.05;

    if (direction === 'left') {
        let newStartTime = resizeState.startTime + deltaTime;
        let newStartOffset = resizeState.startOffset + deltaTime;
        let newDuration = resizeState.duration - deltaTime;

        if (newStartTime < 0) {
            newDuration += newStartTime;
            newStartOffset += newStartTime;
            newStartTime = 0;
        }

        if (newStartOffset < 0) {
            newDuration += newStartOffset;
            newStartTime += newStartOffset;
            newStartOffset = 0;
        }

        if (newDuration < minDuration) {
            newDuration = minDuration;
            newStartTime = resizeState.startTime + (resizeState.duration - minDuration);
            newStartOffset = resizeState.startOffset + (resizeState.duration - minDuration);
        }

        regionData.startTime = newStartTime;
        regionData.startOffset = newStartOffset;
        regionData.duration = newDuration;
        regionData.endOffset = newStartOffset + newDuration;
    } else {
        let newDuration = resizeState.duration + deltaTime;
        let newEndOffset = resizeState.endOffset + deltaTime;

        if (newEndOffset > regionData.buffer.duration) {
            const over = newEndOffset - regionData.buffer.duration;
            newDuration -= over;
            newEndOffset = regionData.buffer.duration;
        }

        if (newDuration < minDuration) {
            newDuration = minDuration;
            newEndOffset = resizeState.startOffset + minDuration;
        }

        regionData.duration = newDuration;
        regionData.endOffset = newEndOffset;
    }

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
}

function handleRegionResizeEnd() {
    if (!isResizingRegion || !resizeState) return;

    const { direction, regionData } = resizeState;
    const minDuration = 0.05;

    if (snapEnabled) {
        if (direction === 'left') {
            const originalEnd = regionData.startTime + regionData.duration;
            const snappedStart = snapToGrid(regionData.startTime);
            let newDuration = Math.max(minDuration, originalEnd - snappedStart);
            const delta = snappedStart - regionData.startTime;
            regionData.startTime = snappedStart;
            regionData.startOffset = Math.max(0, regionData.startOffset + delta);
            regionData.duration = newDuration;
            regionData.endOffset = regionData.startOffset + newDuration;
        } else {
            const endTime = regionData.startTime + regionData.duration;
            const snappedEnd = snapToGrid(endTime);
            let newDuration = Math.max(minDuration, snappedEnd - regionData.startTime);
            const maxDuration = regionData.buffer.duration - regionData.startOffset;
            newDuration = Math.min(newDuration, maxDuration);
            regionData.duration = newDuration;
            regionData.endOffset = regionData.startOffset + newDuration;
        }
    }

    audioEngine.updateDuration();
    updateTimelineZoom();
    updateTimeDisplay();

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
    
    // Remove original region
    const regionIndex = track.regions.indexOf(regionData);
    if (regionIndex !== -1) {
        track.regions.splice(regionIndex, 1);
    }
    region.remove();
    
    // Create first region
    const firstRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime,
        duration: firstRegionDuration,
        startOffset: regionData.startOffset,
        endOffset: regionData.startOffset + firstRegionDuration
    };
    
    createRegionFromData(firstRegionData, track, trackElement);
    
    // Create second region
    const secondRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime + firstRegionDuration,
        duration: secondRegionDuration,
        startOffset: regionData.startOffset + firstRegionDuration,
        endOffset: regionData.endOffset
    };
    
    createRegionFromData(secondRegionData, track, trackElement);

    audioEngine.updateDuration();
    updateTimelineZoom();
    updateTimeDisplay();
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
    
    timeline.appendChild(region);
    
    regionData.element = region;
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
    const newRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime + 0.01, // Slight offset so it's visible
        duration: regionData.duration,
        startOffset: regionData.startOffset,
        endOffset: regionData.endOffset
    };
    createRegionFromData(newRegionData, track, trackElement);
    audioEngine.updateDuration();
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
                audioEngine.updateDuration();
                updateTimelineZoom();
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
    
    const regionIndex = track.regions.indexOf(regionData);
    if (regionIndex !== -1) {
        track.regions.splice(regionIndex, 1);
    }
    regionData.element.remove();
    
    const firstRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime,
        duration: firstDuration,
        startOffset: regionData.startOffset,
        endOffset: regionData.startOffset + firstDuration
    };
    
    createRegionFromData(firstRegionData, track, trackElement);
    
    const secondRegionData = {
        element: null,
        buffer: regionData.buffer,
        startTime: regionData.startTime + firstDuration,
        duration: secondDuration,
        startOffset: regionData.startOffset + firstDuration,
        endOffset: regionData.endOffset
    };
    
    createRegionFromData(secondRegionData, track, trackElement);

    audioEngine.updateDuration();
    updateTimelineZoom();
    updateTimeDisplay();
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
    
    // EQ Controls
    setupEQControls(modal);
    
    // Compression Controls (with knobs)
    setupCompressionControls(modal);
    
    // Effects Controls
    setupEffectsControls(modal);
    
    // Update indicators initially
    updateEffectIndicators(currentTrack, getCurrentTrackElement());
    updateKnobVisuals();
}

// Update all knob visual rotations
function updateKnobVisuals() {
    const modal = document.getElementById('trackSettingsModal');
    if (!modal) return;
    
    modal.querySelectorAll('.knob-wrapper').forEach(wrapper => {
        const input = wrapper.querySelector('.knob-input');
        const visual = wrapper.querySelector('.knob-visual');
        if (input && visual) {
            const min = parseFloat(input.min);
            const max = parseFloat(input.max);
            const value = parseFloat(input.value);
            const percent = (value - min) / (max - min);
            // Rotate from -135deg to 135deg (270 degree range)
            const rotation = -135 + (percent * 270);
            visual.style.setProperty('--knob-rotation', `${rotation}deg`);
        }
    });
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
        const visual = wrapper.querySelector('.knob-visual');
        if (!visual) return;
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        const value = parseFloat(input.value);
        const percent = (value - min) / (max - min);
        const rotation = -135 + (percent * 270);
        visual.style.setProperty('--knob-rotation', `${rotation}deg`);
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
    
    const compThreshold = document.querySelector('.comp-threshold');
    compThreshold.nextElementSibling.textContent = parseFloat(compThreshold.value).toFixed(0) + ' dB';
    
    const compKnee = document.querySelector('.comp-knee');
    compKnee.nextElementSibling.textContent = parseFloat(compKnee.value).toFixed(0) + ' dB';
    
    const compRatio = document.querySelector('.comp-ratio');
    compRatio.nextElementSibling.textContent = parseFloat(compRatio.value).toFixed(1) + ':1';
    
    const compAttack = document.querySelector('.comp-attack');
    compAttack.nextElementSibling.textContent = (parseFloat(compAttack.value) * 1000).toFixed(0) + ' ms';
    
    const compRelease = document.querySelector('.comp-release');
    compRelease.nextElementSibling.textContent = (parseFloat(compRelease.value) * 1000).toFixed(0) + ' ms';
    
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
    const hasEQ = track.eqLow.gain.value !== 0 || track.eqMid.gain.value !== 0 || track.eqHigh.gain.value !== 0;
    if (hasEQ) {
        const indicator = document.createElement('span');
        indicator.className = 'effect-indicator';
        indicator.textContent = 'EQ';
        indicatorsContainer.appendChild(indicator);
        hasActiveEffects = true;
    }
    
    // Check Compression (active if ratio > 1)
    if (track.compressor.ratio.value > 1) {
        const indicator = document.createElement('span');
        indicator.className = 'effect-indicator';
        indicator.textContent = 'COMP';
        indicatorsContainer.appendChild(indicator);
        hasActiveEffects = true;
    }
    
    // Check Delay
    if (track.delayWet.gain.value > 0) {
        const indicator = document.createElement('span');
        indicator.className = 'effect-indicator';
        indicator.textContent = 'DELAY';
        indicatorsContainer.appendChild(indicator);
        hasActiveEffects = true;
    }
    
    // Check Reverb
    if (track.reverbWet.gain.value > 0) {
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
        selectedTrack.classList.remove('track-selected');
    }
    selectedTrack = trackElement;
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
