/**
 * Renderer class for the stick balancing simulation
 * Handles all visual elements including the platform, stick, wheels, and environment
 */
class Renderer {
    constructor(canvas, environment) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.environment = environment;
        
        // Initialize collection properties BEFORE any method uses them
        this.clouds = [];
        this.cloudsInitialized = false;
        this.windStreams = [];
        this.windStreamsInitialized = false;
        this.grassTufts = [];
        this.grassTuftsInitialized = false;
        this.smoothWindRotation = 0;
        this.smoothWindStrength = 0;
    this.smoothThrust = 0; // for smoothing acceleration bar

        // Get world size information safely
        let worldInfo = null;
        try {
            if (this.environment && typeof this.environment.getWorldInfo === 'function') {
                worldInfo = this.environment.getWorldInfo();
            }
        } catch (e) {
            console.warn('Renderer: failed to get world info', e);
        }
        // Fallback defaults if environment not ready yet
        this.worldWidth = (worldInfo && worldInfo.width) ? worldInfo.width : 10;
        this.stickLength = (worldInfo && worldInfo.stickLength) ? worldInfo.stickLength : 2;
        this.platformWidth = (worldInfo && worldInfo.platformWidth) ? worldInfo.platformWidth : 1;
        this.wheelRadius = (worldInfo && worldInfo.wheelRadius) ? worldInfo.wheelRadius : 0.2;

