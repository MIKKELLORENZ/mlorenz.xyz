// ═══════════════════════════════════════════════════════════════════
//  Autonomous Dogfight – Main Application
// ═══════════════════════════════════════════════════════════════════

let scene, camera, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false,
    moveUp = false, moveDown = false;
let prevTime = performance.now();
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let mouseSensitivity = 0.0015;
let moveSpeed = 12.0;
let running = false;

// Simulation
let drones = [];
let rlAgents = [];
let visualizer;
let trainingEnabled = false;
let centralizedTrainer;
let trainingSpeed = 1; // 1×, 5×, 20×

// Drone spawn configuration (2v2)
const DRONE_SPAWNS = [
    { pos: { x: -12, y: 5, z: -5 }, color: 0x3366ff, team: 0 },
    { pos: { x: -12, y: 5, z:  5 }, color: 0x3388ff, team: 0 },
    { pos: { x:  12, y: 5, z: -5 }, color: 0xff3333, team: 1 },
    { pos: { x:  12, y: 5, z:  5 }, color: 0xff5533, team: 1 },
];

// Mobile detection
const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// Texture URLs
const textureURLs = {
    ceiling: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/ceiling_1.png',
    wall: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/gym_wall_indoor_1.png',
    floor: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/gym_floor_1.png',
    grass: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/grass_1.png',
    sky: 'https://raw.githubusercontent.com/MIKKELLORENZ/textures/main/sky_1.png'
};

// Make globals accessible
window.trainingEnabled = false;
window.drones = drones;

init();
animate();

function init() {
    scene = new THREE.Scene();
    
    const textureLoader = new THREE.TextureLoader();
    const skyTexture = textureLoader.load(textureURLs.sky);
    scene.background = skyTexture;

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(15, 10, 15);
    camera.rotation.order = 'YXZ';
    camera.lookAt(0, 5, 0);

    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('canvas'),
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;

    addLighting();
    createOutdoorEnvironment();
    createGymHall();
    createDrones();
    initializeRL();
    
    visualizer = new TrainingVisualizer();
    setupControlPanel();
    setupControls();

    if (isMobile) {
        document.body.classList.add('mobile');
        setupTouchControls();
    }

    window.addEventListener('resize', onWindowResize, false);
}

// ─── Lighting (performance-tuned — only 1 shadow-casting light) ──
function addLighting() {
    // Hemisphere: muted sky above, warm floor bounce below
    const hemiLight = new THREE.HemisphereLight(0x7799bb, 0x665544, 0.35);
    scene.add(hemiLight);

    // Low ambient to fill deep shadows
    const ambientLight = new THREE.AmbientLight(0xeeeeff, 0.15);
    scene.add(ambientLight);

    // Single directional shadow light — warm indirect sunlight
    const dirLight = new THREE.DirectionalLight(0xfff0d8, 0.6);
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

    // Overhead fill lights – NO shadows (cheap)
    const rows = 2, cols = 3;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const overhead = new THREE.PointLight(0xfff8e8, 0.18, 35);
            overhead.position.set(-20 + c * 20, 14.5, -10 + r * 20);
            // castShadow = false (default) — massive GPU savings
            scene.add(overhead);
        }
    }
}

// ─── Environment ─────────────────────────────────────────────────
function createOutdoorEnvironment() {
    const textureLoader = new THREE.TextureLoader();
    const grassTex = textureLoader.load(textureURLs.grass);
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(30, 30);
    
    const grass = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ map: grassTex, side: THREE.DoubleSide })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.1;
    grass.receiveShadow = true;
    scene.add(grass);

    // ── Concrete path around building (single merged plane) ──
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x999990, roughness: 0.9 });
    const pathN = new THREE.Mesh(new THREE.PlaneGeometry(66, 4), pathMat);
    pathN.rotation.x = -Math.PI / 2; pathN.position.set(0, -0.05, -23);
    pathN.receiveShadow = true; scene.add(pathN);
    const pathS = new THREE.Mesh(new THREE.PlaneGeometry(66, 4), pathMat);
    pathS.rotation.x = -Math.PI / 2; pathS.position.set(0, -0.05, 23);
    pathS.receiveShadow = true; scene.add(pathS);
    const pathW = new THREE.Mesh(new THREE.PlaneGeometry(4, 50), pathMat);
    pathW.rotation.x = -Math.PI / 2; pathW.position.set(-33, -0.05, 0);
    pathW.receiveShadow = true; scene.add(pathW);
    const pathE = new THREE.Mesh(new THREE.PlaneGeometry(4, 50), pathMat);
    pathE.rotation.x = -Math.PI / 2; pathE.position.set(33, -0.05, 0);
    pathE.receiveShadow = true; scene.add(pathE);

    // ── Simple low-poly trees (shared geometry + material) ──
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 4, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21 });
    const canopyGeo = new THREE.SphereGeometry(2.2, 6, 5);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2d6b2d, flatShading: true });

    const treePositions = [
        [-40, 0, -10], [-40, 0, 10], [40, 0, -10], [40, 0, 10],
        [-20, 0, -28], [0, 0, -30], [20, 0, -28],
        [-20, 0, 28], [0, 0, 30], [20, 0, 28],
        [-50, 0, 0], [50, 0, 0], [-45, 0, -25], [45, 0, 25]
    ];
    for (const [tx, ty, tz] of treePositions) {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(tx, ty + 2, tz);
        trunk.castShadow = false;
        scene.add(trunk);
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        // Slight random scale for variety (no extra draw calls)
        const s = 0.8 + Math.abs(Math.sin(tx * tz)) * 0.6;
        canopy.scale.set(s, s * 0.9, s);
        canopy.position.set(tx, ty + 5, tz);
        canopy.castShadow = false;
        scene.add(canopy);
    }

    // ── Building exterior trim / roof edge (single dark strip) ──
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const trimGeo = new THREE.BoxGeometry(62, 0.4, 0.4);
    const trimN = new THREE.Mesh(trimGeo, trimMat);
    trimN.position.set(0, 15.2, -20); scene.add(trimN);
    const trimS = new THREE.Mesh(trimGeo, trimMat);
    trimS.position.set(0, 15.2, 20); scene.add(trimS);
    const trimSideGeo = new THREE.BoxGeometry(0.4, 0.4, 40.8);
    const trimW = new THREE.Mesh(trimSideGeo, trimMat);
    trimW.position.set(-30, 15.2, 0); scene.add(trimW);
    const trimE = new THREE.Mesh(trimSideGeo, trimMat);
    trimE.position.set(30, 15.2, 0); scene.add(trimE);
}

