// Ensure you have three.js loaded, e.g.
// <script src="https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js"></script>

let scene, camera, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false,
    moveUp = false, moveDown = false;
let prevTime = performance.now();
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let mouseSensitivity = 0.0015; // Adjustable mouse sensitivity
let moveSpeed = 12.0; // Base movement speed
let running = false; // Track if player is running

// Drone simulation variables
let drones = []; // Array to hold multiple drones
let rlAgents = []; // Array for the RL agents
let visualizer;
let trainingEnabled = false;
let dogfightMode = false; // New mode for combat training

// Make centralized training available globally
let centralizedTrainer;

// Texture URLs using raw GitHub content
const textureURLs = {
    ceiling: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/ceiling_1.png',
    wall: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/gym_wall_indoor_1.png',
    floor: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/gym_floor_1.png',
    grass: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/grass_1.png',
    sky: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/sky_1.png'
};

init();
animate();

function init() {
    // Create scene
    scene = new THREE.Scene();
    
    // Load skybox for scene background
    const textureLoader = new THREE.TextureLoader();
    const skyTexture = textureLoader.load(textureURLs.sky);
    scene.background = skyTexture;

    // Create camera
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    // Start at a position to observe the drone
    camera.position.set(15, 10, 15);
    
    // Set proper rotation order to avoid gimbal lock
    camera.rotation.order = 'YXZ';
    
    // Look at the center where drone will be
    camera.lookAt(0, 5, 0);

    // Create renderer
    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('canvas'),
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows

    // Lighting
    addLighting();

    // Create outside environment (grass field, etc.)
    createOutdoorEnvironment();
    
    // Create the gym hall interior
    createGymHall();

    // Initialize drones
    createDrones();
    
    // Initialize reinforcement learning
    initializeRL();
    
    // Create training visualization
    visualizer = new TrainingVisualizer();
    
    // Create control panel
    setupControlPanel();

    // Set up controls (pointer lock + WASD)
    setupControls();

    // Resize handler
    window.addEventListener('resize', onWindowResize, false);
}

function addLighting() {
    // Soft ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    // One directional "sunlight" from above at an angle
    const dirLight = new THREE.DirectionalLight(0xfffaf0, 0.6); // Warm sunlight
    dirLight.position.set(30, 50, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    scene.add(dirLight);

    // Overhead lights (reduced intensity for more natural window lighting)
    const rows = 2;
    const cols = 3;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const overhead = new THREE.PointLight(0xffffee, 0.25, 40); // Reduced intensity from 0.5 to 0.25
            overhead.position.set(
                -20 + c * 20, // spread them across the width
                14.5,
                -10 + r * 20  // spread them across the length
            );
            overhead.castShadow = true;
            overhead.shadow.mapSize.width = 512;
            overhead.shadow.mapSize.height = 512;
            scene.add(overhead);
        }
    }
}

