const canvas = new fabric.Canvas('main-canvas', {
    backgroundColor: '#ffffff',
    preserveObjectStacking: true
});

// State
let puzzlePath = null;
let selectedObject = null;

// History (Undo/Redo)
const MAX_HISTORY = 6; // current + 5 steps back
let history = [];
let historyIndex = -1;
let isRestoringHistory = false;
let saveStateTimer = null;

// DOM Elements
const canvasWidthInput = document.getElementById('canvas-width');
const canvasHeightInput = document.getElementById('canvas-height');
const dropZone = document.getElementById('canvas-drop-zone');
const addTextBtn = document.getElementById('add-text-btn');
const objectControls = document.getElementById('object-controls');
const imageControls = document.getElementById('image-processing-controls');
const textControls = document.getElementById('text-controls');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const defaultViewBtn = document.getElementById('default-view-btn');
const thresholdType = document.getElementById('threshold-type');
const thresholdLevel = document.getElementById('threshold-level');
const smoothRadius = document.getElementById('smooth-radius');
const vectorizeEnabled = document.getElementById('vectorize-enabled');
const vectorizeQuality = document.getElementById('vectorize-quality');
const hdrSliderContainer = document.getElementById('hdr-slider-container');
const hdrStrength = document.getElementById('hdr-strength');
const thresholdSliderContainer = document.getElementById('threshold-slider-container');
const fontFamily = document.getElementById('font-family');
const textString = document.getElementById('text-string');
const deleteBtn = document.getElementById('delete-btn');
const puzzleStyle = document.getElementById('puzzle-style');
const puzzleCols = document.getElementById('puzzle-cols');
const puzzleRows = document.getElementById('puzzle-rows');
const tabSizeInput = document.getElementById('tab-size');
const jitterInput = document.getElementById('jitter');
const generatePuzzleBtn = document.getElementById('generate-puzzle');
const showPuzzleCheckbox = document.getElementById('show-puzzle');
const exportSvgBtn = document.getElementById('export-svg');
const rulerX = document.getElementById('ruler-x');
const rulerY = document.getElementById('ruler-y');

// Slider Value Displays
const hdrStrengthVal = document.getElementById('hdr-strength-val');
const smoothRadiusVal = document.getElementById('smooth-radius-val');
const thresholdLevelVal = document.getElementById('threshold-level-val');
const tabSizeVal = document.getElementById('tab-size-val');
const jitterVal = document.getElementById('jitter-val');

const UI_CUT_STROKE_COLOR = '#ff0000';
const UI_CUT_STROKE_WIDTH = 1.35;
const EXPORT_CUT_STROKE_WIDTH = 0.1;

function getCutStrokeWidthForZoom() {
    const zoom = canvas.getZoom() || 1;
    return UI_CUT_STROKE_WIDTH / zoom;
}

function syncPuzzleStrokeForZoom() {
    if (!puzzlePath) return;
    puzzlePath.set('strokeWidth', getCutStrokeWidthForZoom());
}

function resetView() {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.setZoom(1);
    syncPuzzleStrokeForZoom();
    canvas.requestRenderAll();
}

// --- Canvas Interaction Enhancements ---
// Zoom in/out with mouse wheel (cursor-centered)
canvas.on('mouse:wheel', (opt) => {
    const e = opt.e;
    const deltaY = e.deltaY;
    let zoom = canvas.getZoom();

    // Smooth exponential zoom. Wheel down -> zoom out, wheel up -> zoom in.
    zoom *= Math.pow(0.999, deltaY);
    zoom = Math.max(0.2, Math.min(4, zoom));

    const point = new fabric.Point(e.offsetX, e.offsetY);
    canvas.zoomToPoint(point, zoom);
    syncPuzzleStrokeForZoom();

    e.preventDefault();
    e.stopPropagation();
});

// Clicking empty space should immediately deselect (and exit text editing if active)
// Dragging empty space pans the viewport
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;

canvas.on('mouse:down', (opt) => {
    const target = opt.target;
    const active = canvas.getActiveObject();
    const e = opt.e;

    if (active && active.type === 'i-text' && active.isEditing) {
        if (!target || target !== active) {
            active.exitEditing();
        }
    }

    if (!target) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();

        isPanning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        canvas.selection = false;
        canvas.defaultCursor = 'grab';
        e.preventDefault();
    }
});

canvas.on('mouse:move', (opt) => {
    if (!isPanning) return;
    const e = opt.e;
    const vpt = canvas.viewportTransform;
    vpt[4] += (e.clientX - lastPanX);
    vpt[5] += (e.clientY - lastPanY);
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    canvas.requestRenderAll();
});

canvas.on('mouse:up', () => {
    if (!isPanning) return;
    isPanning = false;
    canvas.selection = true;
    canvas.defaultCursor = 'default';
    canvas.requestRenderAll();
});

// Initialize Canvas Size
function initCanvas() {
    const w = parseInt(canvasWidthInput.value);
    const h = parseInt(canvasHeightInput.value);
    canvas.setDimensions({ width: w, height: h });
    updateRulers();
}
initCanvas();

// Reactive canvas resizing (no update button)
let resizeTimer = null;
function scheduleCanvasResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        initCanvas();
        if (puzzlePath) generatePuzzle();
        syncPuzzleStrokeForZoom();
    }, 80);
}

canvasWidthInput.addEventListener('input', scheduleCanvasResize);
canvasHeightInput.addEventListener('input', scheduleCanvasResize);

