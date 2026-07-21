// Per-generation evolution charts. Rebuilds datasets from evolution.history
// on every generation end — simple, and reset comes for free.
class EvolutionVisualizer {
    constructor(containerElement) {
        this.container = containerElement;
        this.charts = {};
        this.initialized = false;
        this.maxPoints = 60; // show the last N generations

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

        const chartTypes = ['fitness', 'combat', 'survival', 'diversity'];

        chartTypes.forEach(type => {
            const wrap = document.createElement('div');
            wrap.className = 'chart-wrap';

            const title = document.createElement('h3');
            title.textContent = this.getChartTitle(type);

            const canvas = document.createElement('canvas');
            canvas.id = `chart-${type}`;

            wrap.appendChild(title);
            wrap.appendChild(canvas);
            this.container.appendChild(wrap);

            this.charts[type] = this.createChart(`chart-${type}`, type);
        });
    }

    getChartTitle(type) {
        switch (type) {
            case 'fitness': return 'Fitness per Generation';
            case 'combat': return 'Hits & Kills';
            case 'survival': return 'Survival';
            case 'diversity': return 'Gene Diversity';
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

        let datasets;
        switch (type) {
            case 'fitness':
                datasets = [
                    { label: 'Best', data: [], borderColor: '#ffd700', backgroundColor: 'rgba(255,215,0,0.05)', fill: true },
                    { label: 'Mean', data: [], borderColor: '#00c8ff', backgroundColor: 'transparent' },
                    { label: 'Worst', data: [], borderColor: 'rgba(255,255,255,0.25)', backgroundColor: 'transparent', borderDash: [3, 3] }
                ];
                break;
            case 'combat':
                datasets = [
                    { label: 'Hits', data: [], borderColor: '#00c8ff', backgroundColor: 'rgba(0,200,255,0.05)', fill: true },
                    { label: 'Kills', data: [], borderColor: '#ff3366', backgroundColor: 'rgba(255,51,102,0.05)', fill: true }
                ];
                break;
            case 'survival':
                datasets = [
                    { label: 'Avg airtime (s)', data: [], borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.05)', fill: true },
                    { label: 'Survivors', data: [], borderColor: '#a855f7', backgroundColor: 'transparent' }
                ];
                break;
            case 'diversity':
                datasets = [
                    { label: 'Diversity', data: [], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)', fill: true },
                    { label: 'Mutation rate', data: [], borderColor: '#ff9f43', backgroundColor: 'transparent', borderDash: [3, 3] }
                ];
                break;
        }

        return new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets },
            options: performanceOptions
        });
    }

    // Rebuild all charts from the evolution history (called once per generation)
    updateCharts(evolution) {
        const h = evolution.history;
        const total = h.best.length;
        if (total === 0) return;

        const n = Math.min(this.maxPoints, total);
        const startGen = evolution.gen - n; // evolution.gen already incremented past the recorded gens
        const labels = [];
        for (let i = 0; i < n; i++) labels.push(String(startGen + i));

        const tail = arr => arr.slice(-n);

        this._setData('fitness', labels, [tail(h.best), tail(h.mean), tail(h.worst)]);
        this._setData('combat', labels, [tail(h.hits), tail(h.kills)]);
        this._setData('survival', labels, [tail(h.meanAliveTime), tail(h.survivors)]);
        this._setData('diversity', labels, [tail(h.diversity), tail(h.mutationRate)]);
    }

    _setData(type, labels, series) {
        const chart = this.charts[type];
        if (!chart) return;
        chart.data.labels = labels;
        for (let i = 0; i < series.length; i++) {
            chart.data.datasets[i].data = series[i];
        }
        try { chart.update('none'); } catch (e) { /* ignore */ }
    }

    reset() {
        for (const type of Object.keys(this.charts)) {
            const chart = this.charts[type];
            chart.data.labels = [];
            for (const ds of chart.data.datasets) ds.data = [];
            try { chart.update('none'); } catch (e) { /* ignore */ }
        }
    }
}
