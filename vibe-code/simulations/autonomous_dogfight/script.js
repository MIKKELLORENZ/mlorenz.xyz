// ═══════════════════════════════════════════════════════════════════
//  Autonomous Dogfight – Neuroevolution Battle Royale
//  A whole population of drones fights in the gym; the best breed.
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

// ─── Evolution simulation state ──────────────────────────────────
let drones = [];
let evolution;
let visualizer;
let evolutionRunning = false;
let simSpeed = 1;            // simulation ticks per rendered frame (1–20×)
let populationSize = 16;     // applied on Reset
let genTime = 0;             // sim-seconds elapsed in current round
let genRound = 1;            // 1..ROUNDS within the current generation
let simDead = [];            // per-drone "death already booked" flags
let lastHudUpdate = 0;
let chartsDirty = false;     // generation ended since last chart refresh

// Headless training: no rendering at all — every frame's time budget goes
// into simulation ticks. Typically ~5-10× faster than the 20× rendered mode.
let headlessMode = false;
const HEADLESS_BUDGET_MS = 12;   // per-frame sim budget (leaves time for UI)
let headlessTicks = 0;           // ticks executed while headless (for rate display)
let headlessStats = { t: 0, gen: 0, ticks: 0, gensPerMin: 0, ticksPerSec: 0 };

// Each generation is evaluated over ROUNDS battles — fitness accumulates, so
// one lucky spawn or stray bullet can't crown a bad genome. Round 1 is a
// DISARMED flight qualification: no weapons, so every genome gets one
// low-noise measurement of pure flying skill each generation (combat luck was
// drowning the flight signal — measured signal/noise of 0.58 without it).
const ROUNDS = 4;
const ROUND_DURATION = 12;   // max sim-seconds per round
const TICK_DT = 1 / 60;

// Control trim: NN outputs are centered on stable flight. Thrust output 0 =
// hover (without this every random genome pins ~1.5g and ceiling-crashes in
// 2s — evolution never gets airborne long enough to select on anything), and
// roll/pitch are scaled so random nets drift instead of instantly diving into
// a wall. The network keeps full authority within these envelopes.
// Trim slightly ABOVE exact hover (1/3): tilting sheds ~6% of vertical lift,
// so an exactly-hover-trimmed drone sinks whenever it maneuvers — floor
// crashes were 84% of all deaths. At 0.35 the typical combat tilt is
// lift-neutral.
const HOVER_THRUST = 0.35;
const THRUST_RANGE = 0.32;
const TILT_AUTHORITY = 0.6;

// Lineage colors — you can literally see the genetic operators flying around
const ORIGIN_COLORS = {
    best: 0xffd700,       // gold: the reigning leader (exact, un-mutated)
    contender: 0xe8e8f0,  // silver: the challenger building its track record
    elite: 0xff8c3a,      // orange: elite survivors (mutated)
    child: 0x00c8ff,      // cyan: crossover children (mom + dad copy-paste)
    immigrant: 0xc44dff   // purple: fresh random genomes
};

// Global wind — same weather for everyone, so it's a fair fight
const wind = {
    dir: new THREE.Vector3(1, 0, 0),
    strength: 0.8,
    turbulence: 0.18,
    changeTimer: 0
};

// Scratch objects (avoid per-tick allocations in the hot loop)
const _stateBuf = new Float64Array(25);
const _invQ = new THREE.Quaternion();
const _bodyV = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _threatFwd = new THREE.Vector3();
const _threatDir = new THREE.Vector3();
const _windV = new THREE.Vector3();

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
window.evolutionRunning = false;
window.fxEnabled = true;
window.drones = drones;

init();
animate();

function init() {
    scene = new THREE.Scene();

    const textureLoader = new THREE.TextureLoader();
    const skyTexture = textureLoader.load(textureURLs.sky);
    scene.background = skyTexture;

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(17, 10, 17);
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

    evolution = new Evolution(populationSize, (Math.random() * 0xffffffff) >>> 0);
    createDrones();
    respawnPopulation();

    visualizer = new EvolutionVisualizer();
    setupControlPanel();
    setupControls();
    updateHUD();

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

// ═══════════════════════════════════════════════════════════════════
//  Population management
// ═══════════════════════════════════════════════════════════════════

// Spawn points on an ellipse around the court center. Uniform height and a
// random rotation each call — spawn position must never decide who wins.
// Kept well clear of the walls so random genomes get a few seconds of flight
// to differentiate before physics executes them.
function spawnLayout(n) {
    const pts = [];
    const rx = 16, rz = 10;
    const offset = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
        const a = offset + (i / n) * Math.PI * 2;
        pts.push({
            x: Math.cos(a) * rx,
            y: 6.0,
            z: Math.sin(a) * rz
        });
    }
    return pts;
}