function updateRulers() {
    const w = canvas.width;
    const h = canvas.height;
    
    rulerX.style.width = w + 'px';
    rulerY.style.height = h + 'px';
    
    rulerX.innerHTML = '';
    rulerY.innerHTML = '';
    
    // X Ruler
    for (let i = 0; i <= w; i += 50) {
        const tick = document.createElement('div');
        tick.className = 'ruler-tick';
        tick.style.left = i + 'px';
        tick.style.height = (i % 100 === 0) ? '15px' : '8px';
        rulerX.appendChild(tick);
        
        if (i % 100 === 0) {
            const label = document.createElement('div');
            label.className = 'ruler-label';
            label.style.left = (i + 2) + 'px';
            label.style.bottom = '15px';
            label.innerText = i;
            rulerX.appendChild(label);
        }
    }
    
    // Y Ruler
    for (let i = 0; i <= h; i += 50) {
        const tick = document.createElement('div');
        tick.className = 'ruler-tick';
        tick.style.top = i + 'px';
        tick.style.width = (i % 100 === 0) ? '15px' : '8px';
        rulerY.appendChild(tick);
        
        if (i % 100 === 0) {
            const label = document.createElement('div');
            label.className = 'ruler-label';
            label.style.top = (i + 2) + 'px';
            label.style.right = '15px';
            label.innerText = i;
            rulerY.appendChild(label);
        }
    }
}
generatePuzzle(); // Initial puzzle generation
syncPuzzleStrokeForZoom();

function setEditSelectedDisabled(disabled) {
    objectControls.classList.toggle('disabled', disabled);
    objectControls.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function hasAnyImages() {
    return canvas.getObjects().some(o => o && (o.type === 'image' || o.isVectorizedImage));
}

function updateEditSelectedAvailability() {
    const hasImages = hasAnyImages();
    setEditSelectedDisabled(!hasImages);
    
    // Toggle placeholder
    const placeholder = document.getElementById('empty-state-placeholder');
    if (placeholder) {
        placeholder.style.display = hasImages ? 'none' : 'flex';
    }
    
    // Toggle puzzle visibility
    if (puzzlePath) {
        const shouldShow = showPuzzleCheckbox.checked && hasImages;
        puzzlePath.set('opacity', shouldShow ? 1 : 0);
        canvas.renderAll();
    }
}


defaultViewBtn.addEventListener('click', resetView);

// --- Object Selection ---
canvas.on('selection:created', (e) => handleSelection(e.selected[0]));
canvas.on('selection:updated', (e) => handleSelection(e.selected[0]));
canvas.on('selection:cleared', () => {
    selectedObject = null;
    imageControls.style.display = 'block';
    textControls.style.display = 'none';
});

// Ensure puzzle overlay is always on top
canvas.on('after:render', () => {
    if (puzzlePath && canvas.getObjects().indexOf(puzzlePath) !== canvas.getObjects().length - 1) {
        puzzlePath.bringToFront();
    }
});

function handleSelection(obj) {
    selectedObject = obj;
    if (obj.type === 'image' || obj.isVectorizedImage) {
        imageControls.style.display = 'block';
        textControls.style.display = 'none';
        // Sync controls with object state
        thresholdType.value = (obj.thresholdType === 'otsu') ? 'threshold' : (obj.thresholdType || 'threshold');
        thresholdLevel.value = obj.thresholdLevel || 128;
        thresholdLevelVal.innerText = thresholdLevel.value;
        hdrStrength.value = obj.hdrStrength || 50;
        hdrStrengthVal.innerText = hdrStrength.value;
        smoothRadius.value = (obj.smoothRadius ?? 2);
        smoothRadiusVal.innerText = smoothRadius.value;
        vectorizeEnabled.checked = (obj.vectorizeEnabled ?? true);
        vectorizeQuality.value = (obj.vectorizeQuality ?? 'smooth');
        updateThresholdVisibility();
    } else if (obj.type === 'i-text' || obj.type === 'text') {
        imageControls.style.display = 'none';
        textControls.style.display = 'block';
        fontFamily.value = obj.fontFamily;
        textString.value = obj.text;
    }
}

// Keyboard delete support
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete') return;

    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')) {
        return;
    }

    const activeObj = canvas.getActiveObject();
    if (!activeObj) return;
    if (activeObj === puzzlePath) return;
    if (activeObj.type === 'i-text' && activeObj.isEditing) return;

    canvas.remove(activeObj);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    updateEditSelectedAvailability();
});

// --- Image Handling ---
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});

function handleFiles(files) {
    for (let file of files) {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (f) => {
                fabric.Image.fromURL(f.target.result, (img) => {
                    img.scaleToWidth(canvas.width * 0.5);
                    img.set({
                        left: 50,
                        top: 50,
                        thresholdType: 'threshold',
                        thresholdLevel: 128,
                        hdrStrength: 50,
                        smoothRadius: 2,
                        vectorizeEnabled: true,
                        vectorizeQuality: 'smooth'
                    });
                    // Store the truly original element for re-processing
                    img.originalSrc = img._element;
                    img.originalSrcUrl = f.target.result;
                    canvas.add(img);
                    canvas.setActiveObject(img);
                    applyImageProcessing(img); // Apply immediately
                    updateEditSelectedAvailability();
                });
            };
            reader.readAsDataURL(file);
        }
    }
}

// --- Image Processing (Thresholding) ---
thresholdType.addEventListener('change', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        selectedObject.thresholdType = thresholdType.value;
        updateThresholdVisibility();
        applyImageProcessing(selectedObject);
    }
});

thresholdLevel.addEventListener('input', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        thresholdLevelVal.innerText = thresholdLevel.value;
    }
});

thresholdLevel.addEventListener('change', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        selectedObject.thresholdLevel = parseInt(thresholdLevel.value);
        applyImageProcessing(selectedObject);
    }
});

smoothRadius.addEventListener('input', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        smoothRadiusVal.innerText = smoothRadius.value;
    }
});

smoothRadius.addEventListener('change', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        selectedObject.smoothRadius = parseInt(smoothRadius.value);
        applyImageProcessing(selectedObject);
    }
});

