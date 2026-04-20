// Get canvas and context
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
resizeCanvas();

window.addEventListener('resize', resizeCanvas);

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// Simulation variables
let lasers = [];
let particles = [];
let prisms = [];
let slits = [];
let walls = [];
let mirrors = [];
let polarizers = [];
let negativeCoils = [];
let positiveCoils = [];
let entanglers = [];
let fading = false;
let lastTime = 0;
let paused = false; // Added for pause functionality

// Event listeners for UI buttons
document.getElementById('addLaserButton').addEventListener('click', addLaser);
document.getElementById('addPrismButton').addEventListener('click', addPrism);
document.getElementById('addSlitButton').addEventListener('click', addSlitWall);
document.getElementById('addWallButton').addEventListener('click', addWall);
document.getElementById('addMirrorButton').addEventListener('click', addMirror);
document.getElementById('addPolarizerButton').addEventListener('click', addPolarizer);
document.getElementById('addEntanglerButton').addEventListener('click', addEntangler);
document.getElementById('addPositiveCoilButton').addEventListener('click', addPositiveCoil);
document.getElementById('addNegativeCoilButton').addEventListener('click', addNegativeCoil);
document.getElementById('toggleFadeButton').addEventListener('click', toggleFade);
document.getElementById('clearHitsButton').addEventListener('click', function() {
  walls.forEach(wall => wall.hits = []);
});
document.getElementById('clearSimulationButton').addEventListener('click', clearSimulation);
document.getElementById('deleteObjectButton').addEventListener('click', function() {
  if (selectedObject) {
    removeObject(selectedObject);
    // Remove control panel if exists
    if (currentControlPanel && currentControlPanel.parentNode) {
      currentControlPanel.parentNode.removeChild(currentControlPanel);
      currentControlPanel = null;
    }
    selectedObject = null;
  }
});
document.getElementById('pauseResumeButton').addEventListener('click', function() {
  paused = !paused;
  document.getElementById('pauseResumeButton').textContent = paused ? 'Resume' : 'Pause';
});

// Mouse events
let mouseX = 0, mouseY = 0;
let selectedObject = null;
let currentControlPanel = null;
let dragging = false;
let rotating = false;

canvas.addEventListener('mousedown', function(e) {
  mouseX = e.clientX;
  mouseY = e.clientY;
  dragging = false;
  rotating = false;

  const objects = [...lasers, ...prisms, ...slits, ...walls, ...mirrors, ...polarizers, ...negativeCoils, ...positiveCoils, ...entanglers];
  let objFound = false;
  for (let obj of objects) {
    if (obj.isMouseOver(mouseX, mouseY)) {
      selectedObject = obj;
      objFound = true;
      if (e.shiftKey) {
        rotating = true;
      } else {
        dragging = true;
        obj.offsetX = mouseX - obj.x;
        obj.offsetY = mouseY - obj.y;
      }
      break;
    }
  }
  if (!objFound) {
    // Deselect current object if any
    if (selectedObject) {
      if (currentControlPanel && currentControlPanel.parentNode) {
        currentControlPanel.parentNode.removeChild(currentControlPanel);
        currentControlPanel = null;
      }
      selectedObject = null;
    }
  } else {
    // Remove existing control panel
    if (currentControlPanel && currentControlPanel.parentNode) {
      currentControlPanel.parentNode.removeChild(currentControlPanel);
      currentControlPanel = null;
    }
    // Create control panel for selected object
    if (selectedObject instanceof Laser) {
      currentControlPanel = createLaserControlPanel(selectedObject);
    } else if (selectedObject instanceof SlitWall) {
      currentControlPanel = createSlitControlPanel(selectedObject);
    }
    // Position control panel under the menu buttons
    if (currentControlPanel) {
      currentControlPanel.style.left = '10px';
      currentControlPanel.style.top = '60px';
    }
  }
});

canvas.addEventListener('mousemove', function(e) {
  if (selectedObject) {
    if (dragging) {
      selectedObject.x = e.clientX - selectedObject.offsetX;
      selectedObject.y = e.clientY - selectedObject.offsetY;
    }
    if (rotating && selectedObject.hasOwnProperty('angle')) {
      const dx = e.clientX - selectedObject.x;
      const dy = e.clientY - selectedObject.y;
      let angle = Math.atan2(dy, dx);
      angle = Math.round(angle / (Math.PI / 8)) * (Math.PI / 8); // Snap to 22.5 degrees
      selectedObject.angle = angle;
    }
  }
});

canvas.addEventListener('mouseup', function() {
  dragging = false;
  rotating = false;
});