function createDrones() {
    const layout = spawnLayout(populationSize);
    for (let i = 0; i < populationSize; i++) {
        const drone = new Drone(scene, layout[i], ORIGIN_COLORS.immigrant, i);
        wireDroneEvents(drone);
        drones.push(drone);
    }
    window.drones = drones;
}

// Fitness bookkeeping rides on the drone combat events
function wireDroneEvents(drone) {
    drone.onDamaged = (amount, fromId) => {
        if (!evolutionRunning) return;
        if (typeof fromId === 'number' && evolution.pop[fromId]) {
            evolution.registerHit(fromId, drone.id);
        }
    };
    drone.onDestroyed = (fromId) => {
        if (!evolutionRunning) return;
        if (typeof fromId === 'number' && evolution.pop[fromId]) {
            evolution.registerKill(fromId);
        }
        if (!simDead[drone.id]) {
            simDead[drone.id] = true;
            evolution.registerDeath(drone.id, genTime, false);
        }
    };
}

function disposeDrone(d) {
    for (const p of d.projectiles) scene.remove(p.mesh);
    for (const tp of d.trailParticles) scene.remove(tp.mesh);
    scene.remove(d.mesh);
}

// Fresh battle: reset positions, apply lineage colors, aim at the arena.
// Spawn slots are shuffled every generation so no genome inherits a lucky
// starting spot.
function respawnPopulation() {
    const layout = spawnLayout(drones.length);
    const slot = [...Array(drones.length).keys()];
    for (let i = slot.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slot[i], slot[j]] = [slot[j], slot[i]];
    }
    const disarmed = genRound === 1; // round 1 = flight qualification
    for (let i = 0; i < drones.length; i++) {
        drones[i].resetWithPosition(layout[slot[i]]);
        drones[i].hasWeapon = !disarmed;
        const origin = evolution.pop[i] ? evolution.pop[i].origin : 'immigrant';
        drones[i].setTeamColor(ORIGIN_COLORS[origin] || ORIGIN_COLORS.child);
    }
    orientDronesAtCenter();
    genTime = 0;
    simDead = new Array(drones.length).fill(false);
}

function orientDronesAtCenter() {
    for (const d of drones) {
        const dx = -d.position.x;
        const dz = -d.position.z;
        const baseYaw = Math.atan2(dx, -dz);
        const dev = (Math.random() - 0.5) * (Math.PI / 4);
        d.setInitialRotation(0, baseYaw + dev, 0);
    }
}

function resetEvolution() {
    for (const d of drones) disposeDrone(d);
    drones = [];
    window.drones = drones;
    evolution = new Evolution(populationSize, (Math.random() * 0xffffffff) >>> 0);
    genRound = 1;
    createDrones();
    respawnPopulation();
    if (visualizer) visualizer.reset();
    updateHUD();
    updateInfoDisplay();
}

// ═══════════════════════════════════════════════════════════════════
//  Simulation core — one tick of the whole battle
// ═══════════════════════════════════════════════════════════════════

function updateWind(dt) {
    wind.changeTimer -= dt;
    if (wind.changeTimer <= 0) {
        wind.changeTimer = 5 + Math.random() * 10;
        const a = Math.random() * Math.PI * 2;
        wind.dir.set(Math.cos(a), Math.random() * 0.3 - 0.15, Math.sin(a)).normalize();
        wind.strength = 0.4 + Math.random() * 1.1;
    }
}

// Wind curriculum: calm skies while the population learns to fly, then a
// breeze fades in across generations 30-100, capped at 35% strength.
// Measured: full-strength wind blows even a perfectly-trimmed hover into the
// wall in ~8s — unsurvivable weather teaches nothing, it just resets the
// population every round.
function windRamp() {
    return 0.2 * Math.min(1, Math.max(0, (evolution.gen - 30) / 70));
}

