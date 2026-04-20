function setupUI(scene, engine) {
    var connectionType = document.getElementById('connectionType');
    var sensorType = document.getElementById('sensorType');
    var sensorGroup = document.getElementById('sensorGroup');
    var noiseSlider = document.getElementById('noiseSlider');
    var noiseValue = document.getElementById('noiseValue');
    var noiseGroup = document.getElementById('noiseGroup');
    var simSpeed = document.getElementById('simSpeed');
    var encoding = document.getElementById('encoding');

    var connectionHint = document.getElementById('connectionHint');
    var sensorHint = document.getElementById('sensorHint');
    var encodingHint = document.getElementById('encodingHint');
    var sensorRateEl = document.getElementById('sensorRate');
    var bitsPerSampleEl = document.getElementById('bitsPerSample');
    var throughputEl = document.getElementById('throughput');
    var fullImageTimeEl = document.getElementById('fullImageTime');

    var sourceCanvas = document.getElementById('sourceCanvas');
    var receivedCanvas = document.getElementById('receivedCanvas');
    var sourceCtx = sourceCanvas.getContext('2d');
    var receivedCtx = receivedCanvas.getContext('2d');

    var uploadOverlay = document.getElementById('uploadOverlay');
    var fileInput = document.getElementById('fileInput');
    var fileInfo = document.getElementById('fileInfo');

    var transmitBtn = document.getElementById('transmitBtn');
    var stopBtn = document.getElementById('stopBtn');
    var progressFill = document.getElementById('progressFill');
    var progressText = document.getElementById('progressText');
    var imageArrow = document.getElementById('imageArrow');

    var statBytes = document.getElementById('statBytes');
    var statErrors = document.getElementById('statErrors');
    var statErrorRate = document.getElementById('statErrorRate');
    var statETA = document.getElementById('statETA');

    // Scanline overlay
    var sourceWrap = document.getElementById('sourceWrap');
    var scanCanvas = document.createElement('canvas');
    scanCanvas.width = 256;
    scanCanvas.height = 256;
    scanCanvas.style.cssText = 'position:absolute;top:0;left:0;width:256px;height:256px;pointer-events:none;image-rendering:pixelated;';
    sourceWrap.appendChild(scanCanvas);
    var scanCtx = scanCanvas.getContext('2d');

    var sourceData = null;       // Uint8Array of raw bytes
    var sourceFileType = null;   // 'image' | 'text' | 'binary'
    var sourceImageData = null;  // ImageData for image files

    // Loading spinner
    var loadingRaf = null;
    var loadingStart = 0;

    function startLoadingSpinner() {
        uploadOverlay.classList.add('hidden');
        loadingStart = performance.now();
        function drawSpinner() {
            var t = (performance.now() - loadingStart) / 1000;
            sourceCtx.fillStyle = '#0a0e14';
            sourceCtx.fillRect(0, 0, 256, 256);
            var cx = 128, cy = 128, r = 22, lw = 3;
            // Track ring
            sourceCtx.beginPath();
            sourceCtx.arc(cx, cy, r, 0, Math.PI * 2);
            sourceCtx.strokeStyle = 'rgba(88,166,255,0.15)';
            sourceCtx.lineWidth = lw;
            sourceCtx.stroke();
            // Spinning arc
            var start = t * Math.PI * 2.2;
            sourceCtx.beginPath();
            sourceCtx.arc(cx, cy, r, start, start + Math.PI * 1.1);
            sourceCtx.strokeStyle = '#58a6ff';
            sourceCtx.lineWidth = lw;
            sourceCtx.lineCap = 'round';
            sourceCtx.stroke();
            sourceCtx.lineCap = 'butt';
            // Label
            sourceCtx.fillStyle = 'rgba(88,166,255,0.6)';
            sourceCtx.font = '10px Inter, sans-serif';
            sourceCtx.textAlign = 'center';
            sourceCtx.fillText('Loading…', cx, cy + r + 16);
            loadingRaf = requestAnimationFrame(drawSpinner);
        }
        loadingRaf = requestAnimationFrame(drawSpinner);
    }

    function stopLoadingSpinner() {
        if (loadingRaf) { cancelAnimationFrame(loadingRaf); loadingRaf = null; }
    }

    var CONNECTION_HINTS = {
        white: 'Single white LED → sends R, G, B sequentially (3x slower)',
        rgb: 'Red + Green + Blue LEDs in parallel (3x faster for images)',
        infrared: 'IR LED + TSOP1738 demodulator — 2400 Hz, invisible beam, sunlight-sensitive',
        laser: '650nm laser diode + BPW34 — 10 kHz, focused beam, very low noise',
        fiber: '100 Mbps Ethernet → SFP media converter → fiber optic'
    };

    var SENSOR_HINTS = {
        photoresistor: 'CdS cell GL5528 — ~20 Hz, slow response, noisy',
        photodiode: 'BPW34 + MCP3008 ADC — ~1 kHz, fast, low noise'
    };

    var ENCODING_HINTS = {
        analog8: '256 brightness levels per sample → 8 bits. Needs good SNR.',
        analog4: '16 brightness levels per sample → 4 bits. More noise-tolerant.',
        binary: 'On/off per bit → 1 bit per sample. Most robust.',
        manchester: 'Transition encoding → 0.5 bits/sample. Best clock recovery.',
        hamming74: 'Hamming(7,4) ECC — sends 7 bits per 4 data bits. Auto-corrects any single-bit error.',
        ppm4: '4-PPM — pulse in 1 of 4 slots → 0.5 bits/sample. Peak detection, very noise-tolerant.'
    };

    function updateConfig() {
        var config = {
            connectionType: connectionType.value,
            sensorType: sensorType.value,
            encoding: encoding.value,
            noise: parseInt(noiseSlider.value),
            simSpeed: parseInt(simSpeed.value)
        };
        engine.configure(config);
        scene.updateConfig(config);

        connectionHint.textContent = CONNECTION_HINTS[config.connectionType];
        sensorHint.textContent = SENSOR_HINTS[config.sensorType];
        encodingHint.textContent = ENCODING_HINTS[config.encoding];
        noiseValue.textContent = config.noise + '%';

        // Hide sensor/encoding for fiber and fixed-receiver connections
        var isFiber = config.connectionType === 'fiber';
        var fixedReceiver = isFiber || config.connectionType === 'infrared' || config.connectionType === 'laser';
        sensorGroup.style.display = fixedReceiver ? 'none' : '';
        encoding.parentElement.style.display = isFiber ? 'none' : '';
        noiseGroup.style.display = isFiber ? 'none' : '';

        updateSpeedDisplay();
    }

    function updateSpeedDisplay() {
        var ct = connectionType.value;
        var isFiber = ct === 'fiber';

        if (isFiber) {
            sensorRateEl.textContent = 'N/A';
            bitsPerSampleEl.textContent = 'N/A';
            throughputEl.textContent = '94 Mbps';
        } else {
            var sr = engine.getSensorRate();
            var bps_raw = engine.getBitsPerSample();
            sensorRateEl.textContent = sr + ' Hz';
            bitsPerSampleEl.textContent = Number.isInteger(bps_raw) ? bps_raw : bps_raw.toFixed(2);
            var bps = engine.getBytesPerSec() * 8;
            if (bps >= 1000000) {
                throughputEl.textContent = (bps / 1000000).toFixed(1) + ' Mbps';
            } else if (bps >= 1000) {
                throughputEl.textContent = (bps / 1000).toFixed(1) + ' kbps';
            } else {
                throughputEl.textContent = bps.toFixed(0) + ' bps';
            }
        }

        var totalTime = engine.getFullImageTime();
        if (totalTime < 1) {
            fullImageTimeEl.textContent = '<1s';
        } else if (totalTime < 60) {
            fullImageTimeEl.textContent = '~' + Math.round(totalTime) + 's';
        } else if (totalTime < 3600) {
            fullImageTimeEl.textContent = '~' + (totalTime / 60).toFixed(1) + ' min';
        } else {
            fullImageTimeEl.textContent = '~' + (totalTime / 3600).toFixed(1) + ' hrs';
        }
    }

    function formatNum(n) {
        return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function resetStats() {
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        statBytes.textContent = '0 / 0';
        statErrors.textContent = '0';
        statErrorRate.textContent = '0%';
        statETA.textContent = '--';
    }

    // ── File Loading ──

    function handleFileLoad(file) {
        var name = file.name;
        var ext = name.split('.').pop().toLowerCase();
        startLoadingSpinner();

        if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].indexOf(ext) >= 0) {
            loadImageFile(file);
        } else {
            loadTextOrBinaryFile(file, ext);
        }
    }

    function loadImageFile(file) {
        pendingFilename = file.name;
        var reader = new FileReader();
        reader.onload = function(e) {
            var img = new Image();
            img.onload = function() {
                stopLoadingSpinner(); // stop before cropper draws on canvas
                sourceFileType = 'image';
                uploadOverlay.classList.add('hidden');
                // Cropper handles downscaling + crop UI on source canvas
                if (window._cropper) {
                    window._cropper.loadImage(img);
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    var pendingFilename = 'image.png';

    function loadTextOrBinaryFile(file, ext) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var bytes = new Uint8Array(e.target.result);
            sourceData = bytes;

            if (['txt', 'csv', 'json', 'xml', 'html', 'md'].indexOf(ext) >= 0) {
                sourceFileType = 'text';
            } else {
                sourceFileType = 'binary';
            }

            stopLoadingSpinner();
            // Render preview on source canvas
            renderDataPreview(sourceCtx, bytes, sourceFileType);
            uploadOverlay.classList.add('hidden');
            fileInfo.textContent = file.name + ' · ' + formatSize(bytes.length);
            transmitBtn.disabled = false;
            receivedCtx.clearRect(0, 0, 256, 256);
            scanCtx.clearRect(0, 0, 256, 256);
            resetStats();
        };
        reader.readAsArrayBuffer(file);
    }

    function renderDataPreview(ctx, bytes, type) {
        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(0, 0, 256, 256);

        if (type === 'text') {
            var decoder = new TextDecoder('utf-8', { fatal: false });
            var text = decoder.decode(bytes);
            ctx.fillStyle = '#58a6ff';
            ctx.font = '10px JetBrains Mono, monospace';
            ctx.textAlign = 'left';
            var lines = text.split('\n');
            var y = 14;
            for (var i = 0; i < lines.length && y < 256; i++) {
                ctx.fillText(lines[i].substring(0, 38), 6, y);
                y += 12;
            }
        } else {
            // Binary hex dump
            ctx.fillStyle = '#3fb950';
            ctx.font = '8px JetBrains Mono, monospace';
            ctx.textAlign = 'left';
            var y = 10;
            for (var i = 0; i < bytes.length && y < 256; i += 16) {
                var hex = '';
                for (var j = 0; j < 16 && i + j < bytes.length; j++) {
                    hex += bytes[i + j].toString(16).padStart(2, '0') + ' ';
                }
                ctx.fillText(hex, 4, y);
                y += 10;
            }
        }
    }

    // Detect binary file type from magic bytes
    function detectFileType(bytes) {
        if (!bytes || bytes.length < 4) return '';
        if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'PDF';
        if (bytes[0] === 0x50 && bytes[1] === 0x4B) return 'ZIP';
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'PNG';
        if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'JPEG';
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'GIF';
        if (bytes[0] === 0x42 && bytes[1] === 0x4D) return 'BMP';
        return '';
    }

    // Progressive received display — shows only received portion with error highlighting
    function renderReceivedPreview(ctx, eng, type) {
        var received = eng.currentByte;
        var total = eng.totalBytes;
        var src = eng.sourceBytes;
        var res = eng.resultBytes;

        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(0, 0, 256, 256);

        if (received === 0) {
            ctx.fillStyle = 'rgba(88,166,255,0.2)';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Awaiting data…', 128, 128);
            return;
        }

        if (type === 'text') {
            var decoder = new TextDecoder('utf-8', { fatal: false });
            var text = decoder.decode(res.subarray(0, received));
            ctx.font = '10px JetBrains Mono, monospace';
            ctx.textAlign = 'left';
            var lines = text.split('\n');
            var y = 14;
            for (var i = 0; i < lines.length && y < 244; i++) {
                var line = lines[i].substring(0, 38);
                ctx.fillStyle = '#58a6ff';
                ctx.fillText(line, 6, y);
                y += 12;
            }
            // Blinking cursor
            if (received < total) {
                var now = Date.now();
                if (Math.floor(now / 500) % 2 === 0) {
                    ctx.fillStyle = '#58a6ff';
                    ctx.fillRect(6 + (lines[lines.length - 1] || '').length * 6.02, y - 12, 4, 9);
                }
            }
        } else {
            // Binary/PDF progressive hex dump
            var fileLabel = detectFileType(res);
            ctx.font = '8px JetBrains Mono, monospace';
            ctx.textAlign = 'left';
            var bytesPerRow = 16;
            var y = 12;

            for (var i = 0; i < total && y < 248; i += bytesPerRow) {
                var rowEnd = Math.min(i + bytesPerRow, total);
                var x = 4;
                for (var j = i; j < rowEnd; j++) {
                    var hexStr = res[j].toString(16).padStart(2, '0');
                    if (j >= received) {
                        // Not yet received — dim dots
                        ctx.fillStyle = 'rgba(63,185,80,0.12)';
                        ctx.fillText('··', x, y);
                    } else if (src && res[j] !== src[j]) {
                        // Error byte — red/orange
                        ctx.fillStyle = '#f85149';
                        ctx.fillText(hexStr, x, y);
                    } else {
                        // Correct received byte — green
                        ctx.fillStyle = '#3fb950';
                        ctx.fillText(hexStr, x, y);
                    }
                    x += 15;
                }
                y += 10;
            }

            // File type badge
            if (fileLabel) {
                ctx.fillStyle = 'rgba(88,166,255,0.18)';
                ctx.fillRect(192, 2, 60, 16);
                ctx.fillStyle = '#58a6ff';
                ctx.font = 'bold 8px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(fileLabel, 222, 13);
            }
        }

        // Progress stripe at bottom
        var pct = received / total;
        ctx.fillStyle = 'rgba(88,166,255,0.08)';
        ctx.fillRect(0, 252, 256, 4);
        ctx.fillStyle = '#58a6ff';
        ctx.fillRect(0, 252, Math.round(256 * pct), 4);
    }

    // ── Transmission ──

    var needsReceivedUpdate = false;

    function scheduleReceivedUpdate() {
        if (needsReceivedUpdate) return;
        needsReceivedUpdate = true;
        requestAnimationFrame(function() {
            needsReceivedUpdate = false;
            if (sourceFileType === 'image') {
                var imgData = engine.getPartialImageData();
                if (imgData) receivedCtx.putImageData(imgData, 0, 0);
            } else {
                renderReceivedPreview(receivedCtx, engine, sourceFileType);
            }
        });
    }

    function onProgress(stats) {
        var pct = parseFloat(stats.percent);
        progressFill.style.width = pct + '%';
        progressText.textContent = stats.percent + '%';
        statBytes.textContent = formatSize(stats.bytesDone) + ' / ' + formatSize(stats.bytesTotal);
        statErrors.textContent = formatNum(stats.errors);
        statErrorRate.textContent = stats.errorRate;
        statETA.textContent = stats.eta;

        // Scan line for images
        if (sourceFileType === 'image') {
            var currentPixel = Math.floor(stats.currentByte / 3);
            var currentRow = Math.floor(currentPixel / 256);
            scanCtx.clearRect(0, 0, 256, 256);
            if (currentRow < 256) {
                scanCtx.fillStyle = 'rgba(88, 166, 255, 0.35)';
                scanCtx.fillRect(0, currentRow, 256, 1);
                scanCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                scanCtx.fillRect(0, currentRow + 1, 256, 256 - currentRow - 1);
            }
        }

        scheduleReceivedUpdate();
    }

    function onComplete(stats) {
        if (sourceFileType === 'image') {
            var imgData = engine.getResultImageData();
            if (imgData) receivedCtx.putImageData(imgData, 0, 0);
        } else {
            renderReceivedPreview(receivedCtx, engine, sourceFileType);
        }
        scanCtx.clearRect(0, 0, 256, 256);

        progressFill.style.width = '100%';
        progressText.textContent = '100%';
        statBytes.textContent = formatSize(stats.bytesTotal) + ' / ' + formatSize(stats.bytesTotal);
        statErrors.textContent = formatNum(stats.errors);
        statErrorRate.textContent = stats.errorRate;
        statETA.textContent = 'Done';

        transmitBtn.disabled = false;
        stopBtn.disabled = true;
        imageArrow.classList.remove('active');
        scene.setTransmitting(false);
    }

    function startTransmission() {
        if (!sourceData) return;

        receivedCtx.clearRect(0, 0, 256, 256);
        resetStats();

        transmitBtn.disabled = true;
        stopBtn.disabled = false;
        imageArrow.classList.add('active');
        scene.setTransmitting(true);

        engine.fileType = sourceFileType;
        engine.start(sourceData, sourceFileType, {
            onProgress: onProgress,
            onComplete: onComplete
        });
    }

    function stopTransmission() {
        engine.stop();
        transmitBtn.disabled = false;
        stopBtn.disabled = true;
        imageArrow.classList.remove('active');
        scene.setTransmitting(false);
        scanCtx.clearRect(0, 0, 256, 256);

        if (sourceFileType === 'image') {
            var imgData = engine.getPartialImageData();
            if (imgData) receivedCtx.putImageData(imgData, 0, 0);
        }
    }

    // Event listeners
    connectionType.addEventListener('change', updateConfig);
    sensorType.addEventListener('change', updateConfig);
    encoding.addEventListener('change', updateConfig);
    noiseSlider.addEventListener('input', updateConfig);
    simSpeed.addEventListener('change', updateConfig);
    transmitBtn.addEventListener('click', startTransmission);
    stopBtn.addEventListener('click', stopTransmission);

    fileInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (file) handleFileLoad(file);
    });

    // Drag and drop support
    var sourceWrapEl = document.getElementById('sourceWrap');
    sourceWrapEl.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadOverlay.classList.remove('hidden');
        uploadOverlay.style.borderColor = 'var(--accent)';
    });
    sourceWrapEl.addEventListener('dragleave', function(e) {
        e.preventDefault();
        uploadOverlay.style.borderColor = '';
    });
    sourceWrapEl.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadOverlay.style.borderColor = '';
        var file = e.dataTransfer && e.dataTransfer.files[0];
        if (file) handleFileLoad(file);
    });

    updateConfig();

    return {
        onImageCropped: function(imageData) {
            stopLoadingSpinner();
            var rgbBytes = new Uint8Array(256 * 256 * 3);
            for (var i = 0; i < 256 * 256; i++) {
                rgbBytes[i * 3] = imageData.data[i * 4];
                rgbBytes[i * 3 + 1] = imageData.data[i * 4 + 1];
                rgbBytes[i * 3 + 2] = imageData.data[i * 4 + 2];
            }
            sourceData = rgbBytes;
            sourceFileType = 'image';
            sourceImageData = imageData;
            sourceCtx.putImageData(imageData, 0, 0);
            uploadOverlay.classList.add('hidden');
            fileInfo.textContent = pendingFilename + ' · ' + formatSize(rgbBytes.length);
            transmitBtn.disabled = false;
            receivedCtx.clearRect(0, 0, 256, 256);
            scanCtx.clearRect(0, 0, 256, 256);
            resetStats();
        }
    };
}