// Keyboard events for rotation
window.addEventListener('keydown', function(e) {
  if (selectedObject) {
    e.preventDefault(); // Prevent default scrolling behavior
    if (e.shiftKey && selectedObject.hasOwnProperty('angle')) {
      // Rotation with Shift + Arrow Keys
      if (e.key === 'ArrowLeft') {
        selectedObject.angle -= Math.PI / 8; // Rotate 22.5 degrees counterclockwise
      } else if (e.key === 'ArrowRight') {
        selectedObject.angle += Math.PI / 8; // Rotate 22.5 degrees clockwise
      }
      // Normalize angle
      selectedObject.angle %= 2 * Math.PI;

    } else {
      // Movement with Arrow Keys
      const moveStep = 0.5; // Pixels to move
      if (e.key === 'ArrowLeft') {
        selectedObject.x -= moveStep;
      } else if (e.key === 'ArrowRight') {
        selectedObject.x += moveStep;
      } else if (e.key === 'ArrowUp') {
        selectedObject.y -= moveStep;
      } else if (e.key === 'ArrowDown') {
        selectedObject.y += moveStep;
      }
    }
  }
});


// Laser constructor
function Laser(x, y) {
  this.x = x;
  this.y = y;
  this.angle = -Math.PI / 2;
  this.rate = 50; // Particles per second
  this.lastEmission = 0;
  this.offsetX = 0;
  this.offsetY = 0;
  this.color = '#ff0000'; // Default color: red
}

Laser.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  return Math.hypot(dx, dy) < 20;
};

// Create control panel for laser
function createLaserControlPanel(laser) {
  const panel = document.createElement('div');
  panel.className = 'control-panel';

  // Particle rate controls
  const rateLabel = document.createElement('span');
  rateLabel.textContent = 'Rate: ';
  panel.appendChild(rateLabel);

  const rateMinus = document.createElement('button');
  rateMinus.textContent = '-';
  rateMinus.className = 'button';
  rateMinus.addEventListener('click', function() {
    laser.rate = Math.max(1, laser.rate - 10);
    rateValue.textContent = laser.rate + ' particles/s';
  });
  panel.appendChild(rateMinus);

  const rateValue = document.createElement('span');
  rateValue.textContent = laser.rate + ' particles/s';
  rateValue.style.margin = '0 10px';
  panel.appendChild(rateValue);

  const ratePlus = document.createElement('button');
  ratePlus.textContent = '+';
  ratePlus.className = 'button';
  ratePlus.addEventListener('click', function() {
    laser.rate += 10;
    rateValue.textContent = laser.rate + ' particles/s';
  });
  panel.appendChild(ratePlus);

  // Color picker
  const colorLabel = document.createElement('span');
  colorLabel.textContent = ' Color: ';
  panel.appendChild(colorLabel);

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = laser.color;
  colorPicker.className = 'color-picker';
  colorPicker.addEventListener('input', function() {
    laser.color = colorPicker.value;
  });
  panel.appendChild(colorPicker);

  document.body.appendChild(panel);
  return panel;
}

// Prism constructor
function Prism(x, y) {
  this.x = x;
  this.y = y;
  this.angle = 0;
  this.width = 60;
  this.height = 60;
  this.offsetX = 0;
  this.offsetY = 0;
}

Prism.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  const rotatedX = dx * Math.cos(-this.angle) - dy * Math.sin(-this.angle);
  const rotatedY = dx * Math.sin(-this.angle) + dy * Math.cos(-this.angle);
  return pointInTriangle({ x: rotatedX, y: rotatedY }, { x: 0, y: -this.height / 2 }, { x: this.width / 2, y: this.height / 2 }, { x: -this.width / 2, y: this.height / 2 });
};

// SlitWall constructor
function SlitWall(x, y) {
  this.x = x;
  this.y = y;
  this.angle = 0;
  this.width = 200;
  this.height = 10; // Made thinner
  this.numSlits = 2;
  this.slitWidth = 5;
  this.offsetX = 0;
  this.offsetY = 0;
}

SlitWall.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  const rotatedX = dx * Math.cos(-this.angle) - dy * Math.sin(-this.angle);
  const rotatedY = dx * Math.sin(-this.angle) + dy * Math.cos(-this.angle);
  return rotatedX > -this.width / 2 && rotatedX < this.width / 2 &&
         rotatedY > -this.height / 2 && rotatedY < this.height / 2;
};

// Create control panel for slit wall
function createSlitControlPanel(slitWall) {
  const panel = document.createElement('div');
  panel.className = 'control-panel';

  // Number of slits
  const numSlitsLabel = document.createElement('span');
  numSlitsLabel.textContent = 'Slits: ';
  panel.appendChild(numSlitsLabel);

  const numSlitsInput = document.createElement('input');
  numSlitsInput.type = 'number';
  numSlitsInput.min = 1;
  numSlitsInput.max = 10;
  numSlitsInput.value = slitWall.numSlits;
  numSlitsInput.addEventListener('input', function() {
    slitWall.numSlits = parseInt(numSlitsInput.value);
  });
  panel.appendChild(numSlitsInput);

  // Slit width
  const slitWidthLabel = document.createElement('span');
  slitWidthLabel.textContent = ' Width: ';
  panel.appendChild(slitWidthLabel);

  const slitWidthInput = document.createElement('input');
  slitWidthInput.type = 'number';
  slitWidthInput.min = 1;
  slitWidthInput.max = 20;
  slitWidthInput.value = slitWall.slitWidth;
  slitWidthInput.addEventListener('input', function() {
    slitWall.slitWidth = parseInt(slitWidthInput.value);
  });
  panel.appendChild(slitWidthInput);

  document.body.appendChild(panel);
  return panel;
}