function applyWindTo(d) {
    const ramp = windRamp();
    if (ramp <= 0) return;
    _windV.copy(wind.dir).multiplyScalar(wind.strength * ramp);
    const turb = wind.turbulence * ramp;
    _windV.x += (Math.random() * 2 - 1) * turb;
    _windV.y += (Math.random() * 2 - 1) * turb;
    _windV.z += (Math.random() * 2 - 1) * turb;
    d.applyExternalForce(_windV);
}

// 25 inputs — must match NN_ARCH[0] in nn.js
function buildStateVector(d, aliveCount) {
    const s = _stateBuf;
    let k = 0;
    // where am I
    s[k++] = d.position.x / 29;
    s[k++] = (d.position.y / 7.5) - 1;
    s[k++] = d.position.z / 19;
    // attitude (yaw-independent lean — rotation.x/z Euler angles flip at
    // |yaw| > 90° and would poison these inputs for half the compass)
    s[k++] = d.tiltX / (Math.PI / 2);
    s[k++] = d.tiltZ / (Math.PI / 2);
    const q = d.quaternion;
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    s[k++] = Math.sin(yaw);
    s[k++] = Math.cos(yaw);
    // body-frame velocity
    _invQ.copy(q).invert();
    _bodyV.copy(d.velocity).applyQuaternion(_invQ);
    s[k++] = Math.tanh(_bodyV.x / 8);
    s[k++] = Math.tanh(_bodyV.y / 8);
    s[k++] = Math.tanh(_bodyV.z / 8);
    // angular velocity
    s[k++] = Math.tanh(d.angularVelocity.x / 4);
    s[k++] = Math.tanh(d.angularVelocity.y / 4);
    s[k++] = Math.tanh(d.angularVelocity.z / 4);
    // own health
    s[k++] = d.health / 100;
    // nearest enemy
    if (d.nearestDrone) {
        const e = d.nearestDrone;
        s[k++] = 1;                                          // enemy in sensor range
        s[k++] = Math.tanh(d.nearestDroneDistance / 15);
        _bodyV.copy(d.nearestDroneDirection).applyQuaternion(_invQ);
        s[k++] = _bodyV.x;
        s[k++] = _bodyV.y;
        s[k++] = _bodyV.z;
        // is that enemy aiming at ME? (evasion cue)
        _threatFwd.set(0, 0, -1).applyQuaternion(e.quaternion);
        _threatDir.copy(d.position).sub(e.position).normalize();
        s[k++] = _threatFwd.dot(_threatDir);
        s[k++] = e.health / 100;                             // finish off the weak
    } else {
        s[k++] = 0; s[k++] = 1;
        s[k++] = 0; s[k++] = 0; s[k++] = 0;
        s[k++] = 0; s[k++] = 0;
    }
    // weapon ready?
    s[k++] = Math.max(0, d.weaponCooldown) / d.weaponCooldownTime;
    // wall danger
    s[k++] = Math.max(0, 1 - (29 - Math.abs(d.position.x)) / 10);
    s[k++] = Math.max(0, 1 - (19 - Math.abs(d.position.z)) / 10);
    // how crowded is the fight still
    s[k++] = (aliveCount - 1) / Math.max(1, drones.length - 1);
    return s;
}

// Continuous shaping rewards — small nudges toward flying well and hunting.
// All rates live in REWARDS (evolution.js).
function accrueShaping(d, i, dt, align) {
    let r = REWARDS.alivePerSec;

    const tilt = Math.abs(d.tiltX) + Math.abs(d.tiltZ);
    r += Math.max(0, 1 - tilt / 0.6) * REWARDS.uprightPerSec;
    r += Math.min(1, d.angularVelocity.length() / 4) * REWARDS.spinPenaltyPerSec;

    const y = d.position.y;
    r += Math.exp(-Math.pow(y - 7, 2) / 18) * REWARDS.altitudeBandPerSec;

    const dwx = 29 - Math.abs(d.position.x);
    const dwz = 19 - Math.abs(d.position.z);
    if (dwx < 8) r += Math.pow((8 - dwx) / 8, 2) * REWARDS.wallPenaltyPerSec;
    if (dwz < 8) r += Math.pow((8 - dwz) / 8, 2) * REWARDS.wallPenaltyPerSec;
    if (y < 1.5) r += Math.pow((1.5 - y) / 1.5, 2) * REWARDS.wallPenaltyPerSec * 1.4;
    if (y > 13) r += Math.pow((y - 13) / 2, 2) * REWARDS.wallPenaltyPerSec;

    if (d.nearestDrone) {
        r += Math.max(0, align) * REWARDS.facingPerSec;
        r += Math.exp(-Math.pow(d.nearestDroneDistance - 10, 2) / 60) * REWARDS.rangePerSec;
    }

    evolution.addFitness(i, r * dt);
}