vectorizeEnabled.addEventListener('change', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        selectedObject.vectorizeEnabled = !!vectorizeEnabled.checked;
        applyImageProcessing(selectedObject);
    }
});

vectorizeQuality.addEventListener('change', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        selectedObject.vectorizeQuality = vectorizeQuality.value;
        applyImageProcessing(selectedObject);
    }
});

hdrStrength.addEventListener('input', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        hdrStrengthVal.innerText = hdrStrength.value;
    }
});

hdrStrength.addEventListener('change', () => {
    if (selectedObject && (selectedObject.type === 'image' || selectedObject.isVectorizedImage)) {
        selectedObject.hdrStrength = parseInt(hdrStrength.value);
        applyImageProcessing(selectedObject);
    }
});

function updateThresholdVisibility() {
    thresholdSliderContainer.style.display = 
        (thresholdType.value === 'threshold' || thresholdType.value === 'hdr') ? 'flex' : 'none';
    hdrSliderContainer.style.display = 
        (thresholdType.value === 'hdr') ? 'flex' : 'none';
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function boxBlurFloat(src, width, height, radius) {
    if (radius <= 0) return new Float32Array(src);

    const windowSize = radius * 2 + 1;
    const tmp = new Float32Array(width * height);
    const dst = new Float32Array(width * height);

    // Horizontal pass
    for (let y = 0; y < height; y++) {
        const rowStart = y * width;
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
            const xk = clamp(k, 0, width - 1);
            sum += src[rowStart + xk];
        }
        tmp[rowStart] = sum / windowSize;

        for (let x = 1; x < width; x++) {
            const addX = clamp(x + radius, 0, width - 1);
            const subX = clamp(x - radius - 1, 0, width - 1);
            sum += src[rowStart + addX] - src[rowStart + subX];
            tmp[rowStart + x] = sum / windowSize;
        }
    }

    // Vertical pass
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
            const yk = clamp(k, 0, height - 1);
            sum += tmp[yk * width + x];
        }
        dst[x] = sum / windowSize;

        for (let y = 1; y < height; y++) {
            const addY = clamp(y + radius, 0, height - 1);
            const subY = clamp(y - radius - 1, 0, height - 1);
            sum += tmp[addY * width + x] - tmp[subY * width + x];
            dst[y * width + x] = sum / windowSize;
        }
    }

    return dst;
}

function applyFillToFabricObject(obj, fill, stroke = null) {
    if (!obj) return;
    if (obj.type === 'group' && obj._objects) {
        obj._objects.forEach(child => applyFillToFabricObject(child, fill, stroke));
        obj.set({ fill, stroke, strokeWidth: 0 });
        return;
    }
    obj.set({ fill, stroke, strokeWidth: 0 });
}

function getVectorTraceOptions(quality, smoothRadiusVal) {
    const qualityKey = (quality || 'smooth').toLowerCase();
    const blur = clamp(Math.round((smoothRadiusVal || 0) / 2), 0, 5);

    // These are tuned for "expensive" looking traces: fewer jaggies, fewer micro paths.
    // Note: ltres/qtres are squared distance thresholds in ImageTracer.
    if (qualityKey === 'fast') {
        return {
            ltres: 6,
            qtres: 6,
            pathomit: 24,
            rightangleenhance: true,
            colorsampling: 0,
            numberofcolors: 2,
            colorquantcycles: 1,
            layering: 0,
            strokewidth: 0,
            linefilter: true,
            roundcoords: 1,
            blurradius: blur,
            blurdelta: 64
        };
    }

    if (qualityKey === 'detailed') {
        return {
            ltres: 1,
            qtres: 1,
            pathomit: 0,
            rightangleenhance: true,
            colorsampling: 0,
            numberofcolors: 2,
            colorquantcycles: 1,
            layering: 0,
            strokewidth: 0,
            linefilter: false,
            roundcoords: 2,
            blurradius: blur,
            blurdelta: 64
        };
    }

    // smooth (default)
    return {
        ltres: 3,
        qtres: 3,
        pathomit: 12,
        rightangleenhance: true,
        colorsampling: 0,
        numberofcolors: 2,
        colorquantcycles: 1,
        layering: 0,
        strokewidth: 0,
        linefilter: true,
        roundcoords: 1,
        blurradius: Math.max(1, blur),
        blurdelta: 64
    };
}

function replaceWithVectorizedGroup(oldObj, svgstr, metadata) {
    const left = oldObj.left;
    const top = oldObj.top;
    const angle = oldObj.angle;
    const scaleX = oldObj.scaleX;
    const scaleY = oldObj.scaleY;
    const flipX = oldObj.flipX;
    const flipY = oldObj.flipY;
    const originX = oldObj.originX;
    const originY = oldObj.originY;

    fabric.loadSVGFromString(svgstr, (objects, options) => {
        const group = fabric.util.groupSVGElements(objects, options);

        group.set({
            left,
            top,
            angle,
            scaleX,
            scaleY,
            flipX,
            flipY,
            originX,
            originY,
            selectable: true,
            evented: true
        });

        // Force engraving semantics
        applyFillToFabricObject(group, '#000000', null);

        // Carry metadata for reprocessing and history
        group.isVectorizedImage = true;
        Object.assign(group, metadata);

        canvas.remove(oldObj);
        canvas.add(group);
        canvas.setActiveObject(group);
        selectedObject = group;

        if (puzzlePath) puzzlePath.bringToFront();
        canvas.requestRenderAll();
        updateEditSelectedAvailability();
        
        // Hide loading indicator
        const loadingOverlay = document.getElementById('canvas-loading');
        const mainCanvas = document.getElementById('main-canvas');
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (mainCanvas) mainCanvas.classList.remove('processing');
    });
}

