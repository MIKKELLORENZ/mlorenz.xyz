function SceneRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.connectionType = 'white'; // white | rgb | fiber
    this.sensorType = 'photoresistor';
    this.encoding = 'analog8';
    this.isTransmitting = false;
    this.beamPhase = 0;
    this.time = 0;

    this._senderLedPos = null;
    this._receiverSensorPos = null;

    this.resize();
    var self = this;
    window.addEventListener('resize', function() { self.resize(); });
}

SceneRenderer.prototype.resize = function() {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
};

SceneRenderer.prototype.updateConfig = function(config) {
    if (config.connectionType !== undefined) this.connectionType = config.connectionType;
    if (config.sensorType !== undefined) this.sensorType = config.sensorType;
    if (config.encoding !== undefined) this.encoding = config.encoding;
};

SceneRenderer.prototype.setTransmitting = function(active) {
    this.isTransmitting = active;
};

SceneRenderer.prototype.draw = function(dt) {
    this.time += dt;
    this.beamPhase += dt * 0.005;
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    if (w === 0 || h === 0) return;

    ctx.clearRect(0, 0, w, h);

    // Tightly cropped view: just walls, windows, and hardware
    var wallH = h * 0.82;
    var groundY = wallH;
    var sillY = h * 0.48; // window sill line

    this._drawBackground(ctx, w, h, groundY, sillY);
    this._drawWall(ctx, w, h, groundY, sillY, 0, 'sender');
    this._drawWall(ctx, w, h, groundY, sillY, 1, 'receiver');
    this._drawGround(ctx, w, h, groundY);
    this._drawFence(ctx, w, h, groundY);

    if (this.isTransmitting) {
        this._drawBeam(ctx, w, h);
    }
};

