/*
 * TransmissionEngine - simulates real data transmission via light or fiber.
 *
 * SPEED JUSTIFICATION (real hardware):
 *
 * Sensor sampling rates (bottleneck for LED modes):
 *   Photoresistor (LDR): Rise ~10ms, fall ~50ms → max ~16-20 Hz usable.
 *     We use 20 Hz. This is the CdS cell GL5528 commonly used with RPi.
 *   Photodiode (BPW34): Rise/fall ~1μs → limited by ADC.
 *     RPi has no built-in ADC. With MCP3008 SPI ADC: ~200kHz max,
 *     but practical rate with Python/SPI overhead: ~1-5 kHz.
 *     We use 1000 Hz (conservative DIY teenager setup).
 *
 * Encoding algorithms (bits transmitted per sensor sample):
 *   Analog 8-bit: 256 brightness levels → 8 bits per sample.
 *     Requires good SNR and 10-bit ADC. Realistic with photodiode.
 *   Analog 4-bit: 16 brightness levels → 4 bits per sample.
 *     More noise-tolerant. Works OK with LDR.
 *   Binary: on/off → 1 bit per sample. Most noise-resistant.
 *   Manchester: transition-based encoding → 0.5 bits per sample.
 *     Better clock recovery but halves throughput.
 *   Hamming(7,4) ECC: 4 data bits encoded as 7-bit codeword.
 *     Corrects all single-bit errors per codeword. Effective: 4/7 bits/sample.
 *   4-PPM: 2 data bits encoded as pulse at 1-of-4 positions.
 *     0.5 bits/sample; very noise-tolerant (peak detection, not threshold).
 *
 * Channel multiplier:
 *   White LED: R,G,B sent sequentially → 3x slower per pixel.
 *   RGB LEDs: all 3 channels in parallel → 1x.
 *   Fiber optic: 100 Mbps Ethernet → media converter → fiber.
 *     Actual throughput ~94 Mbps (Ethernet overhead). We use 94 Mbps.
 *   Infrared (IR LED + TSOP1738): ~2400 Hz usable sample rate.
 *     High ambient-light susceptibility. Single channel only.
 *   Laser diode (650nm + BPW34): ~10,000 Hz with fast ADC.
 *     Very high SNR due to focused beam. Lowest noise of all optical modes.
 *
 * Image data: 256×256 × 3 bytes (RGB) = 196,608 bytes = 1,572,864 bits.
 */

function TransmissionEngine() {
    this.running = false;
    this.sourceBytes = null;   // Uint8Array of raw bytes to transmit
    this.resultBytes = null;   // Uint8Array of received bytes
    this.totalBytes = 0;
    this.currentByte = 0;
    this.fileType = 'image';   // 'image' | 'text' | 'binary'
    this.imageWidth = 256;
    this.imageHeight = 256;

    this.config = {
        connectionType: 'white',   // white | rgb | fiber
        sensorType: 'photoresistor',
        encoding: 'analog8',       // analog8 | analog4 | binary | manchester
        noise: 15,
        simSpeed: 100
    };

    this.stats = {
        bytesDone: 0,
        errors: 0,
        startTime: 0
    };

    this.onProgress = null;
    this.onComplete = null;
    this._rafId = null;
    this._lastTick = 0;
    this._accumulator = 0;
}

TransmissionEngine.prototype.configure = function(config) {
    if (config.connectionType !== undefined) this.config.connectionType = config.connectionType;
    if (config.sensorType !== undefined) this.config.sensorType = config.sensorType;
    if (config.encoding !== undefined) this.config.encoding = config.encoding;
    if (config.noise !== undefined) this.config.noise = config.noise;
    if (config.simSpeed !== undefined) this.config.simSpeed = config.simSpeed;
};

// Returns sensor samples per second
TransmissionEngine.prototype.getSensorRate = function() {
    var ct = this.config.connectionType;
    if (ct === 'fiber') return null;        // N/A
    if (ct === 'infrared') return 2400;     // TSOP1738 IrDA compatible
    if (ct === 'laser') return 10000;       // Fast ADC with low-noise photodiode
    return this.config.sensorType === 'photodiode' ? 1000 : 20;
};

