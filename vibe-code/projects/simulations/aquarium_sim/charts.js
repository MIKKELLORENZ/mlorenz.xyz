// charts.js - Chart rendering for water parameters
(function(ns) {
'use strict';

var lerp = ns.lerp, clamp = ns.clamp, rgba = ns.rgba, formatNumber = ns.formatNumber;

// ============================================
// CHARTS RENDERER
// ============================================
function ChartsRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.resize();
}

ChartsRenderer.prototype.resize = function() {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
};

ChartsRenderer.prototype.render = function(state, activeChart) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    
    var padding = { top: 30, right: 20, bottom: 40, left: 50 };
    var chartWidth = this.width - padding.left - padding.right;
    var chartHeight = this.height - padding.top - padding.bottom;
    
    ctx.save();
    ctx.translate(padding.left, padding.top);
    
    var chartConfigs = {
        nitrogen: {
            title: 'Nitrogen Cycle',
            series: [
                { key: 'ammonia', label: 'NH₃', color: '#e63946', data: state.history.ammonia },
                { key: 'nitrite', label: 'NO₂', color: '#f4a261', data: state.history.nitrite },
                { key: 'nitrate', label: 'NO₃', color: '#2a9d8f', data: state.history.nitrate }
            ],
            yMin: 0, yMax: 50, unit: 'ppm'
        },
        environment: {
            title: 'Environment',
            series: [
                { key: 'temperature', label: 'Temp', color: '#e76f51', data: state.history.temperature },
                { key: 'ph', label: 'pH', color: '#9b5de5', data: state.history.ph, scale: 10 }
            ],
            yMin: 0, yMax: 35, unit: '°C / pH×10'
        },
        oxygen: {
            title: 'Oxygen & Algae',
            series: [
                { key: 'oxygen', label: 'O₂', color: '#00b4d8', data: state.history.oxygen },
                { key: 'algae', label: 'Algae', color: '#55a630', data: state.history.algae, scale: 10 }
            ],
            yMin: 0, yMax: 12, unit: 'mg/L'
        },
        stability: {
            title: 'Stability Score',
            series: [
                { key: 'stability', label: 'Score', color: '#4361ee', data: state.history.stability }
            ],
            yMin: 0, yMax: 100, unit: '%'
        }
    };
    
    var config = chartConfigs[activeChart] || chartConfigs.nitrogen;
    
    // Title
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(config.title, chartWidth / 2, -10);
    
    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, chartWidth, chartHeight);
    
    // Grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    var gridLines = 5;
    for (var i = 0; i <= gridLines; i++) {
        var y = (i / gridLines) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();
        
        // Y-axis labels
        var value = lerp(config.yMax, config.yMin, i / gridLines);
        ctx.fillStyle = '#888';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(formatNumber(value, 0), -5, y + 3);
    }
    
    // Unit label
    ctx.fillStyle = '#666';
    ctx.font = '9px sans-serif';
    ctx.save();
    ctx.translate(-35, chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(config.unit, 0, 0);
    ctx.restore();
    
    // Draw series
    var self = this;
    config.series.forEach(function(series) {
        var data = series.data.toArray();
        if (data.length < 2) return;
        
        ctx.strokeStyle = series.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        var minT = data[0].t;
        var maxT = data[data.length - 1].t;
        var range = maxT - minT || 1;
        
        data.forEach(function(point, idx) {
            var x = ((point.t - minT) / range) * chartWidth;
            var value = point.v * (series.scale || 1);
            var y = (1 - (value - config.yMin) / (config.yMax - config.yMin)) * chartHeight;
            y = clamp(y, 0, chartHeight);
            
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        // Current value label
        var lastPoint = data[data.length - 1];
        var lastY = (1 - ((lastPoint.v * (series.scale || 1)) - config.yMin) / (config.yMax - config.yMin)) * chartHeight;
        lastY = clamp(lastY, 10, chartHeight - 10);
        
        ctx.fillStyle = series.color;
        ctx.beginPath();
        ctx.arc(chartWidth, lastY, 4, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(series.label + ': ' + formatNumber(lastPoint.v, 1), chartWidth + 8, lastY + 3);
    });
    
    // X-axis time labels
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    
    var data0 = config.series[0].data.toArray();
    if (data0.length > 0) {
        var minT2 = data0[0].t;
        var maxT2 = data0[data0.length - 1].t;
        var timeRange = (maxT2 - minT2) / 60; // hours
        
        ctx.fillText(formatTimeLabel(minT2), 0, chartHeight + 15);
        ctx.fillText(formatTimeLabel(maxT2), chartWidth, chartHeight + 15);
        if (timeRange > 2) {
            ctx.fillText(formatTimeLabel((minT2 + maxT2) / 2), chartWidth / 2, chartHeight + 15);
        }
    }
    
    ctx.restore();
};

function formatTimeLabel(minutes) {
    var hours = Math.floor(minutes / 60) % 24;
    var days = Math.floor(minutes / 1440);
    if (days > 0) return 'D' + (days + 1);
    return hours + ':00';
}

// ============================================
// MINI DASHBOARD
// ============================================
function MiniDashboard(container, state) {
    this.container = container;
    this.state = state;
    this.elements = {};
    this.createElements();
}

MiniDashboard.prototype.createElements = function() {
    var params = [
        { key: 'temperature', label: 'Temp', unit: '°C', icon: '🌡️', warn: [20, 28], danger: [18, 32] },
        { key: 'ph', label: 'pH', unit: '', icon: '⚗️', warn: [6.5, 7.5], danger: [6.0, 8.0] },
        { key: 'ammonia', label: 'NH₃', unit: 'ppm', icon: '⚠️', warn: [0, 0.25], danger: [0, 0.5], invertWarn: true },
        { key: 'nitrite', label: 'NO₂', unit: 'ppm', icon: '⚠️', warn: [0, 0.25], danger: [0, 0.5], invertWarn: true },
        { key: 'nitrate', label: 'NO₃', unit: 'ppm', icon: '📊', warn: [0, 30], danger: [0, 50], invertWarn: true },
        { key: 'oxygen', label: 'O₂', unit: 'mg/L', icon: '💨', warn: [5.5, 10], danger: [4.0, 12] }
    ];
    
    var self = this;
    this.container.innerHTML = '';
    
    params.forEach(function(param) {
        var el = document.createElement('div');
        el.className = 'param-item';
        el.innerHTML = '<span class="param-icon">' + param.icon + '</span>' +
            '<span class="param-label">' + param.label + '</span>' +
            '<span class="param-value" data-key="' + param.key + '">--</span>' +
            '<span class="param-unit">' + param.unit + '</span>';
        self.container.appendChild(el);
        self.elements[param.key] = {
            el: el,
            valueEl: el.querySelector('.param-value'),
            config: param
        };
    });
};

MiniDashboard.prototype.update = function() {
    var env = this.state.env;
    var self = this;
    
    Object.keys(this.elements).forEach(function(key) {
        var item = self.elements[key];
        var value = env[key];
        var config = item.config;
        
        item.valueEl.textContent = formatNumber(value, key === 'ph' ? 2 : 1);
        
        // Status coloring
        item.el.classList.remove('status-good', 'status-warn', 'status-danger');
        
        var status = 'good';
        if (config.invertWarn) {
            if (value > config.danger[1]) status = 'danger';
            else if (value > config.warn[1]) status = 'warn';
        } else {
            if (value < config.danger[0] || value > config.danger[1]) status = 'danger';
            else if (value < config.warn[0] || value > config.warn[1]) status = 'warn';
        }
        
        item.el.classList.add('status-' + status);
    });
};

// Export to namespace
ns.ChartsRenderer = ChartsRenderer;
ns.MiniDashboard = MiniDashboard;

})(window.AquariumSim);