// ── Background sky between houses ──
SceneRenderer.prototype._drawBackground = function(ctx, w, h, groundY, sillY) {
    var grad = ctx.createLinearGradient(0, 0, 0, groundY);
    grad.addColorStop(0, '#5a9ed6');
    grad.addColorStop(1, '#a8dce6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, groundY);
};

// ── Ground strip ──
SceneRenderer.prototype._drawGround = function(ctx, w, h, groundY) {
    var grad = ctx.createLinearGradient(0, groundY, 0, h);
    grad.addColorStop(0, '#5a9e4b');
    grad.addColorStop(1, '#3d7a34');
    ctx.fillStyle = grad;
    ctx.fillRect(0, groundY, w, h - groundY);
};

// ── Small fence between houses ──
SceneRenderer.prototype._drawFence = function(ctx, w, h, groundY) {
    var fenceY = groundY;
    var postW = 3;
    var postH = 16;
    var gap = 12;
    var startX = w * 0.28;
    var endX = w * 0.72;

    ctx.fillStyle = '#c4a36e';
    ctx.fillRect(startX, fenceY - postH * 0.7, endX - startX, 2);
    ctx.fillRect(startX, fenceY - postH * 0.35, endX - startX, 2);

    for (var x = startX; x <= endX; x += gap) {
        ctx.fillRect(x - postW / 2, fenceY - postH, postW, postH);
        ctx.beginPath();
        ctx.moveTo(x - postW / 2 - 1, fenceY - postH);
        ctx.lineTo(x, fenceY - postH - 3);
        ctx.lineTo(x + postW / 2 + 1, fenceY - postH);
        ctx.fillStyle = '#c4a36e';
        ctx.fill();
    }
};

// ── Wall + Window + Hardware ──
SceneRenderer.prototype._drawWall = function(ctx, w, h, groundY, sillY, sideIdx, side) {
    var wallW = w * 0.32;
    var hx = sideIdx === 0 ? 0 : w - wallW;

    // Wall body
    var wallGrad = ctx.createLinearGradient(hx, 0, hx, groundY);
    wallGrad.addColorStop(0, side === 'sender' ? '#e8dcc8' : '#ddd4c2');
    wallGrad.addColorStop(1, side === 'sender' ? '#ddd0ba' : '#d0c5b0');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(hx, 0, wallW, groundY);

    // Subtle brick texture
    ctx.strokeStyle = 'rgba(0,0,0,0.03)';
    ctx.lineWidth = 0.5;
    for (var row = 0; row < groundY; row += 12) {
        var off = (Math.floor(row / 12) % 2) * 20;
        for (var bx = hx + off; bx < hx + wallW; bx += 40) {
            ctx.strokeRect(bx, row, 40, 12);
        }
    }

    // Wall edge shadow
    if (sideIdx === 0) {
        var edgeShadow = ctx.createLinearGradient(hx + wallW - 8, 0, hx + wallW, 0);
        edgeShadow.addColorStop(0, 'rgba(0,0,0,0)');
        edgeShadow.addColorStop(1, 'rgba(0,0,0,0.08)');
        ctx.fillStyle = edgeShadow;
        ctx.fillRect(hx + wallW - 8, 0, 8, groundY);
    } else {
        var edgeShadow2 = ctx.createLinearGradient(hx, 0, hx + 8, 0);
        edgeShadow2.addColorStop(0, 'rgba(0,0,0,0.08)');
        edgeShadow2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = edgeShadow2;
        ctx.fillRect(hx, 0, 8, groundY);
    }

    // ── Window ──
    var winW = wallW * 0.55;
    var winH = h * 0.42;
    var winX = sideIdx === 0 ? hx + wallW - winW - wallW * 0.08 : hx + wallW * 0.08;
    var winY = sillY - winH;

    // Window recess shadow
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(winX - 3, winY - 3, winW + 6, winH + 6);

    // Window glass
    var glassGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH);
    glassGrad.addColorStop(0, '#b8e4f0');
    glassGrad.addColorStop(0.5, '#9ad4e8');
    glassGrad.addColorStop(1, '#7ec8e3');
    ctx.fillStyle = glassGrad;
    ctx.fillRect(winX, winY, winW, winH);

    // Curtain hints (inside top)
    ctx.fillStyle = 'rgba(200, 180, 160, 0.3)';
    ctx.fillRect(winX + 2, winY + 2, winW * 0.15, winH * 0.6);
    ctx.fillRect(winX + winW - 2 - winW * 0.15, winY + 2, winW * 0.15, winH * 0.6);

    // Window frame
    ctx.strokeStyle = '#f0ebe0';
    ctx.lineWidth = 3;
    ctx.strokeRect(winX, winY, winW, winH);

    // Frame cross
    ctx.strokeStyle = '#e8e0d0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(winX + winW / 2, winY);
    ctx.lineTo(winX + winW / 2, winY + winH);
    ctx.moveTo(winX, winY + winH * 0.45);
    ctx.lineTo(winX + winW, winY + winH * 0.45);
    ctx.stroke();

    // Window sill
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(winX - 6, sillY - 1, winW + 12, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(winX - 6, sillY + 3, winW + 12, 2);

    // ── Hardware on windowsill ──
    this._drawHardwareOnSill(ctx, winX, sillY, winW, side, sideIdx, w);

    // Label
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(side === 'sender' ? 'SENDER' : 'RECEIVER', hx + wallW / 2, groundY + 14);
};

// ── Hardware sitting on the window sill ──
SceneRenderer.prototype._drawHardwareOnSill = function(ctx, winX, sillY, winW, side, sideIdx, canvasW) {
    // RPi board dimensions
    var piW = Math.max(winW * 0.65, 55);
    var piH = piW * 0.62;
    var piX, piY;

    // Pi sits on the sill, slightly off-center toward the lawn
    piY = sillY - piH + 2;
    if (sideIdx === 0) {
        piX = winX + winW - piW * 0.4;
    } else {
        piX = winX - piW * 0.6;
    }

    // ── Raspberry Pi PCB ──
    ctx.save();

    // Board shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.roundRect(piX + 2, piY + 2, piW, piH, 3);
    ctx.fill();

    // Green PCB
    var pcbGrad = ctx.createLinearGradient(piX, piY, piX, piY + piH);
    pcbGrad.addColorStop(0, '#2d9a4e');
    pcbGrad.addColorStop(1, '#1e7a38');
    ctx.fillStyle = pcbGrad;
    ctx.beginPath();
    ctx.roundRect(piX, piY, piW, piH, 3);
    ctx.fill();
    ctx.strokeStyle = '#1a6b2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(piX, piY, piW, piH, 3);
    ctx.stroke();

    // Mounting holes
    var hi = 4, hr = 1.8;
    var holes = [
        [piX + hi, piY + hi], [piX + piW - hi, piY + hi],
        [piX + hi, piY + piH - hi], [piX + piW - hi, piY + piH - hi]
    ];
    for (var i = 0; i < holes.length; i++) {
        ctx.beginPath();
        ctx.arc(holes[i][0], holes[i][1], hr, 0, Math.PI * 2);
        ctx.fillStyle = '#1a5a28';
        ctx.fill();
        ctx.strokeStyle = '#c0c0c0';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    // GPIO header (2x20 style)
    var gpioX = piX + 5;
    var gpioY = piY + 4;
    var pinGap = 2.8;
    var numPins = Math.min(12, Math.floor((piW - 12) / pinGap));
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(gpioX - 1, gpioY - 1, numPins * pinGap + 2, 10);
    for (var row = 0; row < 2; row++) {
        for (var col = 0; col < numPins; col++) {
            ctx.fillStyle = '#d4a843';
            ctx.fillRect(gpioX + col * pinGap, gpioY + row * 4, 1.8, 3);
        }
    }

    // SoC chip
    var chipS = piW * 0.22;
    var chipX = piX + piW * 0.28;
    var chipY = piY + piH * 0.35;
    ctx.fillStyle = '#444';
    ctx.fillRect(chipX, chipY, chipS, chipS);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(chipX, chipY, chipS, chipS);
    // Chip text
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = Math.max(5, chipS * 0.35) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BCM', chipX + chipS / 2, chipY + chipS * 0.65);

    // USB port (silver block)
    ctx.fillStyle = '#999';
    var usbW = 10, usbH = 7;
    ctx.fillRect(piX + piW - usbW - 2, piY + piH * 0.3, usbW, usbH);
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(piX + piW - usbW - 2, piY + piH * 0.3, usbW, usbH);
    // USB opening
    ctx.fillStyle = '#333';
    ctx.fillRect(piX + piW - usbW, piY + piH * 0.3 + 1.5, usbW - 3, usbH - 3);

    // Ethernet port
    var ethX = piX + piW - usbW - 2;
    var ethY = piY + piH * 0.3 + usbH + 2;
    ctx.fillStyle = '#888';
    ctx.fillRect(ethX, ethY, usbW, usbH);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ethX, ethY, usbW, usbH);

    // HDMI port
    ctx.fillStyle = '#aaa';
    ctx.fillRect(piX + piW * 0.45, piY + piH - 5, 9, 4);

    // Power LED
    ctx.beginPath();
    ctx.arc(piX + piW - 6, piY + 6, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3333';
    ctx.fill();
    // Activity LED
    ctx.beginPath();
    ctx.arc(piX + piW - 11, piY + 6, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#33ff33';
    ctx.fill();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = 'bold ' + Math.max(7, piW * 0.11) + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('RPi', piX + 6, piY + piH - 5);

    ctx.restore();

    // ── External components connected via wires ──
    if (this.connectionType === 'fiber') {
        this._drawFiberSetup(ctx, piX, piY, piW, piH, side, sideIdx, canvasW, sillY);
    } else {
        this._drawLedSensorSetup(ctx, piX, piY, piW, piH, side, sideIdx);
    }
};

// ── LED + Sensor wired setup ──
SceneRenderer.prototype._drawLedSensorSetup = function(ctx, piX, piY, piW, piH, side, sideIdx) {
    var wireStartX, wireStartY, compX, compY, wireDir;

    if (side === 'sender') {
        wireDir = 1;
        wireStartX = piX + piW + 2;
        wireStartY = piY + 8;
        compX = wireStartX + 18;
        compY = piY + piH * 0.35;
    } else {
        wireDir = -1;
        wireStartX = piX - 2;
        wireStartY = piY + 8;
        compX = wireStartX - 20;
        compY = piY + piH * 0.35;
    }

    var ct = this.connectionType;

    // Draw signal wire
    ctx.strokeStyle = ct === 'infrared' ? '#884488' : ct === 'laser' ? '#cc2222' : '#e04040';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(wireStartX, wireStartY);
    ctx.quadraticCurveTo(wireStartX + 10 * wireDir, wireStartY, compX, compY);
    ctx.stroke();
    // Ground wire
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wireStartX, wireStartY + 3);
    ctx.quadraticCurveTo(wireStartX + 10 * wireDir, wireStartY + 5, compX, compY + (side === 'sender' ? 10 : 12));
    ctx.stroke();

    if (side === 'sender') {
        if (ct === 'rgb') {
            // Three colored wires + LEDs
            var wires = [
                { color: '#e04040', ledColor: '#ff4444', ledY: compY - 10 },
                { color: '#40c040', ledColor: '#44ff44', ledY: compY },
                { color: '#4040e0', ledColor: '#4444ff', ledY: compY + 10 }
            ];
            for (var i = 0; i < wires.length; i++) {
                ctx.strokeStyle = wires[i].color;
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.moveTo(wireStartX, wireStartY + i * 1.5);
                ctx.quadraticCurveTo(wireStartX + 10 * wireDir, wireStartY + i * 1.5, compX, wires[i].ledY);
                ctx.stroke();
                this._drawDetailedLED(ctx, compX, wires[i].ledY, wires[i].ledColor, this.isTransmitting);
            }
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(wireStartX, wireStartY + 5);
            ctx.quadraticCurveTo(wireStartX + 10 * wireDir, wireStartY + 8, compX, compY + 18);
            ctx.stroke();
            this._senderLedPos = { x: compX + 6 * wireDir, y: compY };
        } else if (ct === 'infrared') {
            this._drawIRLED(ctx, compX, compY, this.isTransmitting);
            this._senderLedPos = { x: compX + 6 * wireDir, y: compY };
        } else if (ct === 'laser') {
            this._drawLaserModule(ctx, compX, compY, wireDir, this.isTransmitting);
            this._senderLedPos = { x: compX + 6 * wireDir, y: compY };
        } else {
            // Single white LED
            this._drawDetailedLED(ctx, compX, compY, '#ffffff', this.isTransmitting);
            this._senderLedPos = { x: compX + 6 * wireDir, y: compY };
        }
    } else {
        // Receiver
        if (ct === 'infrared') {
            this._drawTSOP(ctx, compX, compY);
        } else {
            this._drawDetailedSensor(ctx, compX, compY);
        }
        this._receiverSensorPos = { x: compX - 4 * wireDir, y: compY };
    }
};

// ── Fiber Optic setup ──
SceneRenderer.prototype._drawFiberSetup = function(ctx, piX, piY, piW, piH, side, sideIdx, canvasW, sillY) {
    // Media converter box sits ON the window sill next to the Pi
    var boxW = 26;
    var boxH = 18;
    var boxX, boxY;

    boxY = sillY - boxH + 1; // Bottom aligned to sill

    if (sideIdx === 0) {
        boxX = piX + piW + 14;
    } else {
        boxX = piX - boxW - 14;
    }

    // Ethernet cable from Pi to box (short, on the sill)
    var ethFromX = sideIdx === 0 ? piX + piW - 2 : piX + 2;
    var ethFromY = piY + piH * 0.6;
    var ethToX = sideIdx === 0 ? boxX + 2 : boxX + boxW - 2;
    var ethToY = boxY + boxH * 0.4;

    ctx.strokeStyle = '#2266cc';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ethFromX, ethFromY);
    var cMidX = (ethFromX + ethToX) / 2;
    ctx.quadraticCurveTo(cMidX, Math.max(ethFromY, ethToY) + 4, ethToX, ethToY);
    ctx.stroke();

    // Box shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.roundRect(boxX + 1.5, boxY + 1.5, boxW, boxH, 2);
    ctx.fill();

    // Box body
    ctx.fillStyle = '#2a2a3a';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 2);
    ctx.fill();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 2);
    ctx.stroke();

    // Status LEDs
    ctx.beginPath();
    ctx.arc(boxX + 5, boxY + 4, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = this.isTransmitting ? '#33ff33' : '#335533';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(boxX + 10, boxY + 4, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = this.isTransmitting ? '#ffaa33' : '#554433';
    ctx.fill();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SFP', boxX + boxW / 2, boxY + boxH - 3);

    // ── Fiber optic cable from box outward ──
    var fiberEndX = sideIdx === 0 ? canvasW * 0.38 : canvasW * 0.62;
    var fiberStartX = sideIdx === 0 ? boxX + boxW : boxX;
    var fiberY = boxY + boxH * 0.5;

    // Yellow fiber cable with droop
    ctx.strokeStyle = '#e8c020';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fiberStartX, fiberY);
    var midX = (fiberStartX + fiberEndX) / 2;
    var droopY = fiberY + 12;
    ctx.quadraticCurveTo(midX, droopY, fiberEndX, fiberY);
    ctx.stroke();

    if (this.isTransmitting) {
        // Inner glow
        ctx.strokeStyle = 'rgba(255, 220, 50, ' + (0.3 + 0.5 * Math.abs(Math.sin(this.beamPhase * 2))) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(fiberStartX, fiberY);
        ctx.quadraticCurveTo(midX, droopY, fiberEndX, fiberY);
        ctx.stroke();

        // Traveling data pulses
        for (var p = 0; p < 8; p++) {
            var t = ((this.beamPhase * 0.8 + p / 8) % 1);
            var px = fiberStartX * (1 - t) * (1 - t) + midX * 2 * (1 - t) * t + fiberEndX * t * t;
            var py = fiberY * (1 - t) * (1 - t) + droopY * 2 * (1 - t) * t + fiberY * t * t;
            ctx.beginPath();
            ctx.arc(px, py, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 230, 80, 0.8)';
            ctx.fill();
        }
    }

    // SC connector at the end
    ctx.fillStyle = '#33aa33';
    ctx.fillRect(fiberEndX - 3, fiberY - 3, 6, 6);
    ctx.strokeStyle = '#228822';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(fiberEndX - 3, fiberY - 3, 6, 6);

    if (sideIdx === 0) {
        this._senderLedPos = { x: fiberEndX + 3, y: fiberY };
    } else {
        this._receiverSensorPos = { x: fiberEndX - 3, y: fiberY };
    }
};