// Wall constructor
function Wall(x, y) {
  this.x = x;
  this.y = y;
  this.angle = 0;
  this.width = 400; // Increased wall length
  this.height = 10;
  this.offsetX = 0;
  this.offsetY = 0;
  this.hits = [];
}

Wall.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  const rotatedX = dx * Math.cos(-this.angle) - dy * Math.sin(-this.angle);
  const rotatedY = dx * Math.sin(-this.angle) + dy * Math.cos(-this.angle);
  return rotatedX > -this.width / 2 && rotatedX < this.width / 2 &&
         rotatedY > -this.height / 2 && rotatedY < this.height / 2;
};

// Mirror constructor
function Mirror(x, y) {
  this.x = x;
  this.y = y;
  this.angle = 0;
  this.length = 70;
  this.offsetX = 0;
  this.offsetY = 0;
}

Mirror.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  const rotatedX = dx * Math.cos(-this.angle) - dy * Math.sin(-this.angle);
  const rotatedY = dx * Math.sin(-this.angle) + dy * Math.cos(-this.angle);
  const distance = Math.abs(rotatedY);
  return distance < 10 && rotatedX > -this.length / 2 && rotatedX < this.length / 2;
};

// Polarizer constructor
function Polarizer(x, y) {
  this.x = x;
  this.y = y;
  this.angle = 0;
  this.width = 50;
  this.height = 30; // Adjusted height for oval shape
  this.offsetX = 0;
  this.offsetY = 0;
}

Polarizer.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  const rotatedX = dx * Math.cos(-this.angle) - dy * Math.sin(-this.angle);
  const rotatedY = dx * Math.sin(-this.angle) + dy * Math.cos(-this.angle);
  // Check if point is inside an ellipse
  return (rotatedX * rotatedX) / (this.width * this.width / 4) + (rotatedY * rotatedY) / (this.height * this.height / 4) <= 1;
};

// Polarizer draw function
Polarizer.prototype.draw = function() {
  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.rotate(this.angle);
  // Create gradient
  const gradient = ctx.createLinearGradient(-this.width / 2, 0, this.width / 2, 0);
  gradient.addColorStop(0, 'gray');
  gradient.addColorStop(1, 'darkcyan');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, this.width / 2, this.height / 2, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
};

// Coil constructor (Negative Coil - Repels particles)
function Coil(x, y) {
  this.x = x;
  this.y = y;
  this.radius = 30; // Radius of the coil
  this.angle = 0;
  this.offsetX = 0;
  this.offsetY = 0;
  this.stuckParticles = [];
}

Coil.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  const distance = Math.hypot(dx, dy);
  return distance < this.radius;
};

Coil.prototype.draw = function() {
  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.rotate(this.angle);
  // Draw the coil as a bluish gradient circle
  const gradient = ctx.createRadialGradient(0, 0, this.radius * 0.2, 0, 0, this.radius);
  gradient.addColorStop(0, '#b87333'); // Copper color
  gradient.addColorStop(1, '#8b4513');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, this.radius, 0, 2 * Math.PI);
  ctx.fill();

  // Draw the stuck particles
  for (let particle of this.stuckParticles) {
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 2, 0, 2 * Math.PI);
    ctx.fill();
  }

  ctx.restore();
};

// Positive Coil constructor (Attracts particles)
function PositiveCoil(x, y) {
  this.x = x;
  this.y = y;
  this.radius = 30; // Radius of the coil
  this.angle = 0;
  this.offsetX = 0;
  this.offsetY = 0;
  this.stuckParticles = [];
}

PositiveCoil.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  const distance = Math.hypot(dx, dy);
  return distance < this.radius;
};

PositiveCoil.prototype.draw = function() {
  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.rotate(this.angle);
  // Draw the coil as a brownish gradient circle
  const gradient = ctx.createRadialGradient(0, 0, this.radius * 0.2, 0, 0, this.radius);
  gradient.addColorStop(0, '#00bfff'); // DeepSkyBlue
  gradient.addColorStop(1, '#1e90ff'); // DodgerBlue
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, this.radius, 0, 2 * Math.PI);
  ctx.fill();


  // Draw the stuck particles
  for (let particle of this.stuckParticles) {
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 2, 0, 2 * Math.PI);
    ctx.fill();
  }

  ctx.restore();
};

// Entangler constructor
function Entangler(x, y) {
  this.x = x;
  this.y = y;
  this.radius = 18;
  this.angle = 0;
  this.offsetX = 0;
  this.offsetY = 0;
}

