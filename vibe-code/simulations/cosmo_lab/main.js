document.addEventListener('DOMContentLoaded', () => {
    const canvasId = 'simulationCanvas';
    const canvas = document.getElementById(canvasId);

    // Define the fixed dimensions for the simulation coordinate space
    const simulationWidth = 1200; // Example fixed width
    const simulationHeight = 900; // Example fixed height

    // Initial parameters
    const initialParams = {
        gravity: 0.1,
        // repulsion: 10, // Removed
        // maxSpeed: 2, // Removed
        numParticles: 2500, // Default updated
        seed: 42, // Default updated
        width: simulationWidth, // Use fixed simulation width
        height: simulationHeight, // Use fixed simulation height
        simSpeed: 1.0,
    };

    const simulation = new Simulation(initialParams);
    const renderer = new Renderer(canvasId, simulation); // Renderer now knows simulation width/height

    setupUI(simulation, renderer);

    // ... rest of the game loop logic ...
    let lastTimestamp = 0;
    function gameLoop(timestamp) {
        // ... existing code ...
    }

    document.getElementById('createButton').click();
    requestAnimationFrame(gameLoop);
});