function simTick(dt, renderTick) {
    genTime += dt;
    updateWind(dt);

    // active list shared by sensing and hit detection (wrecks are ghosts)
    const active = drones.filter(o => !o.crashed && !o.isDestroyed);
    const aliveCount = active.length;

    for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        if (d.crashed || d.isDestroyed) continue;

        d.detectDrones(active);
        applyWindTo(d);

        // think — one forward pass through this drone's genome
        const state = buildStateVector(d, aliveCount);
        const out = forward(evolution.pop[i].genome, state);
        d.setControlInputs(
            out[0] * TILT_AUTHORITY,
            out[1] * TILT_AUTHORITY,
            out[2],
            HOVER_THRUST + out[3] * THRUST_RANGE
        );

        let align = -1;
        if (d.nearestDrone) {
            _fwd.set(0, 0, -1).applyQuaternion(d.quaternion);
            align = _fwd.dot(d.nearestDroneDirection);
        }
        if (out[4] > 0 && d.weaponCooldown <= 0) {
            if (d.shoot()) {
                const aimed = align > 0.85 && d.nearestDroneDistance < 22;
                evolution.registerShot(i, aimed);
            }
        }

        d.update(dt, renderTick);
        accrueShaping(d, i, dt, align);

        // boundary crashes discovered during the physics step
        if ((d.crashed || d.isDestroyed) && !simDead[i]) {
            simDead[i] = true;
            evolution.registerDeath(i, genTime, !d.isDestroyed);
        }
    }

    // projectiles advance exactly once per tick (even for dead shooters —
    // their bullets stay live)
    for (const d of drones) {
        if (d.projectiles.length > 0 || d.weaponCooldown > 0) {
            d.updateProjectiles(dt, active);
        }
    }

    // deaths caused by projectiles this tick
    for (let i = 0; i < drones.length; i++) {
        if ((drones[i].crashed || drones[i].isDestroyed) && !simDead[i]) {
            simDead[i] = true;
            evolution.registerDeath(i, genTime, !drones[i].isDestroyed);
        }
    }

    // Run the round's full clock even with one drone left — a lone survivor
    // still has to PROVE it can fly. Ending at "last man standing" would erase
    // the fitness difference between hovering 20s and outliving the crowd by
    // 0.1s.
    const stillAlive = drones.reduce((n, d) => n + (!d.crashed && !d.isDestroyed ? 1 : 0), 0);
    if (stillAlive === 0 || genTime >= ROUND_DURATION) {
        evolution.endRound(genTime);
        if (genRound < ROUNDS) {
            genRound++;
            respawnPopulation(); // same genomes, fresh battle
        } else {
            finishGeneration();
        }
    }
}

function finishGeneration() {
    evolution.endGeneration();
    genRound = 1;
    respawnPopulation();
    // UI refresh is throttled from the animate loop — at headless speeds
    // generations can turn over many times per second, and rebuilding the
    // charts for each one would eat the training budget.
    chartsDirty = true;
}

// Periodic UI refresh shared by rendered and headless modes.
function refreshThrottledUI(time) {
    updateHUD();
    updateInfoDisplay();
    if (chartsDirty && visualizer) {
        chartsDirty = false;
        visualizer.updateCharts(evolution);
    }
    if (headlessMode) updateHeadlessOverlay(time);
}

// Run simulation ticks until the wall-clock deadline (headless mode).
// Checked in small batches — performance.now() is cheap but not free.
function runHeadlessTicks(deadline) {
    let n = 0;
    while (performance.now() < deadline) {
        for (let k = 0; k < 20; k++) {
            simTick(TICK_DT, false);
            n++;
        }
    }
    headlessTicks += n;
    return n;
}