// Returns effective data bits per sensor sample for current encoding
TransmissionEngine.prototype.getBitsPerSample = function() {
    switch (this.config.encoding) {
        case 'analog8':    return 8;
        case 'analog4':    return 4;
        case 'binary':     return 1;
        case 'manchester': return 0.5;
        case 'hamming74':  return 4 / 7;   // 7 bits sent, 4 data bits recovered
        case 'ppm4':       return 0.5;     // 2 data bits per 4-slot symbol
        default:           return 8;
    }
};

// Returns throughput in bits per second
TransmissionEngine.prototype.getThroughputBps = function() {
    return this.getBytesPerSec() * 8;
};

// Returns bytes per second (practical data throughput)
TransmissionEngine.prototype.getBytesPerSec = function() {
    var ct = this.config.connectionType;
    if (ct === 'fiber') return 94000000 / 8; // ~11.75 MB/s
    var sensorRate = this.getSensorRate();
    var bitsPerSample = this.getBitsPerSample();
    var parallelChannels = 1;
    // RGB parallel only applies to visible LED modes for image files
    if (ct === 'rgb' && this.fileType === 'image') parallelChannels = 3;
    return (sensorRate * bitsPerSample * parallelChannels) / 8;
};

TransmissionEngine.prototype.getFullImageTime = function() {
    var bytesPerSec = this.getBytesPerSec();
    var totalBytes = 256 * 256 * 3; // RGB image
    return totalBytes / bytesPerSec;
};

TransmissionEngine.prototype.start = function(sourceBytes, fileType, callbacks) {
    this.sourceBytes = sourceBytes;
    this.fileType = fileType;
    this.totalBytes = sourceBytes.length;
    this.resultBytes = new Uint8Array(this.totalBytes);
    this.currentByte = 0;
    this.stats.bytesDone = 0;
    this.stats.errors = 0;
    this.stats.startTime = performance.now();
    this.running = true;

    this.onProgress = callbacks.onProgress || null;
    this.onComplete = callbacks.onComplete || null;

    this._lastTick = performance.now();
    this._accumulator = 0;
    this._scheduleFrame();
};

TransmissionEngine.prototype.stop = function() {
    this.running = false;
    if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
    }
};

TransmissionEngine.prototype._scheduleFrame = function() {
    var self = this;
    this._rafId = requestAnimationFrame(function(timestamp) {
        if (!self.running) return;
        self._tick(timestamp);
    });
};

TransmissionEngine.prototype._tick = function(timestamp) {
    if (!this.running) return;

    var dt = timestamp - this._lastTick;
    this._lastTick = timestamp;

    var bytesPerSec = this.getBytesPerSec();
    var effectiveBPS = bytesPerSec * this.config.simSpeed;

    this._accumulator += effectiveBPS * (dt / 1000);
    var bytesThisFrame = Math.floor(this._accumulator);
    this._accumulator -= bytesThisFrame;

    // Cap to prevent freezing
    bytesThisFrame = Math.min(bytesThisFrame, 50000);

    var remaining = this.totalBytes - this.currentByte;
    var toProcess = Math.min(bytesThisFrame, remaining);

    for (var i = 0; i < toProcess; i++) {
        this._transmitByte(this.currentByte);
        this.currentByte++;
        this.stats.bytesDone++;
    }

    if (this.onProgress && toProcess > 0) {
        this.onProgress(this.getDisplayStats());
    }

    if (this.currentByte >= this.totalBytes) {
        this.running = false;
        if (this.onComplete) {
            this.onComplete(this.getDisplayStats());
        }
        return;
    }

    this._scheduleFrame();
};

TransmissionEngine.prototype._transmitByte = function(idx) {
    var srcByte = this.sourceBytes[idx];
    var decoded;
    var ct = this.config.connectionType;

    if (ct === 'fiber') {
        // Fiber: virtually no noise, bit-perfect except rare CRC-escaped bit errors
        var nf = this.config.noise / 100;
        if (Math.random() < nf * 0.001) {
            decoded = srcByte ^ (1 << Math.floor(Math.random() * 8));
        } else {
            decoded = srcByte;
        }
    } else {
        decoded = this._transmitByteAnalog(srcByte);
    }

    if (decoded !== srcByte) this.stats.errors++;
    this.resultBytes[idx] = decoded;
};