function createGymHall() {
    const textureLoader = new THREE.TextureLoader();
    function loadRepeatTexture(url, rx = 1, ry = 1) {
        const tex = textureLoader.load(url);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(rx, ry);
        return tex;
    }

    // Floor (polished wood — slight reflectivity)
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        new THREE.MeshStandardMaterial({ map: loadRepeatTexture(textureURLs.floor, 6, 4), roughness: 0.65, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Ceiling (matches 60×40 footprint)
    const ceiling = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        new THREE.MeshStandardMaterial({ map: loadRepeatTexture(textureURLs.ceiling, 6, 4), roughness: 0.85, metalness: 0.0 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 15;
    scene.add(ceiling);

    const wallTex = loadRepeatTexture(textureURLs.wall, 6, 1);
    createWallWithWindows(0, 7.5, -20, 60, 15, 0, wallTex);
    createWallWithWindows(0, 7.5, 20, 60, 15, Math.PI, wallTex);
    createWallWithWindows(-30, 7.5, 0, 40, 15, Math.PI / 2, wallTex);
    createWallWithWindows(30, 7.5, 0, 40, 15, -Math.PI / 2, wallTex);

    createBasketballHoop(0, 0, -19, 0);
    createBasketballHoop(0, 0, 19, Math.PI);

    createBench(-25, 0, 18);
    createBench(-15, 0, 18);
    createBench(15, 0, 18);
    createBench(25, 0, 18);
    createGymEquipment();
    createCourtMarkings();
    createCeilingDetails();
}

// ─── Court Floor Markings ─────────────────────────────────────────
function createCourtMarkings() {
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xcc6633, roughness: 0.9 }); // sport-orange
    const lineW = 0.10; // line width
    const lineH = 0.005; // paper-thin, no z-fighting

    // Outer boundary rectangle
    const bW = 40, bD = 36; // court boundary
    const addLine = (w, h, d, px, py, pz) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lineMat);
        m.position.set(px, py, pz); scene.add(m);
    };
    addLine(bW, lineH, lineW, 0, 0.005, -bD / 2);  // north
    addLine(bW, lineH, lineW, 0, 0.005,  bD / 2);  // south
    addLine(lineW, lineH, bD, -bW / 2, 0.005, 0);  // west
    addLine(lineW, lineH, bD,  bW / 2, 0.005, 0);  // east

    // Center line
    addLine(bW, lineH, lineW, 0, 0.005, 0);

    // Center circle
    const circle = new THREE.Mesh(
        new THREE.TorusGeometry(3, 0.05, 4, 40),
        lineMat
    );
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(0, 0.005, 0);
    scene.add(circle);

    // Key / paint area at each end (rectangle)
    const keyW = 6, keyD = 5.8;
    for (const zSign of [-1, 1]) {
        const kz = zSign * (bD / 2 - keyD / 2);
        addLine(keyW, lineH, lineW, 0, 0.005, zSign * bD / 2 - zSign * keyD); // free-throw line
        addLine(lineW, lineH, keyD, -keyW / 2, 0.005, kz); // left lane
        addLine(lineW, lineH, keyD,  keyW / 2, 0.005, kz); // right lane

        // Free-throw arc
        const arc = new THREE.Mesh(
            new THREE.TorusGeometry(keyW / 2, 0.05, 4, 20, Math.PI),
            lineMat
        );
        arc.rotation.x = -Math.PI / 2;
        arc.rotation.z = zSign > 0 ? Math.PI : 0;
        arc.position.set(0, 0.005, zSign * bD / 2 - zSign * keyD);
        scene.add(arc);

        // Three-point arc (larger)
        const tpArc = new THREE.Mesh(
            new THREE.TorusGeometry(9, 0.05, 4, 28, Math.PI * 0.75),
            lineMat
        );
        tpArc.rotation.x = -Math.PI / 2;
        tpArc.rotation.z = zSign > 0 ? Math.PI + Math.PI * 0.125 : -Math.PI * 0.125;
        tpArc.position.set(0, 0.005, zSign * (bD / 2 - 1.2));
        scene.add(tpArc);
    }
}