// ═══════════════════════════════════════════════════════════════════
//  UI — control panel, HUD, scoreboard
// ═══════════════════════════════════════════════════════════════════

function setupControlPanel() {
    const controlPanel = document.createElement('div');
    controlPanel.id = 'control-panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Neuroevolution';
    controlPanel.appendChild(title);

    // Mode row: start/pause + headless
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';

    const evoBtn = document.createElement('button');
    evoBtn.id = 'evolution-toggle';
    evoBtn.textContent = 'Start Evolution';

    const headlessBtn = document.createElement('button');
    headlessBtn.id = 'headless-toggle';
    headlessBtn.textContent = 'Headless: OFF';

    btnRow.append(evoBtn, headlessBtn);
    controlPanel.appendChild(btnRow);

    const resetRow = document.createElement('div');
    resetRow.className = 'btn-row';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Population';
    resetRow.append(resetBtn);
    controlPanel.appendChild(resetRow);

    // Champion save/load row
    const champRow = document.createElement('div');
    champRow.className = 'btn-row';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Champion';
    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load Champion';
    champRow.append(saveBtn, loadBtn);
    controlPanel.appendChild(champRow);

    // Speed slider
    const speedRow = document.createElement('div');
    speedRow.className = 'speed-row';
    speedRow.innerHTML = '<div class="speed-label"><span>Speed</span><span id="speed-value">1×</span></div>';
    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.min = '1';
    speedSlider.max = '20';
    speedSlider.value = '1';
    speedRow.appendChild(speedSlider);
    controlPanel.appendChild(speedRow);

    // Population slider (applies on reset)
    const popRow = document.createElement('div');
    popRow.className = 'speed-row';
    popRow.innerHTML = `<div class="speed-label"><span>Population (on reset)</span><span id="pop-value">${populationSize}</span></div>`;
    const popSlider = document.createElement('input');
    popSlider.type = 'range';
    popSlider.min = '6';
    popSlider.max = '24';
    popSlider.step = '2';
    popSlider.value = String(populationSize);
    popRow.appendChild(popSlider);
    controlPanel.appendChild(popRow);

    // Lineage color legend
    const legend = document.createElement('div');
    legend.className = 'lineage-legend';
    legend.innerHTML =
        '<span class="chip"><i style="background:#ffd700"></i>leader</span>' +
        '<span class="chip"><i style="background:#e8e8f0"></i>contender</span>' +
        '<span class="chip"><i style="background:#ff8c3a"></i>elite</span>' +
        '<span class="chip"><i style="background:#00c8ff"></i>child</span>' +
        '<span class="chip"><i style="background:#c44dff"></i>immigrant</span>';
    controlPanel.appendChild(legend);

    // Info display
    const infoDisplay = document.createElement('div');
    infoDisplay.id = 'info-display';
    infoDisplay.innerHTML = 'Status: Ready';
    controlPanel.appendChild(infoDisplay);

    // Generation counter (prominent)
    const genCounter = document.createElement('div');
    genCounter.id = 'episode-counter';
    genCounter.innerHTML = '<span class="ep-label">GENERATION</span><span class="ep-value" id="gen-count">1</span>';
    controlPanel.appendChild(genCounter);

    document.body.appendChild(controlPanel);

    // ── handlers ──
    speedSlider.addEventListener('input', () => {
        simSpeed = parseInt(speedSlider.value);
        document.getElementById('speed-value').textContent = `${simSpeed}×`;
    });

    popSlider.addEventListener('input', () => {
        populationSize = parseInt(popSlider.value);
        document.getElementById('pop-value').textContent = populationSize;
    });

    evoBtn.addEventListener('click', () => {
        evolutionRunning = !evolutionRunning;
        window.evolutionRunning = evolutionRunning;
        if (evolutionRunning) {
            evoBtn.textContent = 'Pause Evolution';
            evoBtn.classList.add('danger');
        } else {
            evoBtn.textContent = 'Resume Evolution';
            evoBtn.classList.remove('danger');
        }
        updateInfoDisplay();
        if (headlessMode) updateHeadlessOverlay(performance.now());
    });

    headlessBtn.addEventListener('click', () => {
        setHeadlessMode(!headlessMode);
    });

    resetBtn.addEventListener('click', () => {
        resetEvolution();
    });

    saveBtn.addEventListener('click', () => {
        const json = evolution.serializeChampion();
        if (!json) { flashButton(saveBtn, 'No champion yet'); return; }
        try {
            localStorage.setItem('dogfight-ne-champion', json);
            flashButton(saveBtn, 'Saved ✓');
        } catch (e) {
            flashButton(saveBtn, 'Save failed');
        }
    });

    loadBtn.addEventListener('click', () => {
        const json = localStorage.getItem('dogfight-ne-champion');
        if (json && evolution.loadChampion(json)) {
            flashButton(loadBtn, 'Loaded → next gen');
        } else {
            flashButton(loadBtn, 'Nothing saved');
        }
    });

    updateInfoDisplay();
}