function computeHdrLuminanceMSR(sourceRgba, width, height, strength01) {
    const pixelCount = width * height;
    const luma = new Float32Array(pixelCount);

    for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
        luma[p] = (sourceRgba[i] + sourceRgba[i + 1] + sourceRgba[i + 2]) / 3;
    }

    // Radii chosen relative to image size, clamped for performance.
    const minDim = Math.min(width, height);
    const r1 = clamp(Math.round(minDim * 0.01), 2, 10);
    const r2 = clamp(Math.round(minDim * 0.03), 6, 30);
    const r3 = clamp(Math.round(minDim * 0.08), 12, 80);
    const radii = Array.from(new Set([r1, r2, r3])).sort((a, b) => a - b);

    const retinex = new Float32Array(pixelCount);
    for (const radius of radii) {
        const blurred = boxBlurFloat(luma, width, height, radius);
        for (let p = 0; p < pixelCount; p++) {
            // Single-scale Retinex: log(L+1) - log(blur(L)+1)
            retinex[p] += Math.log1p(luma[p]) - Math.log1p(blurred[p]);
        }
    }

    for (let p = 0; p < pixelCount; p++) {
        retinex[p] /= radii.length;
    }

    // Normalize retinex to [0..255]
    let minV = Infinity;
    let maxV = -Infinity;
    for (let p = 0; p < pixelCount; p++) {
        const v = retinex[p];
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
    }
    const range = (maxV - minV) || 1;

    // Blend with original luma and apply a small gamma lift (helps shadows).
    const out = new Uint8ClampedArray(pixelCount);
    const gamma = 1 - strength01 * 0.45; // 1.0 -> 0.55

    for (let p = 0; p < pixelCount; p++) {
        const mapped = ((retinex[p] - minV) / range) * 255;
        const blended = luma[p] * (1 - strength01) + mapped * strength01;
        const norm = clamp(blended / 255, 0, 1);
        out[p] = Math.round(Math.pow(norm, gamma) * 255);
    }

    return out;
}

function applyImageProcessing(imgObj) {
    // Show loading indicator
    const loadingOverlay = document.getElementById('canvas-loading');
    const mainCanvas = document.getElementById('main-canvas');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    if (mainCanvas) mainCanvas.classList.add('processing');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    const type = (imgObj.thresholdType === 'otsu') ? 'threshold' : (imgObj.thresholdType || 'threshold');
    // Reverse threshold logic: 255 - value
    const level = 255 - imgObj.thresholdLevel;
    const strength = imgObj.hdrStrength || 50;
    const smooth = clamp(parseInt(imgObj.smoothRadius ?? 2), 0, 12);
    const wantsVector = (imgObj.vectorizeEnabled ?? true) && (typeof ImageTracer !== 'undefined');
    const traceQuality = (imgObj.vectorizeQuality ?? 'smooth');

    // We use a temporary canvas to process the image
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');
    const originalImg = imgObj.originalSrc || imgObj._originalElement;
    if (!originalImg) {
        const srcUrl = imgObj.originalSrcUrl || imgObj.src;
        if (srcUrl) {
            const im = new Image();
            im.onload = () => {
                imgObj.originalSrc = im;
                imgObj.originalSrcUrl = srcUrl;
                applyImageProcessing(imgObj);
            };
            im.src = srcUrl;
        }
        return;
    }

    tempCanvas.width = originalImg.width;
    tempCanvas.height = originalImg.height;
    ctx.drawImage(originalImg, 0, 0);

    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const source = imageData.data;
    const width = tempCanvas.width;
    const height = tempCanvas.height;

    // Build luminance and optionally smooth it (reduces noise before threshold)
    const pixelCount = width * height;
    let luma = new Float32Array(pixelCount);
    for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
        luma[p] = (source[i] + source[i + 1] + source[i + 2]) / 3;
    }

    // HDR pre-processing (multi-scale Retinex on luminance)
    if (type === 'hdr') {
        const hdrLuma = computeHdrLuminanceMSR(source, width, height, clamp(strength / 100, 0, 1));
        for (let p = 0; p < pixelCount; p++) luma[p] = hdrLuma[p];
    }

    if (smooth > 0) {
        luma = boxBlurFloat(luma, width, height, smooth);
    }

    const out = new Uint8ClampedArray(source.length);
    for (let p = 0, i = 0; i < source.length; p++, i += 4) {
        const lum = luma[p];

        if (type === 'grayscale') {
            out[i] = out[i + 1] = out[i + 2] = lum;
            out[i + 3] = (lum > 250) ? 0 : 255;
            continue;
        }

        // For HDR mode: always apply *simple* threshold after HDR (user controlled)
        const currentThreshold = level;
        const val = lum >= currentThreshold ? 255 : 0;
        out[i] = out[i + 1] = out[i + 2] = val;
        out[i + 3] = (val === 255) ? 0 : 255; // white => transparent
    }

    const processed = new ImageData(out, width, height);

    // "Real" vector trace: convert the processed mask into SVG paths and replace the image with vector objects.
    if (wantsVector) {
        try {
            // Trace from an RGBA ImageData where black pixels are opaque, background is transparent.
            const traceOptions = getVectorTraceOptions(traceQuality, smooth);
            // Custom palette: black (visible) + transparent white (we'll drop the transparent layer)
            traceOptions.pal = [
                { r: 0, g: 0, b: 0, a: 255 },
                { r: 255, g: 255, b: 255, a: 0 }
            ];

            const tracedata = ImageTracer.imagedataToTracedata({ width, height, data: processed.data }, traceOptions);

            // Keep only the darkest visible layer to avoid exporting invisible/white paths.
            let blackIndex = 0;
            let bestScore = Infinity;
            for (let i = 0; i < tracedata.palette.length; i++) {
                const c = tracedata.palette[i];
                const alpha = (c.a ?? 255) / 255;
                const lum = (c.r + c.g + c.b) / 3;
                const score = lum + (alpha < 0.2 ? 1000 : 0);
                if (score < bestScore) {
                    bestScore = score;
                    blackIndex = i;
                }
            }

            const td = {
                layers: [tracedata.layers[blackIndex] || []],
                palette: [{ r: 0, g: 0, b: 0, a: 255 }],
                width: tracedata.width,
                height: tracedata.height
            };

            const svgstr = ImageTracer.getsvgstring(td, Object.assign({}, traceOptions, {
                strokewidth: 0,
                linefilter: traceOptions.linefilter,
                // Keep original pixel coordinate system; Fabric will handle transforms.
                scale: 1,
                viewbox: true
            }));

            const metadata = {
                thresholdType: type,
                thresholdLevel: imgObj.thresholdLevel,  // Store original slider value, not reversed
                hdrStrength: imgObj.hdrStrength || 50,  // Store original slider value
                smoothRadius: imgObj.smoothRadius ?? 2,  // Store original slider value
                vectorizeEnabled: true,
                vectorizeQuality: traceQuality,
                originalSrcUrl: imgObj.originalSrcUrl || imgObj.src
            };

            replaceWithVectorizedGroup(imgObj, svgstr, metadata);
            return;
        } catch (err) {
            // Fall back to raster if tracing fails
            console.warn('Vector trace failed, falling back to raster:', err);
        }
    }

    // Raster "vector-like" preview fallback
    ctx.putImageData(processed, 0, 0);
    const newImg = new Image();
    newImg.onload = () => {
        if (imgObj.type === 'image') {
            imgObj.setElement(newImg);
            canvas.renderAll();
        }
        // Hide loading indicator
        const loadingOverlay = document.getElementById('canvas-loading');
        const mainCanvas = document.getElementById('main-canvas');
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (mainCanvas) mainCanvas.classList.remove('processing');
    };
    newImg.src = tempCanvas.toDataURL();
}