        // Pixel scaling (will also trigger particle initialization)
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }
    
    /**
     * Resize canvas to fit container
     */
    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        // Calculate scale factor (pixels per meter)
        this.scale = this.canvas.width / (this.worldWidth * 1.2); // Add some padding
        
        // Make sure there's extra room at the bottom for the wheels
        const groundOffset = this.wheelRadius * 1.5 * this.scale;
        this.groundLevel = this.canvas.height - groundOffset;
        
        // Initialize particles only once
        if (!this.cloudsInitialized) {
            this.initClouds();
            this.cloudsInitialized = true;
        }
        if (!this.windStreamsInitialized) {
            this.initWindStreams();
            this.windStreamsInitialized = true;
        }
        if (!this.grassTuftsInitialized) {
            this.grassTufts = this.generateGrassTufts();
            this.grassTuftsInitialized = true;
        }
    }
    
    /**
     * Initialize clouds
     */
    initClouds() {
        // Safety check: ensure worldWidth is valid
        if (!this.worldWidth || this.worldWidth <= 0) {
            console.warn('Cannot initialize clouds: worldWidth not set');
            return;
        }
        
        // Create 3-6 random clouds in each of three layers (foreground, middle, background)
        const layers = [
            { count: Math.floor(Math.random() * 2) + 2, depth: 0.8, scale: 1.2, opacity: 0.9 },   // Foreground
            { count: Math.floor(Math.random() * 3) + 3, depth: 0.5, scale: 1.0, opacity: 0.7 },   // Middle
            { count: Math.floor(Math.random() * 4) + 4, depth: 0.2, scale: 0.8, opacity: 0.5 }    // Background
        ];
        
        layers.forEach(layer => {
            for (let i = 0; i < layer.count; i++) {
                this.clouds.push({
                    x: Math.random() * this.worldWidth - this.worldWidth / 2,
                    y: Math.random() * (this.canvas.height * 0.4),
                    width: (Math.random() * 2 + 1) * layer.scale,  // Cloud width in meters, scaled by layer
                    height: (Math.random() * 0.8 + 0.2) * layer.scale, // Cloud height in meters, scaled by layer
                    speed: 0,  // Will be updated based on wind
                    segments: Math.floor(Math.random() * 3) + 2, // Number of cloud puffs
                    density: Math.random() * 0.2 + layer.opacity, // Cloud density/opacity
                    depth: layer.depth // Parallax depth factor (0-1)
                });
            }
        });
    }
    
    /**
     * Initialize wind stream particles
     */
    initWindStreams() {
        // Safety check: ensure worldWidth is valid
        if (!this.worldWidth || this.worldWidth <= 0) {
            console.warn('Cannot initialize wind streams: worldWidth not set');
            return;
        }
        
        const numStreams = 80; // Increased for more prominent wind visualization
        this.windStreams = [];
        
        for (let i = 0; i < numStreams; i++) {
            this.windStreams.push(this.createWindStreamParticle());
        }
    }
    
    /**
     * Create a single wind stream particle with random properties
     */
    createWindStreamParticle() {
        return {
            x: Math.random() * this.worldWidth - this.worldWidth / 2,
            y: Math.random() * 6, // Height between 0-6 meters (increased range)
            length: Math.random() * 0.5 + 0.2, // Length between 0.2-0.7 meters (increased)
            alpha: Math.random() * 0.4 + 0.2, // Transparency between 0.2-0.6 (more visible)
            speed: 0, // Will be updated based on wind
            waveOffset: Math.random() * Math.PI * 2 // Add wave offset for wavy motion
        };
    }
    
    /**
     * Generate random grass tufts for more detailed ground
     */
    generateGrassTufts() {
        // Safety check: ensure worldWidth is valid
        if (!this.worldWidth || this.worldWidth <= 0) {
            console.warn('Cannot generate grass tufts: worldWidth not set');
            return [];
        }
        
        const tufts = [];
        const numTufts = Math.floor(this.canvas.width / 15); // Tuft every 15 pixels or so
        
        for (let i = 0; i < numTufts; i++) {
            tufts.push({
                x: Math.random() * this.worldWidth - this.worldWidth / 2,
                height: Math.random() * 0.2 + 0.05, // Random height between 0.05 and 0.25 meters
                width: Math.random() * 0.1 + 0.05, // Random width between 0.05 and 0.15 meters
                shade: Math.random() * 30 // Random shade of green
            });
        }
        
        return tufts;
    }
    
    /**
     * Draw episode counter in top left corner
     * @param {number} episodeNumber - Current episode number
     */
    drawEpisodeCounter(episodeNumber) {
        const ctx = this.ctx;
        
        // Set up text styling
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.lineWidth = 2;
        
        const text = `Episode: ${episodeNumber}`;
        const x = 20;
        const y = 35;
        
        // Draw text with outline for better visibility
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
    }
    
    /**
     * Convert world coordinates to screen coordinates
     * @param {number} x - World x coordinate
     * @param {number} y - World y coordinate
     * @returns {Object} - Screen coordinates
     */
    worldToScreen(x, y) {
        // Convert meters to pixels and flip y-axis
        const screenX = (x + this.worldWidth / 2) * this.scale;
        const screenY = this.groundLevel - y * this.scale;
        
        return { x: screenX, y: screenY };
    }
    
    /**
     * Draw the sky and ground
     */
    drawBackground(windForce) {
        const ctx = this.ctx;
        
        // Sky (light blue)
        ctx.fillStyle = '#87CEEB';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Ground base (darker green)
        const groundLevel = this.worldToScreen(0, 0).y;
        ctx.fillStyle = '#3A7D44';
        ctx.fillRect(0, groundLevel, this.canvas.width, this.canvas.height - groundLevel);
        
        // Draw grass tufts with wind effect
        this.drawGrassTufts(windForce);
        
        // Draw a soil/dirt line
        ctx.strokeStyle = '#5D4037';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, groundLevel);
        ctx.lineTo(this.canvas.width, groundLevel);
        ctx.stroke();
    }
    
    /**
     * Draw individual grass tufts for more detailed ground
     */
    drawGrassTufts(windForce) {
        const ctx = this.ctx;
        const groundLevel = this.worldToScreen(0, 0).y;
        
        // Calculate wind effect on grass (safe normalization)
        const normalizedWind = (this.environment && this.environment.maxWindStrength > 0)
            ? (windForce / this.environment.maxWindStrength)
            : 0;
        const windSway = normalizedWind * 8; // Max 8 pixel sway
        
        this.grassTufts.forEach(tuft => {
            const { x: screenX } = this.worldToScreen(tuft.x, 0);
            const tuftWidth = tuft.width * this.scale;
            const tuftHeight = tuft.height * this.scale;
            
            // Apply gentle wind sway - limit to prevent extreme movements
            const swayAmount = Math.min(Math.max(windSway * (0.5 + Math.random() * 0.5), -15), 15);
            const tipX = screenX + swayAmount;
            
            // Draw a grass tuft (triangle that can bend with wind)
            ctx.fillStyle = `rgb(76, ${157 + tuft.shade}, 76)`;
            ctx.beginPath();
            ctx.moveTo(screenX - tuftWidth / 2, groundLevel);
            ctx.lineTo(tipX, groundLevel - tuftHeight); // Tip can move with wind
            ctx.lineTo(screenX + tuftWidth / 2, groundLevel);
            ctx.closePath();
            ctx.fill();
        });
    }
    
    /**
     * Draw clouds that move with the wind
     * @param {number} windForce - Current wind force
     */
    drawClouds(windForce) {
        const ctx = this.ctx;
        
        // Sort clouds by depth to ensure proper layering
        const sortedClouds = [...this.clouds].sort((a, b) => a.depth - b.depth);
        
        // Update and draw each cloud
        sortedClouds.forEach(cloud => {
            // Update cloud position based on wind, with enhanced parallax effect
            const normalizedWind = (this.environment && this.environment.maxWindStrength > 0)
                ? (windForce / this.environment.maxWindStrength)
                : 0;
            
            // Enhanced parallax: background clouds move slower, foreground clouds move faster
            const parallaxMultiplier = 0.3 + (cloud.depth * 1.4); // Range from 0.3 to 1.7
            
            // Slowly adjust cloud speed with better responsiveness
            const targetSpeed = normalizedWind * 0.03 * parallaxMultiplier;
            cloud.speed += (targetSpeed - cloud.speed) * 0.02;
            cloud.x += cloud.speed;
            
            // Wrap clouds around the screen
            if (cloud.x > this.worldWidth / 2 + 2) {
                cloud.x = -this.worldWidth / 2 - 2;
            } else if (cloud.x < -this.worldWidth / 2 - 2) {
                cloud.x = this.worldWidth / 2 + 2;
            }
            
            // Draw cloud with depth-based vertical offset
            const depthOffset = (1 - cloud.depth) * 0.5; // Background clouds higher
            const { x: screenX, y: screenY } = this.worldToScreen(cloud.x, 3 + cloud.y / this.scale + depthOffset);
            
            // Draw cloud segments (puffy parts) with depth-based opacity
            const depthOpacity = cloud.density * (0.4 + cloud.depth * 0.6); // Background clouds more transparent
            ctx.fillStyle = `rgba(255, 255, 255, ${depthOpacity})`;
            const segmentWidth = cloud.width * this.scale / cloud.segments;
            
            for (let i = 0; i < cloud.segments; i++) {
                const segmentX = screenX + i * segmentWidth * 0.8;
                const segmentY = screenY - (i % 2) * 10 * cloud.depth; // Vary height with depth
                const segmentRadius = segmentWidth * 0.8 * (0.7 + cloud.depth * 0.3); // Size varies with depth
                
                // Draw a circle for each cloud segment
                ctx.beginPath();
                ctx.arc(segmentX, segmentY, segmentRadius, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    }
    
    /**
     * Draw wind stream indicators
     * @param {number} windForce - Current wind force
     */
    drawWindStreams(windForce) {
        const ctx = this.ctx;
        
        // More prominent wind visualization
        const normalizedWind = (this.environment && this.environment.maxWindStrength > 0)
            ? (windForce / this.environment.maxWindStrength)
            : 0;
        
        // Enhanced wind properties for better visibility
        const minSpeed = 0.03;
        const minAlpha = 0.25; // Increased visibility
        const minLength = 0.08;
        
        this.windStreams.forEach(stream => {
            // Calculate wind effect with better scaling
            const effectiveWind = normalizedWind;
            const windMagnitude = Math.abs(effectiveWind);
            
            // Update stream position with proper direction
            stream.speed = effectiveWind * 0.15 + (Math.sign(effectiveWind) || 1) * minSpeed;
            stream.x += stream.speed;
            
            // Enhanced wavy motion for more dynamic appearance
            const waveAmplitude = 0.03 + windMagnitude * 0.12;
            const waveFreq = 400 + windMagnitude * 200; // Faster waves with stronger wind
            stream.y += Math.sin(performance.now() / waveFreq + stream.waveOffset) * waveAmplitude;
            
            // Screen wrapping
            if (stream.x > this.worldWidth / 2) {
                stream.x = -this.worldWidth / 2;
            } else if (stream.x < -this.worldWidth / 2) {
                stream.x = this.worldWidth / 2;
            }
            
            // Calculate screen coordinates
            const { x: startX, y: startY } = this.worldToScreen(stream.x, stream.y);
            
            // Enhanced stream length and direction indication
            const streamLength = minLength + windMagnitude * stream.length * 1.5;
            const direction = Math.sign(effectiveWind) || 1;
            const { x: endX } = this.worldToScreen(stream.x + streamLength * direction, stream.y);
            
            // More prominent alpha scaling
            const alphaValue = minAlpha + stream.alpha * windMagnitude * 1.2;
            
            // Enhanced line styling with wind direction colors
            const windColor = effectiveWind > 0 ? 'rgba(120, 180, 220, ' : 'rgba(180, 120, 220, ';
            ctx.strokeStyle = windColor + alphaValue + ')';
            ctx.lineWidth = 1.5 + windMagnitude * 2;
            
            // Draw main wind trail
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, startY);
            ctx.stroke();
            
            // Add arrow-like effect for stronger winds
            if (windMagnitude > 0.3) {
                const arrowSize = 3 + windMagnitude * 4;
                ctx.beginPath();
                ctx.moveTo(endX, startY);
                ctx.lineTo(endX - arrowSize * direction, startY - arrowSize/2);
                ctx.moveTo(endX, startY);
                ctx.lineTo(endX - arrowSize * direction, startY + arrowSize/2);
                ctx.stroke();
            }
        });
    }
    
    /**
     * Draw the platform and wheels
     * @param {Object} state - Current physics state
     */
    drawPlatform(state) {
        const ctx = this.ctx;
        
        // Safety check for invalid platform position
        const safePos = isFinite(state.platformPos) ? state.platformPos : 0;
        
        // Ensure position is within world boundaries
        const boundedPos = Math.max(
            -this.worldWidth / 2, 
            Math.min(this.worldWidth / 2, safePos)
        );
        
        // Get platform position
        const { x: centerX, y: groundY } = this.worldToScreen(boundedPos, 0);
        
        // Platform dimensions in pixels
        const platformWidth = this.platformWidth * this.scale;
        const platformHeight = platformWidth * 0.3;
        
        // Draw wheels
        const wheelRadius = this.wheelRadius * this.scale;
        const leftWheelX = centerX - platformWidth * 0.4;
        const rightWheelX = centerX + platformWidth * 0.4;
        const wheelY = groundY;
        
        // Safe wheel rotation (to prevent NaN)
        const safeRotation = isFinite(state.wheelRotation) ? state.wheelRotation : 0;
        
        // Draw wheels with rotation
        this.drawWheel(leftWheelX, wheelY, wheelRadius, safeRotation);
        this.drawWheel(rightWheelX, wheelY, wheelRadius, safeRotation);
        
        // Draw platform body (rectangle) above the wheels
        ctx.fillStyle = '#8B4513'; // Brown color
        ctx.fillRect(centerX - platformWidth / 2, groundY - platformHeight - wheelRadius * 0.2, platformWidth, platformHeight);
    }
    
    /**
     * Draw a wheel with rotation
     * @param {number} x - Wheel center x coordinate
     * @param {number} y - Wheel center y coordinate
     * @param {number} radius - Wheel radius
     * @param {number} rotation - Wheel rotation angle
     */
    drawWheel(x, y, radius, rotation) {
        const ctx = this.ctx;
        
        // Wheel rim
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Wheel hub
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
        ctx.fill();
        
        // Wheel spokes to show rotation
        ctx.strokeStyle = '#AAA';
        ctx.lineWidth = radius * 0.1;
        
        // Draw 4 spokes
        for (let i = 0; i < 4; i++) {
            const angle = rotation + i * Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(
                x + Math.cos(angle) * radius * 0.9,
                y + Math.sin(angle) * radius * 0.9
            );
            ctx.stroke();
        }
    }
    
    /**
     * Draw the balancing stick
     * @param {Object} state - Current physics state
     */
    drawStick(state) {
        const ctx = this.ctx;
        
        // Safety checks for invalid state values
        const safePos = isFinite(state.platformPos) ? state.platformPos : 0;
        const safeAngle = isFinite(state.stickAngle) ? state.stickAngle : 0;
        
        // Ensure position is within world boundaries
        const boundedPos = Math.max(
            -this.worldWidth / 2, 
            Math.min(this.worldWidth / 2, safePos)
        );
        
        // Get platform position
        const { x: centerX, y: groundY } = this.worldToScreen(boundedPos, 0);
        
        // Platform dimensions in pixels
        const platformWidth = this.platformWidth * this.scale;
        const platformHeight = platformWidth * 0.3;
        const wheelRadius = this.wheelRadius * this.scale;
        
        // Get stick base position (on top of platform)
        const baseX = centerX;
        const baseY = groundY - platformHeight - wheelRadius * 0.2;
        
        // Calculate stick end position using angle
        const stickLength = this.stickLength * this.scale;
        const endX = baseX + Math.sin(safeAngle) * stickLength;
        const endY = baseY - Math.cos(safeAngle) * stickLength;
        
        // Make sure all values are finite before drawing
        if (!isFinite(baseX) || !isFinite(baseY) || 
            !isFinite(endX) || !isFinite(endY)) {
            console.error("Non-finite stick coordinates:", {baseX, baseY, endX, endY});
            return; // Skip drawing rather than drawing with invalid values
        }
        
        // Draw stick
        ctx.strokeStyle = '#D2691E'; // Wooden color
        ctx.lineWidth = stickLength * 0.05;
        ctx.lineCap = 'round';
        
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }
    
    /**
     * Update the wind indicator arrow with smooth transitions
     * @param {number} windForce - Current wind force
     */
    updateWindIndicator(windForce) {
        const arrow = document.getElementById('windArrow');
        const speedEl = document.getElementById('windSpeed');
        
        // Normalize wind to -1 to 1 range (safe when maxWindStrength is 0)
        const normalizedWind = (this.environment && this.environment.maxWindStrength > 0)
            ? (windForce / this.environment.maxWindStrength)
            : 0;
        
        // Calculate target rotation and strength
        const targetRotation = normalizedWind < 0 ? 180 : 0;
        const targetStrength = Math.abs(normalizedWind);
        
        // Smooth transitions
        const rotationSpeed = 0.1; // Adjust for desired smoothness
        const strengthSpeed = 0.05;
        
        // Update smooth values
        const rotationDiff = targetRotation - this.smoothWindRotation;
        // Handle rotation wrapping (0° and 180° are far apart)
        if (Math.abs(rotationDiff) > 90) {
            this.smoothWindRotation += Math.sign(rotationDiff) * 180;
        }
        this.smoothWindRotation += (targetRotation - this.smoothWindRotation) * rotationSpeed;
        this.smoothWindStrength += (targetStrength - this.smoothWindStrength) * strengthSpeed;
        
        // Always show at least a minimal wind indication
        const minStrength = 0.3;
        const displayStrength = Math.max(minStrength, this.smoothWindStrength);
        
        if (arrow) {
            // Update arrow style with smooth values
            arrow.style.transform = `rotate(${this.smoothWindRotation}deg) scaleX(${displayStrength})`;
            arrow.style.opacity = 0.7 + this.smoothWindStrength * 0.3;
        }

        // Update wind speed text (m/s). windForce is in cart force units; treat as m/s equivalent for UI scale.
        if (speedEl) {
            const speedVal = Math.abs(windForce || 0);
            // Limit to one decimal, avoid NaN
            const safeSpeed = isFinite(speedVal) ? speedVal : 0;
            speedEl.textContent = `${safeSpeed.toFixed(1)} m/s`;
        }
    }
    
    /**
     * Clean up resources to prevent memory leaks
     */
    cleanup() {
        // Clear arrays - don't just reassign
        if (this.clouds) this.clouds.length = 0;
        if (this.windStreams) this.windStreams.length = 0;
        if (this.grassTufts) this.grassTufts.length = 0;
        
        // Reset initialization flags so they can be recreated
        this.cloudsInitialized = false;
        this.windStreamsInitialized = false;
        this.grassTuftsInitialized = false;
        
        // Clear canvas
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    
    /**
     * Render the entire scene
     * @param {Object} state - Current physics state
     * @param {number} windForce - Current wind force
     * @param {number} episodeNumber - Current episode number
     */
    render(state, windForce, episodeNumber) {
        try {
            // Safety check for invalid state
            if (!state || typeof state !== 'object') {
                console.error("Invalid state object passed to renderer:", state);
                // Create a default state if none provided
                state = {
                    platformPos: 0,
                    platformVel: 0,
                    stickAngle: 0,
                    stickAngularVel: 0,
                    wheelRotation: 0
                };
            }
            
            // Sanitize windForce
            const safeWindForce = isFinite(windForce) ? windForce : 0;
            
            // Clear canvas with a single operation
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Draw scene elements (pass windForce to background for grass movement)
            this.drawBackground(safeWindForce);
            this.drawWindStreams(safeWindForce);
            this.drawClouds(safeWindForce);
            this.drawPlatform(state);
            this.drawStick(state);
            
            // Draw episode counter
            if (episodeNumber !== undefined) {
                this.drawEpisodeCounter(episodeNumber);
            }
            
            // Update wind indicator
            this.updateWindIndicator(safeWindForce);

            // Update acceleration bar based on last action in state (-1..1)
            const leftEl = document.getElementById('accelLeft');
            const rightEl = document.getElementById('accelRight');
            if (leftEl && rightEl) {
                const target = Math.max(-1, Math.min(1, state.lastAction || 0));
                // Smooth thrust with exponential moving average
                const alpha = 0.2; // smoothing factor; lower is smoother
                this.smoothThrust = this.smoothThrust + alpha * (target - this.smoothThrust);
                const a = this.smoothThrust;
                if (a < 0) {
                    const pct = Math.min(100, Math.abs(a) * 100);
                    leftEl.style.width = pct + '%';
                    rightEl.style.width = '0%';
                } else if (a > 0) {
                    const pct = Math.min(100, a * 100);
                    rightEl.style.width = pct + '%';
                    leftEl.style.width = '0%';
                } else {
                    leftEl.style.width = '0%';
                    rightEl.style.width = '0%';
                }
            }
        } catch (error) {
            console.error("Error in render method:", error);
            // If rendering fails, at least clear the canvas
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
};