Entangler.prototype.isMouseOver = function(mx, my) {
  const dx = mx - this.x;
  const dy = my - this.y;
  const distance = Math.hypot(dx, dy);
  return distance < this.radius;
};

Entangler.prototype.draw = function() {
  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.rotate(this.angle);
  // Draw the entangler as a purple circle with an infinity symbol
  ctx.fillStyle = 'purple';
  ctx.beginPath();
  ctx.arc(0, 0, this.radius, 0, 2 * Math.PI);
  ctx.fill();

  // Draw infinity symbol
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.bezierCurveTo(-10, -10, 10, -10, 10, 0);
  ctx.bezierCurveTo(10, 10, -10, 10, -10, 0);
  ctx.stroke();

  ctx.restore();
};

// Add initial laser
addLaser();

// Add laser function
function addLaser() {
  const laser = new Laser(canvas.width / 2, canvas.height - 50);
  lasers.push(laser);
}

// Add prism function
function addPrism() {
  const prism = new Prism(canvas.width / 2, canvas.height / 2);
  prisms.push(prism);
}

// Add slit wall function
function addSlitWall() {
  const slitWall = new SlitWall(canvas.width / 2, canvas.height / 2);
  slits.push(slitWall);
}

// Add wall function
function addWall() {
  const wall = new Wall(canvas.width / 2, canvas.height / 2);
  walls.push(wall);
}

// Add mirror function
function addMirror() {
  const mirror = new Mirror(canvas.width / 2, canvas.height / 2);
  mirrors.push(mirror);
}

// Add polarizer function
function addPolarizer() {
  const polarizer = new Polarizer(canvas.width / 2, canvas.height / 2);
  polarizers.push(polarizer);
}

// Add coil function
function addNegativeCoil() {
  const coil = new Coil(canvas.width / 2, canvas.height / 2);
  negativeCoils.push(coil);
}

// Add positive coil function
function addPositiveCoil() {
  const coil = new PositiveCoil(canvas.width / 2, canvas.height / 2);
  positiveCoils.push(coil);
}

// Add entangler function
function addEntangler() {
  const entangler = new Entangler(canvas.width / 2, canvas.height / 2);
  entanglers.push(entangler);
}

// Toggle fade function
function toggleFade() {
  fading = !fading;
}

// Clear simulation function
function clearSimulation() {
  lasers = [];
  particles = [];
  prisms = [];
  slits = [];
  walls = [];
  mirrors = [];
  polarizers = [];
  negativeCoils = [];
  positiveCoils = [];
  entanglers = [];
  selectedObject = null;
  if (currentControlPanel && currentControlPanel.parentNode) {
    currentControlPanel.parentNode.removeChild(currentControlPanel);
    currentControlPanel = null;
  }
  addLaser(); // Add initial laser back
}

// Remove object function
function removeObject(obj) {
  const arrays = [lasers, prisms, slits, walls, mirrors, polarizers, negativeCoils, positiveCoils, entanglers];
  for (let arr of arrays) {
    const index = arr.indexOf(obj);
    if (index !== -1) {
      arr.splice(index, 1);
      break;
    }
  }
}

// Particle constructor
function Particle(x, y, angle, color, entangledPartner = null) {
  this.x = x;
  this.y = y;
  this.angle = angle;
  this.speed = 200; // Pixels per second
  this.color = color;
  this.time = 0;
  this.insidePrism = false;
  this.entangledPartner = entangledPartner;
  this.hasBeenEntangled = false;
}

Particle.prototype.updateSpeed = function() {
  if (this.insidePrism) {
    const wavelength = colorToWavelength(this.color);
    const n = getRefractiveIndex(wavelength);
    this.speed = 200 / n; // Adjust speed based on refractive index
  } else {
    this.speed = 200;
  }
};

// Maximum number of particles to prevent performance issues
const MAX_PARTICLES = 5000;

