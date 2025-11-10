/**
 * Main simulation controller that ties together the environment, agent, and renderer
 */
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    const canvas = document.getElementById('simulationCanvas');
    const startButton = document.getElementById('startButton');
    const resetButton = document.getElementById('resetButton');
    
    // Parameter sliders and display values
    const learningRateSlider = document.getElementById('learningRate');
    const learningRateValue = document.getElementById('learningRateValue');
    const discountFactorSlider = document.getElementById('discountFactor');
    const discountFactorValue = document.getElementById('discountFactorValue');
    const explorationRateSlider = document.getElementById('explorationRate');
    const explorationRateValue = document.getElementById('explorationRateValue');
    const minExplorationRateSlider = document.getElementById('minExplorationRate');
    const minExplorationRateValue = document.getElementById('minExplorationRateValue');
    const explorationDecaySlider = document.getElementById('explorationDecay');
    const explorationDecayValue = document.getElementById('explorationDecayValue');
    const windStrengthSlider = document.getElementById('windStrength');
    const windStrengthValue = document.getElementById('windStrengthValue');
    const initialAngleVariationSlider = document.getElementById('initialAngleVariation');
    const initialAngleVariationValue = document.getElementById('initialAngleVariationValue');
    
    // Stats elements
    const episodeCounter = document.getElementById('episodeCounter');
    const bestDuration = document.getElementById('bestDuration');
    const lastReward = document.getElementById('lastReward');
    const weightChange = document.getElementById('weightChange');
    const avgReward100 = document.getElementById('avgReward100');
    
    // Chart contexts
    const rewardsChartCtx = document.getElementById('rewardsChart').getContext('2d');
    const durationChartCtx = document.getElementById('durationChart').getContext('2d');
    const weightChangeChartCtx = document.getElementById('weightChangeChart').getContext('2d');
    
    // Initialize charts
    const rewardsChart = new Chart(rewardsChartCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Episode Reward',
                data: [],
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1,
                borderWidth: 1,
                pointRadius: 3,
                pointBackgroundColor: 'rgba(75, 192, 192, 1)',
                pointBorderColor: 'rgba(75, 192, 192, 1)',
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            animation: false,
            elements: {
                point: {
                    radius: 2, // Small enough to not crowd the chart
                    hitRadius: 10, // Larger area for hover interaction
                    hoverRadius: 4
                }
            }
        }
    });
    
    const durationChart = new Chart(durationChartCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Episode Duration',
                data: [],
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                tension: 0.1,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            animation: false
        }
    });
    
    // New weight change chart
    const weightChangeChart = new Chart(weightChangeChartCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Weight Change',
                data: [],
                borderColor: 'rgba(54, 162, 235, 1)',
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                tension: 0.1,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Euclidean Distance'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            animation: false
        }
    });
    
    // Update slider values display
    function updateSliderDisplays() {
        learningRateValue.textContent = learningRateSlider.value;
        discountFactorValue.textContent = discountFactorSlider.value;
        explorationRateValue.textContent = explorationRateSlider.value;
        minExplorationRateValue.textContent = minExplorationRateSlider.value;
        explorationDecayValue.textContent = explorationDecaySlider.value;
        windStrengthValue.textContent = windStrengthSlider.value;
        initialAngleVariationValue.textContent = initialAngleVariationSlider.value;
    }
    
    // Add event listeners to sliders
    learningRateSlider.addEventListener('input', updateSliderDisplays);
    discountFactorSlider.addEventListener('input', updateSliderDisplays);
    explorationRateSlider.addEventListener('input', updateSliderDisplays);
    minExplorationRateSlider.addEventListener('input', updateSliderDisplays);
    explorationDecaySlider.addEventListener('input', updateSliderDisplays);
    windStrengthSlider.addEventListener('input', updateSliderDisplays);
    initialAngleVariationSlider.addEventListener('input', updateSliderDisplays);
    
    // Initialize slider displays
    updateSliderDisplays();

    // Assets preloading status
    let assetsLoaded = false;
    let assetLoadingStarted = false;
    
    // Simulation class
    class Simulation {
        constructor() {
            this.isRunning = false;
            this.animationId = null;
            this.updateInterval = 20; // milliseconds between physics updates
            this.lastUpdateTime = 0;
            this.lastRenderTime = 0;
            this.renderInterval = 33; // ~30 FPS for rendering (separate from physics)
            
            // Force learning flag to ensure weights are updated
            this.forceLearn = true;
            this.displayWeightUpdates = true;
            this.forceUpdateFrequency = 5; // Update weights every 5 steps
            
            // Initialize environment just for renderer setup
            const params = this.getParameters();
            this.environment = new Environment(params);
            this.renderer = new Renderer(canvas, this.environment);
            
            // Render static background scene immediately
            this.renderBackgroundOnly();
            
            // Sound loading status
            this.soundsLoaded = false;
            
            // Begin loading sounds
            this.preloadAudio();

            // New record notification
            this.newRecordNotification = null;
            this.bestDurationSoFar = 0;
            
            // Add chart update throttling
            this.lastChartUpdate = 0;
            this.chartUpdateInterval = 2000; // Update charts max once per 2 seconds
            
            // Add frame skip for better performance
            this.frameSkip = 0;
            this.maxFrameSkip = 2; // Render every 3rd physics update max
        }

        // Get current parameter values
        getParameters() {
            return {
                learningRate: parseFloat(learningRateSlider.value),
                discountFactor: parseFloat(discountFactorSlider.value),
                explorationRate: parseFloat(explorationRateSlider.value),
                minExplorationRate: parseFloat(minExplorationRateSlider.value),
                explorationDecay: parseFloat(explorationDecaySlider.value),
                windStrength: parseFloat(windStrengthSlider.value),
                initialAngleVariation: parseFloat(initialAngleVariationSlider.value)
            };
        }
        
        // Preload all audio assets
        preloadAudio() {
            if (assetLoadingStarted) return;
            assetLoadingStarted = true;
            
            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // List of sounds to preload
            const soundFiles = [
                { name: 'bird', path: 'sounds/bird.mp3' },
                { name: 'fallen', path: 'sounds/fallen.mp3' },
                { name: 'gravel', path: 'sounds/gravel.mp3' },
                { name: 'newRecord', path: 'sounds/new_record.mp3' }
            ];
            
            this.sounds = {};
            let loadedCount = 0;
            
            // Show loading status on the start button
            startButton.disabled = true;
            startButton.textContent = 'Loading assets...';
            
            // Load each sound
            soundFiles.forEach(sound => {
                const audio = new Audio();
                audio.addEventListener('canplaythrough', () => {
                    loadedCount++;
                    if (loadedCount === soundFiles.length) {
                        this.setupAudio();
                        this.soundsLoaded = true;
                        assetsLoaded = true;
                        startButton.disabled = false;
                        startButton.textContent = 'Start Training';
                        
                        // Position start button in middle of canvas
                        this.positionStartButton();
                    }
                }, { once: true });
                
                audio.addEventListener('error', () => {
                    console.error(`Error loading sound: ${sound.path}`);
                    loadedCount++;
                });
                
                audio.src = sound.path;
                audio.load();
                this.sounds[sound.name] = audio;
            });
        }
        
        // Setup audio system with preloaded sounds
        setupAudio() {
            // Setup oscillator for electric car sound
            this.oscillator = this.audioContext.createOscillator();
            this.oscillator.type = 'sine';
            this.oscillator.frequency.value = 60;
            this.oscillator.volume = 0.1;
            
            this.filter = this.audioContext.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 500;
            this.filter.Q.value = 10;
            
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            this.oscillator.connect(this.filter);
            this.filter.connect(this.gainNode);
            this.gainNode.connect(this.audioContext.destination);
            
            this.soundStarted = false;
            
            // Configure preloaded sounds
            this.birdSound = this.sounds.bird;
            this.birdSound.loop = true;
            this.birdSound.volume = 1.0;
            
            // Create an array of fallen sound instances to allow overlapping
            this.fallenSounds = [
                this.sounds.fallen,
                new Audio(this.sounds.fallen.src),
                new Audio(this.sounds.fallen.src)
            ];
            // Set a lower volume for all fallen sound instances
            this.fallenSounds.forEach(sound => {
                sound.volume = 0.3; // Lower volume from default 1.0 to 0.3
            });
            this.currentFallenSoundIndex = 0;
            
            this.newRecordSound = this.sounds.newRecord;
            this.newRecordSound.volume = 0.2; // Start silent
            
            this.gravelSound = this.sounds.gravel;
            this.gravelSound.loop = true;
            this.gravelSound.volume = 1.0; // Start silent
            this.gravelSound.playbackRate = 1.1; // Base pitch 10% higher
            
            // Don't try to play the sound yet - wait for user interaction
            this.gravelSoundStarted = false;
        }
        
        // Position start button in the middle of the canvas
        positionStartButton() {
            startButton.style.position = 'absolute';
            startButton.style.zIndex = '100';
            
            // Get canvas position
            const canvasRect = canvas.getBoundingClientRect();
            
            // Position button
            startButton.style.left = `${canvasRect.left + canvasRect.width/2 - startButton.offsetWidth/2}px`;
            startButton.style.top = `${canvasRect.top + canvasRect.height/2 - startButton.offsetHeight/2}px`;
        }
        
        // Render just the background (sky, ground, etc.) without simulation elements
        renderBackgroundOnly() {
            if (this.renderer) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Draw background elements only
                this.renderer.drawBackground(0.5);
                
                // Draw clouds with minimal wind
                this.renderer.drawClouds(0.5);
                
                // Draw wind streams with minimal wind (ensuring they're visible)
                this.renderer.drawWindStreams(0.5);
            }
        }
        
        // Update electric car sound based on platform velocity
        updateSound(velocity) {
            if (!this.audioContext || !this.soundStarted) return;
            
            try {
                // Get absolute velocity for sound intensity (with safety checks)
                const absVelocity = Math.abs(velocity) || 0;
                
                // Cap velocity to prevent excessively large values
                const cappedVelocity = Math.min(absVelocity, 20);
                
                // Map velocity to useful frequency range (90-800 Hz)
                // The frequency increases with speed
                const targetFrequency = 90 + cappedVelocity * 50; 
                
                // Safety check to ensure frequency is a valid number and within reasonable range
                if (isFinite(targetFrequency) && targetFrequency > 0 && targetFrequency < 1000) {
                    // Smooth transition to target frequency
                    this.oscillator.frequency.setTargetAtTime(targetFrequency, this.audioContext.currentTime, 0.1);
                }
                
                // Volume increases with velocity but keeps it subtle
                // Significantly reduced volume overall (0.01 base, max 0.05)
                const targetVolume = Math.min(0.01 + cappedVelocity * 0.002, 0.05);
                
                // Safety check for volume value
                if (isFinite(targetVolume) && targetVolume >= 0 && targetVolume <= 1) {
                    this.gainNode.gain.setTargetAtTime(targetVolume, this.audioContext.currentTime, 0.2);
                }
            } catch (error) {
                // Gracefully handle any errors in sound processing
                console.error("Error updating sound:", error);
            }
        }
        
        // Initialize simulation with current parameters
        init() {
            // Get parameter values
            const params = this.getParameters();
            
            // Create environment
            this.environment = new Environment(params);
            
            // Create agent
            this.agent = new Agent(params);
            
            // Create renderer
            this.renderer = new Renderer(canvas, this.environment);
            
            // Simulation properties
            this.episodeSteps = 0;
            this.totalSteps = 0;
            this.currentState = this.environment.reset();
            
            this.trainRepeats = 1; // base, adaptive later
        }
        
        // Start the simulation
        start() {
            if (this.isRunning || !assetsLoaded) return;
            
            // Hide start button
            startButton.style.display = 'none';
            
            // Initialize components if not already done
            this.init();
            
            // Start sound if not already started
            if (!this.soundStarted && this.oscillator) {
                this.oscillator.start();
                this.soundStarted = true;
            }
            
            // Mark as running
            this.isRunning = true;
            
            // Start animation loop
            this.lastUpdateTime = performance.now();
            this.animationLoop();

            // Start background bird sound
            if (this.birdSound) {
                this.birdSound.play();
            }

            // Start the gravel sound at volume 0
            if (this.gravelSound && !this.gravelSoundStarted) {
                this.gravelSound.volume = 0.8;
                this.gravelSound.play().catch(err => console.error("Error playing gravel sound:", err));
                this.gravelSoundStarted = true;
            }
        }
        
        // Stop the simulation
        stop() {
            this.isRunning = false;
            
            // Silence the sound but don't stop it
            if (this.gainNode) {
                this.gainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.1);
            }
            
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }

            // Stop and cleanup all audio
            if (this.birdSound) {
                this.birdSound.pause();
                this.birdSound.currentTime = 0;
            }

            if (this.gravelSound) {
                this.gravelSound.pause();
                this.gravelSound.currentTime = 0;
                this.gravelSoundStarted = false;
            }

            if (this.fallenSounds) {
                this.fallenSounds.forEach(sound => {
                    sound.pause();
                    sound.currentTime = 0;
                });
            }
            
            // Clear any pending timers or callbacks
            this.frameSkip = 0;
        }
        
        // Reset the simulation
        reset() {
            this.stop();
            
            // Clean up renderer resources properly
            if (this.renderer) {
                this.renderer.cleanup();
            }
            
            // Clear charts more efficiently
            const clearChart = (chart) => {
                chart.data.labels.length = 0;
                chart.data.datasets[0].data.length = 0;
                chart.update('none');
            };
            
            clearChart(rewardsChart);
            clearChart(durationChart);
            clearChart(weightChangeChart);
            
            // Reset stats display
            episodeCounter.textContent = '0';
            bestDuration.textContent = '0';
            lastReward.textContent = '0';
            weightChange.textContent = '0';
            
            // Reset agent and environment
            this.init();
            
            // Reset oscillator if needed
            if (this.soundStarted) {
                // Stop and recreate the oscillator properly
                this.oscillator.stop();
                
                // Create new oscillator 
                this.oscillator = this.audioContext.createOscillator();
                this.oscillator.type = 'sine';
                this.oscillator.frequency.value = 120;
                
                // Connect everything again
                this.oscillator.connect(this.filter);
                
                this.soundStarted = false;
            }
            
            // Show start button in the middle of canvas again
            startButton.style.display = 'block';
            this.positionStartButton();
            
            // Re-enable starting with new parameters
            startButton.disabled = false;
            resetButton.disabled = true;
            
            // Render just the background
            this.renderBackgroundOnly();
            
            // Reset performance counters
            this.lastChartUpdate = 0;
            this.frameSkip = 0;
        }
        
        // Display a new record notification
        showNewRecordNotification(duration) {
            try {
                // Remove existing notification if present
                if (this.newRecordNotification && this.newRecordNotification.parentNode) {
                    document.body.removeChild(this.newRecordNotification);
                }
                
                // Create notification element
                this.newRecordNotification = document.createElement('div');
                this.newRecordNotification.classList.add('record-notification');
                this.newRecordNotification.textContent = `New record: ${duration.toFixed(1)}s`;
                
                // Style the notification
                Object.assign(this.newRecordNotification.style, {
                    position: 'absolute',
                    backgroundColor: 'rgba(76, 175, 80, 0.9)',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    zIndex: '100',
                    transition: 'opacity 0.5s ease-in-out',
                    opacity: '0'
                });
                
                // Add to document
                document.body.appendChild(this.newRecordNotification);
                
                // Position near the platform - check that all required elements exist
                if (this.renderer && this.currentState) {
                    const canvasRect = canvas.getBoundingClientRect();
                    const platformPos = this.renderer.worldToScreen(this.currentState.platformPos, 0);
                    
                    if (platformPos && this.newRecordNotification) {
                        this.newRecordNotification.style.left = `${canvasRect.left + platformPos.x - this.newRecordNotification.offsetWidth / 2}px`;
                        this.newRecordNotification.style.top = `${canvasRect.top + platformPos.y - 100}px`;
                    }
                }
                
                // Fade in
                setTimeout(() => {
                    if (this.newRecordNotification) {
                        this.newRecordNotification.style.opacity = '1';
                    }
                }, 10);
                
                // Fade out and remove after a delay
                setTimeout(() => {
                    if (this.newRecordNotification) {
                        this.newRecordNotification.style.opacity = '0';
                        setTimeout(() => {
                            if (this.newRecordNotification && this.newRecordNotification.parentNode) {
                                document.body.removeChild(this.newRecordNotification);
                                this.newRecordNotification = null;
                            }
                        }, 500); // Wait for fade out animation
                    }
                }, 3000); // Show for 3 seconds
            } catch (error) {
                console.error("Error showing record notification:", error);
            }
        }
        
        /**
         * Update charts with latest data (throttled)
         */
        updateCharts() {
            const now = performance.now();
            
            // Throttle chart updates to reduce performance impact
            if (now - this.lastChartUpdate < this.chartUpdateInterval) {
                return;
            }
            this.lastChartUpdate = now;
            
            const stats = this.agent.getStats();
            const timestep = this.environment.physics.timestep;
            
            // Update episode counter
            episodeCounter.textContent = stats.episodeCount;
            
            // Convert from steps to seconds for more intuitive display
            const bestDurationSeconds = stats.bestDuration * timestep;
            // Update best duration (in seconds)
            bestDuration.textContent = bestDurationSeconds.toFixed(1) + 's';
            
            // Check if new record was achieved
            if (bestDurationSeconds > this.bestDurationSoFar) {
                // Play new record sound
                this.newRecordSound.play().catch(err => console.error("Error playing new record sound:", err));
                
                // Show notification
                this.showNewRecordNotification(bestDurationSeconds);
                
                // Update recorded best duration
                this.bestDurationSoFar = bestDurationSeconds;
            }
            
            // Update last reward
            lastReward.textContent = stats.lastReward.toFixed(1);
            
            // Update weight change
            weightChange.textContent = stats.lastWeightChange.toFixed(4);
            
            // Update average reward
            if (avgReward100) {
                avgReward100.textContent = stats.avgRewardLast100.toFixed(1);
            }
            
            // Limit the number of data points more aggressively
            const maxDataPoints = 300; // Reduced from 500
            
            // Update reward chart with decimation for performance
            const rewardData = [...stats.episodeRewards];
            let decimatedRewardData = rewardData;
            if (rewardData.length > maxDataPoints) {
                const decimationFactor = Math.ceil(rewardData.length / maxDataPoints);
                decimatedRewardData = rewardData.filter((_, i) => i % decimationFactor === 0);
            }
            
            rewardsChart.data.labels = Array.from(
                { length: decimatedRewardData.length }, 
                (_, i) => (i * (rewardData.length / decimatedRewardData.length)).toFixed(0)
            );
            rewardsChart.data.datasets[0].data = decimatedRewardData;
            rewardsChart.update('none'); // 'none' disables animations
            
            // Update duration chart with decimation
            const durationData = [...stats.episodeDurations].map(steps => steps * timestep);
            let decimatedDurationData = durationData;
            if (durationData.length > maxDataPoints) {
                const decimationFactor = Math.ceil(durationData.length / maxDataPoints);
                decimatedDurationData = durationData.filter((_, i) => i % decimationFactor === 0);
            }
            
            durationChart.data.labels = Array.from(
                { length: decimatedDurationData.length }, 
                (_, i) => (i * (durationData.length / decimatedDurationData.length)).toFixed(0)
            );
            durationChart.data.datasets[0].data = decimatedDurationData;
            durationChart.options.scales.y.title = {
                display: true,
                text: 'Duration (seconds)'
            };
            durationChart.update('none');
            
            // Update weight change chart with decimation
            const weightChangeData = [...stats.weightChanges];
            let decimatedWeightData = weightChangeData;
            if (weightChangeData.length > maxDataPoints) {
                const decimationFactor = Math.ceil(weightChangeData.length / maxDataPoints);
                decimatedWeightData = weightChangeData.filter((_, i) => i % decimationFactor === 0);
            }
            
            weightChangeChart.data.labels = Array.from(
                { length: decimatedWeightData.length }, 
                (_, i) => (i * (weightChangeData.length / decimatedWeightData.length)).toFixed(0)
            );
            weightChangeChart.data.datasets[0].data = decimatedWeightData;
            weightChangeChart.update('none');
        }
        
        /**
         * Main animation and learning loop
         */
        animationLoop() {
            if (!this.isRunning) return;
            
            const now = performance.now();
            const physicsElapsed = now - this.lastUpdateTime;
            const renderElapsed = now - this.lastRenderTime;
            
            // Update physics at fixed time steps
            if (physicsElapsed >= this.updateInterval) {
                this.lastUpdateTime = now;
                
                try {
                    // Validate current state before proceeding
                    if (!this.isStateValid(this.currentState)) {
                        console.error("Invalid state detected. Resetting episode:", this.currentState);
                        // Reset to a valid state
                        this.currentState = this.environment.reset();
                        this.episodeSteps = 0;
                    }
                    
                    // Select action and step environment
                    const action = this.agent.selectAction(this.currentState);
                    
                    // Log actions in early episodes to verify the agent is moving in both directions
                    if (this.agent.episodeCount < 20 && this.episodeSteps % 20 === 0) {
                        console.log(`Episode ${this.agent.episodeCount}, Step ${this.episodeSteps}: Action = ${action.toFixed(3)}, Angle = ${(this.currentState.stickAngle * 180/Math.PI).toFixed(1)}°, PlatformPos = ${this.currentState.platformPos.toFixed(2)}, Exploration = ${this.agent.explorationRate.toFixed(3)}`);
                    }
                    
                    const result = this.environment.step(action);
                    
                    // Validate result state before continuing
                    if (!this.isStateValid(result.state)) {
                        console.error("Invalid result state detected. Resetting episode:", result.state);
                        // Reset to a valid state
                        this.currentState = this.environment.reset();
                        this.episodeSteps = 0;
                        
                        // Skip the rest of this frame's processing
                        this.renderer.render(this.currentState, 0, this.agent.episodeCount); // Render with zero wind
                        this.animationId = requestAnimationFrame(() => this.animationLoop());
                        return;
                    }
                    
                    // Log rewards for debugging
                    if (this.agent.episodeCount < 10 && this.episodeSteps % 50 === 0) {
                        console.log(`Reward: ${result.reward.toFixed(2)}, Done: ${result.done}, Wind: ${result.wind.toFixed(2)}, Total Reward: ${result.totalReward.toFixed(1)}`);
                    }
                    
                    // Update electric car sound based on platform velocity
                    this.updateSound(result.state.platformVel);
                    
                    // Dynamically adjust gravel sound based on velocity
                    if (this.gravelSound && this.gravelSoundStarted) {
                        try {
                            // Just update volume and playback state
                            const absVelocity = Math.abs(result.state.platformVel) || 0;
                            const cappedVelocity = Math.min(absVelocity, 20);
                            this.gravelSound.volume = Math.min(cappedVelocity / 3, 1.0);
                            if (absVelocity > 0.01) {
                                if (this.gravelSound.paused) {
                                    this.gravelSound.play().catch(err => {
                                        console.error("Error playing gravel sound:", err);
                                    });
                                }
                            } else if (!this.gravelSound.paused) {
                                this.gravelSound.pause();
                            }
                        } catch (error) {
                            console.error("Error updating gravel sound:", error);
                        }
                    }
                    
                    // Learn from the result
                    for (let r = 0; r < this.trainRepeats; r++) {
                        this.agent.learn(this.currentState, action, result.reward, result.state, result.done);
                    }
                    // Adaptive extra training in early curriculum
                    if (this.agent.episodeCount < 150) this.trainRepeats = 2;
                    else if (this.agent.episodeCount < 300) this.trainRepeats = 1;
                    
                    // Debug learning progress in early episodes
                    if (this.agent.episodeCount <= 10 && this.episodeSteps % 100 === 0) {
                        const debug = this.agent.verifyLearning();
                        console.log(`Learning check - Episode ${this.agent.episodeCount}, Step ${this.episodeSteps}: Buffer=${debug.bufferSize}, WeightChange=${debug.weightChange.toFixed(6)}, SumW1=${debug.sumW1.toFixed(2)}`);
                    }
                    
                    // Update current state
                    this.currentState = result.state;
                    
                    // Count steps
                    this.episodeSteps++;
                    this.totalSteps++;
                    
                    // Implement frame skipping for rendering
                    this.frameSkip++;
                    const shouldRender = this.frameSkip >= this.maxFrameSkip || renderElapsed >= this.renderInterval;
                    
                    if (shouldRender) {
                        this.frameSkip = 0;
                        this.lastRenderTime = now;
                        this.renderer.render(this.currentState, result.wind, this.agent.episodeCount);
                    }
                    
                    // If episode is done
                    if (result.done) {
                        // Record episode statistics
                        this.agent.endEpisode(this.episodeSteps, result.totalReward);
                        
                        // Decay exploration rate
                        this.agent.decayExploration();
                        
                        // Update charts only every N episodes for better performance
                        if (this.agent.episodeCount % 5 === 0) {
                            this.updateCharts();
                        } else {
                            // Still update basic stats
                            episodeCounter.textContent = this.agent.episodeCount;
                            const bestDurationSeconds = this.agent.bestDuration * timestep;
                            bestDuration.textContent = bestDurationSeconds.toFixed(1) + 's';
                        }
                        
                        // Log episode info less frequently as training progresses
                        if (this.agent.episodeCount % 5 === 0 || this.agent.episodeCount < 50) {
                            console.log(
                              `Episode ${this.agent.episodeCount} completed. Dur: ${(this.episodeSteps*this.environment.physics.timestep).toFixed(1)}s ` +
                              `Reward: ${result.totalReward.toFixed(2)} Avg100: ${this.agent.avgRewardLast100.toFixed(2)} Explore: ${this.agent.explorationRate.toFixed(3)}`
                            );
                        }
                        
                        // Play fallen sound if needed
                        if (this.environment.physics.hasStickFallen(this.currentState) && this.fallenSounds) {
                            // Rotate through fallen sound instances to allow overlapping
                            const fallenSound = this.fallenSounds[this.currentFallenSoundIndex];
                            fallenSound.currentTime = 0;
                            fallenSound.play().catch(err => console.error("Error playing fallen sound:", err));
                            
                            // Move to next sound instance
                            this.currentFallenSoundIndex = (this.currentFallenSoundIndex + 1) % this.fallenSounds.length;
                        }
                        
                        // Reset environment for next episode
                        this.currentState = this.environment.reset();
                        this.episodeSteps = 0;
                        
                        // Manage memory more aggressively
                        if (this.agent.episodeCount % 25 === 0) { // Changed from 50 to 25
                            this.agent.manageMemoryUsage();
                            
                            // Force garbage collection if available
                            if (window.gc) {
                                window.gc();
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error in animation loop:", error);
                    
                    // If we encounter an error, reset the simulation state
                    this.currentState = this.environment.reset();
                    this.episodeSteps = 0;
                }
            }
            
            // Continue animation loop
            this.animationId = requestAnimationFrame(() => this.animationLoop());
        }
        
        /**
         * Check if a simulation state is valid
         * @param {Object} state - The simulation state to validate
         * @returns {boolean} - True if state is valid, false otherwise
         */
        isStateValid(state) {
            // Check if state exists
            if (!state) return false;
            
            // Check for NaN or Infinite values in physics state
            return Object.values(state).every(isFinite);
        }
    }
    
    // Create simulation instance
    const simulation = new Simulation();
    
    // Set up button event handlers
    startButton.addEventListener('click', () => {
        if (!assetsLoaded) return;
        
        resetButton.disabled = false;
        simulation.start();
    });
    
    resetButton.addEventListener('click', () => {
        simulation.reset();
    });
    
    // Handle window resize events to reposition the start button
    window.addEventListener('resize', () => {
        if (!simulation.isRunning) {
            simulation.positionStartButton();
            simulation.renderBackgroundOnly();
        }
    });
});