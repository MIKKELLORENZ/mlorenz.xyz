/**
 * SpectrAudio - Griffin-Lim Algorithm Implementation
 * TensorFlow.js implementation of spectrogram to audio conversion
 */
class GriffinLim {
    /**
     * Constructor for Griffin-Lim algorithm implementation
     * @param {Object} options - Configuration options
     * @param {number} options.fftSize - FFT size, default 2048
     * @param {number} options.iterations - Number of Griffin-Lim iterations, default 30
     * @param {number} options.sampleRate - Audio sample rate, default 44100
     */
    constructor(options = {}) {
        this.fftSize = options.fftSize || 2048;
        this.hopLength = Math.floor(this.fftSize / 4); // 75% overlap
        this.iterations = options.iterations || 30;
        this.sampleRate = options.sampleRate || 44100;
        this.window = this._createHannWindow(this.fftSize);
    }

    /**
     * Convert image data to spectrogram
     * @param {ImageData} imageData - Image data from canvas
     * @param {Object} options - Configuration options
     * @param {number} options.minFreq - Minimum frequency in Hz
     * @param {number} options.maxFreq - Maximum frequency in Hz
     * @returns {tf.Tensor2D} - Magnitude spectrogram tensor
     */
    imageToSpectrogram(imageData, options = {}) {
        const { width, height, data } = imageData;
        const { minFreq = 0, maxFreq = 20000 } = options;
        
        console.log(`Converting ${width}x${height} image to spectrogram...`);
        
        // Calculate frequency range
        const nyquist = this.sampleRate / 2;
        const freqBinSize = nyquist / (this.fftSize / 2);
        
        // Calculate frequency bin indices
        const minBin = Math.floor(minFreq / freqBinSize);
        const maxBin = Math.min(Math.ceil(maxFreq / freqBinSize), this.fftSize / 2);
        const usableBins = maxBin - minBin;
        
        // Create a scaling factor based on image height to frequency bins
        const scaleFactor = usableBins / height;
        
        try {
            // Extract grayscale values from RGBA and flip vertically
            const specData = new Float32Array(width * usableBins);
            
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    // Map image y to frequency bin
                    const binY = Math.floor((height - 1 - y) * scaleFactor) + minBin;
                    if (binY >= minBin && binY < maxBin) {
                        // Get grayscale from RGBA (use the average of RGB for simplicity)
                        const pixelPos = (y * width + x) * 4;
                        const r = data[pixelPos] / 255;
                        const g = data[pixelPos + 1] / 255;
                        const b = data[pixelPos + 2] / 255;
                        const gray = (r + g + b) / 3; // Simple RGB average
                        
                        // Store in specData
                        specData[(binY - minBin) * width + x] = gray;
                    }
                }
            }
            
