class TrainingVisualizer {
    constructor(containerElement) {
        this.container = containerElement;
        this.charts = {};
        this.initialized = false;
        this.maxStabilityPoints = 50;
        this.lastEpisode = -1;
        this.chartContainers = {};
        
        this.updateFrequency = {
            reward: 1, steps: 1, exploration: 2, stability: 2, kills: 1, weightDrift: 1
        };
        this.updateCounters = { reward: 0, steps: 0, exploration: 0, stability: 0 };
        this.stabilityUpdateRatio = 5;
        
        this.setupCharts();
    }
    
    setupCharts() {
        if (this.initialized) return;
        this.initialized = true;
        
        if (!this.container) {
            this.container = document.getElementById('chart-container');
            if (!this.container) {
                this.container = document.createElement('div');
                this.container.id = 'chart-container';
                document.body.appendChild(this.container);
            }
        }
        
        const chartTypes = ['reward', 'steps', 'exploration', 'stability', 'kills', 'weightDrift'];
        
        chartTypes.forEach(type => {
            const container = document.createElement('div');
            container.className = 'chart-wrap';
            
            const title = document.createElement('h3');
            title.textContent = this.getChartTitle(type);
            
            const canvas = document.createElement('canvas');
            canvas.id = `chart-${type}`;
            
            container.appendChild(title);
            container.appendChild(canvas);
            this.container.appendChild(container);
            this.chartContainers[type] = container;
            
            this.charts[type] = this.createChart(`chart-${type}`, type);
        });
    }
    
    getChartTitle(type) {
        switch(type) {
            case 'reward': return 'Episode Reward';
            case 'steps': return 'Episode Duration';
            case 'exploration': return 'Exploration Rate';
            case 'stability': return 'Stability Score';
            case 'kills': return 'Kills / Deaths';
            case 'weightDrift': return 'NN Weight Drift';
            default: return type;
        }
    }
    