// Animation loop
function animate(time) {
  requestAnimationFrame(animate);

  if (paused) {
    lastTime = time;
    return; // Skip updating when paused
  }

  const deltaTime = (time - lastTime) / 1000;
  lastTime = time;

  // Fade effect only applies to photons
  if (fading) {
    // ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  drawGrid(); // Draw background grid

  // Draw walls and other objects (they persist)
  drawWalls();
  drawPrisms();
  drawSlits();
  drawMirrors();
  drawPolarizers();
  drawNegativeCoils();
  drawPositiveCoils();
  drawEntanglers();

  // Draw wall hit points before particles to ensure particles are on top
  drawWallHits();

  // Emit particles from lasers
  for (let laser of lasers) {
    laser.lastEmission += deltaTime;
    const emissionInterval = 1 / laser.rate;
    if (laser.lastEmission >= emissionInterval && particles.length < MAX_PARTICLES) {
      laser.lastEmission = 0;
      const particle = new Particle(laser.x, laser.y, laser.angle, laser.color);
      particles.push(particle);
    }
    // Draw laser
    ctx.save();
    ctx.translate(laser.x, laser.y);
    ctx.rotate(laser.angle);
    ctx.fillStyle = laser.color;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }

  // Update and draw particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.time += deltaTime;

    // Update particle speed based on medium
    p.updateSpeed();

    p.x += Math.cos(p.angle) * p.speed * deltaTime;
    p.y += Math.sin(p.angle) * p.speed * deltaTime;

    // Remove particle after 10 seconds
    if (p.time > 100) {
      particles.splice(i, 1);
      continue;
    }

    let particleRemoved = false;

    // Check interaction with entanglers
    for (let entangler of entanglers) {
      const dx = p.x - entangler.x;
      const dy = p.y - entangler.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= entangler.radius && !p.hasBeenEntangled) {
        // Create an entangled partner
        const partner = new Particle(p.x, p.y, p.angle + Math.PI, p.color, p);
        p.entangledPartner = partner;
        p.hasBeenEntangled = true;
        partner.hasBeenEntangled = true;
        particles.push(partner);
        break;
      }
    }

    // Check interaction with negative coils (repelling)
    for (let coil of negativeCoils) {
      const dx = p.x - coil.x;
      const dy = p.y - coil.y;
      const distanceSquared = dx * dx + dy * dy;
      const distance = Math.sqrt(distanceSquared);

      // If particle is within the coil's radius, it hits the coil and sticks
      if (distance <= coil.radius) {
        // Make the particle stick to the coil
        const relativeX = p.x - coil.x;
        const relativeY = p.y - coil.y;
        coil.stuckParticles.push({ x: relativeX, y: relativeY, color: p.color });
        particles.splice(i, 1);
        particleRemoved = true;
        continue;
      } else {
        // Apply magnetic force if within a certain range
        const effectRange = 200; // Arbitrary range of effect
        if (distance <= effectRange) {
          // Attracting force
          const forceMagnitude = 7500 / distanceSquared; // Adjust constant as needed

          // Particle's velocity components
          const vx = Math.cos(p.angle) * p.speed;
          const vy = Math.sin(p.angle) * p.speed;

          // Cross product between velocity and position vector (from coil to particle)
          const cross = vx * dy - vy * dx;

          // Determine the direction of angle change
          const direction = cross > 0 ? 1 : -1; // Direction for attraction

          // Compute change in angle
          const deltaAngle = direction * forceMagnitude * deltaTime;

          // Update particle's angle
          p.angle += deltaAngle;
          if (p.entangledPartner) p.entangledPartner.angle += deltaAngle;
        }
      }
    }

    if (particleRemoved) continue;

    // Check interaction with positive coils (attracting)
    for (let coil of positiveCoils) {
      const dx = p.x - coil.x;
      const dy = p.y - coil.y;
      const distanceSquared = dx * dx + dy * dy;
      const distance = Math.sqrt(distanceSquared);

      // If particle is within the coil's radius, it hits the coil and sticks
      if (distance <= coil.radius) {
        // Make the particle stick to the coil
        const relativeX = p.x - coil.x;
        const relativeY = p.y - coil.y;
        coil.stuckParticles.push({ x: relativeX, y: relativeY, color: p.color });
        particles.splice(i, 1);
        particleRemoved = true;
        continue;


      } else {
        // Apply magnetic force if within a certain range
        const effectRange = 200; // Arbitrary range of effect

        if (distance <= effectRange) {
          // Repelling force
          const forceMagnitude = 7500 / distanceSquared; // Adjust constant as needed

          // Particle's velocity components
          const vx = Math.cos(p.angle) * p.speed;
          const vy = Math.sin(p.angle) * p.speed;

          // Cross product between velocity and position vector (from coil to particle)
          const cross = vx * dy - vy * dx;

          // Determine the direction of angle change
          const direction = cross > 0 ? -1 : 1; // Reverse direction for repulsion

          // Compute change in angle
          const deltaAngle = direction * forceMagnitude * deltaTime;

          // Update particle's angle
          p.angle += deltaAngle;
          if (p.entangledPartner) p.entangledPartner.angle += deltaAngle;
        }
      }
    }
    if (particleRemoved) continue;

    // Check collisions with prisms
    let prismCollision = false;
    for (let prism of prisms) {
      const collisionResult = checkCollisionWithPrism(p, prism);
      if (collisionResult) {
        refractParticle(p, prism, collisionResult);
        prismCollision = true;
        if (collisionResult === 'enter') {
          p.insidePrism = true;
        } else if (collisionResult === 'exit') {
          p.insidePrism = false;
        }
        break; // Assume particle interacts with one prism at a time
      }
    }

    // Check collisions with mirrors
    for (let mirror of mirrors) {
      if (checkCollisionWithMirror(p, mirror)) {
        reflectParticle(p, mirror);
        if (p.entangledPartner) reflectParticle(p.entangledPartner, mirror);
        break;
      }
    }

    // Check collisions with polarizers
    for (let polarizer of polarizers) {
      if (checkCollisionWithPolarizer(p, polarizer)) {
        handlePolarizer(p, polarizer);
        if (p.entangledPartner) handlePolarizer(p.entangledPartner, polarizer);
        break; // Only handle first polarizer collision
      }
    }

    // Simulate double-slit effect
    for (let slit of slits) {
      let result = checkCollisionWithSlit(p, slit);
      if (result === 'absorbed') {
        particles.splice(i, 1);
        particleRemoved = true;
        break;
      } else if (result === 'diffracted') {
        applyInterference(p, slit);
        break;
      }
    }
    if (particleRemoved) continue;

    // Check collisions with walls
    for (let wall of walls) {
      if (checkCollisionWithWall(p, wall)) {
        // Record hit on wall
        recordWallHit(p, wall);
        particles.splice(i, 1);
        particleRemoved = true;
        continue;
      }
    }
    if (particleRemoved) continue;

    // Check if particle is off-screen
    if (p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
      particles.splice(i, 1);
      continue;
    }

    // Draw particle with glow effect
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 5);
    gradient.addColorStop(0, p.color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }

  // requestAnimationFrame(animate); // Moved to the top for consistent frame rate
}

