class TrainingVisualizer {
    constructor(containerElement) {
        this.container = containerElement;
        this.charts = {};
        this.initialized = false;
        this.maxStabilityPoints = 50; // Reduced from 100 to 50
        this.lastEpisode = -1;
        this.chartContainers = {}; // Store references to chart containers
        
        // Chart update frequency control
        this.updateFrequency = {
            reward: 3,       // Update every 3 episodes
            steps: 3,        // Update every 3 episodes
            exploration: 5,  // Update every 5 episodes
            stability: 5,    // Update stability with reduced frequency
            stage: 1         // Always update training stage changes
        };
        this.updateCounters = {
            reward: 0,
            steps: 0,
            exploration: 0,
            stability: 0
        };
        this.stabilityUpdateRatio = 5; // Only update stability chart every N points
        
        this.setupCharts();
    }
    
    setupCharts() {
        // Prevent multiple initializations
        if (this.initialized) return;
        this.initialized = true;
        
        // Create chart container if not exists
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'chart-container';
            this.container.style.position = 'absolute';
            this.container.style.right = '10px';
            this.container.style.top = '10px';
            this.container.style.width = '300px';
            this.container.style.height = '750px'; // Fixed height for container
            this.container.style.overflowY = 'auto'; // Add scrollbar if content exceeds height
            this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            this.container.style.borderRadius = '5px';
            this.container.style.padding = '10px';
            document.body.appendChild(this.container);
        }
        
        // Create canvas elements for each chart
        const chartTypes = ['reward', 'steps', 'exploration', 'stability', 'stage'];
        