function createOutdoorEnvironment() {
    const textureLoader = new THREE.TextureLoader();
    
    // Create large grass field
    const grassTex = textureLoader.load(textureURLs.grass);
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(30, 30);
    
    const grassGeom = new THREE.PlaneGeometry(200, 200);
    const grassMat = new THREE.MeshStandardMaterial({
        map: grassTex,
        side: THREE.DoubleSide
    });
    const grass = new THREE.Mesh(grassGeom, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.1; // Slightly below gym floor
    grass.receiveShadow = true;
    scene.add(grass);
}

function createGymHall() {
    const textureLoader = new THREE.TextureLoader();

    // Helper to load repeating textures
    function loadRepeatTexture(url, repeatX = 1, repeatY = 1) {
        const tex = textureLoader.load(url);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        return tex;
    }

    // Floor
    const floorTex = loadRepeatTexture(textureURLs.floor, 6, 4);
    const floorGeom = new THREE.PlaneGeometry(60, 40);
    const floorMat = new THREE.MeshStandardMaterial({
        map: floorTex,
        side: THREE.DoubleSide
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    // Ceiling
    const ceilTex = loadRepeatTexture(textureURLs.ceiling, 6, 6);
    const ceilGeom = new THREE.PlaneGeometry(60, 60);
    const ceilMat = new THREE.MeshStandardMaterial({
        map: ceilTex,
        side: THREE.DoubleSide
    });
    const ceiling = new THREE.Mesh(ceilGeom, ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 15;
    ceiling.receiveShadow = true;
    scene.add(ceiling);

    // Wall texture - fixed aspect ratio for walls
    const wallTex = loadRepeatTexture(textureURLs.wall, 6, 1); // Adjusted repeatY to fix stretching

    // Create walls with windows and add window lighting
    createWallWithWindows(0, 7.5, -20, 60, 15, 0, wallTex); // Back wall
    createWallWithWindows(0, 7.5, 20, 60, 15, Math.PI, wallTex); // Front wall
    createWallWithWindows(-30, 7.5, 0, 40, 15, Math.PI / 2, wallTex); // Left wall
    createWallWithWindows(30, 7.5, 0, 40, 15, -Math.PI / 2, wallTex); // Right wall

    // Add a couple of basketball hoops at each end
    createBasketballHoop(0, 0, -19, 0);     // Moved slightly away from wall
    createBasketballHoop(0, 0, 19, Math.PI); // Moved slightly away from wall

    // Reposition benches along the walls rather than in the middle
    createBench(-25, 0, 18);  // Left side, back corner
    createBench(-15, 0, 18);  // Left side, back corner
    createBench(15, 0, 18);   // Right side, back corner
    createBench(25, 0, 18);   // Right side, back corner
    
    // Add more gym equipment along the walls
    createGymEquipment();
}

function createWallWithWindows(x, y, z, width, height, rotationY, wallTexture) {
    // Create wall sections with windows in between
    const numSections = 3; // 3 wall sections with 2 windows
    const sectionWidth = width / numSections;
    const windowWidth = sectionWidth * 0.6;
    const solidWidth = sectionWidth - windowWidth;
    const windowHeight = 4;
    const windowY = 8; // Position of window center
    
    // Wall material
    const wallMat = new THREE.MeshStandardMaterial({ 
        map: wallTexture, 
        side: THREE.DoubleSide 
    });
    
    // Create the main lower and upper wall sections
    const lowerWallGeom = new THREE.BoxGeometry(width, windowY - windowHeight/2, 0.3);
    const lowerWall = new THREE.Mesh(lowerWallGeom, wallMat);
    lowerWall.position.set(x, (windowY - windowHeight/2) / 2, z);
    lowerWall.rotation.y = rotationY;
    lowerWall.castShadow = true;
    lowerWall.receiveShadow = true;
    scene.add(lowerWall);
    
    const upperWallGeom = new THREE.BoxGeometry(width, height - (windowY + windowHeight/2), 0.3);
    const upperWall = new THREE.Mesh(upperWallGeom, wallMat);
    upperWall.position.set(x, windowY + windowHeight/2 + (height - (windowY + windowHeight/2)) / 2, z);
    upperWall.rotation.y = rotationY;
    upperWall.castShadow = true;
    upperWall.receiveShadow = true;
    scene.add(upperWall);
    
    // Create window sections (glass)
    for (let i = 0; i < numSections-1; i++) {
        const windowX = -width/2 + sectionWidth/2 + sectionWidth * (i+1);
        const glassGeom = new THREE.BoxGeometry(windowWidth, windowHeight, 0.1);
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3,
            roughness: 0.1,
            transmission: 0.9
        });
        
        const windowPane = new THREE.Mesh(glassGeom, glassMat);
        
        // Position correctly based on wall rotation
        let offsetX = 0, offsetZ = 0;
        
        if (rotationY === 0) {
            offsetX = windowX;
            offsetZ = 0;
        } else if (rotationY === Math.PI) {
            offsetX = -windowX;
            offsetZ = 0;
        } else if (rotationY === Math.PI/2) {
            offsetX = 0;
            offsetZ = windowX;
        } else if (rotationY === -Math.PI/2) {
            offsetX = 0;
            offsetZ = -windowX;
        }
        
        windowPane.position.set(
            x + offsetX, 
            windowY, 
            z + offsetZ
        );
        windowPane.rotation.y = rotationY;
        windowPane.receiveShadow = true;
        scene.add(windowPane);
        
        // Window frame (thin border around glass)
        const frameGeom = new THREE.BoxGeometry(windowWidth + 0.2, windowHeight + 0.2, 0.2);
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21 });
        const frame = new THREE.Mesh(frameGeom, frameMat);
        frame.position.set(
            x + offsetX, 
            windowY, 
            z + offsetZ
        );
        frame.rotation.y = rotationY;
        frame.castShadow = true;
        frame.receiveShadow = true;
        scene.add(frame);
        
        // Add light source at window
        let lightX = 0, lightZ = 0;
        
        if (rotationY === 0) {
            lightX = x + windowX;
            lightZ = z + 0.5; // Slightly inside
        } else if (rotationY === Math.PI) {
            lightX = x - windowX;
            lightZ = z - 0.5; // Slightly inside
        } else if (rotationY === Math.PI/2) {
            lightX = x + 0.5; // Slightly inside
            lightZ = z + windowX;
        } else if (rotationY === -Math.PI/2) {
            lightX = x - 0.5; // Slightly inside
            lightZ = z - windowX;
        }
        
        // Window light source
        const windowLight = new THREE.SpotLight(0xffffee, 0.5);
        windowLight.position.set(lightX, windowY, lightZ);
        windowLight.target.position.set(x, windowY, z); // Point toward center
        windowLight.angle = Math.PI / 6;
        windowLight.penumbra = 0.5;
        windowLight.decay = 2;
        windowLight.distance = 30;
        windowLight.castShadow = true;
        scene.add(windowLight);
        scene.add(windowLight.target);
    }
}