// --- Text Handling ---
addTextBtn.addEventListener('click', () => {
    const text = new fabric.IText('New Text', {
        left: 100,
        top: 100,
        fontFamily: 'Arial',
        fill: '#000000'
    });
    canvas.add(text);
    canvas.setActiveObject(text);
});

fontFamily.addEventListener('change', () => {
    if (selectedObject && (selectedObject.type === 'i-text' || selectedObject.type === 'text')) {
        selectedObject.set('fontFamily', fontFamily.value);
        canvas.renderAll();
    }
});

textString.addEventListener('input', () => {
    if (selectedObject && (selectedObject.type === 'i-text' || selectedObject.type === 'text')) {
        selectedObject.set('text', textString.value);
        canvas.renderAll();
    }
});

deleteBtn.addEventListener('click', () => {
    if (selectedObject) {
        if (selectedObject === puzzlePath) return;
        canvas.remove(selectedObject);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        updateEditSelectedAvailability();
    }
});

// --- Puzzle Generation ---
generatePuzzleBtn.addEventListener('click', generatePuzzle);

function removeAllPuzzlePaths() {
    const puzzleObjects = canvas.getObjects().filter(obj => obj && obj.isPuzzlePath);
    if (puzzleObjects.length === 0) return;

    if (canvas.getActiveObject() && canvas.getActiveObject().isPuzzlePath) {
        canvas.discardActiveObject();
    }

    puzzleObjects.forEach(obj => canvas.remove(obj));
    puzzlePath = null;
}