// ─── Ceiling Details ──────────────────────────────────────────────
function createCeilingDetails() {
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.5, roughness: 0.5 });

    // I-beam rafters spanning the width (web + flanges)
    for (let z = -15; z <= 15; z += 10) {
        // Web (vertical)
        const web = new THREE.Mesh(new THREE.BoxGeometry(60, 0.6, 0.08), beamMat);
        web.position.set(0, 14.55, z); scene.add(web);
        // Top flange
        const flgT = new THREE.Mesh(new THREE.BoxGeometry(60, 0.08, 0.3), beamMat);
        flgT.position.set(0, 14.85, z); scene.add(flgT);
        // Bottom flange
        const flgB = new THREE.Mesh(new THREE.BoxGeometry(60, 0.08, 0.3), beamMat);
        flgB.position.set(0, 14.25, z); scene.add(flgB);
    }

    // Longitudinal purlins
    const purlinGeo = new THREE.BoxGeometry(0.1, 0.2, 40);
    for (let x = -25; x <= 25; x += 10) {
        const purlin = new THREE.Mesh(purlinGeo, beamMat);
        purlin.position.set(x, 14.9, 0); scene.add(purlin);
    }

    // Overhead light housings (rectangular fixtures with warm glow)
    const fixtureMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.3, roughness: 0.4 });
    const diffuserMat = new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xfff0d0, emissiveIntensity: 0.3, transparent: true, opacity: 0.85 });
    const fixtureGeo = new THREE.BoxGeometry(1.8, 0.1, 0.6);
    const diffuserGeo = new THREE.BoxGeometry(1.6, 0.02, 0.5);
    for (let x = -20; x <= 20; x += 20) {
        for (let z = -10; z <= 10; z += 20) {
            const housing = new THREE.Mesh(fixtureGeo, fixtureMat);
            housing.position.set(x, 14.2, z); scene.add(housing);
            const diffuser = new THREE.Mesh(diffuserGeo, diffuserMat);
            diffuser.position.set(x, 14.14, z); scene.add(diffuser);
        }
    }

    // Wall kickboard (dark wood trim at base of all walls)
    const kickMat = new THREE.MeshStandardMaterial({ color: 0x30221a, roughness: 0.8 });
    const kickH = 0.8;
    const kickGeoW = new THREE.BoxGeometry(60.4, kickH, 0.12);
    const kickGeoS = new THREE.BoxGeometry(0.12, kickH, 40.4);
    const kickN = new THREE.Mesh(kickGeoW, kickMat);
    kickN.position.set(0, kickH / 2, -19.92); scene.add(kickN);
    const kickS = new THREE.Mesh(kickGeoW, kickMat);
    kickS.position.set(0, kickH / 2, 19.92); scene.add(kickS);
    const kickW = new THREE.Mesh(kickGeoS, kickMat);
    kickW.position.set(-29.92, kickH / 2, 0); scene.add(kickW);
    const kickE = new THREE.Mesh(kickGeoS, kickMat);
    kickE.position.set(29.92, kickH / 2, 0); scene.add(kickE);

    // Exit signs (green emissive, two walls)
    const exitMat = new THREE.MeshStandardMaterial({ color: 0x00aa33, emissive: 0x00aa33, emissiveIntensity: 0.6 });
    const exitGeo = new THREE.BoxGeometry(1.0, 0.35, 0.04);
    const exitSign = new THREE.Mesh(exitGeo, exitMat);
    exitSign.position.set(28, 13.5, -19.82); scene.add(exitSign);
    const exitSign2 = new THREE.Mesh(exitGeo, exitMat);
    exitSign2.position.set(-28, 13.5, 19.82); scene.add(exitSign2);
}

function createWallWithWindows(x, y, z, width, height, rotationY, wallTexture) {
    const numSections = 3;
    const sectionWidth = width / numSections;
    const windowWidth = sectionWidth * 0.6;
    const windowHeight = 4;
    const windowY = 8;
    
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.85, metalness: 0.0 });
    
    const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(width, windowY - windowHeight / 2, 0.3), wallMat);
    lowerWall.position.set(x, (windowY - windowHeight / 2) / 2, z);
    lowerWall.rotation.y = rotationY;
    lowerWall.castShadow = true;
    lowerWall.receiveShadow = true;
    scene.add(lowerWall);
    
    const upperWall = new THREE.Mesh(new THREE.BoxGeometry(width, height - (windowY + windowHeight / 2), 0.3), wallMat);
    upperWall.position.set(x, windowY + windowHeight / 2 + (height - (windowY + windowHeight / 2)) / 2, z);
    upperWall.rotation.y = rotationY;
    upperWall.castShadow = true;
    upperWall.receiveShadow = true;
    scene.add(upperWall);
    
    for (let i = 0; i < numSections - 1; i++) {
        const windowX = -width / 2 + sectionWidth / 2 + sectionWidth * (i + 1);
        
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xd4e8f0, transparent: true, opacity: 0.25,
            roughness: 0.05, metalness: 0.1, transmission: 0.92
        });
        const windowPane = new THREE.Mesh(new THREE.BoxGeometry(windowWidth, windowHeight, 0.1), glassMat);
        
        let offsetX = 0, offsetZ = 0;
        if (rotationY === 0) { offsetX = windowX; }
        else if (rotationY === Math.PI) { offsetX = -windowX; }
        else if (rotationY === Math.PI / 2) { offsetZ = windowX; }
        else if (rotationY === -Math.PI / 2) { offsetZ = -windowX; }
        
        windowPane.position.set(x + offsetX, windowY, z + offsetZ);
        windowPane.rotation.y = rotationY;
        windowPane.receiveShadow = true;
        scene.add(windowPane);
        
        // Window frame outer border
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.7 });
        const fOuter = new THREE.Mesh(
            new THREE.BoxGeometry(windowWidth + 0.3, windowHeight + 0.3, 0.18),
            frameMat
        );
        fOuter.position.set(x + offsetX, windowY, z + offsetZ);
        fOuter.rotation.y = rotationY;
        fOuter.castShadow = true;
        fOuter.receiveShadow = true;
        scene.add(fOuter);

        // Mullion cross bars (vertical + horizontal dividers)
        const mullionMat = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.6 });
        const mullionV = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, windowHeight, 0.12),
            mullionMat
        );
        mullionV.position.set(x + offsetX, windowY, z + offsetZ);
        mullionV.rotation.y = rotationY;
        scene.add(mullionV);
        const mullionH = new THREE.Mesh(
            new THREE.BoxGeometry(windowWidth, 0.06, 0.12),
            mullionMat
        );
        mullionH.position.set(x + offsetX, windowY, z + offsetZ);
        mullionH.rotation.y = rotationY;
        scene.add(mullionH);

        // Window sill (small ledge below window)
        const sillMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7, metalness: 0.1 });
        const sill = new THREE.Mesh(
            new THREE.BoxGeometry(windowWidth + 0.4, 0.08, 0.35),
            sillMat
        );
        const sillY = windowY - windowHeight / 2 - 0.04;
        sill.position.set(x + offsetX, sillY, z + offsetZ);
        sill.rotation.y = rotationY;
        scene.add(sill);
        
        // Window light – NO shadow casting (perf fix)
        let lightX = 0, lightZ = 0;
        if (rotationY === 0) { lightX = x + windowX; lightZ = z + 0.5; }
        else if (rotationY === Math.PI) { lightX = x - windowX; lightZ = z - 0.5; }
        else if (rotationY === Math.PI / 2) { lightX = x + 0.5; lightZ = z + windowX; }
        else if (rotationY === -Math.PI / 2) { lightX = x - 0.5; lightZ = z - windowX; }
        
        const windowLight = new THREE.SpotLight(0xfff8e0, 0.3);
        windowLight.position.set(lightX, windowY, lightZ);
        windowLight.target.position.set(x, windowY, z);
        windowLight.angle = Math.PI / 6;
        windowLight.penumbra = 0.5;
        windowLight.decay = 2;
        windowLight.distance = 30;
        // castShadow = false (default) — saves GPU
        scene.add(windowLight);
        scene.add(windowLight.target);
    }
}