TransmissionEngine.prototype._transmitByteAnalog = function(value) {
    var nf = this.config.noise / 100;
    var encoding = this.config.encoding;
    var ct = this.config.connectionType;

    // Laser has very high SNR — tight beam, minimal ambient pickup
    if (ct === 'laser') nf = nf * 0.25;
    // Infrared is susceptible to sunlight DC bias (raises noise floor)
    if (ct === 'infrared') nf = nf * 1.4;

    if (encoding === 'binary') {
        // Transmit bit by bit, each bit is on/off
        var result = 0;
        for (var bit = 7; bit >= 0; bit--) {
            var srcBit = (value >> bit) & 1;
            var signal = srcBit ? 1.0 : 0.0;
            // Noise
            signal += this._gaussianRandom() * 0.15 * nf;
            if (this.config.sensorType === 'photoresistor') {
                signal += this._gaussianRandom() * 0.1 * nf;
            }
            signal += (Math.random() - 0.3) * 0.2 * nf;
            var decoded = signal > 0.5 ? 1 : 0;
            result |= (decoded << bit);
        }
        return result;

    } else if (encoding === 'manchester') {
        // Manchester: transition-based; more robust clock recovery
        var result = 0;
        for (var bit = 7; bit >= 0; bit--) {
            var srcBit = (value >> bit) & 1;
            var transitionSignal = srcBit ? 0.8 : 0.2;
            transitionSignal += this._gaussianRandom() * 0.12 * nf;
            if (this.config.sensorType === 'photoresistor') {
                transitionSignal += this._gaussianRandom() * 0.08 * nf;
            }
            var decoded = transitionSignal > 0.5 ? 1 : 0;
            result |= (decoded << bit);
        }
        return result;

    } else if (encoding === 'hamming74') {
        // Hamming(7,4): encode each nibble as 7-bit codeword.
        // Corrects ALL single-bit errors within each codeword.
        // Data positions: d0=cw[2], d1=cw[4], d2=cw[5], d3=cw[6]
        // Parity: p0=cw[0]=d0^d1^d3, p1=cw[1]=d0^d2^d3, p2=cw[3]=d1^d2^d3
        var result = 0;
        for (var nibble = 0; nibble < 2; nibble++) {
            var d = (value >> (nibble * 4)) & 0xF;
            var d0 = (d >> 0) & 1, d1 = (d >> 1) & 1, d2 = (d >> 2) & 1, d3 = (d >> 3) & 1;
            var cw = [d0^d1^d3, d0^d2^d3, d0, d1^d2^d3, d1, d2, d3];
            // Transmit 7 bits with noise
            var rx = [];
            for (var b = 0; b < 7; b++) {
                var sig = cw[b] ? 1.0 : 0.0;
                sig += this._gaussianRandom() * 0.15 * nf;
                if (this.config.sensorType === 'photoresistor') sig += this._gaussianRandom() * 0.10 * nf;
                sig += (Math.random() - 0.3) * 0.20 * nf;
                rx.push(sig > 0.5 ? 1 : 0);
            }
            // Syndrome decode: correct up to 1 bit error per codeword
            var s0 = rx[0] ^ rx[2] ^ rx[4] ^ rx[6];
            var s1 = rx[1] ^ rx[2] ^ rx[5] ^ rx[6];
            var s2 = rx[3] ^ rx[4] ^ rx[5] ^ rx[6];
            var syn = s0 + s1 * 2 + s2 * 4; // 1-indexed error position
            if (syn > 0 && syn <= 7) rx[syn - 1] ^= 1;
            // Extract data bits
            var dec = rx[2] | (rx[4] << 1) | (rx[5] << 2) | (rx[6] << 3);
            result |= (dec << (nibble * 4));
        }
        return result;

    } else if (encoding === 'ppm4') {
        // 4-PPM: 2 bits → 1 pulse in one of 4 time slots.
        // Decoder picks the slot with the highest received energy (peak detection).
        var result = 0;
        for (var pair = 3; pair >= 0; pair--) {
            var sym = (value >> (pair * 2)) & 0x3; // 2 data bits
            var rxSlots = [0, 0, 0, 0];
            for (var s = 0; s < 4; s++) {
                var sent = s === sym ? 1.0 : 0.0;
                sent += this._gaussianRandom() * 0.22 * nf;
                if (this.config.sensorType === 'photoresistor') sent += this._gaussianRandom() * 0.14 * nf;
                sent += (Math.random() - 0.3) * 0.18 * nf;
                rxSlots[s] = Math.max(0, Math.min(1, sent));
            }
            // Peak detection: highest amplitude slot wins
            var best = 0;
            for (var k = 1; k < 4; k++) {
                if (rxSlots[k] > rxSlots[best]) best = k;
            }
            result |= (best << (pair * 2));
        }
        return result;

    } else {
        // Analog encoding (8-bit or 4-bit)
        var levels = encoding === 'analog4' ? 16 : 256;
        var quantized = Math.round(value / 255 * (levels - 1));
        var signal = quantized / (levels - 1); // 0.0 to 1.0

        // Distance attenuation
        signal *= (1.0 - 0.10 * nf);

        // Sensor response
        if (this.config.sensorType === 'photoresistor') {
            signal = Math.pow(signal, 0.85); // Non-linear
            signal += this._gaussianRandom() * 0.08 * nf;
        } else {
            signal += this._gaussianRandom() * 0.02 * nf;
        }

        // Ambient light
        signal += (Math.random() - 0.3) * 0.12 * nf;

        // Decode back
        signal = Math.max(0, Math.min(1, signal));
        var decodedLevel = Math.round(signal * (levels - 1));
        return Math.round(decodedLevel / (levels - 1) * 255);
    }
};