            // Create tensor from specData
            return tf.tensor2d(specData, [usableBins, width]);
        } catch (err) {
            console.error("Error converting image to spectrogram:", err);
            throw err;
        }
    }

    /**
     * Reconstruct audio from magnitude spectrogram using Griffin-Lim
     * @param {tf.Tensor2D} magnitudes - Magnitude spectrogram tensor
     * @param {number} duration - Desired audio duration in seconds
     * @param {Function} progressCallback - Callback for reporting progress (0-1)
     * @returns {Float32Array} - Audio samples
     */
    async reconstruct(magnitudes, duration, progressCallback = null) {
        if (!magnitudes || magnitudes.shape.length !== 2) {
            throw new Error("Invalid magnitude spectrogram provided");
        }

        const [freqBins, timeFrames] = magnitudes.shape;
        console.log(`Reconstructing audio from spectrogram: ${freqBins}x${timeFrames}`);
        
        // Calculate target length
        const targetLength = Math.floor(duration * this.sampleRate);
        
        // Create random phase
        console.log("Initializing random phase...");
        let phase = tf.randomUniform([freqBins, timeFrames], 0, 2 * Math.PI);
        
        // Initialize complex spectrogram
        console.log("Creating initial complex spectrogram...");
        let complexSpec = tf.tidy(() => {
            const real = tf.mul(magnitudes, tf.cos(phase));
            const imag = tf.mul(magnitudes, tf.sin(phase));
            return tf.complex(real, imag);
        });
        
        // Report initial progress
        if (progressCallback) {
            progressCallback(0.02); // Small initial progress
            // Force UI update
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        // Griffin-Lim iterations
        let prevSpec = null;
        
        for (let i = 0; i < this.iterations; i++) {
            // Update progress at start of each iteration
            if (progressCallback) {
                // Scale to 90% of total progress (save 10% for final processing)
                const iterProgress = 0.05 + (i / this.iterations) * 0.85;
                progressCallback(iterProgress);
                
                // Force browser to render by yielding to event loop
                if (i % 2 === 0) {
                    console.log(`Griffin-Lim iteration ${i+1}/${this.iterations} (${Math.round(iterProgress * 100)}%)`);
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            // Temporary tensors to dispose after each iteration
            const tempTensors = [];
            
            try {
                // Inverse STFT
                const audioSamples = await this._istft(complexSpec, targetLength);
                
                // Forward STFT 
                const newComplex = await this._stft(audioSamples);
                tempTensors.push(newComplex);
                
                // Update phase - properly extract real and imag components
                const realPart = tf.real(newComplex);
                const imagPart = tf.imag(newComplex);
                tempTensors.push(realPart, imagPart);
                
                // Calculate new phase
                const newPhase = tf.tidy(() => tf.atan2(imagPart, realPart));
                tempTensors.push(newPhase);
                
                // Create new complex spectrogram with original magnitudes and updated phase
                const newReal = tf.mul(magnitudes, tf.cos(newPhase));
                const newImag = tf.mul(magnitudes, tf.sin(newPhase));
                tempTensors.push(newReal, newImag);
                
                // Dispose previous complex spec
                if (prevSpec) prevSpec.dispose();
                prevSpec = complexSpec;
                
                // Update complex spectrogram
                complexSpec = tf.complex(newReal, newImag);
                
                // Clean up temporary tensors
                tempTensors.forEach(tensor => tensor.dispose());
                
            } catch (e) {
                // Clean up on error
                tempTensors.forEach(tensor => {
                    if (tensor) tensor.dispose();
                });
                if (prevSpec) prevSpec.dispose();
                if (complexSpec) complexSpec.dispose();
                throw e;
            }
        }
        
        // Final reconstruction
        if (progressCallback) {
            progressCallback(0.9); // 90% done
            console.log("Final audio reconstruction...");
            // Force UI update
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        // Get final audio
        console.log("Generating final audio waveform...");
        const audioSamples = await this._istft(complexSpec, targetLength);
        
        // Clean up tensors
        if (prevSpec) prevSpec.dispose();
        complexSpec.dispose();
        phase.dispose();
        
        if (progressCallback) {
            progressCallback(1.0); // Done
            console.log("Audio reconstruction complete!");
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        return audioSamples;
    }

    /**
     * Create a WAV file from audio samples
     * @param {Float32Array} samples - Audio samples
     * @returns {Blob} - WAV file blob
     */
    createWavFile(samples) {
        // Create WAV header
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        
        // WAV header (44 bytes)
        // "RIFF" chunk descriptor
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        this._writeString(view, 8, 'WAVE');
        
        // "fmt " sub-chunk
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // subchunk1Size (16 for PCM)
        view.setUint16(20, 1, true); // audioFormat (1 for PCM)
        view.setUint16(22, 1, true); // numChannels (1 for mono)
        view.setUint32(24, this.sampleRate, true); // sampleRate
        view.setUint32(28, this.sampleRate * 2, true); // byteRate (sampleRate * numChannels * bytesPerSample)
        view.setUint16(32, 2, true); // blockAlign (numChannels * bytesPerSample)
        view.setUint16(34, 16, true); // bitsPerSample
        
        // "data" sub-chunk
        this._writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true); // subchunk2Size
        
        // Write audio data
        const volume = 0.9; // Avoid clipping
        for (let i = 0; i < samples.length; i++) {
            // Convert float to 16-bit PCM
            const sample = Math.max(-1, Math.min(1, samples[i])) * volume;
            const pcm = Math.floor(sample * 32767);
            view.setInt16(44 + i * 2, pcm, true);
        }
        
        return new Blob([buffer], {type: 'audio/wav'});
    }

    /**
     * Create a Hann window for STFT
     * @param {number} length - Window length
     * @returns {Float32Array} - Window function
     * @private
     */
    _createHannWindow(length) {
        const window = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
        }
        return window;
    }

    /**
     * Short-Time Fourier Transform
     * @param {Float32Array} samples - Audio samples
     * @returns {tf.Tensor} - Complex spectrogram
     * @private
     */
    async _stft(samples) {
        const frames = this._frame(samples);
        const windowedFrames = this._applyWindow(frames);
        const fftFrames = await this._fft(windowedFrames);
        return fftFrames;
    }

    /**
     * Inverse Short-Time Fourier Transform
     * @param {tf.Tensor} complexSpec - Complex spectrogram
     * @param {number} targetLength - Target audio length
     * @returns {Float32Array} - Audio samples
     * @private
     */
    async _istft(complexSpec, targetLength) {
        // For simplicity in this implementation, we'll use a faster approach:
        // 1. Convert to the time domain for each frame
        // 2. Apply window and overlap-add

        const [freqBins, timeFrames] = complexSpec.shape;
        const frameSize = (freqBins - 1) * 2; // Assuming we have N/2+1 frequency bins for N time samples
        
        // Create output buffer
        const expectedLength = (timeFrames - 1) * this.hopLength + frameSize;
        const output = new Float32Array(expectedLength);
        
        // Extract real and imaginary parts properly from complex tensor
        console.log("Extracting real and imaginary components...");
        const realTensor = tf.real(complexSpec);
        const imagTensor = tf.imag(complexSpec);
        
        // Convert to arrays
        const real = await realTensor.array();
        const imag = await imagTensor.array();
        
        // Clean up tensors we no longer need
        realTensor.dispose();
        imagTensor.dispose();
        
        console.log(`Processing ${timeFrames} frames for ISTFT...`);
        // Process in chunks to allow UI updates
        const chunkSize = Math.max(1, Math.floor(timeFrames / 10));
        
        for (let chunk = 0; chunk < timeFrames; chunk += chunkSize) {
            const endChunk = Math.min(chunk + chunkSize, timeFrames);
            
            for (let t = chunk; t < endChunk; t++) {
                // Extract this frame's data
                const frameReal = real.map(row => row[t]);
                const frameImag = imag.map(row => row[t]);
                
                // Mirror the spectrum (except DC and Nyquist)
                const fullReal = [...frameReal];
                const fullImag = [...frameImag];
                
                for (let i = freqBins - 2; i > 0; i--) {
                    fullReal.push(frameReal[i]);
                    fullImag.push(-frameImag[i]); // Conjugate
                }
                
                // Inverse FFT
                const samples = this._ifft(fullReal, fullImag);
                
                // Apply window and overlap-add
                for (let i = 0; i < samples.length; i++) {
                    samples[i] *= this.window[i];
                }
                
                // Overlap-add
                const start = t * this.hopLength;
                for (let i = 0; i < samples.length; i++) {
                    if (start + i < output.length) {
                        output[start + i] += samples[i];
                    }
                }
            }
            
            // Yield to UI thread every chunk
            if (chunk + chunkSize < timeFrames) {
                console.log(`ISTFT processing: ${Math.round((endChunk / timeFrames) * 100)}% complete`);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        // Normalize by window overlap factor
        const windowSum = this.hopLength / this._sumWindow();
        for (let i = 0; i < output.length; i++) {
            output[i] *= windowSum;
        }
        
        // Trim or pad to target length
        if (output.length > targetLength) {
            // Trim
            return output.slice(0, targetLength);
        } else if (output.length < targetLength) {
            // Pad
            const padded = new Float32Array(targetLength);
            padded.set(output);
            return padded;
        }
        
        return output;
    }

    /**
     * Sum window overlap for normalization
     * @returns {number} - Window overlap sum
     * @private
     */
    _sumWindow() {
        let sum = 0;
        const windowSquared = this.window.map(x => x * x);
        
        // Calculate overlapping window sum
        for (let i = 0; i < this.fftSize; i += this.hopLength) {
            for (let j = 0; j < this.hopLength && i + j < this.fftSize; j++) {
                sum += windowSquared[i + j];
            }
        }
        
        return sum;
    }

    /**
     * Split audio into overlapping frames
     * @param {Float32Array} samples - Audio samples
     * @returns {Array<Float32Array>} - Frames
     * @private
     */
    _frame(samples) {
        const numFrames = 1 + Math.floor((samples.length - this.fftSize) / this.hopLength);
        const frames = [];
        
        for (let i = 0; i < numFrames; i++) {
            const frame = new Float32Array(this.fftSize);
            const start = i * this.hopLength;
            
            // Copy samples to frame
            for (let j = 0; j < this.fftSize && start + j < samples.length; j++) {
                frame[j] = samples[start + j];
            }
            
            frames.push(frame);
        }
        
        return frames;
    }

    /**
     * Apply window function to frames
     * @param {Array<Float32Array>} frames - Audio frames
     * @returns {Array<Float32Array>} - Windowed frames
     * @private
     */
    _applyWindow(frames) {
        return frames.map(frame => {
            const windowed = new Float32Array(frame.length);
            for (let i = 0; i < frame.length; i++) {
                windowed[i] = frame[i] * this.window[i];
            }
            return windowed;
        });
    }

    /**
     * Fast Fourier Transform for each frame
     * @param {Array<Float32Array>} frames - Windowed frames
     * @returns {tf.Tensor} - Complex spectrogram
     * @private
     */
    async _fft(frames) {
        // We'll use TensorFlow.js for FFT
        // This is a simplified implementation
        
        const frameSize = frames[0].length;
        const numFrames = frames.length;
        const outputSize = Math.floor(frameSize / 2) + 1; // FFT size/2 + 1
        
        // Create real tensors for frames
        const realFrames = tf.tensor2d(
            frames.flat(),
            [numFrames, frameSize]
        );
        
        // Prepare result tensors
        const realOut = tf.buffer([outputSize, numFrames]);
        const imagOut = tf.buffer([outputSize, numFrames]);
        
        // Process each frame individually
        for (let t = 0; t < numFrames; t++) {
            const frame = tf.slice(realFrames, [t, 0], [1, frameSize]).reshape([frameSize]);
            
            // FFT using tf.spectral.rfft
            const fft = tf.spectral.rfft(frame);
            
            // Extract real and imaginary parts using tf functions (not methods)
            const realPart = tf.real(fft);
            const imagPart = tf.imag(fft);
            
            // Get the array data
            const real = await realPart.array();
            const imag = await imagPart.array();
            
            // Copy to output buffers
            for (let f = 0; f < outputSize; f++) {
                realOut.set(real[f], f, t);
                imagOut.set(imag[f], f, t);
            }
            
            // Clean up all tensors
            fft.dispose();
            frame.dispose();
            realPart.dispose();
            imagPart.dispose();
            
            // Log progress occasionally
            if (t % Math.max(1, Math.floor(numFrames / 5)) === 0) {
                console.log(`FFT processing: ${Math.round((t / numFrames) * 100)}%`);
                // Allow UI updates
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        // Clean up input tensor
        realFrames.dispose();
        
        // Create complex tensor
        return tf.complex(realOut.toTensor(), imagOut.toTensor());
    }

    /**
     * Simplified Inverse FFT implementation
     * @param {Array<number>} real - Real part
     * @param {Array<number>} imag - Imaginary part
     * @returns {Float32Array} - Time domain samples
     * @private
     */
    _ifft(real, imag) {
        const n = real.length;
        const output = new Float32Array(n);
        
        // Simplified inverse FFT implementation
        for (let k = 0; k < n; k++) {
            let sumReal = 0;
            let sumImag = 0;
            
            for (let t = 0; t < n; t++) {
                const angle = 2 * Math.PI * k * t / n;
                sumReal += real[t] * Math.cos(angle) + imag[t] * Math.sin(angle);
                sumImag += imag[t] * Math.cos(angle) - real[t] * Math.sin(angle);
            }
            
            output[k] = sumReal / n; // Scale by 1/N
        }
        
        return output;
    }

    /**
     * Helper to write string to DataView
     * @param {DataView} view - DataView to write to
     * @param {number} offset - Offset in bytes
     * @param {string} string - String to write
     * @private
     */
    _writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}
