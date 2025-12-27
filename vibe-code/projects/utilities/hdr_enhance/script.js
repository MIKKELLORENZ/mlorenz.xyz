class HDREnhancer {
    constructor() {
        this.originalImageData = null;
        this.hdrImageData = null;
        this.fullResImageData = null;
        this.originalCanvas = document.getElementById('originalCanvas');
        this.resultCanvas = document.getElementById('resultCanvas');
        this.originalCtx = this.originalCanvas.getContext('2d');
        this.resultCtx = this.resultCanvas.getContext('2d');
        this.currentImage = null;
        this.splitPosition = 50;
        
        // Worker code as a string to avoid file:// security issues
        const workerCode = `
            self.onmessage = function(e) {
                const { imageData, params } = e.data;
                const { width, height, data } = imageData;
                const outputData = new Uint8ClampedArray(data);
                
                const luminanceMap = new Float32Array(width * height);
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
                    luminanceMap[i / 4] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                }
                
                const integral = new Float64Array((width + 1) * (height + 1));
                for (let y = 0; y < height; y++) {
                    let rowSum = 0;
                    for (let x = 0; x < width; x++) {
                        rowSum += luminanceMap[y * width + x];
                        integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
                    }
                }
                
                const exposure = Math.pow(2, params.exposure);
                const shadows = params.shadows / 50, highlights = params.highlights / 50;
                const contrast = params.contrast / 100, detail = params.detail / 50;
                const vibrance = params.vibrance / 100, saturation = params.saturation / 100;
                const smoothing = params.smoothing / 100;
                const radius = Math.max(1, Math.round(20 * smoothing));
                
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const idx = (y * width + x) * 4;
                        let r = (data[idx] / 255) * exposure, g = (data[idx + 1] / 255) * exposure, b = (data[idx + 2] / 255) * exposure;
                        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                        
                        const x1 = Math.max(0, x - radius), y1 = Math.max(0, y - radius);
                        const x2 = Math.min(width, x + radius + 1), y2 = Math.min(height, y + radius + 1);
                        const area = (x2 - x1) * (y2 - y1);
                        const localMean = (integral[y2 * (width + 1) + x2] - integral[y1 * (width + 1) + x2] - integral[y2 * (width + 1) + x1] + integral[y1 * (width + 1) + x1]) / area;
                        
                        const shadowLift = Math.pow(lum, 0.5) * (shadows * 0.5) * Math.max(0, localMean - lum);
                        const highlightTame = Math.pow(lum, 1.5) * (2.0 - highlights) * Math.max(0, lum - localMean);
                        let newLum = Math.max(0.001, lum + shadowLift - highlightTame + (lum - localMean) * detail * 0.5);
                        
                        const ratio = newLum / lum;
                        r *= ratio; g *= ratio; b *= ratio;
                        
                        const applyContrast = (v, c) => v < 0.5 ? 0.5 * Math.pow(2 * v, c) : 1 - 0.5 * Math.pow(2 * (1 - v), c);
                        const contrastExp = Math.pow(2, contrast - 1);
                        r = applyContrast(Math.max(0, Math.min(1, r)), contrastExp);
                        g = applyContrast(Math.max(0, Math.min(1, g)), contrastExp);
                        b = applyContrast(Math.max(0, Math.min(1, b)), contrastExp);
                        
                        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
                        let h = 0, s = max === 0 ? 0 : delta / max, v = max;
                        if (delta !== 0) {
                            if (max === r) h = ((g - b) / delta) % 6;
                            else if (max === g) h = (b - r) / delta + 2;
                            else h = (r - g) / delta + 4;
                            h = (h / 6 + 1) % 1;
                        }
                        
                        s = Math.max(0, Math.min(1, s * saturation + (1.0 - s) * (vibrance - 1.0) * 0.5));
                        
                        const c = v * s, x_h = c * (1 - Math.abs((h * 6) % 2 - 1)), m = v - c;
                        let r1, g1, b1, hp = h * 6;
                        if (hp < 1) [r1, g1, b1] = [c, x_h, 0];
                        else if (hp < 2) [r1, g1, b1] = [x_h, c, 0];
                        else if (hp < 3) [r1, g1, b1] = [0, c, x_h];
                        else if (hp < 4) [r1, g1, b1] = [0, x_h, c];
                        else if (hp < 5) [r1, g1, b1] = [x_h, 0, c];
                        else [r1, g1, b1] = [c, 0, x_h];
                        
                        outputData[idx] = Math.max(0, Math.min(255, Math.pow(r1 + m, 1/1.1) * 255));
                        outputData[idx + 1] = Math.max(0, Math.min(255, Math.pow(g1 + m, 1/1.1) * 255));
                        outputData[idx + 2] = Math.max(0, Math.min(255, Math.pow(b1 + m, 1/1.1) * 255));
                    }
                }
                self.postMessage({ imageData: new ImageData(outputData, width, height) });
            };
        `;
        
        this.workerBlob = new Blob([workerCode], { type: 'application/javascript' });
        this.workerUrl = URL.createObjectURL(this.workerBlob);
        
        // Worker for background processing
        this.worker = new Worker(this.workerUrl);
        this.isProcessing = false;
        this.pendingUpdate = false;
        
        this.worker.onmessage = (e) => {
            this.hdrImageData = e.data.imageData;
            this.isProcessing = false;
            this.blendImages();
            
            if (this.pendingUpdate) {
                this.pendingUpdate = false;
                this.generateAdvancedHDR();
            }
        };

        this.initializeEventListeners();
        this.initializeControls();
        this.initializeSplitView();
    }

    initializeEventListeners() {
        const fileInput = document.getElementById('fileInput');
        const uploadArea = document.getElementById('uploadArea');

        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.processFile(files[0]);
            }
        });
    }

    initializeControls() {
        const controls = [
            'hdrBlend', 'exposure', 'shadows', 'highlights', 
            'contrast', 'detail', 'vibrance', 'saturation', 'transitionZone'
        ];
        
        controls.forEach(id => {
            const slider = document.getElementById(id);
            const display = document.getElementById(id + 'Value');
            if (!slider) return;

            slider.addEventListener('input', () => {
                let val = slider.value;
                if (id === 'hdrBlend' || id === 'contrast' || id === 'vibrance' || id === 'saturation' || id === 'transitionZone') {
                    val += '%';
                }
                if (display) display.textContent = val;
                
                if (id === 'hdrBlend') {
                    this.blendImages();
                } else {
                    this.generateAdvancedHDR();
                }
            });
        });
    }

    initializeSplitView() {
        const splitSlider = document.getElementById('splitSlider');
        const splitView = document.getElementById('splitView');
        let isDragging = false;

        const updateSplit = (clientX) => {
            const rect = splitView.getBoundingClientRect();
            const x = clientX - rect.left;
            const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
            
            this.splitPosition = percentage;
            
            const leftClip = `polygon(0 0, ${percentage}% 0, ${percentage}% 100%, 0 100%)`;
            const rightClip = `polygon(${percentage}% 0, 100% 0, 100% 100%, ${percentage}% 100%)`;
            
            this.originalCanvas.style.clipPath = leftClip;
            this.resultCanvas.style.clipPath = rightClip;
            splitSlider.style.left = `${percentage}%`;
        };

        splitSlider.addEventListener('mousedown', (e) => { isDragging = true; e.preventDefault(); });
        document.addEventListener('mousemove', (e) => { if (isDragging) updateSplit(e.clientX); });
        document.addEventListener('mouseup', () => { isDragging = false; });
        
        splitSlider.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
        document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateSplit(e.touches[0].clientX); });
        document.addEventListener('touchend', () => { isDragging = false; });

        splitView.addEventListener('click', (e) => {
            if (e.target === splitView || e.target.classList.contains('split-canvas')) {
                updateSplit(e.clientX);
            }
        });
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) this.processFile(file);
    }

    processFile(file) {
        if (!file.type.match('image.*')) {
            alert('Please select an image file');
            return;
        }

        const uploadProgress = document.getElementById('uploadProgress');
        const uploadBtn = document.querySelector('.upload-btn');
        
        if (uploadProgress) uploadProgress.classList.add('active');
        if (uploadBtn) uploadBtn.disabled = true;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                if (uploadProgress) uploadProgress.classList.remove('active');
                if (uploadBtn) uploadBtn.disabled = false;
                this.loadImage(img);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    loadImage(img) {
        this.currentImage = img;
        
        const maxWidth = 800; // Increased preview size
        const maxHeight = 600;
        let { width, height } = img;

        const displayRatio = Math.min(maxWidth / width, maxHeight / height);
        const displayWidth = width * displayRatio;
        const displayHeight = height * displayRatio;

        this.originalCanvas.width = displayWidth;
        this.originalCanvas.height = displayHeight;
        this.resultCanvas.width = displayWidth;
        this.resultCanvas.height = displayHeight;

        const splitView = document.getElementById('splitView');
        splitView.style.height = `${displayHeight}px`;

        this.originalCtx.drawImage(img, 0, 0, displayWidth, displayHeight);
        this.originalImageData = this.originalCtx.getImageData(0, 0, displayWidth, displayHeight);

        this.generateAdvancedHDR();

        const uploadSection = document.querySelector('.upload-section');
        const mainContent = document.getElementById('mainContent');
        uploadSection.style.display = 'none';
        mainContent.classList.remove('hidden');
        mainContent.style.display = 'grid';

        this.blendImages();
    }

    getParams() {
        return {
            exposure: parseFloat(document.getElementById('exposure').value),
            shadows: parseFloat(document.getElementById('shadows').value),
            highlights: parseFloat(document.getElementById('highlights').value),
            contrast: parseFloat(document.getElementById('contrast').value),
            detail: parseFloat(document.getElementById('detail').value),
            vibrance: parseFloat(document.getElementById('vibrance').value),
            saturation: parseFloat(document.getElementById('saturation').value),
            smoothing: parseFloat(document.getElementById('transitionZone').value)
        };
    }

    generateAdvancedHDR() {
        if (!this.originalImageData) return;
        
        if (this.isProcessing) {
            this.pendingUpdate = true;
            return;
        }

        this.isProcessing = true;
        this.worker.postMessage({
            imageData: this.originalImageData,
            params: this.getParams()
        });
    }

    blendImages() {
        if (!this.originalImageData || !this.hdrImageData) return;

        const blendValue = parseInt(document.getElementById('hdrBlend').value) / 100;
        
        const resultData = new ImageData(
            new Uint8ClampedArray(this.originalImageData.data),
            this.originalImageData.width,
            this.originalImageData.height
        );

        const original = this.originalImageData.data;
        const hdr = this.hdrImageData.data;
        const result = resultData.data;

        for (let i = 0; i < original.length; i += 4) {
            result[i] = original[i] * (1 - blendValue) + hdr[i] * blendValue;
            result[i + 1] = original[i + 1] * (1 - blendValue) + hdr[i + 1] * blendValue;
            result[i + 2] = original[i + 2] * (1 - blendValue) + hdr[i + 2] * blendValue;
            result[i + 3] = 255;
        }

        this.resultCtx.putImageData(resultData, 0, 0);
    }
}

