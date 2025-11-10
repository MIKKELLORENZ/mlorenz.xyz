// Main Application Logic
let audioEngine;
let trackCounter = 0;
let currentTrack = null;
let pixelsPerSecond = 100;
let selectedRegion = null;
let isDraggingRegion = false;
let dragOffset = { x: 0, y: 0 };
let timelineScroll = 0;
let zoomLevel = 1.0;
let snapEnabled = true;
let snapValue = 0.25; // quarter note
let bpm = 120;

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
});

// Event Listeners
function setupEventListeners() {
    // Transport controls
    document.getElementById('playBtn').addEventListener('click', () => audioEngine.play());
    document.getElementById('pauseBtn').addEventListener('click', () => audioEngine.pause());
    document.getElementById('stopBtn').addEventListener('click', () => {
        audioEngine.stop();
        updateTimeDisplay();
        updatePlayhead();
    });
    
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
        const db = 20 * Math.log10(value);
        document.getElementById('masterVolumeValue').textContent = db.toFixed(1) + ' dB';
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
    
    // Scrolling and Zooming
    const tracksWrapper = document.querySelector('.tracks-wrapper');
    tracksWrapper.addEventListener('wheel', handleWheelScroll, { passive: false });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyPress);
}

function handleKeyPress(e) {
    // Delete key to remove selected region
    if (e.key === 'Delete' && selectedRegion) {
        const track = audioEngine.tracks.find(t => 
            t.regions && t.regions.some(r => r.element === selectedRegion)
        );
        if (track) {
            const regionIndex = track.regions.findIndex(r => r.element === selectedRegion);
            if (regionIndex !== -1) {
                track.regions[regionIndex].element.remove();
                track.regions.splice(regionIndex, 1);
                selectedRegion = null;
            }
        }
    }
    
    // Space bar to play/pause
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        if (audioEngine.isPlaying) {
            audioEngine.pause();
        } else {
            audioEngine.play();
        }
    }
}

function handleWheelScroll(e) {
    e.preventDefault();
    
    if (e.ctrlKey) {
        // Zoom in/out with Ctrl + Wheel
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        zoomLevel *= zoomDelta;
        zoomLevel = Math.max(0.5, Math.min(10, zoomLevel)); // Clamp between 0.5x and 10x
        
        updateTimelineZoom();
    } else {
        // Horizontal scroll with wheel
        const scrollDelta = e.deltaY;
        timelineScroll += scrollDelta;
        
        const maxScroll = Math.max(0, (audioEngine.duration || 60) * pixelsPerSecond * zoomLevel - window.innerWidth + 300);
        timelineScroll = Math.max(0, Math.min(maxScroll, timelineScroll));
        
        updateTimelineScroll();
    }
}

function updateTimelineZoom() {
    // Update all track timelines width based on zoom
    const duration = audioEngine.duration || 60;
    const newWidth = duration * pixelsPerSecond * zoomLevel;
    
    document.querySelectorAll('.track-timeline').forEach(timeline => {
        timeline.style.width = `${newWidth}px`;
    });
    
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
}

function updateTimelineGrid() {
    // Add/update vertical grid lines on all track timelines
    document.querySelectorAll('.track-timeline').forEach(timeline => {
        // Remove existing grid
        const existingGrid = timeline.querySelector('.timeline-grid');
        if (existingGrid) existingGrid.remove();
        
        // Create new grid
        const grid = document.createElement('div');
        grid.className = 'timeline-grid';
        grid.style.position = 'absolute';
        grid.style.top = '0';
        grid.style.left = '0';
        grid.style.width = '100%';
        grid.style.height = '100%';
        grid.style.pointerEvents = 'none';
        grid.style.zIndex = '1';
        
        const duration = audioEngine.duration || 60;
        const totalWidth = duration * pixelsPerSecond * zoomLevel;
        
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
            const line = document.createElement('div');
            line.style.position = 'absolute';
            line.style.left = `${(time / duration) * totalWidth}px`;
            line.style.top = '0';
            line.style.width = '1px';
            line.style.height = '100%';
            line.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
            
            // Emphasize major grid lines (every 4 beats or major time intervals)
            const isMajor = (i % 4 === 0);
            if (isMajor) {
                line.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            }
            
            grid.appendChild(line);
        }
        
        timeline.insertBefore(grid, timeline.firstChild);
    });
}

