// render.js - Canvas rendering: tank, animals, plants, particles, overlays
(function(ns) {
'use strict';

var lerp = ns.lerp, clamp = ns.clamp, rgba = ns.rgba, smoothstep = ns.smoothstep;

// ============================================
// RENDERER CLASS
// ============================================
function Renderer(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;
    this.time = 0;
    this.lightRayOffset = 0;
    this.waterGradient = null;
    this.substrateGradient = null;
    this.hoveredEntity = null;
    this.selectedEntity = null;
    this.resize();
}

Renderer.prototype.resize = function() {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
    this.state.tank.width = this.width;
    this.state.tank.height = this.height;
    this.createGradients();
};

Renderer.prototype.createGradients = function() {
    var ctx = this.ctx;
    this.waterGradient = ctx.createLinearGradient(0, 0, 0, this.height);
    this.waterGradient.addColorStop(0, '#87ceeb');
    this.waterGradient.addColorStop(0.3, '#5fb3d4');
    this.waterGradient.addColorStop(0.7, '#4a9ebe');
    this.waterGradient.addColorStop(1, '#3d8fb0');
    
    var substrateY = this.height - this.state.tank.substrateDepth;
    this.substrateGradient = ctx.createLinearGradient(0, substrateY, 0, this.height);
    this.substrateGradient.addColorStop(0, '#8b7355');
    this.substrateGradient.addColorStop(0.3, '#6b5344');
    this.substrateGradient.addColorStop(1, '#4a3728');
};

Renderer.prototype.render = function(deltaTime) {
    this.time += deltaTime;
    this.lightRayOffset += deltaTime * 0.0005;
    var ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    this.renderBackground();
    this.renderLightRays();
    this.renderSubstrate();
    this.renderDecorations();
    this.renderPlants();
    this.renderAnimals();
    this.renderParticles();
    this.renderWaterEffects();
    this.renderOverlays();
    ctx.restore();
};

Renderer.prototype.renderBackground = function() {
    var ctx = this.ctx;
    var env = this.state.env;
    ctx.fillStyle = this.waterGradient;
    ctx.fillRect(0, 0, this.width, this.height);
    if (env.algae > 0.05) { ctx.fillStyle = rgba(50, 150, 50, env.algae * 0.3); ctx.fillRect(0, 0, this.width, this.height); }
    if (env.tannins > 0.01) { ctx.fillStyle = rgba(139, 90, 43, env.tannins * 0.2); ctx.fillRect(0, 0, this.width, this.height); }
    if (env.turbidity > 0.05) { ctx.fillStyle = rgba(200, 200, 180, env.turbidity * 0.4); ctx.fillRect(0, 0, this.width, this.height); }
};

Renderer.prototype.renderLightRays = function() {
    var ctx = this.ctx;
    var hourOfDay = (this.state.meta.simTime / 60) % 24;
    var lightOn = hourOfDay >= this.state.settings.lightSchedule.on && hourOfDay < this.state.settings.lightSchedule.off;
    
    if (!lightOn) { ctx.fillStyle = rgba(20, 30, 50, 0.4); ctx.fillRect(0, 0, this.width, this.height); return; }
    
    var lightStart = this.state.settings.lightSchedule.on;
    var lightEnd = this.state.settings.lightSchedule.off;
    var midDay = (lightStart + lightEnd) / 2;
    var intensity = 1 - Math.abs(hourOfDay - midDay) / ((lightEnd - lightStart) / 2);
    intensity = Math.max(0.3, intensity);
    
    var self = this;
    this.state.entities.plants.forEach(function(plant) {
        if (plant.species.floating) intensity *= (1 - plant.species.lightBlocking * plant.growth * 0.5);
    });
    
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    for (var i = 0; i < 5; i++) {
        var x = (i / 5) * this.width + Math.sin(this.lightRayOffset + i) * 50;
        var rayWidth = 60 + Math.sin(this.lightRayOffset * 0.5 + i * 2) * 20;
        var gradient = ctx.createLinearGradient(x, 0, x + rayWidth, this.height);
        gradient.addColorStop(0, rgba(255, 255, 200, 0.15 * intensity));
        gradient.addColorStop(0.5, rgba(255, 255, 200, 0.08 * intensity));
        gradient.addColorStop(1, rgba(255, 255, 200, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + rayWidth, 0);
        ctx.lineTo(x + rayWidth * 1.5, this.height);
        ctx.lineTo(x - rayWidth * 0.5, this.height);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
};

Renderer.prototype.renderSubstrate = function() {
    var ctx = this.ctx;
    var substrateY = this.height - this.state.tank.substrateDepth;
    ctx.fillStyle = this.substrateGradient;
    ctx.beginPath();
    ctx.moveTo(0, this.height);
    for (var x = 0; x <= this.width; x += 10) {
        var wave = Math.sin(x * 0.02 + this.time * 0.0002) * 3;
        ctx.lineTo(x, substrateY + wave);
    }
    ctx.lineTo(this.width, this.height);
    ctx.closePath();
    ctx.fill();
    
    ctx.save();
    ctx.globalAlpha = 0.3;
    var seed = 12345;
    for (var i = 0; i < 100; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        var px = (seed / 0x7fffffff) * this.width;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        var py = substrateY + (seed / 0x7fffffff) * this.state.tank.substrateDepth;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        var size = 2 + (seed / 0x7fffffff) * 4;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        var shade = 50 + (seed / 0x7fffffff) * 40;
        ctx.fillStyle = rgba(shade, shade * 0.8, shade * 0.6, 0.5);
        ctx.beginPath();
        ctx.ellipse(px, py, size, size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
};

Renderer.prototype.renderDecorations = function() {
    var ctx = this.ctx;
    var self = this;
    this.state.entities.decorations.forEach(function(decor) {
        ctx.save();
        ctx.translate(decor.x, decor.y);
        ctx.fillStyle = '#4a3728';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 5;
        if (decor.type === 'driftwood') self.drawDriftwood(ctx, decor);
        else if (decor.type === 'rock') self.drawRock(ctx, decor);
        ctx.restore();
    });
};

Renderer.prototype.drawDriftwood = function(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.bezierCurveTo(20, 0, 60, 10, 80, 5);
    ctx.bezierCurveTo(90, 15, 70, 25, 80, 35);
    ctx.bezierCurveTo(50, 40, 20, 35, 0, 20);
    ctx.fill();
};

Renderer.prototype.drawRock = function(ctx) {
    ctx.beginPath();
    ctx.moveTo(10, 35);
    ctx.lineTo(5, 20);
    ctx.lineTo(15, 5);
    ctx.lineTo(35, 0);
    ctx.lineTo(45, 10);
    ctx.lineTo(50, 25);
    ctx.lineTo(40, 35);
    ctx.closePath();
    ctx.fill();
};

Renderer.prototype.renderPlants = function() {
    var ctx = this.ctx;
    var substrateY = this.height - this.state.tank.substrateDepth;
    var self = this;
    
    this.state.entities.plants.forEach(function(plant) {
        ctx.save();
        var sway = Math.sin(self.time * 0.001 + plant.swayOffset) * (5 + self.state.env.flow * 10);
        if (plant.species.floating) self.renderFloatingPlant(ctx, plant, sway);
        else if (plant.species.category === 'carpet') self.renderCarpetPlant(ctx, plant, substrateY, sway);
        else if (plant.species.category === 'stem') self.renderStemPlant(ctx, plant, substrateY, sway);
        else self.renderBroadLeafPlant(ctx, plant, substrateY, sway);
        ctx.restore();
    });
};

Renderer.prototype.renderFloatingPlant = function(ctx, plant, sway) {
    var colors = plant.species.colors;
    var growth = plant.growth;
    var x = plant.x + sway * 0.5;
    var y = 15;
    
    ctx.strokeStyle = colors.roots;
    ctx.lineWidth = 1;
    for (var i = 0; i < 5 * growth; i++) {
        var rootX = x + (i - 2.5 * growth) * 8;
        ctx.beginPath();
        ctx.moveTo(rootX, y + 5);
        ctx.bezierCurveTo(rootX + Math.sin(this.time * 0.002 + i) * 5, y + 20, rootX - Math.sin(this.time * 0.002 + i) * 5, y + 35, rootX, y + 30 + growth * 20);
        ctx.stroke();
    }
    
    var leafCount = Math.floor(3 + growth * 4);
    for (var j = 0; j < leafCount; j++) {
        var angle = (j / leafCount) * Math.PI * 2;
        var leafX = x + Math.cos(angle) * (15 * growth);
        var leafY = y + Math.sin(angle) * (8 * growth);
        var size = 12 * growth;
        ctx.fillStyle = j % 2 === 0 ? colors.leaves : colors.highlight;
        ctx.beginPath();
        ctx.ellipse(leafX, leafY, size, size * 0.7, angle, 0, Math.PI * 2);
        ctx.fill();
    }
};

Renderer.prototype.renderStemPlant = function(ctx, plant, substrateY, sway) {
    var colors = plant.species.colors;
    var growth = plant.growth;
    var baseX = plant.x;
    var baseY = substrateY - 5;
    var height = 80 * growth;
    
    for (var stem = 0; stem < plant.segments; stem++) {
        var stemX = baseX + (stem - plant.segments / 2) * 15;
        ctx.strokeStyle = colors.stem;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(stemX, baseY);
        
        var segments = 8;
        for (var i = 1; i <= segments; i++) {
            var t = i / segments;
            var segmentSway = sway * t * 0.5;
            ctx.lineTo(stemX + segmentSway, baseY - height * t);
        }
        ctx.stroke();
        
        for (var k = 1; k < segments; k++) {
            var t2 = k / segments;
            var leafY = baseY - height * t2;
            var leafX = stemX + sway * t2 * 0.5;
            
            for (var side = -1; side <= 1; side += 2) {
                ctx.fillStyle = colors.leaves;
                ctx.beginPath();
                var leafAngle = Math.PI * 0.3 * side + sway * 0.02;
                var leafLength = 8 * growth;
                ctx.moveTo(leafX, leafY);
                ctx.quadraticCurveTo(leafX + Math.cos(leafAngle) * leafLength, leafY + Math.sin(leafAngle) * leafLength * 0.5, leafX + Math.cos(leafAngle) * leafLength * 2, leafY);
                ctx.quadraticCurveTo(leafX + Math.cos(leafAngle) * leafLength, leafY - Math.sin(leafAngle) * leafLength * 0.5, leafX, leafY);
                ctx.fill();
            }
        }
    }
};

Renderer.prototype.renderBroadLeafPlant = function(ctx, plant, substrateY, sway) {
    var colors = plant.species.colors;
    var growth = plant.growth;
    var x = plant.x;
    var y = substrateY - 10;
    
    ctx.fillStyle = colors.stem;
    ctx.beginPath();
    ctx.ellipse(x, y, 15 * growth, 5 * growth, 0, 0, Math.PI * 2);
    ctx.fill();
    
    var leafCount = Math.floor(3 + growth * 4);
    for (var i = 0; i < leafCount; i++) {
        var baseAngle = -Math.PI / 2 + (i - leafCount / 2) * 0.4;
        var leafSway = sway * 0.02 + Math.sin(this.time * 0.001 + i) * 0.05;
        var angle = baseAngle + leafSway;
        var stemLength = 20 + growth * 20;
        var leafLength = 25 * growth;
        var leafWidth = 15 * growth;
        
        ctx.strokeStyle = colors.stem;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * stemLength, y + Math.sin(angle) * stemLength);
        ctx.stroke();
        
        var leafX = x + Math.cos(angle) * stemLength;
        var leafY = y + Math.sin(angle) * stemLength;
        ctx.fillStyle = colors.leaves;
        ctx.beginPath();
        ctx.moveTo(leafX, leafY);
        ctx.bezierCurveTo(leafX + Math.cos(angle - 0.3) * leafWidth, leafY + Math.sin(angle - 0.3) * leafWidth, leafX + Math.cos(angle) * leafLength + Math.cos(angle - 0.3) * leafWidth * 0.5, leafY + Math.sin(angle) * leafLength + Math.sin(angle - 0.3) * leafWidth * 0.5, leafX + Math.cos(angle) * leafLength, leafY + Math.sin(angle) * leafLength);
        ctx.bezierCurveTo(leafX + Math.cos(angle) * leafLength + Math.cos(angle + 0.3) * leafWidth * 0.5, leafY + Math.sin(angle) * leafLength + Math.sin(angle + 0.3) * leafWidth * 0.5, leafX + Math.cos(angle + 0.3) * leafWidth, leafY + Math.sin(angle + 0.3) * leafWidth, leafX, leafY);
        ctx.fill();
    }
};

Renderer.prototype.renderCarpetPlant = function(ctx, plant, substrateY, sway) {
    var colors = plant.species.colors;
    var growth = plant.growth;
    var x = plant.x;
    var y = substrateY - 5;
    var width = plant.species.size.width * growth;
    var bladeCount = Math.floor(20 * growth);
    
    for (var i = 0; i < bladeCount; i++) {
        var bladeX = x - width / 2 + (i / bladeCount) * width;
        var bladeHeight = 15 + Math.random() * 10 * growth;
        var bladeSway = sway * 0.3 + Math.sin(this.time * 0.002 + i * 0.5) * 2;
        ctx.strokeStyle = i % 3 === 0 ? colors.tips : colors.blades;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bladeX, y);
        ctx.quadraticCurveTo(bladeX + bladeSway, y - bladeHeight * 0.6, bladeX + bladeSway * 1.5, y - bladeHeight);
        ctx.stroke();
    }
};

Renderer.prototype.renderAnimals = function() {
    var ctx = this.ctx;
    var self = this;
    var sorted = this.state.entities.animals.slice().sort(function(a, b) { return a.y - b.y; });
    
    sorted.forEach(function(animal) {
        ctx.save();
        ctx.translate(animal.x, animal.y);
        if (animal.flipX) ctx.scale(-1, 1);
        var depthScale = 0.9 + (animal.y / self.height) * 0.2;
        ctx.scale(animal.size * depthScale, animal.size * depthScale);
        ctx.globalAlpha = 0.7 + (animal.health / 100) * 0.3;
        
        var species = animal.species;
        if (species.category === 'fish') {
            if (species.behavior.depthPreference === 'bottom') self.renderBottomFish(ctx, animal);
            else self.renderSmallFish(ctx, animal);
        } else if (species.category === 'shrimp') {
            self.renderShrimp(ctx, animal);
        } else if (species.category === 'snail') {
            self.renderSnail(ctx, animal);
        }
        
        if (animal.stress > 50) self.renderStressIndicator(ctx, animal);
        ctx.restore();
        
        if (self.hoveredEntity === animal) self.renderEntityHighlight(animal);
    });
};

Renderer.prototype.renderSmallFish = function(ctx, animal) {
    var colors = animal.species.colors;
    var wobble = Math.sin(animal.animFrame * 0.3) * 2;
    
    ctx.fillStyle = colors.primary;
    ctx.beginPath();
    ctx.ellipse(0, wobble, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = colors.stripe || colors.secondary;
    ctx.beginPath();
    ctx.ellipse(0, wobble, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = colors.secondary;
    var tailWobble = Math.sin(animal.animFrame * 0.5) * 3;
    ctx.beginPath();
    ctx.moveTo(-10, wobble);
    ctx.lineTo(-18 + tailWobble, -5 + wobble);
    ctx.lineTo(-18 + tailWobble, 5 + wobble);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(7, -1 + wobble, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(7.5, -1 + wobble, 1, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = colors.primary;
    ctx.beginPath();
    ctx.moveTo(-3, -5 + wobble);
    ctx.lineTo(0, -10 + wobble);
    ctx.lineTo(5, -5 + wobble);
    ctx.closePath();
    ctx.fill();
};

Renderer.prototype.renderBottomFish = function(ctx, animal) {
    var colors = animal.species.colors;
    var wobble = Math.sin(animal.animFrame * 0.2) * 1;
    
    ctx.fillStyle = colors.primary;
    ctx.beginPath();
    ctx.ellipse(0, wobble, 18, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = colors.secondary;
    ctx.beginPath();
    ctx.moveTo(-15, wobble);
    ctx.lineTo(-22, -4 + wobble);
    ctx.lineTo(-22, 4 + wobble);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(10, -2 + wobble, 2, 0, Math.PI * 2);
    ctx.fill();
    
    if (colors.spots) {
        ctx.fillStyle = colors.spots;
        for (var i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(-5 + i * 5, wobble + (i % 2) * 3 - 1, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Barbels
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, 3 + wobble);
    ctx.lineTo(18, 6 + wobble);
    ctx.moveTo(12, 4 + wobble);
    ctx.lineTo(17, 8 + wobble);
    ctx.stroke();
};

Renderer.prototype.renderShrimp = function(ctx, animal) {
    var colors = animal.species.colors;
    var wobble = Math.sin(animal.animFrame * 0.4) * 1;
    
    ctx.fillStyle = colors.primary;
    ctx.beginPath();
    ctx.ellipse(0, wobble, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.ellipse(-6, wobble + 1, 5, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = colors.secondary;
    ctx.lineWidth = 1;
    for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-3 + i * 3, 4 + wobble);
        ctx.lineTo(-3 + i * 3 + Math.sin(this.time * 0.01 + i) * 2, 10 + wobble);
        ctx.stroke();
    }
    
    ctx.strokeStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(6, wobble);
    ctx.lineTo(12, -2 + wobble);
    ctx.moveTo(6, wobble - 1);
    ctx.lineTo(11, -4 + wobble);
    ctx.stroke();
    
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(4, -1 + wobble, 0.8, 0, Math.PI * 2);
    ctx.fill();
};

Renderer.prototype.renderSnail = function(ctx, animal) {
    var colors = animal.species.colors;
    
    ctx.fillStyle = colors.body;
    ctx.beginPath();
    ctx.ellipse(5, 5, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = colors.shell;
    ctx.beginPath();
    ctx.arc(-2, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = colors.shellPattern;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-2, 0, 7, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-2, 0, 4, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
    
    ctx.strokeStyle = colors.body;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, 2);
    ctx.lineTo(14, -2);
    ctx.moveTo(10, 3);
    ctx.lineTo(13, 0);
    ctx.stroke();
    
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(14, -2, 1, 0, Math.PI * 2);
    ctx.arc(13, 0, 1, 0, Math.PI * 2);
    ctx.fill();
};

Renderer.prototype.renderStressIndicator = function(ctx, animal) {
    var pulse = Math.sin(this.time * 0.01) * 0.3 + 0.7;
    ctx.fillStyle = rgba(255, 100, 100, pulse * (animal.stress / 100));
    ctx.beginPath();
    ctx.arc(0, -15, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 0, -12);
};

Renderer.prototype.renderEntityHighlight = function(entity) {
    var ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(entity.x - 20, entity.y - 15, 40, 30);
    ctx.restore();
};

Renderer.prototype.renderParticles = function() {
    var ctx = this.ctx;
    var self = this;
    
    this.state.entities.particles.forEach(function(particle) {
        ctx.save();
        ctx.globalAlpha = particle.alpha;
        
        if (particle.type === 'bubble') {
            ctx.strokeStyle = rgba(255, 255, 255, 0.6);
            ctx.fillStyle = rgba(200, 230, 255, 0.3);
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = rgba(255, 255, 255, 0.8);
            ctx.beginPath();
            ctx.arc(particle.x - particle.size * 0.3, particle.y - particle.size * 0.3, particle.size * 0.2, 0, Math.PI * 2);
            ctx.fill();
        } else if (particle.type === 'food') {
            ctx.fillStyle = '#8b4513';
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fill();
        } else if (particle.type === 'debris') {
            ctx.fillStyle = rgba(100, 80, 60, 0.6);
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    });
};

Renderer.prototype.renderWaterEffects = function() {
    var ctx = this.ctx;
    
    // Surface ripples
    ctx.save();
    ctx.strokeStyle = rgba(255, 255, 255, 0.1);
    ctx.lineWidth = 1;
    for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        for (var x = 0; x <= this.width; x += 20) {
            var y = 5 + Math.sin(x * 0.02 + this.time * 0.002 + i) * 2;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.restore();
    
    // Caustics on substrate
    var substrateY = this.height - this.state.tank.substrateDepth;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.1;
    for (var j = 0; j < 5; j++) {
        var cx = (Math.sin(this.time * 0.0005 + j * 2) + 1) * this.width * 0.5;
        var cy = substrateY + 10;
        var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
        gradient.addColorStop(0, 'rgba(255,255,255,0.3)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(cx - 50, cy - 50, 100, 100);
    }
    ctx.restore();
};

Renderer.prototype.renderOverlays = function() {
    var ctx = this.ctx;
    
    // Glass edges
    ctx.save();
    var glassGradient = ctx.createLinearGradient(0, 0, 20, 0);
    glassGradient.addColorStop(0, 'rgba(255,255,255,0.15)');
    glassGradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glassGradient;
    ctx.fillRect(0, 0, 20, this.height);
    
    glassGradient = ctx.createLinearGradient(this.width - 20, 0, this.width, 0);
    glassGradient.addColorStop(0, 'rgba(255,255,255,0)');
    glassGradient.addColorStop(1, 'rgba(255,255,255,0.15)');
    ctx.fillStyle = glassGradient;
    ctx.fillRect(this.width - 20, 0, 20, this.height);
    ctx.restore();
    
    // Tank frame
    ctx.strokeStyle = '#2d3436';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, this.width - 4, this.height - 4);
};

Renderer.prototype.getEntityAtPoint = function(x, y) {
    var found = null;
    var self = this;
    
    this.state.entities.animals.forEach(function(animal) {
        var dx = x - animal.x;
        var dy = y - animal.y;
        if (Math.sqrt(dx * dx + dy * dy) < 20) found = animal;
    });
    
    if (!found) {
        this.state.entities.plants.forEach(function(plant) {
            var dx = x - plant.x;
            var dy = y - plant.y;
            if (Math.sqrt(dx * dx + dy * dy) < 30) found = plant;
        });
    }
    
    if (!found) {
        this.state.entities.devices.forEach(function(device) {
            var dx = x - device.x;
            var dy = y - device.y;
            if (Math.sqrt(dx * dx + dy * dy) < 25) found = device;
        });
    }
    
    return found;
};

// Export to namespace
ns.Renderer = Renderer;

})(window.AquariumSim);