animate(0);

// Drawing functions
function drawPrisms() {
  for (let prism of prisms) {
    ctx.save();
    ctx.translate(prism.x, prism.y);
    ctx.rotate(prism.angle);
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.moveTo(0, -prism.height / 2);
    ctx.lineTo(prism.width / 2, prism.height / 2);
    ctx.lineTo(-prism.width / 2, prism.height / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawSlits() {
  for (let slit of slits) {
    ctx.save();
    ctx.translate(slit.x, slit.y);
    ctx.rotate(slit.angle);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-slit.width / 2, -slit.height / 2, slit.width, slit.height);

    // Draw slits
    ctx.fillStyle = '#000';
    const totalSlitWidth = slit.numSlits * slit.slitWidth;
    const spacing = (slit.width - totalSlitWidth) / (slit.numSlits + 1);
    let currentX = -slit.width / 2 + spacing;

    for (let i = 0; i < slit.numSlits; i++) {
      ctx.fillRect(currentX, -slit.height / 2, slit.slitWidth, slit.height);
      currentX += slit.slitWidth + spacing;
    }

    ctx.restore();
  }
}

function drawWalls() {
  for (let wall of walls) {
    ctx.save();
    ctx.translate(wall.x, wall.y);
    ctx.rotate(wall.angle);
    ctx.fillStyle = '#444';
    ctx.fillRect(-wall.width / 2, -wall.height / 2, wall.width, wall.height);
    ctx.restore();
  }
}

function drawMirrors() {
  for (let mirror of mirrors) {
    ctx.save();
    ctx.translate(mirror.x, mirror.y);
    ctx.rotate(mirror.angle);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-mirror.length / 2, 0);
    ctx.lineTo(mirror.length / 2, 0);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPolarizers() {
  for (let polarizer of polarizers) {
    polarizer.draw();
  }
}

function drawNegativeCoils() {
  for (let coil of negativeCoils) {
    coil.draw();
  }
}

function drawPositiveCoils() {
  for (let coil of positiveCoils) {
    coil.draw();
  }
}

function drawEntanglers() {
  for (let entangler of entanglers) {
    entangler.draw();
  }
}

// Wall hit recording
function recordWallHit(particle, wall) {
  const dx = particle.x - wall.x;
  const dy = particle.y - wall.y;
  const rotatedX = dx * Math.cos(-wall.angle) - dy * Math.sin(-wall.angle);
  const rotatedY = dx * Math.sin(-wall.angle) + dy * Math.cos(-wall.angle);

  wall.hits.push({ x: rotatedX, y: rotatedY, color: particle.color, timestamp: performance.now() });
}

function drawWallHits() {
  const currentTime = performance.now();
  for (let wall of walls) {
    ctx.save();
    ctx.translate(wall.x, wall.y);
    ctx.rotate(wall.angle);
    for (let i = wall.hits.length - 1; i >= 0; i--) {
      const hit = wall.hits[i];
      const timeSinceHit = (currentTime - hit.timestamp) / 1000; // in seconds
      if (timeSinceHit > 10) {
        const opacity = Math.max(1 - (timeSinceHit - 10) / 5, 0);
        if (opacity <= 0) {
          wall.hits.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `rgba(${hexToRgb(hit.color).join(',')},${opacity})`;
      } else {
        ctx.fillStyle = hit.color;
      }
      ctx.fillRect(hit.x, hit.y, 2, 2);
    }
    ctx.restore();
  }
}

// Collision and physics functions
function checkCollisionWithPrism(p, prism) {
  const dx = p.x - prism.x;
  const dy = p.y - prism.y;
  const rotatedX = dx * Math.cos(-prism.angle) - dy * Math.sin(-prism.angle);
  const rotatedY = dx * Math.sin(-prism.angle) + dy * Math.cos(-prism.angle);

  // Check if inside triangular prism
  const a = { x: 0, y: -prism.height / 2 };
  const b = { x: prism.width / 2, y: prism.height / 2 };
  const c = { x: -prism.width / 2, y: prism.height / 2 };
  const point = { x: rotatedX, y: rotatedY };

  const inside = pointInTriangle(point, a, b, c);

  if (inside && !p.insidePrism) {
    return 'enter';
  } else if (!inside && p.insidePrism) {
    return 'exit';
  } else if (inside && p.insidePrism) {
    return 'inside';
  } else {
    return false;
  }
}

function refractParticle(p, prism, status) {
  let n1, n2;
  if (status === 'enter') {
    n1 = 1;
    n2 = getRefractiveIndex(colorToWavelength(p.color));
  } else if (status === 'exit') {
    n1 = getRefractiveIndex(colorToWavelength(p.color));
    n2 = 1;
  } else if (status === 'inside') {
    // No refraction needed while inside
    return;
  } else {
    // Should not happen
    return;
  }

  // Calculate normal at point of entry/exit
  const normalAngle = calculateNormalAngle(p, prism);

  // Angle of incidence
  let incidentAngle = p.angle - normalAngle;
  incidentAngle = normalizeAngle(incidentAngle);

  // Snell's Law
  const sinIncident = Math.sin(incidentAngle);
  const sinRefracted = n1 / n2 * sinIncident;

  // Refracted angle
  if (Math.abs(sinRefracted) <= 1) {
    let refractedAngle = Math.asin(sinRefracted) + normalAngle;
    refractedAngle = normalizeAngle(refractedAngle);
    p.angle = refractedAngle;
    if (p.entangledPartner) p.entangledPartner.angle = refractedAngle;
  } else {
    // Total internal reflection
    p.angle = 2 * normalAngle - p.angle;
    p.angle = normalizeAngle(p.angle);
    if (p.entangledPartner) {
      p.entangledPartner.angle = p.angle;
    }
  }
}

function calculateNormalAngle(p, prism) {
  // Approximate normal based on closest prism edge
  const dx = p.x - prism.x;
  const dy = p.y - prism.y;
  const rotatedX = dx * Math.cos(-prism.angle) - dy * Math.sin(-prism.angle);
  const rotatedY = dx * Math.sin(-prism.angle) + dy * Math.cos(-prism.angle);

  // Prism edges in local coordinates
  const edges = [
    { x1: 0, y1: -prism.height / 2, x2: prism.width / 2, y2: prism.height / 2 }, // Right side
    { x1: prism.width / 2, y1: prism.height / 2, x2: -prism.width / 2, y2: prism.height / 2 }, // Bottom
    { x1: -prism.width / 2, y1: prism.height / 2, x2: 0, y2: -prism.height / 2 } // Left side
  ];

  let minDist = Infinity;
  let normalAngle = prism.angle;

  for (let edge of edges) {
    const dist = pointToLineDistance(rotatedX, rotatedY, edge.x1, edge.y1, edge.x2, edge.y2);
    if (dist < minDist) {
      minDist = dist;
      // Calculate normal angle for this edge
      const edgeAngle = Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1) + Math.PI / 2;
      normalAngle = prism.angle + edgeAngle;
    }
  }

  return normalizeAngle(normalAngle);
}

function pointToLineDistance(x0, y0, x1, y1, x2, y2) {
  return Math.abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1) /
         Math.hypot(y2 - y1, x2 - x1);
}

function normalizeAngle(angle) {
  angle %= 2 * Math.PI;
  if (angle < 0) angle += 2 * Math.PI;
  return angle;
}

function checkCollisionWithMirror(p, mirror) {
  const dx = p.x - mirror.x;
  const dy = p.y - mirror.y;
  const rotatedX = dx * Math.cos(-mirror.angle) - dy * Math.sin(-mirror.angle);
  const rotatedY = dx * Math.sin(-mirror.angle) + dy * Math.cos(-mirror.angle);
  const distance = Math.abs(rotatedY);

  // Check if particle is within mirror bounds
  if (distance < 5 && rotatedX > -mirror.length / 2 && rotatedX < mirror.length / 2) {
    // Reflect the particle
    return true;
  }
  return false;
}

function reflectParticle(p, mirror) {
  // Compute normal vector of the mirror
  const normalAngle = mirror.angle + Math.PI / 2;
  const nx = Math.cos(normalAngle);
  const ny = Math.sin(normalAngle);

  // Particle's velocity vector
  const vx = Math.cos(p.angle);
  const vy = Math.sin(p.angle);

  // Compute dot product of velocity and normal
  const dot = vx * nx + vy * ny;

  // Compute reflected velocity
  const rx = vx - 2 * dot * nx;
  const ry = vy - 2 * dot * ny;

  // Compute new angle
  p.angle = Math.atan2(ry, rx);
}

function checkCollisionWithWall(p, wall) {
  const dx = p.x - wall.x;
  const dy = p.y - wall.y;
  const rotatedX = dx * Math.cos(-wall.angle) - dy * Math.sin(-wall.angle);
  const rotatedY = dx * Math.sin(-wall.angle) + dy * Math.cos(-wall.angle);

  return rotatedX > -wall.width / 2 && rotatedX < wall.width / 2 &&
         rotatedY > -wall.height / 2 && rotatedY < wall.height / 2;
}

function checkCollisionWithSlit(p, slit) {
  const dx = p.x - slit.x;
  const dy = p.y - slit.y;
  const rotatedX = dx * Math.cos(-slit.angle) - dy * Math.sin(-slit.angle);
  const rotatedY = dx * Math.sin(-slit.angle) + dy * Math.cos(-slit.angle);

  const withinWidth = rotatedX > -slit.width / 2 && rotatedX < slit.width / 2;
  const withinHeight = rotatedY > -slit.height / 2 && rotatedY < slit.height / 2;

  if (!withinWidth || !withinHeight) {
    return 'none';
  }

  const totalSlitWidth = slit.numSlits * slit.slitWidth;
  const spacing = (slit.width - totalSlitWidth) / (slit.numSlits + 1);
  let currentX = -slit.width / 2 + spacing;

  let inAnySlit = false;

  for (let i = 0; i < slit.numSlits; i++) {
    // Check if particle is within a slit
    if (rotatedX >= currentX && rotatedX <= currentX + slit.slitWidth) {
      inAnySlit = true;
      break;
    }
    currentX += slit.slitWidth + spacing;
  }

  if (inAnySlit) {
    return 'diffracted'; // Pass through the slit
  } else {
    return 'absorbed'; // Hit the wall between slits
  }
}

function applyInterference(p, slit) {
  // Adjust angle based on slit width
  const wavelength = colorToWavelength(p.color) * 1e-9; // in meters
  const slitWidthMeters = slit.slitWidth * 1e-6; // Assuming 1 pixel = 1e-6 meters
  let diffractionAngle = 0;

  if (slitWidthMeters > 0 && wavelength <= slitWidthMeters) {
    diffractionAngle = Math.asin(wavelength / slitWidthMeters);
  }

  // Clamp diffraction angle to reasonable values to prevent extreme angles
  diffractionAngle = Math.min(diffractionAngle, Math.PI / 4);

  const angleDeviation = (Math.random() - 0.5) * diffractionAngle;
  p.angle += angleDeviation;
}

function checkCollisionWithPolarizer(p, polarizer) {
  const dx = p.x - polarizer.x;
  const dy = p.y - polarizer.y;
  const rotatedX = dx * Math.cos(-polarizer.angle) - dy * Math.sin(-polarizer.angle);
  const rotatedY = dx * Math.sin(-polarizer.angle) + dy * Math.cos(-polarizer.angle);
  // Check if point is inside an ellipse
  return (rotatedX * rotatedX) / (polarizer.width * polarizer.width / 4) + (rotatedY * rotatedY) / (polarizer.height * polarizer.height / 4) <= 1;
}

function handlePolarizer(p, polarizer) {
  // 50% chance to pass through, 50% to reflect
  if (Math.random() < 0.5) {
    // Pass through: do nothing, continue
  } else {
    // Reflect like a mirror
    const normalAngle = polarizer.angle + Math.PI / 2;
    p.angle = 2 * normalAngle - p.angle;
    // Normalize angle
    p.angle = (p.angle + 2 * Math.PI) % (2 * Math.PI);
  }
}

// Utility functions
function hexToRgb(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}

function colorToWavelength(color) {
  const rgb = hexToRgb(color);
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];

  let wavelength;
  if (r >= g && r >= b) {
    wavelength = 700 - (r / 255) * 100; // 600-700 nm
  } else if (g >= r && g >= b) {
    wavelength = 570 - (g / 255) * 170; // 500-570 nm
  } else if (b >= r && b >= g) {
    wavelength = 450 - (b / 255) * 50; // 400-450 nm
  } else {
    wavelength = 550; // Default
  }
  return wavelength;
}

function getRefractiveIndex(wavelength) {
  const A = 1.5;
  const B = 0.004;
  const lambda = wavelength / 1000; // Convert nm to micrometers
  const n = A + B / (lambda * lambda);
  return n;
}

function pointInTriangle(p, a, b, c) {
  const areaOrig = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const area1 = Math.abs((a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x));
  const area2 = Math.abs((b.x - p.x) * (c.y - p.y) - (b.y - p.y) * (c.x - p.x));
  const area3 = Math.abs((c.x - p.x) * (a.y - p.y) - (c.y - p.y) * (a.x - p.x));
  return Math.abs(area1 + area2 + area3 - areaOrig) < 0.01;
}

function drawGrid() {
  const gridSize = 35;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;

  // Vertical lines
  for (let x = 0; x < canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  // Horizontal lines
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}