function handleTimelineClick(e) {
    const ruler = e.currentTarget;
    const rect = ruler.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineScroll;
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
    const wrapperWidth = tracksWrapper.clientWidth - 200;
    const scrollPos = tracksWrapper.scrollLeft;
    
    if (position > scrollPos + wrapperWidth - 100) {
        tracksWrapper.scrollLeft = position - wrapperWidth + 100;
        timelineScroll = tracksWrapper.scrollLeft;
    } else if (position < scrollPos + 100) {
        tracksWrapper.scrollLeft = Math.max(0, position - 100);
        timelineScroll = tracksWrapper.scrollLeft;
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
                <button class="mute-btn" data-track-id="${trackId}">M</button>
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
            <button class="settings-btn" data-track-id="${trackId}">
                ⚙ Effects & EQ
            </button>
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
    
    // Setup drag and drop
    setupDragAndDrop(trackElement, track);
    
    // Track name change
    const nameInput = trackElement.querySelector('.track-name');
    nameInput.addEventListener('change', (e) => {
        track.name = e.target.value;
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
    });
    
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
    });
    
    // Settings button
    const settingsBtn = trackElement.querySelector('.settings-btn');
    settingsBtn.addEventListener('click', () => {
        openTrackSettings(track, trackElement);
    });
    
    // Right-click context menu on timeline
    const timeline = trackElement.querySelector('.track-timeline');
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
    try {
        const buffer = await track.loadAudio(file);
        audioEngine.updateDuration();
        updateTimelineRuler();
        
        // Apply snap to start time
        const snappedStartTime = snapEnabled ? snapToGrid(startTime) : startTime;
        
        // Create audio region
        createAudioRegion(track, trackElement, buffer, snappedStartTime);
        
        trackElement.classList.add('has-audio');
        updateTimeDisplay();
    } catch (error) {
        console.error('Error loading audio:', error);
        alert('Error loading audio file');
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
    updateTimelineZoom();
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
        
        // Start dragging
        isDraggingRegion = true;
        const rect = region.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        dragOffset.track = track;
        dragOffset.trackElement = trackElement;
        dragOffset.regionData = regionData;
    });
    
    // Double-click to split
    region.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        splitRegionAtPosition(region, regionData, track, trackElement, e);
    });
}

function handleRegionDrag(e) {
    if (!isDraggingRegion || !selectedRegion) return;
    
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
    if (!isDraggingRegion || !selectedRegion) return;
    
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
    }
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
}

// Track Settings Modal
function openTrackSettings(track, trackElement) {
    currentTrack = track;
    const modal = document.getElementById('trackSettingsModal');
    modal.classList.add('active');
    
    // Store reference to track element for updating indicators
    modal.dataset.trackElement = trackElement.dataset.trackId;
    
    // Load current values
    loadTrackSettingsValues(track);
    
    // Setup control listeners
    setupSettingsControls(track, trackElement);
}

function loadTrackSettingsValues(track) {
    // EQ
    document.querySelector('.eq-freq[data-band="low"]').value = track.eqLow.frequency.value;
    document.querySelector('.eq-gain[data-band="low"]').value = track.eqLow.gain.value;
    document.querySelector('.eq-q[data-band="low"]').value = track.eqLow.Q.value;
    
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
}

function setupSettingsControls(track, trackElement) {
    // Remove old listeners by cloning and replacing
    const modal = document.getElementById('trackSettingsModal');
    const newModal = modal.cloneNode(true);
    modal.parentNode.replaceChild(newModal, modal);
    
    // Re-setup close button
    const closeBtn = newModal.querySelector('.close');
    closeBtn.addEventListener('click', () => {
        newModal.classList.remove('active');
    });
    
    // Re-setup tabs
    const tabBtns = newModal.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
    
    // EQ Controls
    setupEQControls(track, newModal, trackElement);
    
    // Compression Controls
    setupCompressionControls(track, newModal, trackElement);
    
    // Effects Controls
    setupEffectsControls(track, newModal, trackElement);
    
    // Automation Controls
    setupAutomationControls(track, newModal);
    
    // Update indicators initially
    updateEffectIndicators(track, trackElement);
}

function setupEQControls(track, modal, trackElement) {
    const bands = ['low', 'mid', 'high'];
    const nodes = { low: track.eqLow, mid: track.eqMid, high: track.eqHigh };
    
    bands.forEach(band => {
        const freqSlider = modal.querySelector(`.eq-freq[data-band="${band}"]`);
        const gainSlider = modal.querySelector(`.eq-gain[data-band="${band}"]`);
        const qSlider = modal.querySelector(`.eq-q[data-band="${band}"]`);
        
        freqSlider.addEventListener('input', (e) => {
            nodes[band].frequency.value = parseFloat(e.target.value);
            e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(0) + ' Hz';
            updateEffectIndicators(track, trackElement);
        });
        
        gainSlider.addEventListener('input', (e) => {
            nodes[band].gain.value = parseFloat(e.target.value);
            e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(1) + ' dB';
            updateEffectIndicators(track, trackElement);
        });
        
        qSlider.addEventListener('input', (e) => {
            nodes[band].Q.value = parseFloat(e.target.value);
            e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(1);
        });
    });
}