function createGymEquipment() {
    const matMat = new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.95, metalness: 0.0 });
    const matBorder = new THREE.MeshStandardMaterial({ color: 0x1a4488, roughness: 0.9 });

    function createGymMat(px, py, pz) {
        // Main pad
        const pad = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.25, 4.6), matMat);
        pad.position.set(px, py + 0.125 + 0.04, pz);
        pad.receiveShadow = true; scene.add(pad);
        // Edge border (darker, slightly larger)
        const border = new THREE.Mesh(new THREE.BoxGeometry(8, 0.04, 5), matBorder);
        border.position.set(px, py + 0.02, pz);
        border.receiveShadow = true; scene.add(border);
        // Center stitching line
        const stitch = new THREE.Mesh(
            new THREE.BoxGeometry(7.4, 0.005, 0.03),
            new THREE.MeshStandardMaterial({ color: 0x4488cc, roughness: 0.8 })
        );
        stitch.position.set(px, py + 0.3, pz);
        scene.add(stitch);
    }

    createGymMat(-25, 0, -15);
    createGymMat(25, 0, -15);
    
    createVaultingHorse(-20, 0, 0);
    createWallBars(28, 0, -15);
}

function createWallBars(x, y, z) {
    const frameH = 8, frameW = 2.4;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.75 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0x9b6a3c, roughness: 0.6, metalness: 0.05 });

    // Two vertical side uprights (not a solid rectangle)
    const uprightGeo = new THREE.BoxGeometry(0.12, frameH, 0.12);
    const upL = new THREE.Mesh(uprightGeo, woodMat);
    upL.position.set(x - frameW / 2, y + frameH / 2, z - 0.06);
    upL.castShadow = true; scene.add(upL);
    const upR = new THREE.Mesh(uprightGeo, woodMat);
    upR.position.set(x + frameW / 2, y + frameH / 2, z - 0.06);
    upR.castShadow = true; scene.add(upR);

    // Horizontal rungs (round dowels)
    const barGeo = new THREE.CylinderGeometry(0.04, 0.04, frameW, 10);
    for (let i = 1; i <= 10; i++) {
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(x, y + i * (frameH / 11), z - 0.06);
        bar.castShadow = true;
        scene.add(bar);
    }
}

function createVaultingHorse(x, y, z) {
    const legHeight = 0.8;
    const bodyH = 1.0;
    const bodyTop = legHeight + bodyH;

    // Rounded body (cylinder on its side)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a4020, roughness: 0.7, metalness: 0.05 });
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 4.5, 12),
        bodyMat
    );
    body.rotation.x = Math.PI / 2;
    body.position.set(x, y + legHeight + 0.55, z);
    body.castShadow = true;
    scene.add(body);

    // Leather top pad
    const padMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.85 });
    const pad = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.12, 4.6),
        padMat
    );
    pad.position.set(x, y + legHeight + 1.1 + 0.06, z);
    pad.castShadow = true;
    scene.add(pad);

    // Metal legs with rubber feet
    const legMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.6, roughness: 0.4 });
    const footMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const legGeo = new THREE.CylinderGeometry(0.06, 0.06, legHeight, 8);
    const footGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8);
    [[-0.4, -1.8], [0.4, -1.8], [-0.4, 1.8], [0.4, 1.8]].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(x + lx, y + legHeight / 2, z + lz);
        leg.castShadow = true; scene.add(leg);
        const foot = new THREE.Mesh(footGeo, footMat);
        foot.position.set(x + lx, y + 0.02, z + lz);
        scene.add(foot);
    });
}

function createBasketballHoop(x, y, z, rotationY) {
    // Direction vector pointing inward from wall
    const inward = (rotationY === 0) ? 1 : -1; // +z faces into gym from north wall, -z from south
    const bZ = z + inward * 0.15; // backboard flush near wall
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5, roughness: 0.4 });
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0xff4500, metalness: 0.3, roughness: 0.5 });

    // Backboard (white with target square)
    const backboard = new THREE.Mesh(
        new THREE.BoxGeometry(3, 2, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 })
    );
    backboard.position.set(x, 10, bZ);
    backboard.castShadow = true; scene.add(backboard);

    // Target square (painted on backboard face)
    const targetMat = new THREE.MeshStandardMaterial({ color: 0xff4500, roughness: 0.7 });
    const tW = 0.06, tD = 0.8;
    const tZ = bZ + inward * 0.06;
    const tTop = new THREE.Mesh(new THREE.BoxGeometry(tD, tW, 0.01), targetMat);
    tTop.position.set(x, 10.3, tZ); scene.add(tTop);
    const tBot = new THREE.Mesh(new THREE.BoxGeometry(tD, tW, 0.01), targetMat);
    tBot.position.set(x, 9.7, tZ); scene.add(tBot);
    const tLeft = new THREE.Mesh(new THREE.BoxGeometry(tW, 0.6, 0.01), targetMat);
    tLeft.position.set(x - 0.4, 10, tZ); scene.add(tLeft);
    const tRight = new THREE.Mesh(new THREE.BoxGeometry(tW, 0.6, 0.01), targetMat);
    tRight.position.set(x + 0.4, 10, tZ); scene.add(tRight);

    // Hoop (horizontal ring)
    const hoopZ = bZ + inward * 0.65;
    const hoop = new THREE.Mesh(
        new THREE.TorusGeometry(0.45, 0.03, 10, 24),
        hoopMat
    );
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(x, 9.2, hoopZ);
    hoop.castShadow = true; scene.add(hoop);

    // Support bracket (L-shaped arm from backboard to hoop)
    const armH = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.65), metalMat);
    armH.position.set(x, 9.5, bZ + inward * 0.32);
    armH.castShadow = true; scene.add(armH);
    const armV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.06), metalMat);
    armV.position.set(x, 9.35, bZ + inward * 0.05);
    armV.castShadow = true; scene.add(armV);

    // Net (tapered wireframe cylinder)
    const net = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.2, 0.7, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, wireframe: true, transparent: true, opacity: 0.5 })
    );
    net.position.set(x, 8.85, hoopZ);
    scene.add(net);

    // Wall mount plate
    const mountPlate = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 2.4, 0.08),
        metalMat
    );
    mountPlate.position.set(x, 10, z + inward * 0.04);
    mountPlate.castShadow = true; scene.add(mountPlate);
}