// ── IR LED (dark clear epoxy dome) ──
SceneRenderer.prototype._drawIRLED = function(ctx, x, y, active) {
    var r = 5;
    // Body — dark tinted epoxy
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#5a3a6a' : '#2a1a2a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Highlight
    ctx.beginPath();
    ctx.arc(x - 1.5, y - 1.5, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200,150,220,0.4)';
    ctx.fill();
    // Legs
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x - 2, y + r); ctx.lineTo(x - 2, y + r + 6);
    ctx.moveTo(x + 2, y + r); ctx.lineTo(x + 2, y + r + 5);
    ctx.stroke();
    // Label
    ctx.fillStyle = 'rgba(200,150,220,0.7)';
    ctx.font = '6px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IR', x, y + r + 14);
    if (active) {
        // IR glow (invisible, so show subtle purple hint)
        var glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 5);
        glow.addColorStop(0, 'rgba(180,100,220,0.25)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    }
};

// ── Laser module (cylindrical housing) ──
SceneRenderer.prototype._drawLaserModule = function(ctx, x, y, wireDir, active) {
    var bw = 14, bh = 8;
    var bx = x - bw / 2, by = y - bh / 2;
    // Housing
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 2);
    ctx.stroke();
    // Aperture (front face toward lawn)
    var apertureX = wireDir > 0 ? bx + bw : bx;
    ctx.beginPath();
    ctx.arc(apertureX, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#ff2222' : '#441111';
    ctx.fill();
    // Label
    ctx.fillStyle = 'rgba(255,100,100,0.7)';
    ctx.font = '5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('650nm', x, y + bh / 2 + 9);
    if (active) {
        var glow = ctx.createRadialGradient(apertureX, y, 1, apertureX, y, 20);
        glow.addColorStop(0, 'rgba(255,50,50,0.5)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(apertureX - 20, y - 20, 40, 40);
    }
};

// ── TSOP1738 IR demodulator ──
SceneRenderer.prototype._drawTSOP = function(ctx, x, y) {
    var pw = 10, ph = 14;
    // D-shaped body
    ctx.fillStyle = '#1a1010';
    ctx.beginPath();
    ctx.roundRect(x - pw / 2, y - ph / 2, pw, ph, [2, 2, 4, 4]);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(x - pw / 2, y - ph / 2, pw, ph, [2, 2, 4, 4]);
    ctx.stroke();
    // IR lens window
    ctx.beginPath();
    ctx.arc(x, y - 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(80,40,80,0.6)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,80,150,0.4)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // Legs
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + ph / 2); ctx.lineTo(x - 3, y + ph / 2 + 7);
    ctx.moveTo(x, y + ph / 2);     ctx.lineTo(x, y + ph / 2 + 7);
    ctx.moveTo(x + 3, y + ph / 2); ctx.lineTo(x + 3, y + ph / 2 + 7);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,150,220,0.6)';
    ctx.font = '6px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TSOP', x, y + ph / 2 + 16);
};