function createGymEquipment() {
    // Create gym mats along the walls
    const matGeom = new THREE.BoxGeometry(8, 0.3, 5);
    const matMat = new THREE.MeshStandardMaterial({ color: 0x3d85c6 });
    
    // Position mats along the walls
    const mat1 = new THREE.Mesh(matGeom, matMat);
    mat1.position.set(-25, 0.15, -15); // Left side
    mat1.receiveShadow = true;
    scene.add(mat1);
    
    const mat2 = new THREE.Mesh(matGeom, matMat);
    mat2.position.set(25, 0.15, -15); // Right side
    mat2.receiveShadow = true;
    scene.add(mat2);
    
    // Create a vaulting horse - moved to side
    createVaultingHorse(-20, 0, 0); // Moved to left side
    
    // Add some more equipment along the walls
    createWallBars(28, 0, -15); // Climbing bars on right wall
}

// Add wall bars (Swedish bars)
function createWallBars(x, y, z) {
    const frameWidth = 2;
    const frameHeight = 8;
    const depth = 0.5;
    
    // Frame
    const frameGeom = new THREE.BoxGeometry(frameWidth, frameHeight, depth);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21 });
    const frame = new THREE.Mesh(frameGeom, frameMat);
    frame.position.set(x, y + frameHeight/2, z);
    frame.castShadow = true;
    scene.add(frame);
    
    // Bars
    const numBars = 8;
    const barRadius = 0.05;
    const barSpacing = frameHeight / (numBars + 1);
    
    for (let i = 1; i <= numBars; i++) {
        const barGeom = new THREE.CylinderGeometry(barRadius, barRadius, frameWidth + 0.1, 8);
        const barMat = new THREE.MeshStandardMaterial({ color: 0xA0522D });
        const bar = new THREE.Mesh(barGeom, barMat);
        bar.rotation.z = Math.PI / 2; // Rotate to horizontal
        bar.position.set(x, y + i * barSpacing, z);
        bar.castShadow = true;
        scene.add(bar);
    }
}

function createVaultingHorse(x, y, z) {
    // Body
    const bodyGeom = new THREE.BoxGeometry(2, 1.3, 5);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.set(x, y + 1.3/2 + 0.7, z);
    body.castShadow = true;
    scene.add(body);
    
    // Padding on top
    const paddingGeom = new THREE.BoxGeometry(2.2, 0.2, 5.2);
    const paddingMat = new THREE.MeshStandardMaterial({ color: 0x8B8682 });
    const padding = new THREE.Mesh(paddingGeom, paddingMat);
    padding.position.set(x, y + 1.3 + 0.1 + 0.7, z);
    padding.castShadow = true;
    scene.add(padding);
    
    // Legs
    const legGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.7);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x696969 });
    
    const positions = [
        [-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]
    ];
    
    positions.forEach(pos => {
        const leg = new THREE.Mesh(legGeom, legMat);
        leg.position.set(x + pos[0], y + 0.35, z + pos[1]);
        leg.castShadow = true;
        scene.add(leg);
    });
}