function createBench(x, y, z) {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.75 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.5, roughness: 0.4 });
    const seatH = 1.4;

    // Seat planks (3 slats instead of 1 solid block)
    const slatGeo = new THREE.BoxGeometry(4.8, 0.08, 0.35);
    for (let i = 0; i < 3; i++) {
        const slat = new THREE.Mesh(slatGeo, woodMat);
        slat.position.set(x, y + seatH + 0.04, z + (i - 1) * 0.38);
        slat.castShadow = true; scene.add(slat);
    }

    // Metal frame legs (A-frame style on each end)
    const legGeo = new THREE.BoxGeometry(0.08, seatH, 0.08);
    const crossGeo = new THREE.BoxGeometry(0.06, 0.06, 1.1);
    for (const sx of [-2.2, 2.2]) {
        // Two angled legs per side
        const legF = new THREE.Mesh(legGeo, metalMat);
        legF.position.set(x + sx, y + seatH / 2, z - 0.4);
        legF.castShadow = true; scene.add(legF);
        const legR = new THREE.Mesh(legGeo, metalMat);
        legR.position.set(x + sx, y + seatH / 2, z + 0.4);
        legR.castShadow = true; scene.add(legR);
        // Cross brace
        const cross = new THREE.Mesh(crossGeo, metalMat);
        cross.position.set(x + sx, y + seatH * 0.4, z);
        scene.add(cross);
    }

    // Rubber feet
    const footGeo = new THREE.BoxGeometry(0.12, 0.04, 0.12);
    const footMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    for (const sx of [-2.2, 2.2]) {
        for (const sz of [-0.4, 0.4]) {
            const foot = new THREE.Mesh(footGeo, footMat);
            foot.position.set(x + sx, y + 0.02, z + sz);
            scene.add(foot);
        }
    }
}

// ─── Controls ────────────────────────────────────────────────────
function setupControls() {
    const canvas = document.getElementById('canvas');

    if (!isMobile) {
        canvas.addEventListener('click', () => {
            canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock;
            canvas.requestPointerLock();
        });
    }

    document.addEventListener('mousemove', (event) => {
        if (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas) {
            camera.rotation.y -= event.movementX * mouseSensitivity;
            camera.rotation.x -= event.movementY * mouseSensitivity;
            camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));
        }
    }, false);

    // FIXED: A/D key swap corrected — A=left, D=right
    document.addEventListener('keydown', (event) => {
        switch (event.code) {
            case 'ArrowUp': case 'KeyW': moveForward = true; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
            case 'ArrowDown': case 'KeyS': moveBackward = true; break;
            case 'ArrowRight': case 'KeyD': moveRight = true; break;
            case 'Space': moveUp = true; break;
            case 'ShiftLeft': case 'ShiftRight': moveDown = true; break;
            case 'ControlLeft': case 'ControlRight': running = true; break;
        }
    }, false);

    document.addEventListener('keyup', (event) => {
        switch (event.code) {
            case 'ArrowUp': case 'KeyW': moveForward = false; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
            case 'ArrowDown': case 'KeyS': moveBackward = false; break;
            case 'ArrowRight': case 'KeyD': moveRight = false; break;
            case 'Space': moveUp = false; break;
            case 'ShiftLeft': case 'ShiftRight': moveDown = false; break;
            case 'ControlLeft': case 'ControlRight': running = false; break;
        }
    }, false);
}

// ─── Mobile Touch Joysticks ──────────────────────────────────────
function setupTouchControls() {
    const leftZone = document.getElementById('joystick-left');
    const rightZone = document.getElementById('joystick-right');
    if (!leftZone || !rightZone) return;
    
    const thumbL = leftZone.querySelector('.joystick-thumb');
    const thumbR = rightZone.querySelector('.joystick-thumb');
    
    let leftTouch = null, rightTouch = null;
    let leftOrigin = null, rightOrigin = null;
    const maxDist = 40;
    
    function handleStart(e) {
        for (const t of e.changedTouches) {
            const x = t.clientX;
            if (x < window.innerWidth / 2) {
                leftTouch = t.identifier;
                leftOrigin = { x: t.clientX, y: t.clientY };
            } else {
                rightTouch = t.identifier;
                rightOrigin = { x: t.clientX, y: t.clientY };
            }
        }
        e.preventDefault();
    }
    
    function handleMove(e) {
        for (const t of e.changedTouches) {
            if (t.identifier === leftTouch && leftOrigin) {
                const dx = Math.max(-maxDist, Math.min(maxDist, t.clientX - leftOrigin.x));
                const dy = Math.max(-maxDist, Math.min(maxDist, t.clientY - leftOrigin.y));
                thumbL.style.transform = `translate(${dx}px, ${dy}px)`;
                
                // Movement
                moveForward = dy < -10;
                moveBackward = dy > 10;
                moveLeft = dx < -10;
                moveRight = dx > 10;
            }
            if (t.identifier === rightTouch && rightOrigin) {
                const dx = t.clientX - rightOrigin.x;
                const dy = t.clientY - rightOrigin.y;
                const clampDx = Math.max(-maxDist, Math.min(maxDist, dx));
                const clampDy = Math.max(-maxDist, Math.min(maxDist, dy));
                thumbR.style.transform = `translate(${clampDx}px, ${clampDy}px)`;
                
                // Camera look
                camera.rotation.y -= dx * 0.001;
                camera.rotation.x -= dy * 0.001;
                camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));
                rightOrigin = { x: t.clientX, y: t.clientY };
            }
        }
        e.preventDefault();
    }
    
    function handleEnd(e) {
        for (const t of e.changedTouches) {
            if (t.identifier === leftTouch) {
                leftTouch = null;
                leftOrigin = null;
                thumbL.style.transform = '';
                moveForward = moveBackward = moveLeft = moveRight = false;
            }
            if (t.identifier === rightTouch) {
                rightTouch = null;
                rightOrigin = null;
                thumbR.style.transform = '';
            }
        }
        e.preventDefault();
    }
    
    document.addEventListener('touchstart', handleStart, { passive: false });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd, { passive: false });
    document.addEventListener('touchcancel', handleEnd, { passive: false });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ─── Control Panel (using CSS classes from style.css) ────────────
