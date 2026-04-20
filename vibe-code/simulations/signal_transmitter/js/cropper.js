/*
 * ImageCropper - inline crop on the source canvas.
 * Uses multi-step downscaling for high quality.
 * Shows the image with a draggable 256x256 crop overlay directly on sourceCanvas.
 */
function ImageCropper(sourceCanvas, onCropped) {
    this.canvas = sourceCanvas;
    this.ctx = sourceCanvas.getContext('2d');
    this.onCropped = onCropped;

    // Original full-res image
    this.image = null;

    // Pre-downscaled version (shortest side = 256)
    this.scaledCanvas = null;
    this.scaledW = 0;
    this.scaledH = 0;

    // Display mapping (scaled image → 256x256 source canvas)
    this.displayScale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // Crop rect in scaled-image coordinates
    this.cropRect = { x: 0, y: 0 };
    this.cropSize = 256;

    // State
    this.active = false; // true when showing crop UI
    this.dragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragOrigX = 0;
    this.dragOrigY = 0;

    this._bind();
}

ImageCropper.prototype._bind = function() {
    var self = this;
    this.canvas.addEventListener('mousedown', function(e) { self._onPointerDown(e); });
    this.canvas.addEventListener('mousemove', function(e) { self._onPointerMove(e); });
    this.canvas.addEventListener('mouseup', function(e) { self._onPointerUp(e); });
    this.canvas.addEventListener('mouseleave', function() { self.dragging = false; });

    this.canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        self._onPointerDown(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchmove', function(e) {
        e.preventDefault();
        self._onPointerMove(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchend', function(e) { self._onPointerUp(e); });
};

// Downscale image to target dimensions with good quality
ImageCropper.prototype._highQualityDownscale = function(img, targetW, targetH) {
    var c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, targetW, targetH);
    return c;
};

// Load an Image object — auto center-crop to 256x256
ImageCropper.prototype.loadImage = function(img) {
    this.image = img;
    var natW = img.naturalWidth;
    var natH = img.naturalHeight;

    // Downscale so shortest side = 256, then center-crop to 256x256
    var scale = 256 / Math.min(natW, natH);
    if (scale > 1) scale = 1;
    var sw = Math.max(256, Math.round(natW * scale));
    var sh = Math.max(256, Math.round(natH * scale));

    this.scaledCanvas = this._highQualityDownscale(img, sw, sh);
    this.scaledW = sw;
    this.scaledH = sh;

    // Center crop
    this.cropRect.x = Math.floor((sw - 256) / 2);
    this.cropRect.y = Math.floor((sh - 256) / 2);

    // If image is exactly square after downscale, just use it
    if (sw === 256 && sh === 256) {
        this.active = false;
        var imageData = this.scaledCanvas.getContext('2d').getImageData(0, 0, 256, 256);
        if (this.onCropped) this.onCropped(imageData);
        return;
    }

    // If only slightly non-square (aspect ratio < 1.3), auto-crop without UI
    var aspect = Math.max(sw, sh) / Math.min(sw, sh);
    if (aspect < 1.3) {
        this.active = false;
        this._confirmCrop();
        return;
    }

    // Show interactive crop UI for very non-square images
    this.displayScale = Math.min(256 / sw, 256 / sh);
    this.offsetX = (256 - sw * this.displayScale) / 2;
    this.offsetY = (256 - sh * this.displayScale) / 2;

    this.active = true;
    this._render();
};

ImageCropper.prototype._render = function() {
    if (!this.scaledCanvas || !this.active) return;
    var ctx = this.ctx;

    // Clear
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, 256, 256);

    // Draw scaled image
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
        this.scaledCanvas,
        this.offsetX, this.offsetY,
        this.scaledW * this.displayScale, this.scaledH * this.displayScale
    );

    // Crop rect in display coords
    var cx = this.offsetX + this.cropRect.x * this.displayScale;
    var cy = this.offsetY + this.cropRect.y * this.displayScale;
    var cs = 256 * this.displayScale;

    // Darken outside
    var iw = this.scaledW * this.displayScale;
    var ih = this.scaledH * this.displayScale;
    var ix = this.offsetX;
    var iy = this.offsetY;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(ix, iy, iw, cy - iy);
    ctx.fillRect(ix, cy + cs, iw, iy + ih - cy - cs);
    ctx.fillRect(ix, cy, cx - ix, cs);
    ctx.fillRect(cx + cs, cy, ix + iw - cx - cs, cs);

    // Crop border
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(cx, cy, cs, cs);
    ctx.setLineDash([]);

    // Corner L-handles
    var hl = 8;
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + hl); ctx.lineTo(cx, cy); ctx.lineTo(cx + hl, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + cs - hl, cy); ctx.lineTo(cx + cs, cy); ctx.lineTo(cx + cs, cy + hl);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + cs - hl); ctx.lineTo(cx, cy + cs); ctx.lineTo(cx + hl, cy + cs);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + cs - hl, cy + cs); ctx.lineTo(cx + cs, cy + cs); ctx.lineTo(cx + cs, cy + cs - hl);
    ctx.stroke();

    // Hint text
    ctx.fillStyle = 'rgba(88, 166, 255, 0.8)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Drag to reposition, click to confirm', 128, 252);
};