// ── Detailed LED ──
SceneRenderer.prototype._drawDetailedLED = function(ctx, x, y, color, active) {
    var r = 5;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? color : '#888';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Highlight
    ctx.beginPath();
    ctx.arc(x - 1.5, y - 1.5, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();

    // Flat edge
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + r * 0.7, y - r * 0.7);
    ctx.lineTo(x + r * 0.7, y + r * 0.7);
    ctx.stroke();

    // Legs
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x - 2, y + r);
    ctx.lineTo(x - 2, y + r + 6);
    ctx.moveTo(x + 2, y + r);
    ctx.lineTo(x + 2, y + r + 5);
    ctx.stroke();

    if (active) {
        var glowColor = this._ledGlowColors[color] || 'rgba(255,255,255,0.5)';
        var glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 6);
        glow.addColorStop(0, glowColor);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
    }
};

// ── Detailed Sensor ──
SceneRenderer.prototype._drawDetailedSensor = function(ctx, x, y) {
    if (this.sensorType === 'photoresistor') {
        var r = 7;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        var dg = ctx.createRadialGradient(x, y, 0, x, y, r);
        dg.addColorStop(0, '#c85a30');
        dg.addColorStop(0.7, '#a04020');
        dg.addColorStop(1, '#803010');
        ctx.fillStyle = dg;
        ctx.fill();
        ctx.strokeStyle = '#602010';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Zigzag
        ctx.strokeStyle = '#d4a843';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 3.5, y - 3.5);
        ctx.lineTo(x + 2.5, y - 2);
        ctx.lineTo(x - 2.5, y);
        ctx.lineTo(x + 2.5, y + 1.5);
        ctx.lineTo(x - 3.5, y + 3.5);
        ctx.stroke();

        // Clear window
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 180, 140, 0.25)';
        ctx.fill();

        // Legs
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x - 2.5, y + r);
        ctx.lineTo(x - 2.5, y + r + 7);
        ctx.moveTo(x + 2.5, y + r);
        ctx.lineTo(x + 2.5, y + r + 7);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '7px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LDR', x, y + r + 16);
    } else {
        var pw = 10, ph = 12;
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(x - pw / 2, y - ph / 2, pw, ph);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x - pw / 2, y - ph / 2, pw, ph);

        // Lens
        ctx.beginPath();
        ctx.arc(x, y - 1, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100, 140, 200, 0.5)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(150, 180, 220, 0.5)';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Polarity dot
        ctx.beginPath();
        ctx.arc(x - 2.5, y + ph / 2 - 3, 1, 0, Math.PI * 2);
        ctx.fillStyle = '#555';
        ctx.fill();

        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x - 2.5, y + ph / 2);
        ctx.lineTo(x - 2.5, y + ph / 2 + 7);
        ctx.moveTo(x + 2.5, y + ph / 2);
        ctx.lineTo(x + 2.5, y + ph / 2 + 7);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '6px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PD', x, y + ph / 2 + 16);
    }
};