function createBasketballHoop(x, y, z, rotationY) {
    // Backboard - moved away from wall slightly
    const offset = (rotationY === 0) ? 0.5 : -0.5; // Ensure it faces inward
    const backboardOffset = (rotationY === 0) ? 0.5 : -0.5;
    
    const backboardGeo = new THREE.BoxGeometry(3, 2, 0.2);
    const backboardMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const backboard = new THREE.Mesh(backboardGeo, backboardMat);
    backboard.position.set(
        x, 
        10, 
        z + backboardOffset // Moved away from wall
    );
    backboard.rotation.y = rotationY;
    backboard.castShadow = true;
    scene.add(backboard);

    // Hoop (torus)
    const hoopGeo = new THREE.TorusGeometry(0.6, 0.04, 16, 32);
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0xff4500 });
    const hoop = new THREE.Mesh(hoopGeo, hoopMat);
    // Move the hoop forward from the backboard
    const hoopOffset = 0.6;
    hoop.position.set(
        x + hoopOffset * Math.sin(rotationY),
        9,
        (z + backboardOffset) - hoopOffset * Math.cos(rotationY)
    );
    hoop.rotation.x = Math.PI / 2;
    hoop.castShadow = true;
    scene.add(hoop);
    
    // Add the rim support
    const supportGeo = new THREE.BoxGeometry(0.05, 0.05, 0.6);
    const supportMat = new THREE.MeshStandardMaterial({ color: 0xC0C0C0 });
    const support = new THREE.Mesh(supportGeo, supportMat);
    support.position.set(
        x + (hoopOffset/2) * Math.sin(rotationY),
        9,
        (z + backboardOffset) - (hoopOffset/2) * Math.cos(rotationY)
    );
    support.rotation.y = rotationY;
    support.castShadow = true;
    scene.add(support);

    // Add the net using cylindrical mesh
    const netGeo = new THREE.CylinderGeometry(0.6, 0.3, 1, 16, 1, true);
    const netMat = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        wireframe: true,
        transparent: true,
        opacity: 0.7
    });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(
        x + hoopOffset * Math.sin(rotationY),
        8.5,
        (z + backboardOffset) - hoopOffset * Math.cos(rotationY)
    );
    scene.add(net);
    
    // Add a support structure mounted to the wall
    const mountSize = 0.2;
    const mountLength = 1.5;
    const mountGeo = new THREE.BoxGeometry(mountSize, mountSize, mountLength);
    const mountMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    
    const mount = new THREE.Mesh(mountGeo, mountMat);
    mount.position.set(
        x,
        10,
        z + (backboardOffset/2) * (rotationY === 0 ? 1 : -1)
    );
    mount.rotation.y = rotationY;
    mount.castShadow = true;
    scene.add(mount);
}

function createBench(x, y, z) {
    // Seat
    const seatGeo = new THREE.BoxGeometry(5, 0.3, 1.2);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.position.set(x, y + 1.5, z);
    seat.castShadow = true;
    scene.add(seat);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.2, 1.4, 1.2);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x696969 });

    const leg1 = new THREE.Mesh(legGeo, legMat);
    leg1.position.set(x - 2.3, y + 0.7, z);
    leg1.castShadow = true;
    scene.add(leg1);

    const leg2 = new THREE.Mesh(legGeo, legMat);
    leg2.position.set(x + 2.3, y + 0.7, z);
    leg2.castShadow = true;
    scene.add(leg2);
}

function setupControls() {
    const canvas = document.getElementById('canvas');

    // Pointer lock on click
    canvas.addEventListener('click', () => {
        canvas.requestPointerLock =
            canvas.requestPointerLock || canvas.mozRequestPointerLock;
        canvas.requestPointerLock();
    });

    // Mouse look - CSGO-like with proper rotation handling
    function onMouseMove(event) {
        if (
            document.pointerLockElement === canvas ||
            document.mozPointerLockElement === canvas
        ) {
            // Apply mouse sensitivity setting with proper rotation order (YXZ)
            // This ensures that yaw (left/right) rotation is applied first,
            // then pitch (up/down) is applied relative to the new orientation
            camera.rotation.y -= event.movementX * mouseSensitivity;
            camera.rotation.x -= event.movementY * mouseSensitivity;
            
            // Limit vertical look more strictly like in CSGO
            camera.rotation.x = Math.max(
                -Math.PI / 2.2,
                Math.min(Math.PI / 2.2, camera.rotation.x)
            );
        }
    }
    document.addEventListener('mousemove', onMouseMove, false);

    // WASD/Space/Shift movement - CSGO-like
    function onKeyDown(event) {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = true;
                break;
            case 'ArrowLeft':
            case 'KeyD':  // Fixed: was 'KeyD'
                moveLeft = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = true;
                break;
            case 'ArrowRight':
            case 'KeyA':  // Fixed: was 'KeyA'
                moveRight = true;
                break;
            case 'Space':
                // Space to jump (in CSGO this would be jump, but we'll keep it as up)
                moveUp = true;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                // Shift to crouch/go down (in CSGO this would be walk)
                moveDown = true;
                break;
            case 'ControlLeft':
            case 'ControlRight':
                // Ctrl to run (increased speed)
                running = true;
                break;
        }
    }

    function onKeyUp(event) {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = false;
                break;
            case 'ArrowLeft':
            case 'KeyD':  // Fixed: was 'KeyD'
                moveLeft = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = false;
                break;
            case 'ArrowRight':
            case 'KeyA':  // Fixed: was 'KeyA'
                moveRight = false;
                break;
            case 'Space':
                moveUp = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                moveDown = false;
                break;
            case 'ControlLeft':
            case 'ControlRight':
                running = false;
                break;
        }
    }

    document.addEventListener('keydown', onKeyDown, false);
    document.addEventListener('keyup', onKeyUp, false);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Add controls to start/stop training and show info