function flashButton(btn, text) {
    const orig = btn.dataset.label || btn.textContent;
    btn.dataset.label = orig;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = orig; }, 1400);
}

// ─── Headless mode ───────────────────────────────────────────────
function setHeadlessMode(on) {
    headlessMode = on;
    const overlay = document.getElementById('headless-overlay');
    if (overlay) overlay.classList.toggle('show', on);
    const btn = document.getElementById('headless-toggle');
    if (btn) {
        btn.textContent = on ? 'Headless: ON' : 'Headless: OFF';
        btn.classList.toggle('active', on);
    }
    // reset rate sampling so gens/min doesn't average across the off-period
    headlessStats = {
        t: 0,
        gen: evolution ? evolution.gen : 0,
        ticks: headlessTicks,
        gensPerMin: 0,
        ticksPerSec: 0
    };
    if (on) updateHeadlessOverlay(performance.now());
    updateInfoDisplay();
}

function updateHeadlessOverlay(time) {
    const badge = document.getElementById('headless-badge-text');
    const genEl = document.getElementById('headless-gen');
    const rateEl = document.getElementById('headless-rate');
    const tpsEl = document.getElementById('headless-tps');
    const bestEl = document.getElementById('headless-best');
    const champEl = document.getElementById('headless-champ');
    if (!genEl || !evolution) return;

    // sample throughput about once a second
    if (time - headlessStats.t > 1000) {
        if (headlessStats.t > 0) {
            const dt = (time - headlessStats.t) / 1000;
            headlessStats.gensPerMin = ((evolution.gen - headlessStats.gen) / dt) * 60;
            headlessStats.ticksPerSec = (headlessTicks - headlessStats.ticks) / dt;
        }
        headlessStats.t = time;
        headlessStats.gen = evolution.gen;
        headlessStats.ticks = headlessTicks;
    }

    if (badge) badge.textContent = evolutionRunning ? 'HEADLESS TRAINING' : 'HEADLESS · PAUSED';
    genEl.textContent = evolution.gen;
    rateEl.textContent = headlessStats.gensPerMin > 0 ? headlessStats.gensPerMin.toFixed(1) : '–';
    tpsEl.textContent = headlessStats.ticksPerSec > 0
        ? (headlessStats.ticksPerSec / 1000).toFixed(1) + 'k' : '–';
    const h = evolution.history;
    bestEl.textContent = h.best.length ? h.best[h.best.length - 1].toFixed(0) : '–';
    champEl.textContent = evolution.champion ? evolution.champion.fitness.toFixed(0) : '–';
}

