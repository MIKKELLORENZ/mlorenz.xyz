function setupUI(simulation, renderer) {
    const gravitySlider = document.getElementById('gravity');
    const gravityValue = document.getElementById('gravityValue');
    const numParticlesInput = document.getElementById('numParticles');
    const numParticlesValue = document.getElementById('numParticlesValue');
    const seedInput = document.getElementById('seed');
    const createButton = document.getElementById('createButton');
    const playPauseButton = document.getElementById('playPauseButton');
    const simSpeedSlider = document.getElementById('simSpeed');
    const simSpeedValue = document.getElementById('simSpeedValue');
    const simAgeDisplay = document.getElementById('simAge');
    const colorModeSelect = document.getElementById('colorModeSelect');
    const genesisModeSelect = document.getElementById('genesisModeSelect');

    function updateParamDisplay() {
        gravityValue.textContent = parseFloat(gravitySlider.value).toFixed(2);
        numParticlesValue.textContent = numParticlesInput.value;
    }

    gravitySlider.addEventListener('input', () => {
        updateParamDisplay();
        simulation.updateParams({ gravity: parseFloat(gravitySlider.value) });
    });

    numParticlesInput.addEventListener('input', updateParamDisplay);

    createButton.addEventListener('click', () => {
        const selectedMode = genesisModeSelect.value;
        let numParticlesToCreate = parseInt(numParticlesInput.value, 10);

        numParticlesInput.disabled = false; // Always enabled now
        // Ensure value is at least the minimum if user entered something invalid
        if (isNaN(numParticlesToCreate) || numParticlesToCreate < 10) {
            numParticlesToCreate = 1750; // Fallback to default if invalid
            numParticlesInput.value = numParticlesToCreate;
        }
        updateParamDisplay(); // Update the span display

        simulation.recreate({
            gravity: parseFloat(gravitySlider.value),
            numParticles: numParticlesToCreate, // Use the determined value
            seed: parseInt(seedInput.value, 10) || 42,
            simSpeed: parseFloat(simSpeedSlider.value),
            mode: selectedMode
        });
        // After recreate, simulation is stopped. Set button to "Play" (blue).
        playPauseButton.textContent = 'Play';
        playPauseButton.classList.remove('paused');
        playPauseButton.classList.add('primary');
        simAgeDisplay.textContent = '0';
        updateParamDisplay(); // Update display including potentially changed particle count
        simSpeedValue.textContent = `${parseFloat(simSpeedSlider.value).toFixed(1)}x`;
    });

    // Add listener for Genesis Mode change
    genesisModeSelect.addEventListener('change', () => {
        numParticlesInput.value = 1750; // Set default particle count for all modes on change
        numParticlesInput.disabled = false; // Ensure it's enabled
        updateParamDisplay(); // Update the displayed particle count
        createButton.click(); // Automatically create the universe when mode changes
    });

    playPauseButton.addEventListener('click', () => {
        const isRunning = simulation.togglePlayPause();
        playPauseButton.textContent = isRunning ? 'Pause' : 'Play';
        // Add/remove classes for styling
        if (isRunning) {
            // Simulation is running -> Button shows "Pause" -> Apply red style
            playPauseButton.classList.add('paused');
            playPauseButton.classList.remove('primary');
        } else {
            // Simulation is paused -> Button shows "Play" -> Apply blue style
            playPauseButton.classList.remove('paused');
            playPauseButton.classList.add('primary');
        }
    });

    simSpeedSlider.addEventListener('input', () => {
        const speed = parseFloat(simSpeedSlider.value);
        simulation.setSpeed(speed);
        simSpeedValue.textContent = `${speed.toFixed(1)}x`;
    });

    colorModeSelect.addEventListener('change', () => {
        renderer.setColorMode(colorModeSelect.value);
    });

    setInterval(() => {
        if (simulation.isRunning) {
            simAgeDisplay.textContent = simulation.age;
        }
    }, 250);

    // Initial setup reflects new defaults
    updateParamDisplay();
    simSpeedValue.textContent = `${parseFloat(simSpeedSlider.value).toFixed(1)}x`;
}