function setupControlPanel() {
    const controlPanel = document.createElement('div');
    controlPanel.id = 'control-panel';
    
    // Button row
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    
    const trainingBtn = document.createElement('button');
    trainingBtn.id = 'training-toggle';
    trainingBtn.textContent = 'Start Training';
    
    const centralizedBtn = document.createElement('button');
    centralizedBtn.id = 'centralized-toggle';
    centralizedBtn.textContent = 'Centralized: OFF';
    
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Drones';
    
    btnRow.append(trainingBtn, centralizedBtn, resetBtn);
    controlPanel.appendChild(btnRow);
    
    // Speed slider row
    const speedRow = document.createElement('div');
    speedRow.className = 'btn-row';
    speedRow.style.alignItems = 'center';
    
    const speedLabel = document.createElement('label');
    speedLabel.textContent = 'Speed: 1×';
    speedLabel.id = 'speed-label';
    speedLabel.style.color = '#ccc';
    speedLabel.style.fontSize = '12px';
    speedLabel.style.marginRight = '8px';
    
    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.id = 'speed-slider';
    speedSlider.min = '1';
    speedSlider.max = '20';
    speedSlider.value = '1';
    speedSlider.style.flex = '1';
    
    speedRow.append(speedLabel, speedSlider);
    controlPanel.appendChild(speedRow);
    
    // Info display
    const infoDisplay = document.createElement('div');
    infoDisplay.id = 'info-display';
    infoDisplay.innerHTML = 'Status: Ready<br>Training: Not started';
    controlPanel.appendChild(infoDisplay);
    
    // Episode counter (prominent)
    const episodeCounter = document.createElement('div');
    episodeCounter.id = 'episode-counter';
    episodeCounter.innerHTML = '<span class="ep-label">EPISODE</span><span class="ep-value" id="ep-count">0</span>';
    controlPanel.appendChild(episodeCounter);
    
    document.body.appendChild(controlPanel);
    
    // Speed slider handler
    speedSlider.addEventListener('input', () => {
        trainingSpeed = parseInt(speedSlider.value);
        speedLabel.textContent = `Speed: ${trainingSpeed}×`;
    });
    
    // Training toggle
    trainingBtn.addEventListener('click', () => {
        trainingEnabled = !trainingEnabled;
        window.trainingEnabled = trainingEnabled;
        
        if (trainingEnabled) {
            for (const agent of rlAgents) agent.startTraining();
            trainingBtn.textContent = 'Stop Training';
            trainingBtn.classList.add('danger');
        } else {
            for (const agent of rlAgents) agent.stopTraining();
            if (centralizedTrainer && centralizedTrainer.isActive) {
                centralizedTrainer.deactivate();
                centralizedBtn.textContent = 'Centralized: OFF';
                centralizedBtn.classList.remove('active');
            }
            trainingBtn.textContent = 'Start Training';
            trainingBtn.classList.remove('danger');
        }
        updateInfoDisplay();
    });
    
    // Centralized toggle
    centralizedBtn.addEventListener('click', () => {
        if (!centralizedTrainer) return;
        if (!trainingEnabled) { alert('Start training first.'); return; }
        
        if (centralizedTrainer.isActive) {
            centralizedTrainer.deactivate();
            centralizedBtn.textContent = 'Centralized: OFF';
            centralizedBtn.classList.remove('active');
        } else {
            centralizedTrainer.activate();
            centralizedBtn.textContent = 'Centralized: ON';
            centralizedBtn.classList.add('active');
        }
        updateInfoDisplay();
    });
    
    resetBtn.addEventListener('click', () => { resetAllDrones(); updateInfoDisplay(); });
    
    updateInfoDisplay();
}

function updateInfoDisplay() {
    const infoDisplay = document.getElementById('info-display');
    if (!infoDisplay || rlAgents.length === 0) return;
    
    // Aggregate stats across all agents
    const maxEpisode = Math.max(...rlAgents.map(a => a.episode));
    const avgExploration = rlAgents.reduce((s, a) => s + a.noiseScale, 0) / rlAgents.length;
    const totalEpisodes = rlAgents.reduce((s, a) => s + a.episode, 0);
    
    // Update episode counter (total across all agents)
    const epCount = document.getElementById('ep-count');
    if (epCount) epCount.textContent = totalEpisodes;
    
    let html = `Status: ${trainingEnabled ? '<b style="color:#00c8ff">Training</b>' : 'Ready'}<br>`;
    html += `Drones: ${drones.length} (${drones.filter(d => d.team === 0).length}v${drones.filter(d => d.team === 1).length})<br>`;
    
    if (centralizedTrainer) html += `Centralized: ${centralizedTrainer.isActive ? '<b style="color:#00c8ff">Active</b>' : 'Off'}<br>`;
    
    if (trainingEnabled) {
        html += `Exploration: ${avgExploration.toFixed(3)}<br>`;
        // Best running average across agents
        const bestAvg = Math.max(...rlAgents.map(a => a.runningAvgReward || 0));
        const latestRewards = rlAgents.filter(a => a.totalRewards.length > 0).map(a => a.totalRewards[a.totalRewards.length - 1]);
        if (latestRewards.length > 0) {
            html += `Last Reward: ${(latestRewards.reduce((s,v) => s+v, 0) / latestRewards.length).toFixed(1)}<br>`;
        }
        if (bestAvg) html += `Best Avg Reward: <b>${bestAvg.toFixed(1)}</b><br>`;
        const avgSR = rlAgents.reduce((s, a) => s + a.successWindow.filter(x => x).length / Math.max(1, a.successWindow.length), 0) / rlAgents.length;
        html += `Success: ${(avgSR * 100).toFixed(0)}%<br>`;
        const totalBuffer = rlAgents.reduce((s, a) => s + a.replayBuffer.length, 0);
        html += `Buffer: ${totalBuffer.toLocaleString()}<br>`;
        // Aggregate kills/deaths
        const totalKills = rlAgents.reduce((s, a) => s + a.kills, 0);
        const totalDeaths = rlAgents.reduce((s, a) => s + a.deaths, 0);
        html += `Total K/D: ${totalKills}/${totalDeaths}<br>`;
        html += `Speed: ${trainingSpeed}×`;
    }
    
    infoDisplay.innerHTML = html;
}

