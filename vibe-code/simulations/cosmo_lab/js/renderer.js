class Renderer {
    constructor(canvasId, simulation) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.simulation = simulation;
        // Default to velocity if gravity was previously selected somehow
        this.colorMode = "velocity"; // "velocity", "kinetic"
        // Store the fixed simulation dimensions used for coordinates
        // Ensure these match the values set in main.js
        this.simulationWidth = simulation.params.width;
        this.simulationHeight = simulation.params.height;
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.addClickListener(); // Add this line
    }

    resizeCanvas() {
        // Set the canvas drawing buffer size to match its CSS displayed size
        const computedStyle = getComputedStyle(this.canvas);
        this.canvas.width = parseInt(computedStyle.width, 10);
        this.canvas.height = parseInt(computedStyle.height, 10);
        // Note: We no longer update simulation.params.width/height here,
        // as they represent the fixed simulation coordinate space.
    }

    setColorMode(mode) {
        // Ensure mode is valid after removing gravity
        if (mode === "velocity" || mode === "kinetic") {
            this.colorMode = mode;
        } else {
            this.colorMode = "velocity"; // Default fallback
        }
    }

    velocityToColor(vx, vy) {
        const speed = Math.sqrt(vx * vx + vy * vy);
        const maxSpeed = 5.0;
        const ratio = Math.min(speed / maxSpeed, 1.0);
        const hue = (1.0 - ratio) * 240;
        return `hsl(${hue}, 100%, 70%)`;
    }

    kineticToColor(vx, vy, mass) {
        const ke = 0.5 * mass * (vx * vx + vy * vy);
        const maxKE = 5.0; // Tune for best visual effect
        const ratio = Math.min(ke / maxKE, 1.0);
        const hue = (1.0 - ratio) * 120; // 120 (green) to 0 (red)
        return `hsl(${hue}, 100%, 70%)`;
    }

    addClickListener() {
        this.canvas.addEventListener('click', (event) => {
            // Get click coordinates relative to the canvas element
            const rect = this.canvas.getBoundingClientRect();
            const canvasX = event.clientX - rect.left;
            const canvasY = event.clientY - rect.top;

            // Reverse the scaling and translation applied during drawing
            const scaleX = this.canvas.width / this.simulationWidth;
            const scaleY = this.canvas.height / this.simulationHeight;
            const scale = Math.min(scaleX, scaleY);
            const scaledWidth = this.simulationWidth * scale;
            const scaledHeight = this.simulationHeight * scale;
            const offsetX = (this.canvas.width - scaledWidth) / 2;
            const offsetY = (this.canvas.height - scaledHeight) / 2;

            // Convert canvas coordinates back to simulation coordinates
            const simX = (canvasX - offsetX) / scale;
            const simY = (canvasY - offsetY) / scale;

            // Check if the click is within the bounds of the scaled simulation area
            if (simX >= 0 && simX <= this.simulationWidth && simY >= 0 && simY <= this.simulationHeight) {
                // Add a small cluster of particles at the simulation coordinates
                this.simulation.addParticleCluster(simX, simY, 10, 15); // Add 10 particles in a 15-unit spread
            }
        });
    }

    draw() {
        const ctx = this.ctx;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

        // Calculate scale factors for width and height
        const scaleX = canvasWidth / this.simulationWidth;
        const scaleY = canvasHeight / this.simulationHeight;

        // Use the smaller scale factor to maintain aspect ratio (fit inside)
        const scale = Math.min(scaleX, scaleY);

        // Calculate the size of the scaled simulation drawing
        const scaledWidth = this.simulationWidth * scale;
        const scaledHeight = this.simulationHeight * scale;

        // Calculate offsets to center the drawing within the canvas element
        const offsetX = (canvasWidth - scaledWidth) / 2;
        const offsetY = (canvasHeight - scaledHeight) / 2;

        // Clear canvas
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Save context state, apply translation and uniform scaling
        ctx.save();
        ctx.translate(offsetX, offsetY); // Move origin to center the drawing
        ctx.scale(scale, scale); // Apply uniform scale

        // Draw particles using simulation coordinates (they will be scaled uniformly)
        for (const p of this.simulation.particles) {
            ctx.beginPath();
            // Use simulation coordinates for arc
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            let color;
            if (this.colorMode === "velocity") {
                color = this.velocityToColor(p.vx, p.vy);
            } else if (this.colorMode === "kinetic") {
                color = this.kineticToColor(p.vx, p.vy, p.mass);
            }
            ctx.fillStyle = color;
            ctx.fill();
        }

        // Restore context state (removes scaling and translation)
        ctx.restore();
    }
}