function setupCompressionControls(track, modal, trackElement) {
    const thresholdSlider = modal.querySelector('.comp-threshold');
    const kneeSlider = modal.querySelector('.comp-knee');
    const ratioSlider = modal.querySelector('.comp-ratio');
    const attackSlider = modal.querySelector('.comp-attack');
    const releaseSlider = modal.querySelector('.comp-release');
    
    thresholdSlider.addEventListener('input', (e) => {
        track.compressor.threshold.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(0) + ' dB';
        updateEffectIndicators(track, trackElement);
    });
    
    kneeSlider.addEventListener('input', (e) => {
        track.compressor.knee.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(0) + ' dB';
    });
    
    ratioSlider.addEventListener('input', (e) => {
        track.compressor.ratio.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = parseFloat(e.target.value).toFixed(1) + ':1';
        updateEffectIndicators(track, trackElement);
    });
    
    attackSlider.addEventListener('input', (e) => {
        track.compressor.attack.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 1000).toFixed(0) + ' ms';
    });
    
    releaseSlider.addEventListener('input', (e) => {
        track.compressor.release.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 1000).toFixed(0) + ' ms';
    });
}

function setupEffectsControls(track, modal, trackElement) {
    const delayTimeSlider = modal.querySelector('.delay-time');
    const delayFeedbackSlider = modal.querySelector('.delay-feedback');
    const delayMixSlider = modal.querySelector('.delay-mix');
    const reverbDecaySlider = modal.querySelector('.reverb-decay');
    const reverbMixSlider = modal.querySelector('.reverb-mix');
    
    delayTimeSlider.addEventListener('input', (e) => {
        track.delayNode.delayTime.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 1000).toFixed(0) + ' ms';
    });
    
    delayFeedbackSlider.addEventListener('input', (e) => {
        track.delayFeedback.gain.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 100).toFixed(0) + '%';
    });
    
    delayMixSlider.addEventListener('input', (e) => {
        track.delayWet.gain.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 100).toFixed(0) + '%';
        updateEffectIndicators(track, trackElement);
    });
    
    reverbDecaySlider.addEventListener('input', (e) => {
        const decay = parseFloat(e.target.value);
        track.createReverbImpulse(decay);
        e.target.nextElementSibling.textContent = decay.toFixed(1) + ' s';
    });
    
    reverbMixSlider.addEventListener('input', (e) => {
        track.reverbWet.gain.value = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (parseFloat(e.target.value) * 100).toFixed(0) + '%';
        updateEffectIndicators(track, trackElement);
    });
}

function setupAutomationControls(track, modal) {
    const addPointBtn = modal.querySelector('.add-automation-point');
    const paramSelect = modal.querySelector('.automation-param');
    
    addPointBtn.addEventListener('click', () => {
        const param = paramSelect.value;
        const time = audioEngine.getCurrentTime();
        let value;
        
        switch (param) {
            case 'volume':
                value = track.gainNode.gain.value;
                break;
            case 'delay':
                value = track.delayWet.gain.value;
                break;
            case 'reverb':
                value = track.reverbWet.gain.value;
                break;
        }
        
        track.addAutomationPoint(param, time, value);
        updateAutomationList(track, modal);
    });
    
    updateAutomationList(track, modal);
}

function updateAutomationList(track, modal) {
    const list = modal.querySelector('.automation-list');
    const paramSelect = modal.querySelector('.automation-param');
    const param = paramSelect.value;
    
    list.innerHTML = '';
    
    if (track.automation[param]) {
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

// Metering
function startMetering() {
    const meterL = document.getElementById('masterMeterL');
    const meterR = document.getElementById('masterMeterR');
    const dataArray = new Uint8Array(audioEngine.analyser.frequencyBinCount);
    
    function updateMeters() {
        audioEngine.analyser.getByteTimeDomainData(dataArray);
        
        let sumL = 0;
        let sumR = 0;
        const halfLength = dataArray.length / 2;
        
        for (let i = 0; i < halfLength; i++) {
            sumL += Math.abs((dataArray[i] - 128) / 128);
        }
        for (let i = halfLength; i < dataArray.length; i++) {
            sumR += Math.abs((dataArray[i] - 128) / 128);
        }
        
        const avgL = sumL / halfLength;
        const avgR = sumR / halfLength;
        
        meterL.style.height = `${Math.min(avgL * 100, 100)}%`;
        meterR.style.height = `${Math.min(avgR * 100, 100)}%`;
        
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