// ─── Scoreboard HUD Update ───────────────────────────────────────
function updateScoreboard() {
    if (drones.length < 2 || rlAgents.length < 2) return;
    
    // Team health = average of alive team members
    const blueTeam = drones.filter(d => d.team === 0);
    const redTeam  = drones.filter(d => d.team === 1);
    const blueHP = blueTeam.reduce((s, d) => s + Math.max(0, d.health), 0) / blueTeam.length;
    const redHP  = redTeam.reduce((s, d) => s + Math.max(0, d.health), 0) / redTeam.length;
    
    const bh = document.querySelector('.blue-health');
    const rh = document.querySelector('.red-health');
    if (bh) bh.style.width = blueHP + '%';
    if (rh) rh.style.width = redHP + '%';
    
    // Team kills/deaths
    const blueAgents = rlAgents.filter((_, i) => drones[i] && drones[i].team === 0);
    const redAgents  = rlAgents.filter((_, i) => drones[i] && drones[i].team === 1);
    const bk = document.getElementById('blue-kills');
    const bd = document.getElementById('blue-deaths');
    const rk = document.getElementById('red-kills');
    const rd = document.getElementById('red-deaths');
    if (bk) bk.textContent = blueAgents.reduce((s, a) => s + a.kills, 0);
    if (bd) bd.textContent = blueAgents.reduce((s, a) => s + a.deaths, 0);
    if (rk) rk.textContent = redAgents.reduce((s, a) => s + a.kills, 0);
    if (rd) rd.textContent = redAgents.reduce((s, a) => s + a.deaths, 0);
}

// ─── Animation Loop ──────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    
    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1);
    
    // Update drones
    for (let i = 0; i < drones.length; i++) {
        if (drones[i].isDestroyed) continue;
        drones[i].update(delta);
        drones[i].detectDrones(drones.filter(d => d.id !== drones[i].id));
        drones[i].updateProjectiles(delta, drones.filter(d => d.id !== drones[i].id));
    }
    
    // Training loop with speed multiplier
    if (trainingEnabled) {
        // Reset crashed drones independently (don't block training for others)
        for (let i = 0; i < drones.length; i++) {
            if (drones[i].crashed || drones[i].isDestroyed) {
                drones[i].resetWithPosition(DRONE_SPAWNS[i].pos);
                drones[i].body.material.color.set(DRONE_SPAWNS[i].color);
                // Orient only THIS drone toward enemies
                const enemies = drones.filter(o => o.team !== drones[i].team);
                if (enemies.length > 0) {
                    const cx = enemies.reduce((s, e) => s + e.position.x, 0) / enemies.length;
                    const cz = enemies.reduce((s, e) => s + e.position.z, 0) / enemies.length;
                    const dx = cx - drones[i].position.x;
                    const dz = cz - drones[i].position.z;
                    const baseYaw = Math.atan2(dx, -dz);
                    const dev = (Math.random() - 0.5) * (Math.PI / 3);
                    drones[i].setInitialRotation(0, baseYaw + dev, 0);
                }
                // RL agent already called endEpisode() in step()
                if (rlAgents[i]) {
                    rlAgents[i].prevAction = null;
                    rlAgents[i].prevStates = [];
                    rlAgents[i].noiseState.fill(0);
                    if (trainingEnabled) rlAgents[i].isTraining = true;
                }
            }
        }
        
        // Run multiple RL steps per frame when speed > 1
        const stepsPerFrame = Math.min(trainingSpeed, 20);
        for (let s = 0; s < stepsPerFrame; s++) {
            for (let i = 0; i < rlAgents.length; i++) {
                if (!drones[i].isDestroyed && !drones[i].crashed) rlAgents[i].step(delta / stepsPerFrame);
            }
        }
        
        if (centralizedTrainer && centralizedTrainer.isActive) {
            centralizedTrainer.step(delta);
        }
        
        // Update viz — faster at high speeds, minimum 200ms interval
        const updateInterval = trainingSpeed > 5 ? 200 : 500;
        if (Math.floor(time / updateInterval) > Math.floor(prevTime / updateInterval)) {
            // Aggregate stats across all agents for charts
            const allStats = rlAgents.map(a => a.getStats());
            const best = allStats.reduce((b, s) => s.episode >= b.episode ? s : b, allStats[0]);
            const mergedStats = {
                episode: rlAgents.reduce((s, a) => s + a.episode, 0),
                totalRewards: best.totalRewards,
                episodeLengths: best.episodeLengths,
                runningAvgReward: Math.max(...allStats.map(s => s.runningAvgReward || 0)),
                explorationRate: allStats.reduce((s, x) => s + x.explorationRate, 0) / allStats.length,
                stabilityScores: best.stabilityScores,
                successRate: allStats.reduce((s, x) => s + x.successRate, 0) / allStats.length,
                kills: allStats.reduce((s, x) => s + x.kills, 0),
                deaths: allStats.reduce((s, x) => s + x.deaths, 0),
                replayBufferSize: allStats.reduce((s, x) => s + x.replayBufferSize, 0),
                criticUpdates: allStats.reduce((s, x) => s + x.criticUpdates, 0),
                weightDrift: best.weightDrift
            };
            visualizer.updateCharts(mergedStats);
            updateInfoDisplay();
            updateScoreboard();
        }
    } else {
        for (const d of drones) {
            if (!d.isDestroyed) applyHoverControl(d, delta);
        }
    }
    
    // Camera movement (desktop)
    if (document.pointerLockElement === document.getElementById('canvas')) {
        const friction = 10.0;
        velocity.x -= velocity.x * friction * delta;
        velocity.z -= velocity.z * friction * delta;
        velocity.y -= velocity.y * friction * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.y = Number(moveUp) - Number(moveDown);
        direction.normalize();

        const currentSpeed = running ? moveSpeed * 1.5 : moveSpeed;
        const acceleration = 65.0 * delta;
        
        const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        const upVector = new THREE.Vector3(0, 1, 0);
        const rightVector = new THREE.Vector3().crossVectors(upVector, forwardVector).normalize();
        
        if (moveForward || moveBackward) {
            velocity.x += forwardVector.x * direction.z * acceleration;
            velocity.y += forwardVector.y * direction.z * acceleration;
            velocity.z += forwardVector.z * direction.z * acceleration;
        }
        if (moveLeft || moveRight) {
            velocity.x += rightVector.x * direction.x * acceleration;
            velocity.z += rightVector.z * direction.x * acceleration;
        }
        if (moveUp || moveDown) {
            velocity.y += direction.y * acceleration;
        }
        
        const maxVelocity = currentSpeed;
        const curVel = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
        if (curVel > maxVelocity) {
            const scale = maxVelocity / curVel;
            velocity.x *= scale;
            velocity.y *= scale;
            velocity.z *= scale;
        }

        camera.position.x += velocity.x * delta;
        camera.position.y += velocity.y * delta;
        camera.position.z += velocity.z * delta;

        camera.position.y = Math.max(1, Math.min(14, camera.position.y));
        camera.position.x = Math.max(-29, Math.min(29, camera.position.x));
        camera.position.z = Math.max(-19, Math.min(19, camera.position.z));
    } else if (isMobile) {
        // On mobile, apply movement from joystick even without pointer lock
        const friction = 10.0;
        velocity.x -= velocity.x * friction * delta;
        velocity.z -= velocity.z * friction * delta;
        velocity.y -= velocity.y * friction * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        const acceleration = 40.0 * delta;
        const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forwardVector.y = 0;
        forwardVector.normalize();
        const rightVector = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forwardVector).normalize();
        
        if (moveForward || moveBackward) {
            velocity.x += forwardVector.x * direction.z * acceleration;
            velocity.z += forwardVector.z * direction.z * acceleration;
        }
        if (moveLeft || moveRight) {
            velocity.x += rightVector.x * direction.x * acceleration;
            velocity.z += rightVector.z * direction.x * acceleration;
        }
        
        camera.position.x += velocity.x * delta;
        camera.position.z += velocity.z * delta;
        
        camera.position.y = Math.max(1, Math.min(14, camera.position.y));
        camera.position.x = Math.max(-29, Math.min(29, camera.position.x));
        camera.position.z = Math.max(-19, Math.min(19, camera.position.z));
    }

    prevTime = time;
    
    // At very high speeds, skip some renders
    if (trainingSpeed > 10 && trainingEnabled && time % 3 !== 0) return;
    renderer.render(scene, camera);
}

