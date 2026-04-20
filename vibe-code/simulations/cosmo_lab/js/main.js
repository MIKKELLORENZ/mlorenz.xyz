document.addEventListener('DOMContentLoaded', () => {
    const canvasId = 'simulationCanvas';
    const canvas = document.getElementById(canvasId);

    // Define the fixed dimensions for the simulation coordinate space (slightly larger)
    const simulationWidth = 1000; // Increased from 800
    const simulationHeight = 750; // Increased from 600 (maintains 4:3 ratio)

    // Initial parameters (updated defaults)
    const initialParams = {
        gravity: 0.59,
        numParticles: 1750, // Default updated to 1750
        seed: 42,
        width: simulationWidth,
        height: simulationHeight,
        simSpeed: 1.0, // Default updated to 1.0
        // mode will be read from the select element by the UI listener triggered by createButton.click()
    };

    const simulation = new Simulation(initialParams);
    const renderer = new Renderer(canvasId, simulation);

    // Run UI setup first to get references and listeners ready
    setupUI(simulation, renderer);

    let lastTimestamp = 0;
    function gameLoop(timestamp) {
        const dt = (timestamp - lastTimestamp) / 100;
        lastTimestamp = timestamp;
        const maxDt = 0.5;
        const clampedDt = Math.min(dt, maxDt);
        if (clampedDt > 0) {
             simulation.step(clampedDt);
        }
        renderer.draw();
        requestAnimationFrame(gameLoop);
    }

    // Trigger initial creation (reads default values from HTML, including mode)
    document.getElementById('createButton').click();

    // Set simulation to auto-play
    simulation.isRunning = true;

    // --- Explicitly update button state AFTER setting auto-play ---
    const playPauseButton = document.getElementById('playPauseButton');
    playPauseButton.textContent = 'Pause';
    playPauseButton.classList.add('paused');
    playPauseButton.classList.remove('primary');
    // --- End button state update ---

    // Start the loop
    requestAnimationFrame(gameLoop);
});