SceneRenderer.prototype._ledGlowColors = {
    '#ffffff': 'rgba(255,255,255,0.5)',
    '#ff4444': 'rgba(255,68,68,0.5)',
    '#44ff44': 'rgba(68,255,68,0.5)',
    '#4444ff': 'rgba(68,68,255,0.5)'
};

// ── Light Beam with realistic signal visualization ──
SceneRenderer.prototype._drawBeam = function(ctx, w, h) {
    if (!this._senderLedPos || !this._receiverSensorPos) return;
    if (this.connectionType === 'fiber') return;

    var sx = this._senderLedPos.x;
    var sy = this._senderLedPos.y;
    var rx = this._receiverSensorPos.x;
    var ry = this._receiverSensorPos.y;
    var dist = Math.sqrt((rx - sx) * (rx - sx) + (ry - sy) * (ry - sy));
    var ang = Math.atan2(ry - sy, rx - sx);

    ctx.save();

    var phase = this.beamPhase * 3;
    var ct = this.connectionType;

    if (ct === 'laser') {
        // Laser: tight, straight, narrow beam with waveform on it
        // Draw beam cone (very narrow)
        ctx.beginPath();
        var perpX = Math.cos(ang + Math.PI / 2), perpY = Math.sin(ang + Math.PI / 2);
        ctx.moveTo(sx + perpX * 1, sy + perpY * 1);
        ctx.lineTo(rx + perpX * 1, ry + perpY * 1);
        ctx.lineTo(rx - perpX * 1, ry - perpY * 1);
        ctx.lineTo(sx - perpX * 1, sy - perpY * 1);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,30,30,0.12)';
        ctx.fill();
        this._drawSignalWave(ctx, sx, sy, rx, ry, dist, ang, phase,
            'rgba(255,80,80,0.85)', 'rgba(255,50,50,0.9)', 8);

    } else if (ct === 'infrared') {
        // IR: invisible in reality — show as faint purple dashed line + waveform hint
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(160,80,200,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(rx, ry);
        ctx.stroke();
        ctx.setLineDash([]);
        this._drawSignalWave(ctx, sx, sy, rx, ry, dist, ang, phase,
            'rgba(180,100,220,0.45)', 'rgba(160,80,200,0.5)', 9);

    } else if (ct === 'rgb') {
        // RGB: three parallel signal waves
        var offsets = [-5, 0, 5];
        var colors = [
            ['rgba(255,100,100,0.6)', 'rgba(255,80,80,0.7)'],
            ['rgba(100,255,100,0.6)', 'rgba(80,255,80,0.7)'],
            ['rgba(100,100,255,0.6)', 'rgba(80,80,255,0.7)']
        ];
        var perpX2 = Math.cos(ang + Math.PI / 2);
        var perpY2 = Math.sin(ang + Math.PI / 2);
        for (var i = 0; i < 3; i++) {
            var ox = perpX2 * offsets[i];
            var oy = perpY2 * offsets[i];
            this._drawSignalWave(ctx, sx + ox, sy + oy, rx + ox, ry + oy, dist, ang,
                phase + i * 2.1, colors[i][0], colors[i][1], 8);
        }

    } else {
        // Single white LED
        this._drawSignalWave(ctx, sx, sy, rx, ry, dist, ang, phase,
            'rgba(255,255,240,0.7)', 'rgba(255,255,255,0.8)', 12);
    }

    ctx.restore();
};