function resetFilters() {
    const defaults = {
        'hdrBlend': 70,
        'exposure': 0,
        'shadows': 50,
        'highlights': 50,
        'contrast': 100,
        'detail': 100,
        'vibrance': 100,
        'saturation': 100,
        'transitionZone': 50
    };

    for (const [id, val] of Object.entries(defaults)) {
        const slider = document.getElementById(id);
        slider.value = val;
        const display = document.getElementById(id + 'Value');
        if (display) {
            display.textContent = val + (['hdrBlend', 'contrast', 'vibrance', 'saturation', 'transitionZone'].includes(id) ? '%' : '');
        }
    }

    if (window.hdrEnhancer) {
        window.hdrEnhancer.generateAdvancedHDR();
    }
}

function uploadNew() {
    const fileInput = document.getElementById('fileInput');
    fileInput.value = '';
    fileInput.click();
}

async function downloadImage(event) {
    if (!window.hdrEnhancer || !window.hdrEnhancer.currentImage) {
        alert('No image loaded');
        return;
    }

    const enhancer = window.hdrEnhancer;
    const originalText = event.target.textContent;
    const processingIndicator = document.getElementById('processingIndicator');
    
    event.target.textContent = 'Processing...';
    event.target.disabled = true;
    if (processingIndicator) processingIndicator.classList.add('active');
    
    try {
        // Create full-res canvas
        const fullCanvas = document.createElement('canvas');
        const fullCtx = fullCanvas.getContext('2d');
        const img = enhancer.currentImage;
        fullCanvas.width = img.width;
        fullCanvas.height = img.height;
        fullCtx.drawImage(img, 0, 0);
        const fullImageData = fullCtx.getImageData(0, 0, img.width, img.height);

        // Use a temporary worker for full-res to avoid blocking preview worker
        const fullResWorker = new Worker(enhancer.workerUrl);
        
        const processedFullRes = await new Promise((resolve) => {
            fullResWorker.onmessage = (e) => resolve(e.data.imageData);
            fullResWorker.postMessage({
                imageData: fullImageData,
                params: enhancer.getParams()
            });
        });
        
        fullResWorker.terminate();

        // Blend
        const blendValue = parseInt(document.getElementById('hdrBlend').value) / 100;
        const result = processedFullRes.data;
        const original = fullImageData.data;

        for (let i = 0; i < original.length; i += 4) {
            result[i] = original[i] * (1 - blendValue) + result[i] * blendValue;
            result[i + 1] = original[i + 1] * (1 - blendValue) + result[i + 1] * blendValue;
            result[i + 2] = original[i + 2] * (1 - blendValue) + result[i + 2] * blendValue;
        }

        fullCtx.putImageData(processedFullRes, 0, 0);
        
        const link = document.createElement('a');
        link.download = `hdr-enhanced.png`;
        link.href = fullCanvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        console.error(error);
        alert('Error during download');
    } finally {
        event.target.textContent = originalText;
        event.target.disabled = false;
        if (processingIndicator) processingIndicator.classList.remove('active');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.hdrEnhancer = new HDREnhancer();
});