TransmissionEngine.prototype._gaussianRandom = function() {
    var u1 = Math.random();
    var u2 = Math.random();
    if (u1 < 1e-10) u1 = 1e-10;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

TransmissionEngine.prototype.getDisplayStats = function() {
    var elapsed = (performance.now() - this.stats.startTime) / 1000;
    var rate = this.stats.bytesDone / Math.max(elapsed, 0.001);
    var remaining = (this.totalBytes - this.stats.bytesDone) / Math.max(rate, 0.001);

    return {
        bytesDone: this.stats.bytesDone,
        bytesTotal: this.totalBytes,
        errors: this.stats.errors,
        percent: (this.stats.bytesDone / this.totalBytes * 100).toFixed(1),
        errorRate: (this.stats.errors / Math.max(this.stats.bytesDone, 1) * 100).toFixed(1) + '%',
        eta: remaining < 3600 ? Math.ceil(remaining) + 's' : '>1h',
        currentByte: this.currentByte
    };
};

TransmissionEngine.prototype.getResultImageData = function() {
    if (this.fileType !== 'image') return null;
    var w = this.imageWidth;
    var h = this.imageHeight;
    var imgData = new ImageData(w, h);
    for (var i = 0; i < w * h; i++) {
        var si = i * 3;
        var di = i * 4;
        imgData.data[di] = si < this.resultBytes.length ? this.resultBytes[si] : 0;
        imgData.data[di + 1] = si + 1 < this.resultBytes.length ? this.resultBytes[si + 1] : 0;
        imgData.data[di + 2] = si + 2 < this.resultBytes.length ? this.resultBytes[si + 2] : 0;
        imgData.data[di + 3] = 255;
    }
    return imgData;
};

TransmissionEngine.prototype.getPartialImageData = function() {
    if (this.fileType !== 'image') return null;
    var w = this.imageWidth;
    var h = this.imageHeight;
    var imgData = new ImageData(w, h);
    var pixelsDone = Math.floor(this.currentByte / 3);
    for (var i = 0; i < pixelsDone && i < w * h; i++) {
        var si = i * 3;
        var di = i * 4;
        imgData.data[di] = this.resultBytes[si];
        imgData.data[di + 1] = this.resultBytes[si + 1];
        imgData.data[di + 2] = this.resultBytes[si + 2];
        imgData.data[di + 3] = 255;
    }
    return imgData;
};

TransmissionEngine.prototype.getResultText = function() {
    if (!this.resultBytes) return '';
    var decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(this.resultBytes.subarray(0, this.currentByte));
};