// Draw a signal waveform between two points based on current encoding
SceneRenderer.prototype._drawSignalWave = function(ctx, sx, sy, ex, ey, dist, ang, phase, strokeColor, glowColor, amplitude) {
    var encoding = this.encoding;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);

    // Generate a pseudo-random signal pattern (seeded by phase)
    ctx.beginPath();
    ctx.moveTo(0, 0);

    var steps = 80;
    var segLen = dist / steps;

    // Generate pseudo-random bits for the signal
    var seed = Math.floor(phase * 2) % 256;

    for (var i = 0; i <= steps; i++) {
        var x = i * segLen;
        var t = i / steps;
        // Negate phase so the wave travels sender→receiver (left to right)
        var scroll = ((t * 16 - phase * 4) % 16 + 160) % 16;
        var bitIdx = Math.floor(scroll);
        var subBit = scroll - bitIdx; // sub-bit position for smooth blending
        // Pseudo-random bit pattern using seed
        var bit = ((seed * 7 + bitIdx * 13 + Math.floor(phase)) % 3) > 0 ? 1 : 0;
        var y = 0;

        if (encoding === 'binary' || encoding === 'hamming74') {
            // Square wave: on/off
            y = bit ? -amplitude * 0.8 : amplitude * 0.3;
        } else if (encoding === 'manchester') {
            // Manchester: transition in middle of each bit period
            if (bit) {
                y = subBit < 0.5 ? -amplitude * 0.8 : amplitude * 0.8;
            } else {
                y = subBit < 0.5 ? amplitude * 0.8 : -amplitude * 0.8;
            }
        } else if (encoding === 'analog4') {
            // 4-bit: 16 discrete levels
            var level4 = ((seed * 3 + bitIdx * 7 + Math.floor(phase * 2)) % 16) / 15;
            y = -(level4 * 2 - 1) * amplitude * 0.7;
            // Step-like with slight smoothing at transitions
            var nextLevel = ((seed * 3 + ((bitIdx + 1) % 16) * 7 + Math.floor(phase * 2)) % 16) / 15;
            if (subBit > 0.85) {
                var nY = -(nextLevel * 2 - 1) * amplitude * 0.7;
                y = y + (nY - y) * ((subBit - 0.85) / 0.15);
            }
        } else if (encoding === 'ppm4') {
            // 4-PPM: pulse at one of 4 positions per symbol
            var slotInSymbol = Math.floor(scroll * 2) % 4; // 4 slots per symbol (16/4)
            var pulseSlot = (bitIdx * 3) % 4; // pseudo-random pulse position
            y = slotInSymbol === pulseSlot ? -amplitude * 0.9 : amplitude * 0.15;
        } else {
            // analog8: smooth interpolated analog signal
            var level8 = ((seed * 5 + bitIdx * 11 + Math.floor(phase * 2)) % 256) / 255;
            var nextLevel8 = ((seed * 5 + ((bitIdx + 1) % 16) * 11 + Math.floor(phase * 2)) % 256) / 255;
            var blended8 = level8 + (nextLevel8 - level8) * subBit;
            y = -(blended8 * 2 - 1) * amplitude * 0.6;
        }

        // Fade at edges
        var edgeFade = Math.min(t * 8, (1 - t) * 8, 1);
        y *= edgeFade;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    // Glow
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Second pass brighter
    ctx.shadowBlur = 0;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
};