function updateInfoDisplay() {
    const infoDisplay = document.getElementById('info-display');
    if (!infoDisplay || !evolution) return;

    const h = evolution.history;
    const alive = drones.reduce((n, d) => n + (!d.crashed && !d.isDestroyed ? 1 : 0), 0);
    const mut = evolution.effectiveMutation();

    let html = `Status: ${evolutionRunning ? '<b style="color:#00c8ff">Evolving</b>' : 'Paused'}<br>`;
    html += `Population: ${drones.length} (${alive} alive)<br>`;
    if (h.best.length > 0) {
        html += `Best (last gen): <b>${h.best[h.best.length - 1].toFixed(1)}</b><br>`;
        html += `Mean: ${h.mean[h.mean.length - 1].toFixed(1)}<br>`;
        html += `Kills last gen: ${h.kills[h.kills.length - 1]}<br>`;
    }
    if (evolution.leader && evolution.leader.fits.length > 0) {
        const lf = evolution.leader.fits;
        const lAvg = lf.reduce((s, v) => s + v, 0) / lf.length;
        const t = evolution.leader.tenure;
        const grace = t < GA.leaderGraceGens ? ` <span style="color:#ffd700">(grace ${t}/${GA.leaderGraceGens})</span>` : ` (reign ${t})`;
        html += `Leader avg: <b style="color:#ffd700">${lAvg.toFixed(0)}</b>${grace}<br>`;
    }
    if (evolution.contender && evolution.contender.fits.length > 0) {
        const cf = evolution.contender.fits;
        const cAvg = cf.reduce((s, v) => s + v, 0) / cf.length;
        html += `Contender avg: <b style="color:#e8e8f0">${cAvg.toFixed(0)}</b> (${cf.length} eval${cf.length > 1 ? 's' : ''})<br>`;
    }
    if (evolution.champion) {
        html += `Champion: <b>${evolution.champion.fitness.toFixed(1)}</b> (gen ${evolution.champion.gen}, ${evolution.champion.kills} kills)<br>`;
    }
    html += `Mutation rate: ${mut.rate.toFixed(3)}${evolution.stagnantGens > 0 ? ` <span style="color:#ff9f43">(+${evolution.stagnantGens} stagnant)</span>` : ''}<br>`;
    html += `Diversity: ${evolution.diversity.toFixed(3)}<br>`;
    html += `Wind: ${(windRamp() * 100).toFixed(0)}%<br>`;
    html += headlessMode ? 'Speed: <b style="color:#ffd700">headless (max)</b>' : `Speed: ${simSpeed}×`;

    infoDisplay.innerHTML = html;
}

function updateHUD() {
    const genEl = document.getElementById('hud-gen');
    const aliveEl = document.getElementById('hud-alive');
    const timeEl = document.getElementById('hud-time');
    const bestEl = document.getElementById('hud-best');
    const genCount = document.getElementById('gen-count');

    const alive = drones.reduce((n, d) => n + (!d.crashed && !d.isDestroyed ? 1 : 0), 0);
    if (genEl) genEl.textContent = evolution.gen;
    if (genCount) genCount.textContent = evolution.gen;
    if (aliveEl) aliveEl.textContent = `${alive}/${drones.length}`;
    const roundLabel = genRound === 1 ? 'QUAL' : `R${genRound}`;
    if (timeEl) timeEl.textContent = `${roundLabel}·${Math.max(0, ROUND_DURATION - genTime).toFixed(0)}s`;
    const h = evolution.history;
    if (bestEl) bestEl.textContent = h.best.length ? h.best[h.best.length - 1].toFixed(0) : '–';
}

// ─── Animation Loop ──────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1);

    if (evolutionRunning) {
        if (headlessMode) {
            // Flat-out: fill the frame's time budget with sim ticks, render nothing
            window.fxEnabled = false;
            runHeadlessTicks(time + HEADLESS_BUDGET_MS);
        } else {
            // Heavy FX only at watchable speeds
            window.fxEnabled = simSpeed <= 3;
            for (let t = 0; t < simSpeed; t++) {
                simTick(TICK_DT, t === simSpeed - 1);
            }
        }
    } else if (!headlessMode) {
        // Idle demo mode: gentle hover
        window.fxEnabled = true;
        for (const d of drones) {
            if (!d.isDestroyed && !d.crashed) {
                applyHoverControl(d, delta);
                d.update(delta, true);
            }
            if (d.projectiles.length > 0 || d.weaponCooldown > 0) {
                d.updateProjectiles(delta, []);
            }
        }
    }

    // Throttled UI refresh — at headless speeds generations turn over many
    // times a second, so charts/HUD redraw on a timer, not per generation.
    if (time - lastHudUpdate > 250) {
        lastHudUpdate = time;
        refreshThrottledUI(time);
    }

    if (headlessMode) {
        // No camera, no render — the overlay explains the frozen scene
        prevTime = time;
        return;
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
    renderer.render(scene, camera);
}

function applyHoverControl(drone, deltaTime) {
    const targetHeight = 5.0;
    const heightError = targetHeight - drone.position.y;
    let thrust = Math.max(0.1, Math.min(0.9, 0.5 + heightError * 0.05));

    drone.setControlInputs(
        -drone.tiltX * 0.5,
        -drone.tiltZ * 0.5,
        0,
        thrust
    );
}