    createChart(canvasId, type) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        const performanceOptions = {
            animation: { duration: 0 },
            responsive: true,
            maintainAspectRatio: false,
            elements: {
                line: { tension: 0.3, borderWidth: 1.5 },
                point: { radius: 0, hoverRadius: 2 }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: 'rgba(255,255,255,0.3)', maxTicksLimit: 4, font: { size: 9 } }
                },
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: 'rgba(255,255,255,0.3)', maxTicksLimit: 6, autoSkip: true, font: { size: 9 } }
                }
            },
            plugins: {
                legend: { labels: { color: 'rgba(255,255,255,0.4)', boxWidth: 8, font: { size: 9 } } },
                tooltip: { enabled: false }
            }
        };
        
        let config;
        
        switch(type) {
            case 'reward':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [
                            { label: 'Reward', data: [], borderColor: '#00c8ff', backgroundColor: 'rgba(0,200,255,0.05)', fill: true },
                            { label: 'Avg', data: [], borderColor: '#ff3366', backgroundColor: 'transparent' }
                        ]
                    },
                    options: { ...performanceOptions, scales: { ...performanceOptions.scales, y: { ...performanceOptions.scales.y, beginAtZero: false } } }
                };
                break;
            case 'steps':
                config = {
                    type: 'bar',
                    data: {
                        labels: [],
                        datasets: [{ label: 'Steps', data: [], backgroundColor: 'rgba(0,200,255,0.2)', borderColor: '#00c8ff', borderWidth: 1 }]
                    },
                    options: { ...performanceOptions, scales: { ...performanceOptions.scales, y: { ...performanceOptions.scales.y, beginAtZero: true } } }
                };
                break;
            case 'exploration':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{ label: 'ε', data: [], borderColor: '#ff9f43', backgroundColor: 'rgba(255,159,67,0.05)', fill: true }]
                    },
                    options: { ...performanceOptions, scales: { ...performanceOptions.scales, y: { ...performanceOptions.scales.y, beginAtZero: true, max: 1 } } }
                };
                break;
            case 'stability':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{ label: 'Stability', data: [], borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.05)', fill: true, pointRadius: 0 }]
                    },
                    options: { ...performanceOptions, scales: { ...performanceOptions.scales, y: { ...performanceOptions.scales.y, beginAtZero: true, max: 1 } } }
                };
                break;
            case 'kills':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [
                            { label: 'Kills', data: [], borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.05)', fill: true },
                            { label: 'Deaths', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)', fill: true }
                        ]
                    },
                    options: {
                        ...performanceOptions,
                        scales: {
                            ...performanceOptions.scales,
                            y: { ...performanceOptions.scales.y, beginAtZero: true }
                        }
                    }
                };
                break;
            case 'weightDrift':
                config = {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{ label: 'Avg Weight Drift', data: [], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)', fill: true }]
                    },
                    options: { ...performanceOptions, scales: { ...performanceOptions.scales, y: { ...performanceOptions.scales.y, beginAtZero: true } } }
                };
                break;
        }
        
        return new Chart(ctx, config);
    }
    
    updateCharts(stats) {
        const isNewEpisode = stats.episode !== this.lastEpisode;
        this.lastEpisode = stats.episode;
        
        if (stats.totalRewards.length > 0 && isNewEpisode) {
            if (++this.updateCounters.reward >= this.updateFrequency.reward) {
                this.updateCounters.reward = 0;
                this.updateRewardChart(stats);
            }
        }
        
        if (stats.episodeLengths.length > 0 && isNewEpisode) {
            if (++this.updateCounters.steps >= this.updateFrequency.steps) {
                this.updateCounters.steps = 0;
                this.updateStepsChart(stats);
            }
        }
        
        if (isNewEpisode) {
            if (++this.updateCounters.exploration >= this.updateFrequency.exploration) {
                this.updateCounters.exploration = 0;
                this.updateExplorationChart(stats);
            }
        }
        
        if (stats.stabilityScores && stats.stabilityScores.length > 0) {
            if (++this.updateCounters.stability >= this.updateFrequency.stability) {
                this.updateCounters.stability = 0;
                this.updateStabilityChart(stats);
            }
        }
        
        if (isNewEpisode && stats.kills !== undefined) {
            this.updateKillsChart(stats);
        }

        if (isNewEpisode && stats.weightDrift && stats.weightDrift.length > 0) {
            this.updateWeightDriftChart(stats);
        }
    }
    
    updateRewardChart(stats) {
        const chart = this.charts['reward'];
        if (!chart) return;
        const lastN = 20;
        if (stats.totalRewards.length > 0) {
            chart.data.labels.push(stats.episode.toString());
            chart.data.datasets[0].data.push(stats.totalRewards[stats.totalRewards.length - 1]);
            chart.data.datasets[1].data.push(stats.runningAvgReward);
            if (chart.data.labels.length > lastN) {
                chart.data.labels = chart.data.labels.slice(-lastN);
                chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-lastN);
                chart.data.datasets[1].data = chart.data.datasets[1].data.slice(-lastN);
            }
            this._update(chart);
        }
    }
    
    updateStepsChart(stats) {
        const chart = this.charts['steps'];
        if (!chart) return;
        const lastN = 20;
        if (stats.episodeLengths.length > 0) {
            chart.data.labels.push(stats.episode.toString());
            chart.data.datasets[0].data.push(stats.episodeLengths[stats.episodeLengths.length - 1]);
            if (chart.data.labels.length > lastN) {
                chart.data.labels = chart.data.labels.slice(-lastN);
                chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-lastN);
            }
            this._update(chart);
        }
    }
    
    updateExplorationChart(stats) {
        const chart = this.charts['exploration'];
        if (!chart) return;
        chart.data.labels.push(stats.episode.toString());
        chart.data.datasets[0].data.push(stats.explorationRate);
        if (chart.data.labels.length > 15) {
            chart.data.labels = chart.data.labels.slice(-15);
            chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-15);
        }
        this._update(chart);
    }
    
    updateStabilityChart(stats) {
        const chart = this.charts['stability'];
        if (!chart) return;
        const scores = stats.stabilityScores;
        const latest = scores.slice(Math.max(0, scores.length - this.stabilityUpdateRatio));
        if (latest.length === 0) return;
        const avg = latest.reduce((s, v) => s + v, 0) / latest.length;
        
        if (scores.length === 1) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
        }
        
        const len = chart.data.datasets[0].data.length;
        if (len < this.maxStabilityPoints) chart.data.labels.push((len % this.maxStabilityPoints).toString());
        chart.data.datasets[0].data.push(avg);
        
        if (chart.data.datasets[0].data.length > this.maxStabilityPoints) {
            chart.data.datasets[0].data.shift();
            if (chart.data.labels.length > this.maxStabilityPoints) chart.data.labels.shift();
        }
        this._update(chart);
    }
    
    updateKillsChart(stats) {
        const chart = this.charts['kills'];
        if (!chart) return;
        chart.data.labels.push(stats.episode.toString());
        chart.data.datasets[0].data.push(stats.kills || 0);
        chart.data.datasets[1].data.push(stats.deaths || 0);
        if (chart.data.labels.length > 30) {
            chart.data.labels = chart.data.labels.slice(-30);
            chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-30);
            chart.data.datasets[1].data = chart.data.datasets[1].data.slice(-30);
        }
        this._update(chart);
    }
    
    updateWeightDriftChart(stats) {
        const chart = this.charts['weightDrift'];
        if (!chart) return;
        const drift = stats.weightDrift;
        const lastN = 50;
        chart.data.labels.push(stats.episode.toString());
        chart.data.datasets[0].data.push(drift[drift.length - 1]);
        if (chart.data.labels.length > lastN) {
            chart.data.labels = chart.data.labels.slice(-lastN);
            chart.data.datasets[0].data = chart.data.datasets[0].data.slice(-lastN);
        }
        this._update(chart);
    }
    
    _update(chart) {
        try { if (chart) chart.update('none'); } catch (e) { /* ignore */ }
    }
}