function setupControlPanel() {
    // Create control panel container
    const controlPanel = document.createElement('div');
    controlPanel.id = 'control-panel';
    controlPanel.style.position = 'absolute';
    controlPanel.style.left = '10px';
    controlPanel.style.top = '10px';
    controlPanel.style.background = 'rgba(0,0,0,0.7)';
    controlPanel.style.padding = '10px';
    controlPanel.style.borderRadius = '5px';
    controlPanel.style.color = 'white';
    controlPanel.style.fontFamily = 'Arial, sans-serif';
    
    // Create toggle training button
    const trainingButton = document.createElement('button');
    trainingButton.id = 'training-toggle';
    trainingButton.textContent = 'Start Training';
    trainingButton.style.padding = '5px 10px';
    trainingButton.style.marginRight = '10px';
    
    // Create centralized training toggle button
    const centralizedButton = document.createElement('button');
    centralizedButton.id = 'centralized-toggle';
    centralizedButton.textContent = 'Centralized: OFF';
    centralizedButton.style.padding = '5px 10px';
    centralizedButton.style.marginRight = '10px';
    
    // Create reset button
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset Drones';
    resetButton.style.padding = '5px 10px';
    resetButton.style.marginRight = '10px';
    
    // Create toggle dogfight mode button
    const dogfightButton = document.createElement('button');
    dogfightButton.id = 'dogfight-toggle';
    dogfightButton.textContent = 'Dogfight Mode: OFF';
    dogfightButton.style.padding = '5px 10px';
    
    // Create info display
    const infoDisplay = document.createElement('div');
    infoDisplay.id = 'info-display';
    infoDisplay.style.marginTop = '10px';
    infoDisplay.style.fontSize = '12px';
    infoDisplay.innerHTML = 'Status: Ready<br>Training: Not started';
    
    // Add buttons and info to control panel
    controlPanel.appendChild(trainingButton);
    controlPanel.appendChild(centralizedButton);
    controlPanel.appendChild(resetButton);
    controlPanel.appendChild(dogfightButton);
    controlPanel.appendChild(infoDisplay);
    
    // Add control panel to body
    document.body.appendChild(controlPanel);
    
    // Setup button event handlers
    trainingButton.addEventListener('click', function() {
        trainingEnabled = !trainingEnabled;
        
        if (trainingEnabled) {
            // Start training for both agents
            for (const agent of rlAgents) {
                agent.startTraining();
            }
            trainingButton.textContent = 'Stop Training';
            trainingButton.style.backgroundColor = '#f44336';
        } else {
            // Stop training for both agents
            for (const agent of rlAgents) {
                agent.stopTraining();
            }
            
            // Deactivate centralized training if active
            if (centralizedTrainer && centralizedTrainer.isActive) {
                centralizedTrainer.deactivate();
                centralizedButton.textContent = 'Centralized: OFF';
                centralizedButton.style.backgroundColor = '#4CAF50';
            }
            
            trainingButton.textContent = 'Start Training';
            trainingButton.style.backgroundColor = '#4CAF50';
        }
        
        updateInfoDisplay();
    });
    
    // Centralized training toggle
    centralizedButton.addEventListener('click', function() {
        if (!centralizedTrainer) return;
        
        // Can only toggle if training is enabled
        if (!trainingEnabled) {
            alert('Please start training first before enabling centralized training.');
            return;
        }
        
        if (centralizedTrainer.isActive) {
            centralizedTrainer.deactivate();
            centralizedButton.textContent = 'Centralized: OFF';
            centralizedButton.style.backgroundColor = '#4CAF50';
        } else {
            centralizedTrainer.activate();
            centralizedButton.textContent = 'Centralized: ON';
            centralizedButton.style.backgroundColor = '#f44336';
        }
        
        updateInfoDisplay();
    });
    
    resetButton.addEventListener('click', function() {
        resetAllDrones();
        updateInfoDisplay();
    });
    
    dogfightButton.addEventListener('click', function() {
        dogfightMode = !dogfightMode;
        
        if (dogfightMode) {
            dogfightButton.textContent = 'Dogfight Mode: ON';
            dogfightButton.style.backgroundColor = '#f44336';
        } else {
            dogfightButton.textContent = 'Dogfight Mode: OFF';
            dogfightButton.style.backgroundColor = '#4CAF50';
        }
        
        // Reset the drones to apply the new mode
        resetAllDrones();
        updateInfoDisplay();
    });
    
    // Update info display initially
    updateInfoDisplay();
}