function generatePuzzle() {
    removeAllPuzzlePaths();

    const style = puzzleStyle.value;
    const cols = parseInt(puzzleCols.value);
    const rows = parseInt(puzzleRows.value);
    const width = canvas.width;
    const height = canvas.height;
    const tabSize = parseInt(tabSizeInput.value) / 100;
    const jitter = parseInt(jitterInput.value);

    const cellW = width / cols;
    const cellH = height / rows;

    // Store horizontal and vertical edge types (1 for out, -1 for in)
    const hEdges = Array.from({ length: rows + 1 }, () => new Array(cols).fill(0));
    const vEdges = Array.from({ length: rows }, () => new Array(cols + 1).fill(0));

    // Randomize edges
    for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            hEdges[r][c] = Math.random() > 0.5 ? 1 : -1;
        }
    }
    for (let r = 0; r < rows; r++) {
        for (let c = 1; c < cols; c++) {
            vEdges[r][c] = Math.random() > 0.5 ? 1 : -1;
        }
    }

    let pathData = '';

    // Draw horizontal lines
    for (let r = 0; r <= rows; r++) {
        const yBase = r * cellH;
        pathData += `M 0 ${yBase} `;
        for (let c = 0; c < cols; c++) {
            const x1 = c * cellW;
            const x2 = (c + 1) * cellW;
            const type = hEdges[r][c];
            
            if (type === 0) {
                pathData += `L ${x2} ${yBase} `;
            } else {
                const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * jitter;
                const tabH = cellH * tabSize * type;
                
                if (style === 'classic') {
                    const neckW = cellW * 0.15;
                    const headW = cellW * 0.25;
                    const cp1x = x1 + neckW;
                    const cp2x = midX - headW;
                    const cp3x = midX + headW;
                    const cp4x = x2 - neckW;
                    pathData += `C ${cp1x} ${yBase} ${cp2x} ${yBase + tabH * 0.2} ${midX - neckW} ${yBase + tabH} `;
                    pathData += `C ${midX - neckW * 0.5} ${yBase + tabH * 1.3} ${midX + neckW * 0.5} ${yBase + tabH * 1.3} ${midX + neckW} ${yBase + tabH} `;
                    pathData += `C ${midX + headW} ${yBase + tabH * 0.2} ${cp4x} ${yBase} ${x2} ${yBase} `;
                } else if (style === 'geometric') {
                    const tabW = cellW * 0.3;
                    pathData += `L ${midX - tabW/2} ${yBase} `;
                    pathData += `L ${midX - tabW/2} ${yBase + tabH} `;
                    pathData += `L ${midX + tabW/2} ${yBase + tabH} `;
                    pathData += `L ${midX + tabW/2} ${yBase} `;
                    pathData += `L ${x2} ${yBase} `;
                } else if (style === 'wavy') {
                    pathData += `Q ${midX} ${yBase + tabH * 1.5} ${x2} ${yBase} `;
                } else if (style === 'triangular') {
                    pathData += `L ${midX} ${yBase + tabH} `;
                    pathData += `L ${x2} ${yBase} `;
                } else if (style === 'shards') {
                    const randY = yBase + (Math.random() - 0.5) * cellH * 0.5;
                    pathData += `L ${midX} ${randY} `;
                    pathData += `L ${x2} ${yBase} `;
                }
            }
        }
    }

    // Draw vertical lines
    for (let c = 0; c <= cols; c++) {
        const xBase = c * cellW;
        pathData += `M ${xBase} 0 `;
        for (let r = 0; r < rows; r++) {
            const y1 = r * cellH;
            const y2 = (r + 1) * cellH;
            const type = vEdges[r][c];

            if (type === 0) {
                pathData += `L ${xBase} ${y2} `;
            } else {
                const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * jitter;
                const tabW = cellW * tabSize * type;

                if (style === 'classic') {
                    const neckH = cellH * 0.15;
                    const headH = cellH * 0.25;
                    const cp1y = y1 + neckH;
                    const cp2y = midY - headH;
                    const cp3y = midY + headH;
                    const cp4y = y2 - neckH;
                    pathData += `C ${xBase} ${cp1y} ${xBase + tabW * 0.2} ${cp2y} ${xBase + tabW} ${midY - neckH} `;
                    pathData += `C ${xBase + tabW * 1.3} ${midY - neckH * 0.5} ${xBase + tabW * 1.3} ${midY + neckH * 0.5} ${xBase + tabW} ${midY + neckH} `;
                    pathData += `C ${xBase + tabW * 0.2} ${midY + headH} ${xBase} ${cp4y} ${xBase} ${y2} `;
                } else if (style === 'geometric') {
                    const tabH = cellH * 0.3;
                    pathData += `L ${xBase} ${midY - tabH/2} `;
                    pathData += `L ${xBase + tabW} ${midY - tabH/2} `;
                    pathData += `L ${xBase + tabW} ${midY + tabH/2} `;
                    pathData += `L ${xBase} ${midY + tabH/2} `;
                    pathData += `L ${xBase} ${y2} `;
                } else if (style === 'wavy') {
                    pathData += `Q ${xBase + tabW * 1.5} ${midY} ${xBase} ${y2} `;
                } else if (style === 'triangular') {
                    pathData += `L ${xBase + tabW} ${midY} `;
                    pathData += `L ${xBase} ${y2} `;
                } else if (style === 'shards') {
                    const randX = xBase + (Math.random() - 0.5) * cellW * 0.5;
                    pathData += `L ${randX} ${midY} `;
                    pathData += `L ${xBase} ${y2} `;
                }
            }
        }
    }

    // Special case for Honeycomb (Hex)
    if (style === 'honeycomb') {
        pathData = ''; // Reset path data for hex
        const hexW = cellW;
        const hexH = cellH;
        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                const x = c * hexW * 1.5;
                const y = r * hexH + (c % 2 === 0 ? 0 : hexH / 2);
                
                // Draw a hexagon
                pathData += `M ${x + hexW * 0.5} ${y} `;
                pathData += `L ${x + hexW * 1.5} ${y} `;
                pathData += `L ${x + hexW * 2} ${y + hexH * 0.5} `;
                pathData += `L ${x + hexW * 1.5} ${y + hexH} `;
                pathData += `L ${x + hexW * 0.5} ${y + hexH} `;
                pathData += `L ${x} ${y + hexH * 0.5} Z `;
            }
        }
    }

    // Brick / Offset pattern
    if (style === 'brick') {
        pathData = '';
        // Horizontal lines
        for (let r = 0; r <= rows; r++) {
            pathData += `M 0 ${r * cellH} L ${width} ${r * cellH} `;
        }
        // Vertical lines with offset every other row
        for (let r = 0; r < rows; r++) {
            const offset = (r % 2 === 0) ? 0 : cellW / 2;
            for (let c = 0; c <= cols; c++) {
                const x = c * cellW + offset;
                if (x > 0 && x < width) {
                    pathData += `M ${x} ${r * cellH} L ${x} ${(r + 1) * cellH} `;
                }
            }
        }
        // Add outer border
        pathData += `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z `;
    }

    // Curved Edges
    if (style === 'curved') {
        pathData = '';
        // Horizontal curved lines
        for (let r = 0; r <= rows; r++) {
            const y = r * cellH;
            pathData += `M 0 ${y} `;
            for (let c = 0; c < cols; c++) {
                const x1 = c * cellW;
                const x2 = (c + 1) * cellW;
                const midX = (x1 + x2) / 2;
                const curveAmp = (r === 0 || r === rows) ? 0 : cellH * 0.15 * (Math.random() > 0.5 ? 1 : -1);
                pathData += `Q ${midX} ${y + curveAmp} ${x2} ${y} `;
            }
        }
        // Vertical curved lines
        for (let c = 0; c <= cols; c++) {
            const x = c * cellW;
            pathData += `M ${x} 0 `;
            for (let r = 0; r < rows; r++) {
                const y1 = r * cellH;
                const y2 = (r + 1) * cellH;
                const midY = (y1 + y2) / 2;
                const curveAmp = (c === 0 || c === cols) ? 0 : cellW * 0.15 * (Math.random() > 0.5 ? 1 : -1);
                pathData += `Q ${x + curveAmp} ${midY} ${x} ${y2} `;
            }
        }
    }

    // Diamond Grid
    if (style === 'diamond') {
        pathData = '';
        const diagW = cellW;
        const diagH = cellH;
        // Draw diagonal lines in both directions
        for (let r = 0; r <= rows * 2; r++) {
            const startY = r * diagH / 2;
            // Top-left to bottom-right
            pathData += `M 0 ${startY} `;
            for (let step = 0; step <= cols; step++) {
                const x = step * diagW;
                const y = startY + step * diagH / 2;
                if (y <= height && x <= width) {
                    pathData += `L ${x} ${y} `;
                }
            }
        }
        for (let c = 1; c <= cols; c++) {
            const startX = c * diagW;
            pathData += `M ${startX} 0 `;
            for (let step = 0; step <= rows; step++) {
                const x = startX + step * diagW;
                const y = step * diagH / 2;
                if (y <= height && x <= width) {
                    pathData += `L ${x} ${y} `;
                }
            }
        }
        // Top-right to bottom-left
        for (let r = 0; r <= rows * 2; r++) {
            const startY = r * diagH / 2;
            pathData += `M ${width} ${startY} `;
            for (let step = 0; step <= cols; step++) {
                const x = width - step * diagW;
                const y = startY + step * diagH / 2;
                if (y <= height && x >= 0) {
                    pathData += `L ${x} ${y} `;
                }
            }
        }
        for (let c = 1; c <= cols; c++) {
            const startX = width - c * diagW;
            pathData += `M ${startX} 0 `;
            for (let step = 0; step <= rows; step++) {
                const x = startX - step * diagW;
                const y = step * diagH / 2;
                if (y <= height && x >= 0) {
                    pathData += `L ${x} ${y} `;
                }
            }
        }
        // Outer border
        pathData += `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z `;
    }

    // Organic (Bezier curves with randomness)
    if (style === 'organic') {
        pathData = '';
        const points = [];
        // Generate random intersection points
        for (let r = 0; r <= rows; r++) {
            points[r] = [];
            for (let c = 0; c <= cols; c++) {
                const baseX = c * cellW;
                const baseY = r * cellH;
                const jitterX = (c === 0 || c === cols) ? 0 : (Math.random() - 0.5) * jitter * 3;
                const jitterY = (r === 0 || r === rows) ? 0 : (Math.random() - 0.5) * jitter * 3;
                points[r][c] = { x: baseX + jitterX, y: baseY + jitterY };
            }
        }
        // Draw horizontal organic lines
        for (let r = 0; r <= rows; r++) {
            pathData += `M ${points[r][0].x} ${points[r][0].y} `;
            for (let c = 0; c < cols; c++) {
                const p1 = points[r][c];
                const p2 = points[r][c + 1];
                const cp1x = p1.x + (p2.x - p1.x) * 0.3 + (Math.random() - 0.5) * jitter * 2;
                const cp1y = p1.y + (Math.random() - 0.5) * jitter * 2;
                const cp2x = p1.x + (p2.x - p1.x) * 0.7 + (Math.random() - 0.5) * jitter * 2;
                const cp2y = p2.y + (Math.random() - 0.5) * jitter * 2;
                pathData += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y} `;
            }
        }
        // Draw vertical organic lines
        for (let c = 0; c <= cols; c++) {
            pathData += `M ${points[0][c].x} ${points[0][c].y} `;
            for (let r = 0; r < rows; r++) {
                const p1 = points[r][c];
                const p2 = points[r + 1][c];
                const cp1x = p1.x + (Math.random() - 0.5) * jitter * 2;
                const cp1y = p1.y + (p2.y - p1.y) * 0.3 + (Math.random() - 0.5) * jitter * 2;
                const cp2x = p2.x + (Math.random() - 0.5) * jitter * 2;
                const cp2y = p1.y + (p2.y - p1.y) * 0.7 + (Math.random() - 0.5) * jitter * 2;
                pathData += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y} `;
            }
        }
    }

    // Horizontal Strips (only horizontal cuts)
    if (style === 'strips') {
        pathData = '';
        for (let r = 0; r <= rows; r++) {
            const y = r * cellH;
            if (r === 0 || r === rows) {
                // Straight border
                pathData += `M 0 ${y} L ${width} ${y} `;
            } else {
                // Wavy horizontal line
                pathData += `M 0 ${y} `;
                const segments = cols * 2;
                const segW = width / segments;
                for (let s = 0; s < segments; s++) {
                    const x2 = (s + 1) * segW;
                    const waveAmp = cellH * 0.2 * Math.sin((s / segments) * Math.PI * 4 + Math.random());
                    pathData += `Q ${(s + 0.5) * segW} ${y + waveAmp} ${x2} ${y} `;
                }
            }
        }
        // Left and right borders
        pathData += `M 0 0 L 0 ${height} `;
        pathData += `M ${width} 0 L ${width} ${height} `;
    }

    // Vertical Columns (only vertical cuts)
    if (style === 'columns') {
        pathData = '';
        for (let c = 0; c <= cols; c++) {
            const x = c * cellW;
            if (c === 0 || c === cols) {
                // Straight border
                pathData += `M ${x} 0 L ${x} ${height} `;
            } else {
                // Wavy vertical line
                pathData += `M ${x} 0 `;
                const segments = rows * 2;
                const segH = height / segments;
                for (let s = 0; s < segments; s++) {
                    const y2 = (s + 1) * segH;
                    const waveAmp = cellW * 0.2 * Math.sin((s / segments) * Math.PI * 4 + Math.random());
                    pathData += `Q ${x + waveAmp} ${(s + 0.5) * segH} ${x} ${y2} `;
                }
            }
        }
        // Top and bottom borders
        pathData += `M 0 0 L ${width} 0 `;
        pathData += `M 0 ${height} L ${width} ${height} `;
    }

    puzzlePath = new fabric.Path(pathData, {
        stroke: UI_CUT_STROKE_COLOR,
        strokeWidth: getCutStrokeWidthForZoom(),
        fill: 'transparent',
        selectable: false,
        evented: false,
        opacity: (showPuzzleCheckbox.checked && hasAnyImages()) ? 1 : 0,
        isPuzzlePath: true
    });

    canvas.add(puzzlePath);
    puzzlePath.bringToFront();
    syncPuzzleStrokeForZoom();
    canvas.renderAll();
}