function applyHoverControl(drone, deltaTime) {
    const state = drone.getState();
    const targetHeight = 5.0;
    const heightError = targetHeight - state.position.y;
    let thrust = Math.max(0.1, Math.min(0.9, 0.5 + heightError * 0.05));
    
    drone.setControlInputs(
        -state.rotation.x * 0.5,
        -state.rotation.z * 0.5,
        0,
        thrust
    );
}

// ─── Drone & RL Initialization ───────────────────────────────────
function createDrones() {
    for (let i = 0; i < DRONE_SPAWNS.length; i++) {
        const s = DRONE_SPAWNS[i];
        const drone = new Drone(scene, s.pos, s.color, i);
        drone.team = s.team;
        drones.push(drone);
    }
    window.drones = drones;
    orientDronesAtOpponents();
}

function orientDronesAtOpponents() {
    for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        const enemies = drones.filter(o => o.team !== d.team);
        if (enemies.length === 0) continue;
        const cx = enemies.reduce((s, e) => s + e.position.x, 0) / enemies.length;
        const cz = enemies.reduce((s, e) => s + e.position.z, 0) / enemies.length;
        const dx = cx - d.position.x;
        const dz = cz - d.position.z;
        const baseYaw = Math.atan2(dx, -dz);
        const dev = (Math.random() - 0.5) * (Math.PI / 3);
        d.setInitialRotation(0, baseYaw + dev, 0);
    }
}

function initializeRL() {
    for (let i = 0; i < drones.length; i++) {
        const others = drones.filter((_, j) => j !== i);
        const rl = new ReinforcementLearning(drones[i], others);
        rlAgents.push(rl);
    }
    centralizedTrainer = new CentralizedTraining(rlAgents);
}

function resetAllDrones() {
    for (let i = 0; i < drones.length; i++) {
        drones[i].resetWithPosition(DRONE_SPAWNS[i].pos);
        drones[i].body.material.color.set(DRONE_SPAWNS[i].color);
    }
    orientDronesAtOpponents();
    
    for (let i = 0; i < rlAgents.length; i++) {
        if (rlAgents[i].isTraining && rlAgents[i].episodeStep > 0) {
            rlAgents[i].endEpisode();
        } else {
            rlAgents[i].episodeStep = 0;
            rlAgents[i].episodeReward = 0;
            rlAgents[i].prevAction = null;
            rlAgents[i].prevStates = [];
            rlAgents[i].stabilityScores = [];
            rlAgents[i].noiseState.fill(0);
        }
        if (trainingEnabled) rlAgents[i].isTraining = true;
    }
    
    if (centralizedTrainer && centralizedTrainer.isActive) centralizedTrainer.reset();
    updateScoreboard();
}

function resetDronesForCombat() {
    resetAllDrones();
}