// Update the information display with current status
function updateInfoDisplay() {
    const infoDisplay = document.getElementById('info-display');
    
    if (!infoDisplay) return;
    
    // Get status from the first RL agent (they should be in sync)
    const agent = rlAgents[0];
    
    let statusHtml = `Status: ${trainingEnabled ? 'Training' : 'Ready'}<br>`;
    statusHtml += `Episode: ${agent.episode}<br>`;
    statusHtml += `Mode: ${dogfightMode ? 'Dogfight' : 'Free Flight'}<br>`;
    
    // Add centralized training status if available
    if (centralizedTrainer) {
        statusHtml += `Centralized: ${centralizedTrainer.isActive ? 'Active' : 'Inactive'}<br>`;
    }
    
    if (trainingEnabled) {
        // Add details about exploration rate
        statusHtml += `Exploration rate: ${agent.noiseScale.toFixed(3)}<br>`;
        
        // Add most recent reward if available
        if (agent.totalRewards.length > 0) {
            const lastReward = agent.totalRewards[agent.totalRewards.length - 1];
            statusHtml += `Last episode reward: ${lastReward.toFixed(1)}<br>`;
        }
        
        // Add running average reward if available
        if (agent.runningAvgReward) {
            statusHtml += `Avg reward: ${agent.runningAvgReward.toFixed(1)}<br>`;
        }
        
        // Show training stage
        const stages = ['Basic Flight', 'Stability', 'Tracking', 'Combat'];
        statusHtml += `Stage: ${stages[agent.trainingStage]}<br>`;
        
        // Add success rate indicator
        const successRate = agent.successWindow.filter(s => s).length / Math.max(1, agent.successWindow.length);
        statusHtml += `Success rate: ${(successRate * 100).toFixed(0)}%<br>`;
    }
    
    infoDisplay.innerHTML = statusHtml;
}