        chartTypes.forEach(type => {
            const container = document.createElement('div');
            container.style.marginBottom = '15px';
            container.style.maxHeight = type === 'stability' ? '100px' : '150px'; // Limit height
            
            const title = document.createElement('h3');
            title.textContent = this.getChartTitle(type);
            title.style.color = 'white';
            title.style.fontSize = '14px';
            title.style.marginBottom = '5px';
            
            const canvas = document.createElement('canvas');
            canvas.id = `chart-${type}`;
            canvas.style.width = '100%';
            canvas.style.height = type === 'stability' ? '80px' : '120px';
            
            container.appendChild(title);
            container.appendChild(canvas);
            this.container.appendChild(container);
            this.chartContainers[type] = container;
            
            // Create the chart
            this.charts[type] = this.createChart(`chart-${type}`, type);
        });
    }
    
    getChartTitle(type) {
        switch(type) {
            case 'reward': return 'Episode Reward';
            case 'steps': return 'Episode Duration (steps)';
            case 'exploration': return 'Exploration / Noise Scale';
            case 'stability': return 'Stability Score';
            case 'stage': return 'Training Stage';
            default: return type;
        }
    }
    
    createChart(canvasId, type) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Configuration for different chart types
        let config;
        
        // Common performance options to apply to all charts
        const performanceOptions = {
            animation: {
                duration: 0 // Disable all animations for better performance
            },
            responsive: true,
            maintainAspectRatio: false,
            elements: {
                line: {
                    tension: 0 // Disable bezier curves for faster rendering
                },
                point: {
                    radius: 0, // No points except for hover
                    hoverRadius: 3 // Small hover radius
                }
            },
            scales: {
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        maxTicksLimit: 5 // Limit number of ticks for performance
                    }
                },
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        maxTicksLimit: 8, // Limit number of ticks for performance
                        autoSkip: true // Skip labels that would overlap
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        boxWidth: 10 // Smaller legend boxes
                    }
                },
                tooltip: {
                    enabled: false // Disable tooltips for performance
                }
            }
        };
        
        switch(type) {
            case 'reward':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Reward',
                            data: [],
                            borderColor: 'rgba(75, 192, 192, 1)',
                            backgroundColor: 'rgba(75, 192, 192, 0.2)',
                            tension: 0,
                            borderWidth: 1.5
                        },
                        {
                            label: 'Running Avg',
                            data: [],
                            borderColor: 'rgba(255, 159, 64, 1)',
                            backgroundColor: 'rgba(255, 159, 64, 0.2)',
                            tension: 0,
                            borderWidth: 1.5
                        }]
                    },
                    options: {
                        ...performanceOptions,
                        scales: {
                            ...performanceOptions.scales,
                            y: {
                                ...performanceOptions.scales.y,
                                beginAtZero: false
                            }
                        }
                    }
                };
                break;
                
            case 'steps':
                config = {
                    type: 'bar',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Steps',
                            data: [],
                            backgroundColor: 'rgba(54, 162, 235, 0.5)',
                            borderColor: 'rgba(54, 162, 235, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        ...performanceOptions,
                        scales: {
                            ...performanceOptions.scales,
                            y: {
                                ...performanceOptions.scales.y,
                                beginAtZero: true
                            }
                        }
                    }
                };
                break;
                
            case 'exploration':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Exploration Rate',
                            data: [],
                            borderColor: 'rgba(255, 99, 132, 1)',
                            backgroundColor: 'rgba(255, 99, 132, 0.2)',
                            tension: 0,
                            borderWidth: 1.5
                        }]
                    },
                    options: {
                        ...performanceOptions,
                        scales: {
                            ...performanceOptions.scales,
                            y: {
                                ...performanceOptions.scales.y,
                                beginAtZero: true,
                                max: 1
                            }
                        }
                    }
                };
                break;
                
            case 'stability':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Stability',
                            data: [],
                            borderColor: 'rgba(153, 102, 255, 1)',
                            backgroundColor: 'rgba(153, 102, 255, 0.2)',
                            borderWidth: 1.5,
                            pointRadius: 0
                        }]
                    },
                    options: {
                        ...performanceOptions,
                        scales: {
                            ...performanceOptions.scales,
                            y: {
                                ...performanceOptions.scales.y,
                                beginAtZero: true,
                                max: 1
                            }
                        }
                    }
                };
                break;
                
            case 'stage':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Training Stage',
                            data: [],
                            borderColor: 'rgba(255, 206, 86, 1)',
                            backgroundColor: 'rgba(255, 206, 86, 0.2)',
                            borderWidth: 1.5,
                            steppedLine: true
                        }]
                    },
                    options: {
                        ...performanceOptions,
                        scales: {
                            ...performanceOptions.scales,
                            y: {
                                ...performanceOptions.scales.y,
                                beginAtZero: true,
                                max: 4,
                                ticks: {
                                    ...performanceOptions.scales.y.ticks,
                                    callback: function(value) {
                                        const stages = ['Basic Flight', 'Stability', 'Tracking', 'Combat'];
                                        return stages[value] || value;
                                    }
                                }
                            }
                        }
                    }
                };
                break;
        }
        
        return new Chart(ctx, config);
    }
    
    updateCharts(stats) {
        // Check if we need to update at reduced frequency
        const isNewEpisode = stats.episode !== this.lastEpisode;
        this.lastEpisode = stats.episode;
        
        // Update reward chart
        if (stats.totalRewards.length > 0 && isNewEpisode) {
            this.updateCounters.reward++;
            if (this.updateCounters.reward >= this.updateFrequency.reward) {
                this.updateCounters.reward = 0;
                this.updateRewardChart(stats);
            }
        }
        
        // Update steps chart
        if (stats.episodeLengths.length > 0 && isNewEpisode) {
            this.updateCounters.steps++;
            if (this.updateCounters.steps >= this.updateFrequency.steps) {
                this.updateCounters.steps = 0;
                this.updateStepsChart(stats);
            }
        }
        
        // Update exploration rate chart
        if (isNewEpisode) {
            this.updateCounters.exploration++;
            if (this.updateCounters.exploration >= this.updateFrequency.exploration) {
                this.updateCounters.exploration = 0;
                this.updateExplorationChart(stats);
            }
        }
        
        // Update stability chart with both reduced frequency and sampling
        if (stats.stabilityScores && stats.stabilityScores.length > 0) {
            this.updateCounters.stability++;
            if (this.updateCounters.stability >= this.updateFrequency.stability) {
                this.updateCounters.stability = 0;
                this.updateStabilityChart(stats);
            }
        }
        
        // Update training stage chart - always update for stage changes
        if (isNewEpisode || stats.trainingStage !== undefined) {
            this.updateStageChart(stats);
        }
    }
    
    // Split chart updates into separate methods for better organization
    updateRewardChart(stats) {
        const chartId = 'chart-reward';
        const canvas = document.getElementById(chartId);
        
        if (canvas && this.charts['reward']) {
            const chart = this.charts['reward'];
            
            // Only keep the last 20 episodes for clarity
            const lastN = 20;
            
            // Add the new reward data point
            if (stats.totalRewards.length > 0) {
                const newReward = stats.totalRewards[stats.totalRewards.length - 1];
                
                // Add new data point
                chart.data.labels.push(stats.episode.toString());
                chart.data.datasets[0].data.push(newReward);
                chart.data.datasets[1].data.push(stats.runningAvgReward);
                
                // Trim to keep only the last N points
                if (chart.data.labels.length > lastN) {
                    chart.data.labels = chart.data.labels.slice(-lastN);
                    chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-lastN);
                    chart.data.datasets[1].data = chart.data.datasets[1].data.slice(-lastN);
                }
                
                this.batchUpdateChart(chart);
            }
        }
    }
    
    updateStepsChart(stats) {
        const chartId = 'chart-steps';
        const canvas = document.getElementById(chartId);
        
        if (canvas && this.charts['steps']) {
            const chart = this.charts['steps'];
            
            // Only keep the last 20 episodes
            const lastN = 20;
            
            // Add the new steps data point
            if (stats.episodeLengths.length > 0) {
                const newSteps = stats.episodeLengths[stats.episodeLengths.length - 1];
                
                // Add new data point
                chart.data.labels.push(stats.episode.toString());
                chart.data.datasets[0].data.push(newSteps);
                
                // Trim to keep only the last N points
                if (chart.data.labels.length > lastN) {
                    chart.data.labels = chart.data.labels.slice(-lastN);
                    chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-lastN);
                }
                
                this.batchUpdateChart(chart);
            }
        }
    }
    
    updateExplorationChart(stats) {
        const chartId = 'chart-exploration';
        const canvas = document.getElementById(chartId);
        
        if (canvas && this.charts['exploration']) {
            const chart = this.charts['exploration'];
            
            // Keep a very limited history for exploration rate
            const maxPoints = 15;
            
            // Add the new exploration rate point
            chart.data.labels.push(stats.episode.toString());
            chart.data.datasets[0].data.push(stats.explorationRate);
            
            // Trim to keep only the most recent points
            if (chart.data.labels.length > maxPoints) {
                chart.data.labels = chart.data.labels.slice(-maxPoints);
                chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-maxPoints);
            }
            
            this.batchUpdateChart(chart);
        }
    }
    
    updateStabilityChart(stats) {
        const chartId = 'chart-stability';
        const canvas = document.getElementById(chartId);
        
        if (canvas && this.charts['stability']) {
            const chart = this.charts['stability'];
            
            // Limit the number of points to prevent browser crash
            const maxPoints = this.maxStabilityPoints;
            
            // Clear existing data if we're starting a new episode
            if (stats.stabilityScores.length === 1) {
                chart.data.labels = [];
                chart.data.datasets[0].data = [];
            }
            
            // Only sample a subset of points for better performance
            const scores = stats.stabilityScores;
            const latestScores = scores.slice(Math.max(0, scores.length - this.stabilityUpdateRatio));
            
            if (latestScores.length === 0) return;
            
            // Average the latest scores for a smoother chart
            const averageScore = latestScores.reduce((sum, score) => sum + score, 0) / latestScores.length;
            
            // Add new data point - use fixed width labels
            const currentLength = chart.data.datasets[0].data.length;
            
            // Use sparse labeling
            if (currentLength < maxPoints) {
                chart.data.labels.push((currentLength % maxPoints).toString());
            }
            chart.data.datasets[0].data.push(averageScore);
            
            // Trim to keep only the most recent points
            if (chart.data.datasets[0].data.length > maxPoints) {
                // Shift data instead of slice to maintain continuous scrolling effect
                chart.data.datasets[0].data.shift();
                
                // Keep the same number of labels
                if (chart.data.labels.length > maxPoints) {
                    chart.data.labels.shift();
                }
            }
            
            // Use a more efficient update approach
            this.batchUpdateChart(chart, 'none'); // 'none' disables animations
        }
    }
    
    updateStageChart(stats) {
        const chartId = 'chart-stage';
        const canvas = document.getElementById(chartId);
        
        if (canvas && this.charts['stage']) {
            const chart = this.charts['stage'];
            const trainingStage = stats.trainingStage !== undefined ? stats.trainingStage : 0;
            
            // Only keep track of stage changes
            if (chart.data.datasets[0].data.length === 0 || 
                chart.data.datasets[0].data[chart.data.datasets[0].data.length - 1] !== trainingStage) {
                
                // Add new data point
                chart.data.labels.push(stats.episode.toString());
                chart.data.datasets[0].data.push(trainingStage);
                
                // Keep a reasonable history (last 50 episodes)
                const maxPoints = 50;
                if (chart.data.labels.length > maxPoints) {
                    chart.data.labels = chart.data.labels.slice(-maxPoints);
                    chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-maxPoints);
                }
                
                this.batchUpdateChart(chart);
            }
        }
    }
    
    // Add these properties to match the RL class
    get explorationMin() { return 0.01; }
    get explorationDecay() { return 0.995; }
    
    // Helper for batch updating chart
    batchUpdateChart(chart, animationMode = 'none') {
        try {
            if (chart) {
                chart.update(animationMode);
            }
        } catch (error) {
            console.warn('Error updating chart:', error);
        }
    }
}