ImageCropper.prototype._displayToScaled = function(dx, dy) {
    return {
        x: (dx - this.offsetX) / this.displayScale,
        y: (dy - this.offsetY) / this.displayScale
    };
};

ImageCropper.prototype._getPointerPos = function(e) {
    var rect = this.canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
};

ImageCropper.prototype._onPointerDown = function(e) {
    if (!this.active) return;
    var pos = this._getPointerPos(e);
    var imgPos = this._displayToScaled(pos.x, pos.y);

    var cr = this.cropRect;
    if (imgPos.x >= cr.x && imgPos.x <= cr.x + 256 &&
        imgPos.y >= cr.y && imgPos.y <= cr.y + 256) {
        this.dragging = true;
        this.dragStartX = imgPos.x;
        this.dragStartY = imgPos.y;
        this.dragOrigX = cr.x;
        this.dragOrigY = cr.y;
    }
};

ImageCropper.prototype._onPointerMove = function(e) {
    if (!this.active || !this.dragging) return;
    var pos = this._getPointerPos(e);
    var imgPos = this._displayToScaled(pos.x, pos.y);

    var newX = this.dragOrigX + (imgPos.x - this.dragStartX);
    var newY = this.dragOrigY + (imgPos.y - this.dragStartY);

    newX = Math.max(0, Math.min(this.scaledW - 256, newX));
    newY = Math.max(0, Math.min(this.scaledH - 256, newY));

    this.cropRect.x = Math.round(newX);
    this.cropRect.y = Math.round(newY);
    this._render();
};

ImageCropper.prototype._onPointerUp = function(e) {
    if (!this.active) { this.dragging = false; return; }

    var wasDragging = this.dragging;
    this.dragging = false;

    if (!wasDragging) {
        // Click without drag = confirm crop
        this._confirmCrop();
        return;
    }

    // Check if drag was very small (treat as click)
    if (e && (e.clientX !== undefined)) {
        var pos = this._getPointerPos(e);
        var imgPos = this._displayToScaled(pos.x, pos.y);
        var moved = Math.abs(imgPos.x - this.dragStartX) + Math.abs(imgPos.y - this.dragStartY);
        if (moved < 3) {
            this._confirmCrop();
        }
    }
};

ImageCropper.prototype._confirmCrop = function() {
    if (!this.scaledCanvas) return;

    // Extract 256x256 from scaled canvas (already at the right resolution)
    var offscreen = document.createElement('canvas');
    offscreen.width = 256;
    offscreen.height = 256;
    var octx = offscreen.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(
        this.scaledCanvas,
        this.cropRect.x, this.cropRect.y, 256, 256,
        0, 0, 256, 256
    );

    this.active = false;
    var imageData = octx.getImageData(0, 0, 256, 256);
    if (this.onCropped) this.onCropped(imageData);
};