function animate() {
    requestAnimationFrame(animate);
    
    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1); // Cap delta to avoid large jumps
    
    // Update each drone
    for (let i = 0; i < drones.length; i++) {
        // Skip destroyed drones until episode reset
        if (drones[i].isDestroyed) continue;
        
        // Update drone physics
        drones[i].update(delta);
        
        // Run detection on other drones
        const otherDrones = drones.filter(d => d.id !== drones[i].id);
        drones[i].detectDrones(otherDrones);
        
        // Update projectiles
        drones[i].updateProjectiles(delta, otherDrones);
    }
    
    // Update reinforcement learning for each agent
    if (trainingEnabled) {
        // Process crashed or destroyed drones first
        let needsReset = false;
        
        for (let i = 0; i < drones.length; i++) {
            if (drones[i].crashed || drones[i].isDestroyed) {
                needsReset = true;
                break;
            }
        }
        
        if (needsReset) {
            // Reset all drones for next episode
            resetAllDrones();
            
            // Skip the rest of the training update this frame
            prevTime = time;
            renderer.render(scene, camera);
            return;
        }
        
        // Apply control to all drones
        for (let i = 0; i < rlAgents.length; i++) {
            // Skip destroyed drones
            if (drones[i].isDestroyed) continue;
            
            const agent = rlAgents[i];
            
            // Always use RL for both drones when training is enabled
            agent.step(delta);
        }
        
        // Update centralized training if active
        if (centralizedTrainer && centralizedTrainer.isActive) {
            centralizedTrainer.step(delta);
        }
        
        // Update visualization and info at reduced frequency
        if (Math.floor(time / 1000) > Math.floor(prevTime / 1000)) {
            visualizer.updateCharts(rlAgents[0].getStats());
            updateInfoDisplay();
        }
    } else {
        // Add hover control for drones when not training
        for (let i = 0; i < drones.length; i++) {
            if (!drones[i].isDestroyed) {
                applyHoverControl(drones[i], delta);
            }
        }
    }
    
    // Handle camera movement for player (if needed)
    if (document.pointerLockElement === document.getElementById('canvas')) {
        // CSGO-like movement with momentum
        const friction = 10.0;
        velocity.x -= velocity.x * friction * delta;
        velocity.z -= velocity.z * friction * delta;
        velocity.y -= velocity.y * friction * delta;

        // Calculate movement direction in the camera's local space
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.y = Number(moveUp) - Number(moveDown);
        direction.normalize();

        // Adjust speed based on running state (CSGO has walk/run toggle)
        const currentSpeed = running ? moveSpeed * 1.5 : moveSpeed;

        // CSGO-like acceleration
        const acceleration = 65.0 * delta;
        
        // Calculate forward vector based on camera facing direction
        // We no longer zero out the Y component, so forward follows camera pitch
        const forwardVector = new THREE.Vector3(0, 0, -1);
        forwardVector.applyQuaternion(camera.quaternion);
        forwardVector.normalize(); // Keep normalized for consistent speed
        
        // Calculate right vector (perpendicular to world up and forward)
        const upVector = new THREE.Vector3(0, 1, 0);
        const rightVector = new THREE.Vector3();
        rightVector.crossVectors(upVector, forwardVector);
        rightVector.normalize();
        
        // Apply movement based on camera orientation, including vertical movement
        if (moveForward || moveBackward) {
            velocity.x += forwardVector.x * direction.z * acceleration;
            velocity.y += forwardVector.y * direction.z * acceleration; // Y component follows camera direction
            velocity.z += forwardVector.z * direction.z * acceleration;
        }
        
        if (moveLeft || moveRight) {
            velocity.x += rightVector.x * direction.x * acceleration;
            velocity.z += rightVector.z * direction.x * acceleration;
        }
        
        // Space/Shift still provide direct up/down movement independent of camera
        if (moveUp || moveDown) {
            velocity.y += direction.y * acceleration;
        }
        
        // Cap maximum velocity (CSGO has speed limits)
        const maxVelocity = currentSpeed;
        const currentVelocity = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
        
        if (currentVelocity > maxVelocity) {
            const scale = maxVelocity / currentVelocity;
            velocity.x *= scale;
            velocity.y *= scale;
            velocity.z *= scale;
        }

        // Apply velocity directly without rotation conversion since we've already
        // accounted for camera rotation in our movement vectors
        camera.position.x += velocity.x * delta;
        camera.position.y += velocity.y * delta;
        camera.position.z += velocity.z * delta;

        // Basic floor/ceiling clamping
        if (camera.position.y < 1) camera.position.y = 1;
        if (camera.position.y > 14) camera.position.y = 14;

        // Basic wall collision
        if (camera.position.x < -29) camera.position.x = -29;
        if (camera.position.x > 29) camera.position.x = 29;
        if (camera.position.z < -19) camera.position.z = -19;
        if (camera.position.z > 19) camera.position.z = 19;
    }

    prevTime = time;
    renderer.render(scene, camera);
}

// Add a function to provide basic hover control for non-training drones
function applyHoverControl(drone, deltaTime) {
    // Get current state
    const state = drone.getState();
    
    // Compute basic hover commands (simplified PID)
    // Target height is 5.0 (matching RL target)
    const targetHeight = 5.0;
    const heightError = targetHeight - state.position.y;
    
    // Simplistic thrust control - more thrust if too low, less if too high
    let thrust = 0.5 + (heightError * 0.05);
    thrust = Math.max(0.1, Math.min(0.9, thrust));
    
    // Attitude stabilization - try to keep level
    const rollCorrection = -state.rotation.x * 0.5;
    const pitchCorrection = -state.rotation.z * 0.5;
    
    // Apply control inputs
    drone.setControlInputs(
        rollCorrection,  // roll (stabilize)
        pitchCorrection, // pitch (stabilize)
        0,               // yaw (no rotation)
        thrust           // thrust (maintain height)
    );
}