// Reactive Puzzle Settings
[puzzleStyle, puzzleCols, puzzleRows, tabSizeInput, jitterInput].forEach(input => {
    input.addEventListener('input', () => {
        if (input === tabSizeInput) tabSizeVal.innerText = input.value;
        if (input === jitterInput) jitterVal.innerText = input.value;
        generatePuzzle();
    });
});

showPuzzleCheckbox.addEventListener('change', () => {
    if (puzzlePath) {
        const shouldShow = showPuzzleCheckbox.checked && hasAnyImages();
        puzzlePath.set('opacity', shouldShow ? 1 : 0);
        canvas.renderAll();
    }
});

// --- Export SVG ---
exportSvgBtn.addEventListener('click', () => {
    // To export correctly for laser:
    // 1. All images/text should be black fill.
    // 2. Puzzle paths should be red stroke, very thin.
    // 3. Clip everything to the canvas boundary.
    
    const originalOpacity = puzzlePath ? puzzlePath.opacity : 0;
    const originalStrokeWidth = puzzlePath ? puzzlePath.strokeWidth : 0;
    
    if (puzzlePath) {
        puzzlePath.set({
            opacity: 1,
            stroke: UI_CUT_STROKE_COLOR,
            strokeWidth: EXPORT_CUT_STROKE_WIDTH
        });
    }

    let svg = canvas.toSVG({
        suppressPreamble: false,
        width: canvas.width,
        height: canvas.height
    });

    // Restore UI state
    if (puzzlePath) {
        puzzlePath.set({
            opacity: originalOpacity,
            strokeWidth: originalStrokeWidth
        });
    }
    syncPuzzleStrokeForZoom();
    canvas.renderAll();

    // Inject a clipPath to clip everything outside the canvas boundary
    const clipPathId = 'puzzle-clip-boundary';
    const clipPathDef = `<defs><clipPath id="${clipPathId}"><rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" /></clipPath></defs>`;
    
    // Find the main <svg> tag and inject clipPath, then wrap content in a clipped group
    svg = svg.replace(
        /(<svg[^>]*>)/,
        `$1${clipPathDef}<g clip-path="url(#${clipPathId})">`
    );
    svg = svg.replace('</svg>', '</g></svg>');

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'puzzle_design.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// --- Undo / Redo ---
function scheduleSaveState() {
    if (isRestoringHistory) return;
    if (saveStateTimer) clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(saveState, 150);
}

function saveState() {
    if (isRestoringHistory) return;

    const json = canvas.toDatalessJSON([
        'thresholdType',
        'thresholdLevel',
        'smoothRadius',
        'hdrStrength',
        'originalSrcUrl',
        'vectorizeEnabled',
        'vectorizeQuality',
        'isVectorizedImage',
        'isPuzzlePath'
    ]);

    // drop redo branch
    history = history.slice(0, historyIndex + 1);
    history.push(json);

    if (history.length > MAX_HISTORY) {
        history.shift();
    }
    historyIndex = history.length - 1;
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= history.length - 1;
}

function restoreState(index) {
    const json = history[index];
    if (!json) return;

    isRestoringHistory = true;

    canvas.loadFromJSON(json, () => {
        // Re-link puzzlePath and re-apply processing on images
        puzzlePath = null;
        canvas.getObjects().forEach((obj) => {
            if (obj && obj.isPuzzlePath) {
                puzzlePath = obj;
                obj.selectable = false;
                obj.evented = false;
                obj.stroke = UI_CUT_STROKE_COLOR;
                obj.strokeWidth = getCutStrokeWidthForZoom();
            }

            if (obj && (obj.type === 'image' || obj.isVectorizedImage)) {
                // Ensure we have an original source URL for re-processing
                const srcUrl = obj.originalSrcUrl || obj.src;
                if (srcUrl) {
                    obj.originalSrcUrl = srcUrl;
                    const im = new Image();
                    im.onload = () => {
                        obj.originalSrc = im;
                        applyImageProcessing(obj);
                        if (puzzlePath) puzzlePath.bringToFront();
                        canvas.requestRenderAll();
                    };
                    im.src = srcUrl;
                }
            }
        });

        if (puzzlePath) puzzlePath.bringToFront();
        syncPuzzleStrokeForZoom();
        canvas.renderAll();
        updateEditSelectedAvailability();

        isRestoringHistory = false;
        updateUndoRedoButtons();
    });
}

function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreState(historyIndex);
}

function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    restoreState(historyIndex);
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

canvas.on('object:added', () => {
    scheduleSaveState();
    updateEditSelectedAvailability();
});
canvas.on('object:modified', () => scheduleSaveState());
canvas.on('object:removed', () => {
    scheduleSaveState();
    updateEditSelectedAvailability();
});
canvas.on('text:changed', () => scheduleSaveState());

// Init availability + initial history snapshot
updateEditSelectedAvailability();
saveState();