function createDrones() {
    // Create the primary training drone (blue)
    const drone1 = new Drone(scene, { x: -10, y: 5, z: 0 }, 0x3366ff, 0);
    
    // Create the opponent drone (red)
    const drone2 = new Drone(scene, { x: 10, y: 5, z: 0 }, 0xff3333, 1);
    
    // Add to array
    drones.push(drone1);
    drones.push(drone2);
}

function initializeRL() {
    // Create RL agent for first drone, tell it about the second drone
    const rl1 = new ReinforcementLearning(drones[0], [drones[1]]);
    
    // Create RL agent for second drone, tell it about the first drone
    const rl2 = new ReinforcementLearning(drones[1], [drones[0]]);
    
    // Add to array
    rlAgents.push(rl1);
    rlAgents.push(rl2);
    
    // Initialize centralized training if multiple agents
    if (rlAgents.length > 1) {
        centralizedTrainer = new CentralizedTraining(rlAgents);
    }
    
    // Set global rl reference to first agent for backward compatibility
    rl = rl1;
}

// Add these missing functions
function resetAllDrones() {
    // Position drones at their original positions
    const positions = [
        { x: -10, y: 5, z: 0 },  // Blue drone (left side)
        { x: 10, y: 5, z: 0 }    // Red drone (right side)
    ];
    
    // Reset each drone with proper position and ensure colors are preserved
    for (let i = 0; i < drones.length; i++) {
        // Reset the drone to its proper position
        drones[i].resetWithPosition(positions[i]);
        
        // Set random horizontal rotation (yaw) for each drone
        const randomYawAngle = Math.random() * Math.PI * 2; // Random angle between 0 and 2π
        
        if (dogfightMode) {
            // In dogfight mode, add randomness but still generally face each other
            // Base angles that generally point toward each other
            const baseAngle = (i === 0) ? Math.PI / 2 : -Math.PI / 2;
            // Add some random deviation (±60°)
            const randomDeviation = (Math.random() - 0.5) * Math.PI / 3;
            drones[i].setInitialRotation(0, baseAngle + randomDeviation, 0);
        } else {
            // In regular mode, completely random orientation
            drones[i].setInitialRotation(0, randomYawAngle, 0);
        }
        
        // Also make sure the color is properly maintained
        const color = (i === 0) ? 0x3366ff : 0xff3333;
        drones[i].body.material.color.set(color);
    }
    
    // Reset RL agents - ensure BOTH agents are properly reset regardless of mode
    for (let i = 0; i < rlAgents.length; i++) {
        // Always end episode for all drones to ensure consistent state
        rlAgents[i].endEpisode();
        
        // If training is enabled, make sure both agents are in training mode
        if (trainingEnabled) {
            rlAgents[i].isTraining = true;
            
            // Ensure the same stage is applied to both agents
            if (i > 0) {
                rlAgents[i].trainingStage = rlAgents[0].trainingStage;
                rlAgents[i].windEnabled = rlAgents[0].windEnabled;
                rlAgents[i].turbulenceIntensity = rlAgents[0].turbulenceIntensity;
            }
        }
    }
    
    // Also reset centralized trainer if active
    if (centralizedTrainer && centralizedTrainer.isActive) {
        centralizedTrainer.reset();
    }
    
    console.log("All drones reset for next episode");
}

function resetDronesForCombat() {
    // Position drones for combat at opposite sides of the arena
    const positions = [
        { x: -15, y: 5, z: 0 },  // Blue drone (left side)
        { x: 15, y: 5, z: 0 }    // Red drone (right side)
    ];
    
    // Reset each drone with combat positions
    for (let i = 0; i < drones.length; i++) {
        drones[i].resetWithPosition(positions[i]);
        
        // Set initial rotation to face each other
        const rotation = (i === 0) ? Math.PI / 2 : -Math.PI / 2;
        drones[i].setInitialRotation(0, rotation, 0);
        
        // Ensure colors are maintained (redundant but safe)
        const color = (i === 0) ? 0x3366ff : 0xff3333;
        drones[i].body.material.color.set(color);
    }
    
    // If training is enabled, make sure both RL agents are active
    if (trainingEnabled) {
        // Ensure both agents are in training mode
        for (let i = 0; i < rlAgents.length; i++) {
            rlAgents[i].isTraining = true;
        }
    }
    
    console.log("Drones positioned for combat training");
}