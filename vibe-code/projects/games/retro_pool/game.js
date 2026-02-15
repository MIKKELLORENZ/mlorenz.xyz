/**
 * Retro Pool - PlayStation 1 Style 3D Pool Game
 * Features authentic PS1 graphics with low-poly models, vertex jitter, and pixelated textures
 */

// ── Sound Engine (PS1-style synthesized sounds) ───────────────────────────────
class RetroSoundEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.enabled = true;
        this.volume = 0.4;
    }

    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.volume;
            this.masterGain.connect(this.ctx.destination);
        } catch (e) {
            console.warn('Web Audio not available');
            this.enabled = false;
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setVolume(v) {
        this.volume = v;
        if (this.masterGain) this.masterGain.gain.value = v;
    }

    // Ball hitting ball — sharp click
    playHit(power = 0.5) {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = 'square';
        osc.frequency.setValueAtTime(800 + power * 600, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);

        filter.type = 'lowpass';
        filter.frequency.value = 2000;

        gain.gain.setValueAtTime(0.3 * Math.max(power, 0.1), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.15);
    }

    // Ball hitting cushion — muted thud
    playCushion() {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.06);

        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.1);
    }

    // Ball pocketed — satisfying descending tone
    playPocket() {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);

        gain.gain.setValueAtTime(0.25, t);
        gain.gain.linearRampToValueAtTime(0.05, t + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.4);
    }

    // Foul — harsh buzzer
    playFoul() {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;

        [150, 148].forEach(freq => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.5);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 0.55);
        });
    }

    // Menu select — PS1 blip
    playSelect() {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.setValueAtTime(660, t + 0.05);

        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.15);
    }

    // Win fanfare
    playWin() {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;
        const notes = [523, 659, 784, 1047];

        notes.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, t + i * 0.15);
            gain.gain.linearRampToValueAtTime(0.1, t + i * 0.15 + 0.02);
            gain.gain.linearRampToValueAtTime(0.05, t + i * 0.15 + 0.14);
            gain.gain.linearRampToValueAtTime(0, t + i * 0.15 + 0.3);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t + i * 0.15);
            osc.stop(t + i * 0.15 + 0.35);
        });
    }
}

// ── Main Game Class ───────────────────────────────────────────────────────────
class RetroPoolGame {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.canvas = null;

        // Sound
        this.sound = new RetroSoundEngine();

        // Game state
        this.gameState = 'loading'; // loading, menu, playing, paused, gameover
        this.currentPlayer = 1;
        this.player1Score = 0;
        this.player2Score = 0;
        this.player1Balls = []; // pocketed ball numbers
        this.player2Balls = [];
        this.player1Type = null; // 'solids' or 'stripes' (assigned on first legal pocket)
        this.player2Type = null;
        this.shotPower = 0;
        this.isChargingShot = false;
        this.gameStarted = false;
        this.pocketedThisTurn = false;
        this.turnMessage = '';
        this.turnMessageTimer = 0;
        this.firstBallPocketed = false;
        this._foulThisTurn = false;

        // Settings
        this.settings = {
            scanlines: true,
            customCursor: true,
            dither: false,
            sound: true,
            jitter: true,
            povCloseup: true,
            aimSensitivity: 1,
            cameraSensitivity: 1,
            zoomSpeed: 1,
            chargeRate: 1,
            fov: 60
        };

        // 3D objects
        this.table = null;
        this.balls = [];
        this.cue = null;
        this.room = null;
        this.windows = [];
        this.aimLine = null;
        this.overheadLight = null;
        this.overheadLamp = null;

        // Camera controls
        this.cameraAngle = 0;
        this.cameraRadius = 8;
        this.cameraHeight = 4;
        this.cameraTarget = new THREE.Vector3(0, 1, 0);
        this.cameraAngleTarget = 0;
        this.cameraRadiusTarget = 8;
        this.cameraHeightTarget = 4;
        this.cameraDamp = 0.12;
        this.fovTarget = 60;
        this.menuAnimation = false;
        this.cameraTransitioning = false;

        // Aiming system
        this.aimingAngle = 0;
        this.isAiming = false;

        // Mouse drag camera
        this.isDraggingCamera = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // POV camera (auto-zoom when charging shot)
        this.povActive = false;
        this.povLerp = 0; // 0 = normal view, 1 = full POV
        this.savedCameraAngle = 0;
        this.savedCameraRadius = 5;
        this.savedCameraHeight = 3;

        this._lastFrameTime = 0;
        this._deltaSec = 1 / 60;

        // Input handling
        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.keys = {};

        // Physics simulation
        this.physics = {
            friction: 0.98,
            tableFriction: 0.985,
            ballRadius: 0.05,
            tableWidth: 4.5,
            tableHeight: 2.25
        };

        this.pocketPositions = [];

        this.init();
    }

    async init() {
        this.showLoadingScreen();
        await this.simulateLoading();
        this.setupEventListeners();
        this.applySettings();
        this.showMainMenu();
    }

    // ── Loading ─────────────────────────────────────────────────────────────
    async simulateLoading() {
        const progressBar = document.querySelector('.loading-progress');
        const loadingText = document.querySelector('.loading-text');

        const loadingSteps = [
            { text: 'Checking Memory Card (Slot 1)...', duration: 600 },
            { text: 'Initializing GPU...', duration: 800 },
            { text: 'Loading Textures...', duration: 600 },
            { text: 'Creating Pool Table...', duration: 500 },
            { text: 'Racking Balls...', duration: 400 },
            { text: 'Setting Up Physics Engine...', duration: 300 },
            { text: 'Calibrating DualShock...', duration: 500 },
            { text: 'Ready!', duration: 300 }
        ];

        for (let i = 0; i < loadingSteps.length; i++) {
            const step = loadingSteps[i];
            loadingText.textContent = step.text;
            progressBar.style.width = `${((i + 1) / loadingSteps.length) * 100}%`;
            const delay = step.duration + Math.random() * 200;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // ── Screen Management ───────────────────────────────────────────────────
    showLoadingScreen() {
        this.hideAllScreens();
        document.getElementById('loadingScreen').classList.add('active');
    }

    showMainMenu() {
        this.hideAllScreens();
        document.getElementById('mainMenu').classList.add('active');
        this.gameState = 'menu';
        this.setGameCursor(false);

        if (!this.gameStarted) {
            this.initializeGame();
            this.startMenuAnimation();
        }
    }

    showGameScreen() {
        this.hideAllScreens();
        document.getElementById('gameScreen').classList.add('active');
        this.gameState = 'playing';
        this.setGameCursor(this.settings.customCursor);
        this.sound.resume();

        this.stopMenuAnimation();
        this.startGameView();
        this.showTurnMessage(`PLAYER ${this.currentPlayer}'S TURN`);
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }

    showOptionsMenu() {
        this.hideAllScreens();
        document.getElementById('optionsMenu').classList.add('active');
        this.gameState = 'menu';
        this.setGameCursor(false);
        this.updateOptionsButtons();
    }

    showGameOver(winner) {
        this.gameState = 'gameover';
        this.setGameCursor(false);

        const overlay = document.getElementById('gameOverScreen');
        const msgEl = document.getElementById('gameOverMessage');
        const subEl = document.getElementById('gameOverSub');

        if (winner > 0) {
            msgEl.textContent = `PLAYER ${winner} WINS!`;
            subEl.textContent = `Score: ${winner === 1 ? this.player1Score : this.player2Score} balls pocketed`;
            this.sound.playWin();
        } else {
            msgEl.textContent = 'GAME OVER';
            subEl.textContent = '8-ball scratch!';
            this.sound.playFoul();
        }

        overlay.classList.add('active');
    }

    showTurnMessage(msg) {
        this.turnMessage = msg;
        this.turnMessageTimer = 120;
        const el = document.getElementById('turnNotification');
        if (el) {
            el.textContent = msg;
            el.classList.add('visible');
            setTimeout(() => el.classList.remove('visible'), 2000);
        }
    }

    // ── Event Listeners ─────────────────────────────────────────────────────
    setupEventListeners() {
        // Menu buttons
        document.getElementById('playButton').addEventListener('click', () => {
            this.sound.playSelect();
            this.showGameScreen();
        });

        document.getElementById('optionsButton').addEventListener('click', () => {
            this.sound.playSelect();
            this.showOptionsMenu();
        });

        document.getElementById('exitButton').addEventListener('click', () => {
            this.sound.playSelect();
            setTimeout(() => {
                if (window.opener || window.history.length > 1) {
                    window.history.back();
                } else {
                    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000;color:#00ff41;font-family:monospace;font-size:2rem;text-align:center;">THANKS FOR PLAYING<br>RETRO POOL</div>';
                }
            }, 300);
        });

        // Options menu buttons
        document.getElementById('toggleScanlines').addEventListener('click', () => {
            this.sound.playSelect();
            this.settings.scanlines = !this.settings.scanlines;
            this.applySettings();
            this.updateOptionsButtons();
        });

        document.getElementById('toggleCursor').addEventListener('click', () => {
            this.sound.playSelect();
            this.settings.customCursor = !this.settings.customCursor;
            this.applySettings();
            this.updateOptionsButtons();
        });

        document.getElementById('toggleDither').addEventListener('click', () => {
            this.sound.playSelect();
            this.settings.dither = !this.settings.dither;
            this.applySettings();
            this.updateOptionsButtons();
        });

        document.getElementById('toggleSound').addEventListener('click', () => {
            this.settings.sound = !this.settings.sound;
            this.sound.setVolume(this.settings.sound ? 0.4 : 0);
            this.updateOptionsButtons();
            if (this.settings.sound) this.sound.playSelect();
        });

        document.getElementById('toggleJitter').addEventListener('click', () => {
            this.sound.playSelect();
            this.settings.jitter = !this.settings.jitter;
            this.updateOptionsButtons();
        });

        document.getElementById('togglePov').addEventListener('click', () => {
            this.sound.playSelect();
            this.settings.povCloseup = !this.settings.povCloseup;
            this.updateOptionsButtons();
        });

        const bindRange = (id, valueId, onChange, formatter) => {
            const input = document.getElementById(id);
            const valueEl = document.getElementById(valueId);
            if (!input || !valueEl) return;

            const update = () => {
                const val = parseFloat(input.value);
                valueEl.textContent = formatter ? formatter(val) : val.toFixed(2);
                onChange(val);
            };

            input.addEventListener('input', update);
            update();
        };

        bindRange('aimSensitivity', 'aimSensitivityValue', (val) => {
            this.settings.aimSensitivity = val;
        }, (val) => val.toFixed(2));

        bindRange('cameraSensitivity', 'cameraSensitivityValue', (val) => {
            this.settings.cameraSensitivity = val;
        }, (val) => val.toFixed(2));

        bindRange('zoomSpeed', 'zoomSpeedValue', (val) => {
            this.settings.zoomSpeed = val;
        }, (val) => val.toFixed(2));

        bindRange('chargeRate', 'chargeRateValue', (val) => {
            this.settings.chargeRate = val;
        }, (val) => val.toFixed(2));

        bindRange('fovSetting', 'fovSettingValue', (val) => {
            this.settings.fov = val;
            this.fovTarget = val;
        }, (val) => `${Math.round(val)}`);

        document.getElementById('optionsBackButton').addEventListener('click', () => {
            this.sound.playSelect();
            this.showMainMenu();
        });

        // Pause menu buttons
        document.getElementById('resumeButton').addEventListener('click', () => {
            this.sound.playSelect();
            this.resumeGame();
        });

        document.getElementById('restartButton').addEventListener('click', () => {
            this.sound.playSelect();
            this.restartGame();
        });

        document.getElementById('menuButton').addEventListener('click', () => {
            this.sound.playSelect();
            this.showMainMenu();
        });

        // Game over buttons
        document.getElementById('playAgainButton').addEventListener('click', () => {
            this.sound.playSelect();
            document.getElementById('gameOverScreen').classList.remove('active');
            this.restartGame();
            this.showGameScreen();
        });

        document.getElementById('gameOverMenuButton').addEventListener('click', () => {
            this.sound.playSelect();
            document.getElementById('gameOverScreen').classList.remove('active');
            this.restartGame();
            this.showMainMenu();
        });

        // Keyboard events
        document.addEventListener('keydown', (event) => {
            this.keys[event.code] = true;
            this.handleKeyDown(event);
        });

        document.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;
            this.handleKeyUp(event);
        });

        // Mouse events
        document.addEventListener('mousemove', (event) => this.handleMouseMove(event));
        document.addEventListener('mousedown', (event) => this.handleMouseDown(event));
        document.addEventListener('mouseup', (event) => this.handleMouseUp(event));

        document.addEventListener('contextmenu', (event) => {
            if (this.gameState === 'playing') event.preventDefault();
        });

        // Mouse wheel zoom
        document.addEventListener('wheel', (event) => {
            if (this.gameState !== 'playing') return;
            if (this.povActive) return; // Don't zoom during POV
            event.preventDefault();
            const delta = event.deltaY * 0.005 * this.settings.zoomSpeed;
            this.cameraRadiusTarget = Math.min(12, Math.max(2.5, this.cameraRadiusTarget + delta));
        }, { passive: false });

        // Window resize
        window.addEventListener('resize', () => this.onWindowResize());

        window.addEventListener('blur', () => {
            this.isDraggingCamera = false;
            if (this.isChargingShot) this.takeShot();
        });

        // Init audio on first user interaction
        const initAudio = () => {
            this.sound.init();
            document.removeEventListener('click', initAudio);
            document.removeEventListener('keydown', initAudio);
        };
        document.addEventListener('click', initAudio);
        document.addEventListener('keydown', initAudio);
    }

    // ── Initialization ──────────────────────────────────────────────────────
    initializeGame() {
        this.setupThreeJS();
        this.createScene();
        this.positionCamera();
        this.gameStarted = true;
        this.animate();
    }

    setupThreeJS() {
        this.canvas = document.getElementById('gameCanvas');

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x1a0f05, 12, 25);

        this.camera = new THREE.PerspectiveCamera(
            this.settings.fov,
            window.innerWidth / window.innerHeight,
            0.1,
            100
        );

        this.fovTarget = this.settings.fov;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: false,
            alpha: false
        });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this.renderer.setClearColor(0x1a0f05);

        this.setupLighting();
    }

    setupLighting() {
        // Warm ambient — PS1 bar atmosphere (brighter for better visibility)
        const ambientLight = new THREE.AmbientLight(0x5d4b3f, 0.7);
        this.scene.add(ambientLight);

        // Main directional light (warmer, brighter)
        const mainLight = new THREE.DirectionalLight(0xffeedd, 0.8);
        mainLight.position.set(5, 8, 5);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 512;
        mainLight.shadow.mapSize.height = 512;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 50;
        mainLight.shadow.camera.left = -10;
        mainLight.shadow.camera.right = 10;
        mainLight.shadow.camera.top = 10;
        mainLight.shadow.camera.bottom = -10;
        this.scene.add(mainLight);

        // Cool fill light (slightly stronger)
        const secondaryLight = new THREE.DirectionalLight(0x6666bb, 0.2);
        secondaryLight.position.set(-3, 5, -3);
        this.scene.add(secondaryLight);

        // Warm bar point lights (brighter, wider range)
        const barLight1 = new THREE.PointLight(0xffaa44, 0.8, 15);
        barLight1.position.set(-4, 3, -4);
        this.scene.add(barLight1);

        const barLight2 = new THREE.PointLight(0xffaa44, 0.8, 15);
        barLight2.position.set(4, 3, -4);
        this.scene.add(barLight2);

        // Additional fill lights to brighten the room
        const fillLight1 = new THREE.PointLight(0xffc488, 0.5, 14);
        fillLight1.position.set(0, 4, 5);
        this.scene.add(fillLight1);

        const fillLight2 = new THREE.PointLight(0xffc488, 0.4, 14);
        fillLight2.position.set(-6, 3, 3);
        this.scene.add(fillLight2);

        const fillLight3 = new THREE.PointLight(0xffc488, 0.4, 14);
        fillLight3.position.set(6, 3, 3);
        this.scene.add(fillLight3);

        // Overhead pool table spotlight (brighter)
        this.overheadLight = new THREE.SpotLight(0xffffcc, 1.5, 10, Math.PI / 4, 0.5, 1);
        this.overheadLight.position.set(0, 5, 0);
        this.overheadLight.target.position.set(0, 1, 0);
        this.overheadLight.castShadow = true;
        this.overheadLight.shadow.mapSize.width = 512;
        this.overheadLight.shadow.mapSize.height = 512;
        this.scene.add(this.overheadLight);
        this.scene.add(this.overheadLight.target);
    }

    // ── Scene Creation ──────────────────────────────────────────────────────
    createScene() {
        this.createRoom();
        this.createPoolTable();
        this.createOverheadLamp();
        this.createBalls();
        this.createCue();
        this.createAimLine();
        this.positionCamera();
    }

    createRoom() {
        const roomGroup = new THREE.Group();

        // Floor — dark wood planks (warmer, lighter)
        const floorGeometry = new THREE.PlaneGeometry(20, 20, 4, 4);
        const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x7a4e2d });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        roomGroup.add(floor);

        // Floor plank lines for texture
        for (let i = -9; i <= 9; i += 1.2) {
            const lineGeo = new THREE.PlaneGeometry(20, 0.02);
            const lineMat = new THREE.MeshBasicMaterial({ color: 0x5a3518, transparent: true, opacity: 0.3 });
            const line = new THREE.Mesh(lineGeo, lineMat);
            line.rotation.x = -Math.PI / 2;
            line.position.set(0, 0.001, i);
            roomGroup.add(line);
        }

        // Walls (warmer, richer brown)
        const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
        const backWallGeometry = new THREE.PlaneGeometry(20, 8, 2, 2);

        const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
        backWall.position.set(0, 4, -10);
        roomGroup.add(backWall);

        const sideWallGeometry = new THREE.PlaneGeometry(20, 8, 2, 2);

        const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
        leftWall.rotation.y = Math.PI / 2;
        leftWall.position.set(-10, 4, 0);
        roomGroup.add(leftWall);

        const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
        rightWall.rotation.y = -Math.PI / 2;
        rightWall.position.set(10, 4, 0);
        roomGroup.add(rightWall);

        const frontWall = new THREE.Mesh(backWallGeometry, wallMaterial);
        frontWall.rotation.y = Math.PI;
        frontWall.position.set(0, 4, 10);
        roomGroup.add(frontWall);

        // Ceiling (slightly lighter for depth)
        const ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0x3d2a1a });
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(20, 20, 2, 2), ceilingMaterial);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = 8;
        roomGroup.add(ceiling);

        // Wainscoting / chair rail along walls (lower half paneling)
        const wainscotMaterial = new THREE.MeshLambertMaterial({ color: 0x4a2a14 });

        // Back wall wainscot
        const wainscotBack = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), wainscotMaterial);
        wainscotBack.position.set(0, 1.5, -9.98);
        roomGroup.add(wainscotBack);

        // Front wall wainscot
        const wainscotFront = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), wainscotMaterial);
        wainscotFront.rotation.y = Math.PI;
        wainscotFront.position.set(0, 1.5, 9.98);
        roomGroup.add(wainscotFront);

        // Left wall wainscot
        const wainscotLeft = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), wainscotMaterial);
        wainscotLeft.rotation.y = Math.PI / 2;
        wainscotLeft.position.set(-9.98, 1.5, 0);
        roomGroup.add(wainscotLeft);

        // Right wall wainscot
        const wainscotRight = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), wainscotMaterial);
        wainscotRight.rotation.y = -Math.PI / 2;
        wainscotRight.position.set(9.98, 1.5, 0);
        roomGroup.add(wainscotRight);

        // Chair rail molding (horizontal strip at 3m height)
        const moldingMat = new THREE.MeshLambertMaterial({ color: 0x3a1c0e });
        const moldingGeo = new THREE.BoxGeometry(20, 0.08, 0.04);

        const moldingBack = new THREE.Mesh(moldingGeo, moldingMat);
        moldingBack.position.set(0, 3, -9.96);
        roomGroup.add(moldingBack);

        const moldingFront = new THREE.Mesh(moldingGeo, moldingMat);
        moldingFront.position.set(0, 3, 9.96);
        roomGroup.add(moldingFront);

        const moldingGeoSide = new THREE.BoxGeometry(0.04, 0.08, 20);
        const moldingLeft = new THREE.Mesh(moldingGeoSide, moldingMat);
        moldingLeft.position.set(-9.96, 3, 0);
        roomGroup.add(moldingLeft);

        const moldingRight = new THREE.Mesh(moldingGeoSide, moldingMat);
        moldingRight.position.set(9.96, 3, 0);
        roomGroup.add(moldingRight);

        // Baseboards
        const baseGeo = new THREE.BoxGeometry(20, 0.12, 0.04);
        const baseMat = new THREE.MeshLambertMaterial({ color: 0x2a1208 });

        const baseBack = new THREE.Mesh(baseGeo, baseMat);
        baseBack.position.set(0, 0.06, -9.96);
        roomGroup.add(baseBack);

        const baseFront = new THREE.Mesh(baseGeo, baseMat);
        baseFront.position.set(0, 0.06, 9.96);
        roomGroup.add(baseFront);

        const baseGeoSide = new THREE.BoxGeometry(0.04, 0.12, 20);
        const baseLeft = new THREE.Mesh(baseGeoSide, baseMat);
        baseLeft.position.set(-9.96, 0.06, 0);
        roomGroup.add(baseLeft);

        const baseRight = new THREE.Mesh(baseGeoSide, baseMat);
        baseRight.position.set(9.96, 0.06, 0);
        roomGroup.add(baseRight);

        this.createWindows(roomGroup);
        this.createBarElements(roomGroup);

        this.scene.add(roomGroup);
        this.room = roomGroup;
    }

    createWindows(roomGroup) {
        const skyMaterial = new THREE.MeshBasicMaterial({ color: 0x87CEEB });
        const skyGeometry = new THREE.PlaneGeometry(5, 4);

        const mainSky = new THREE.Mesh(skyGeometry, skyMaterial);
        mainSky.position.set(3, 5, -10.1);
        roomGroup.add(mainSky);

        const sideSky1 = new THREE.Mesh(skyGeometry, skyMaterial);
        sideSky1.rotation.y = Math.PI / 2;
        sideSky1.position.set(-10.1, 5, 3);
        roomGroup.add(sideSky1);

        const sideSky2 = new THREE.Mesh(skyGeometry, skyMaterial);
        sideSky2.rotation.y = -Math.PI / 2;
        sideSky2.position.set(10.1, 5, -3);
        roomGroup.add(sideSky2);

        const windowFrameMaterial = new THREE.MeshLambertMaterial({ color: 0x3a1c1a });
        const windowGeometry = new THREE.PlaneGeometry(4, 3);
        const windowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3
        });

        const mainWindow = new THREE.Mesh(windowGeometry, windowMaterial);
        mainWindow.position.set(3, 5, -9.9);
        roomGroup.add(mainWindow);

        const frameThickness = 0.05;
        const frameGeometry1 = new THREE.BoxGeometry(4.2, 0.1, frameThickness);
        const frameGeometry2 = new THREE.BoxGeometry(0.1, 3.2, frameThickness);

        const topFrame = new THREE.Mesh(frameGeometry1, windowFrameMaterial);
        topFrame.position.set(3, 6.55, -9.85);
        roomGroup.add(topFrame);

        const bottomFrame = new THREE.Mesh(frameGeometry1, windowFrameMaterial);
        bottomFrame.position.set(3, 3.45, -9.85);
        roomGroup.add(bottomFrame);

        const leftFrame = new THREE.Mesh(frameGeometry2, windowFrameMaterial);
        leftFrame.position.set(1, 5, -9.85);
        roomGroup.add(leftFrame);

        const rightFrame = new THREE.Mesh(frameGeometry2, windowFrameMaterial);
        rightFrame.position.set(5, 5, -9.85);
        roomGroup.add(rightFrame);

        // Cross dividers
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(4, 0.06, frameThickness), windowFrameMaterial);
        crossH.position.set(3, 5, -9.85);
        roomGroup.add(crossH);

        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3, frameThickness), windowFrameMaterial);
        crossV.position.set(3, 5, -9.85);
        roomGroup.add(crossV);

        const sideWindow1 = new THREE.Mesh(windowGeometry, windowMaterial.clone());
        sideWindow1.rotation.y = Math.PI / 2;
        sideWindow1.position.set(-9.9, 5, 3);
        roomGroup.add(sideWindow1);

        const sideWindow2 = new THREE.Mesh(windowGeometry, windowMaterial.clone());
        sideWindow2.rotation.y = -Math.PI / 2;
        sideWindow2.position.set(9.9, 5, -3);
        roomGroup.add(sideWindow2);

        this.windows = [mainWindow, sideWindow1, sideWindow2];
    }

    createBarElements(roomGroup) {
        // Bar counter
        const barGeometry = new THREE.BoxGeometry(8, 1, 1.5, 1, 1, 1);
        const barMaterial = new THREE.MeshLambertMaterial({ color: 0x3a1c1a });
        const bar = new THREE.Mesh(barGeometry, barMaterial);
        bar.position.set(-5, 0.5, -8);
        bar.castShadow = true;
        roomGroup.add(bar);

        const barTopGeometry = new THREE.BoxGeometry(8.2, 0.1, 1.7, 1, 1, 1);
        const barTopMaterial = new THREE.MeshLambertMaterial({ color: 0x2f1b14 });
        const barTop = new THREE.Mesh(barTopGeometry, barTopMaterial);
        barTop.position.set(-5, 1.05, -8);
        barTop.castShadow = true;
        roomGroup.add(barTop);

        // Bar stools with red vinyl seats
        for (let i = 0; i < 3; i++) {
            const stoolGeometry = new THREE.CylinderGeometry(0.08, 0.12, 1.5, 6);
            const stoolMaterial = new THREE.MeshLambertMaterial({ color: 0x2f1b14 });
            const stool = new THREE.Mesh(stoolGeometry, stoolMaterial);
            stool.position.set(-6 + i * 2, 0.75, -6.5);
            stool.castShadow = true;
            roomGroup.add(stool);

            const seatGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 6);
            const seatMaterial = new THREE.MeshLambertMaterial({ color: 0x8b0000 });
            const seat = new THREE.Mesh(seatGeometry, seatMaterial);
            seat.position.set(-6 + i * 2, 1.55, -6.5);
            seat.castShadow = true;
            roomGroup.add(seat);
        }

        // Shelving behind bar
        for (let shelf = 0; shelf < 3; shelf++) {
            const shelfGeometry = new THREE.BoxGeometry(7, 0.05, 0.3, 1, 1, 1);
            const shelfMaterial = new THREE.MeshLambertMaterial({ color: 0x3a1c1a });
            const shelfMesh = new THREE.Mesh(shelfGeometry, shelfMaterial);
            shelfMesh.position.set(-5, 2 + shelf * 0.8, -9.7);
            shelfMesh.castShadow = true;
            roomGroup.add(shelfMesh);

            for (let bottle = 0; bottle < 5; bottle++) {
                const bottleGeometry = new THREE.CylinderGeometry(0.03, 0.05, 0.35, 5);
                const bottleColors = [0x228B22, 0x8B4513, 0x4169E1, 0x800080, 0xdaa520];
                const bottleMaterial = new THREE.MeshLambertMaterial({
                    color: bottleColors[bottle % bottleColors.length]
                });
                const bottleMesh = new THREE.Mesh(bottleGeometry, bottleMaterial);
                bottleMesh.position.set(-7.5 + bottle * 1.3, 2.25 + shelf * 0.8, -9.55);
                bottleMesh.castShadow = true;
                roomGroup.add(bottleMesh);
            }
        }

        // Hanging light fixtures
        for (let i = 0; i < 2; i++) {
            const cordGeometry = new THREE.CylinderGeometry(0.01, 0.01, 2, 4);
            const cordMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
            const cord = new THREE.Mesh(cordGeometry, cordMaterial);
            cord.position.set(-3 + i * 6, 6, -2);
            roomGroup.add(cord);

            const shadeGeometry = new THREE.ConeGeometry(0.4, 0.6, 6);
            const shadeMaterial = new THREE.MeshLambertMaterial({ color: 0x6b3410 });
            const shade = new THREE.Mesh(shadeGeometry, shadeMaterial);
            shade.position.set(-3 + i * 6, 4.7, -2);
            shade.castShadow = true;
            roomGroup.add(shade);
        }

        // Pool cue rack on wall
        const rackGeometry = new THREE.BoxGeometry(2, 0.1, 0.1, 1, 1, 1);
        const rackMaterial = new THREE.MeshLambertMaterial({ color: 0x3a1c1a });
        const rack = new THREE.Mesh(rackGeometry, rackMaterial);
        rack.position.set(8, 3, -9.9);
        rack.castShadow = true;
        roomGroup.add(rack);

        for (let i = 0; i < 4; i++) {
            const cueGeometry = new THREE.CylinderGeometry(0.008, 0.012, 1.8, 6);
            const cueMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
            const cue = new THREE.Mesh(cueGeometry, cueMaterial);
            cue.position.set(7.5 + i * 0.3, 3.9, -9.8);
            cue.rotation.z = Math.PI / 2;
            cue.castShadow = true;
            roomGroup.add(cue);
        }

        // Neon "OPEN" sign
        const signGeometry = new THREE.PlaneGeometry(1.2, 0.4);
        const signMaterial = new THREE.MeshBasicMaterial({ color: 0xff0044 });
        const sign = new THREE.Mesh(signGeometry, signMaterial);
        sign.position.set(6, 4, -9.88);
        roomGroup.add(sign);

        const signGlow = new THREE.PointLight(0xff0044, 0.3, 3);
        signGlow.position.set(6, 4, -9.5);
        roomGroup.add(signGlow);

        // Dartboard on right wall
        const dartboardGeometry = new THREE.CircleGeometry(0.5, 12);
        const dartboardMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const dartboard = new THREE.Mesh(dartboardGeometry, dartboardMaterial);
        dartboard.rotation.y = -Math.PI / 2;
        dartboard.position.set(9.88, 3.5, 0);
        roomGroup.add(dartboard);

        const innerGeometry = new THREE.CircleGeometry(0.35, 12);
        const innerMaterial = new THREE.MeshLambertMaterial({ color: 0x006400 });
        const inner = new THREE.Mesh(innerGeometry, innerMaterial);
        inner.rotation.y = -Math.PI / 2;
        inner.position.set(9.87, 3.5, 0);
        roomGroup.add(inner);

        const bullseyeGeometry = new THREE.CircleGeometry(0.08, 8);
        const bullseyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const bullseye = new THREE.Mesh(bullseyeGeometry, bullseyeMaterial);
        bullseye.rotation.y = -Math.PI / 2;
        bullseye.position.set(9.86, 3.5, 0);
        roomGroup.add(bullseye);

        // Dartboard light
        const dartLight = new THREE.PointLight(0xffcc88, 0.4, 4);
        dartLight.position.set(9.3, 4.2, 0);
        roomGroup.add(dartLight);

        // Scoreboard / chalkboard on back wall
        const boardGeo = new THREE.PlaneGeometry(2, 1.5);
        const boardMat = new THREE.MeshLambertMaterial({ color: 0x1a2a1a });
        const board = new THREE.Mesh(boardGeo, boardMat);
        board.position.set(-3, 4, -9.88);
        roomGroup.add(board);

        // Board frame
        const bFrameMat = new THREE.MeshLambertMaterial({ color: 0x3a1c1a });
        const bfTop = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.03), bFrameMat);
        bfTop.position.set(-3, 4.78, -9.86);
        roomGroup.add(bfTop);
        const bfBot = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.03), bFrameMat);
        bfBot.position.set(-3, 3.22, -9.86);
        roomGroup.add(bfBot);
        const bfL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.03), bFrameMat);
        bfL.position.set(-4.03, 4, -9.86);
        roomGroup.add(bfL);
        const bfR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.03), bFrameMat);
        bfR.position.set(-1.97, 4, -9.86);
        roomGroup.add(bfR);

        // Jukebox against left wall
        const jukeboxBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 1.6, 0.5, 1, 1, 1),
            new THREE.MeshLambertMaterial({ color: 0x5c2a0e })
        );
        jukeboxBody.position.set(-9.5, 0.8, -5);
        jukeboxBody.castShadow = true;
        roomGroup.add(jukeboxBody);

        const jukeboxTop = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, 0.6, 0.55, 1, 1, 1),
            new THREE.MeshLambertMaterial({ color: 0x7a3812 })
        );
        jukeboxTop.position.set(-9.5, 1.9, -5);
        jukeboxTop.castShadow = true;
        roomGroup.add(jukeboxTop);

        // Jukebox colorful window
        const jukeboxWindow = new THREE.Mesh(
            new THREE.PlaneGeometry(0.5, 0.35),
            new THREE.MeshBasicMaterial({ color: 0xff6600 })
        );
        jukeboxWindow.rotation.y = Math.PI / 2;
        jukeboxWindow.position.set(-9.24, 1.9, -5);
        roomGroup.add(jukeboxWindow);

        // Jukebox glow
        const jukeboxGlow = new THREE.PointLight(0xff6600, 0.3, 3);
        jukeboxGlow.position.set(-9, 1.9, -5);
        roomGroup.add(jukeboxGlow);

        // Floor rug under pool table area
        const rugGeometry = new THREE.PlaneGeometry(6, 4, 1, 1);
        const rugMaterial = new THREE.MeshLambertMaterial({ color: 0x6b1a1a });
        const rug = new THREE.Mesh(rugGeometry, rugMaterial);
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(0, 0.005, 0);
        roomGroup.add(rug);

        // Rug border
        const rugBorderGeo = new THREE.PlaneGeometry(6.3, 4.3, 1, 1);
        const rugBorderMat = new THREE.MeshLambertMaterial({ color: 0x4a0e0e });
        const rugBorder = new THREE.Mesh(rugBorderGeo, rugBorderMat);
        rugBorder.rotation.x = -Math.PI / 2;
        rugBorder.position.set(0, 0.003, 0);
        roomGroup.add(rugBorder);

        // Picture frames on left wall
        for (let i = 0; i < 2; i++) {
            const frameGeo = new THREE.BoxGeometry(0.04, 1.0, 0.8);
            const frameMat = new THREE.MeshLambertMaterial({ color: 0xb8860b });
            const frame = new THREE.Mesh(frameGeo, frameMat);
            frame.position.set(-9.88, 4.5, 4 + i * 2.5);
            roomGroup.add(frame);

            const picGeo = new THREE.PlaneGeometry(0.85, 0.65);
            const picColors = [0x2a4a6a, 0x4a2a2a];
            const picMat = new THREE.MeshLambertMaterial({ color: picColors[i] });
            const pic = new THREE.Mesh(picGeo, picMat);
            pic.rotation.y = Math.PI / 2;
            pic.position.set(-9.86, 4.5, 4 + i * 2.5);
            roomGroup.add(pic);
        }
    }

    createOverheadLamp() {
        const lampGroup = new THREE.Group();

        // Chain
        const chainGeo = new THREE.CylinderGeometry(0.015, 0.015, 3, 4);
        const chainMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
        const chain = new THREE.Mesh(chainGeo, chainMat);
        chain.position.y = 5.5;
        lampGroup.add(chain);

        // Classic pool hall green shade
        const shadeGeo = new THREE.BoxGeometry(2.5, 0.12, 0.8, 1, 1, 1);
        const shadeMat = new THREE.MeshLambertMaterial({ color: 0x006400 });
        const shade = new THREE.Mesh(shadeGeo, shadeMat);
        shade.position.y = 3.95;
        shade.castShadow = true;
        lampGroup.add(shade);

        // Gold rim
        const rimGeo = new THREE.BoxGeometry(2.6, 0.04, 0.9, 1, 1, 1);
        const rimMat = new THREE.MeshLambertMaterial({ color: 0xb8860b });
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.position.y = 3.88;
        lampGroup.add(rim);

        // Bulb glow
        const bulbGeo = new THREE.SphereGeometry(0.05, 6, 4);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.y = 3.85;
        lampGroup.add(bulb);

        lampGroup.position.set(0, 0, 0);
        this.scene.add(lampGroup);
        this.overheadLamp = lampGroup;
    }

    createPoolTable() {
        const tableGroup = new THREE.Group();

        // Table surface (felt)
        const surfaceGeometry = new THREE.BoxGeometry(
            this.physics.tableWidth,
            0.1,
            this.physics.tableHeight,
            1, 1, 1
        );
        const surfaceMaterial = new THREE.MeshLambertMaterial({ color: 0x0d6b23 });
        const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
        surface.position.y = 1;
        surface.receiveShadow = true;
        tableGroup.add(surface);

        // Table body/frame
        const bodyGeometry = new THREE.BoxGeometry(
            this.physics.tableWidth + 0.3,
            0.15,
            this.physics.tableHeight + 0.3,
            1, 1, 1
        );
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x3a1c1a });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.925;
        body.castShadow = true;
        tableGroup.add(body);

        // Table legs — properly grounded
        const legGeometry = new THREE.BoxGeometry(0.15, 0.85, 0.15, 1, 1, 1);
        const legMaterial = new THREE.MeshLambertMaterial({ color: 0x3a1c1a });

        const legPositions = [
            [-this.physics.tableWidth / 2 + 0.1, 0.425, -this.physics.tableHeight / 2 + 0.1],
            [this.physics.tableWidth / 2 - 0.1, 0.425, -this.physics.tableHeight / 2 + 0.1],
            [-this.physics.tableWidth / 2 + 0.1, 0.425, this.physics.tableHeight / 2 - 0.1],
            [this.physics.tableWidth / 2 - 0.1, 0.425, this.physics.tableHeight / 2 - 0.1]
        ];

        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.position.set(...pos);
            leg.castShadow = true;
            leg.receiveShadow = true;
            tableGroup.add(leg);
        });

        // Rails (split for middle pocket openings)
        const railMaterial = new THREE.MeshLambertMaterial({ color: 0x3a1c1a });
        const railCushionMaterial = new THREE.MeshLambertMaterial({ color: 0x0a5e1c });

        const halfLongRail = (this.physics.tableWidth - 0.3) / 2;

        // Top rail halves
        const topRailGeo = new THREE.BoxGeometry(halfLongRail, 0.15, 0.15, 1, 1, 1);

        const topRailLeft = new THREE.Mesh(topRailGeo, railMaterial);
        topRailLeft.position.set(-halfLongRail / 2 - 0.05, 1.1, this.physics.tableHeight / 2 + 0.075);
        topRailLeft.castShadow = true;
        tableGroup.add(topRailLeft);

        const topRailRight = new THREE.Mesh(topRailGeo, railMaterial);
        topRailRight.position.set(halfLongRail / 2 + 0.05, 1.1, this.physics.tableHeight / 2 + 0.075);
        topRailRight.castShadow = true;
        tableGroup.add(topRailRight);

        // Bottom rail halves
        const bottomRailLeft = new THREE.Mesh(topRailGeo, railMaterial);
        bottomRailLeft.position.set(-halfLongRail / 2 - 0.05, 1.1, -this.physics.tableHeight / 2 - 0.075);
        bottomRailLeft.castShadow = true;
        tableGroup.add(bottomRailLeft);

        const bottomRailRight = new THREE.Mesh(topRailGeo, railMaterial);
        bottomRailRight.position.set(halfLongRail / 2 + 0.05, 1.1, -this.physics.tableHeight / 2 - 0.075);
        bottomRailRight.castShadow = true;
        tableGroup.add(bottomRailRight);

        // Short rails
        const shortRailGeometry = new THREE.BoxGeometry(0.15, 0.15, this.physics.tableHeight - 0.1, 1, 1, 1);

        const leftRail = new THREE.Mesh(shortRailGeometry, railMaterial);
        leftRail.position.set(-this.physics.tableWidth / 2 - 0.075, 1.1, 0);
        leftRail.castShadow = true;
        tableGroup.add(leftRail);

        const rightRail = new THREE.Mesh(shortRailGeometry, railMaterial);
        rightRail.position.set(this.physics.tableWidth / 2 + 0.075, 1.1, 0);
        rightRail.castShadow = true;
        tableGroup.add(rightRail);

        // Rail cushions (green bumpers)
        const cushionH = 0.06;
        const longCushionGeo = new THREE.BoxGeometry(halfLongRail - 0.1, cushionH, 0.04, 1, 1, 1);

        [[1, -0.01], [-1, 0.01]].forEach(([sign, zOff]) => {
            const zPos = sign * (this.physics.tableHeight / 2) + zOff;
            const cl = new THREE.Mesh(longCushionGeo, railCushionMaterial);
            cl.position.set(-halfLongRail / 2 - 0.05, 1.08, zPos);
            tableGroup.add(cl);
            const cr = new THREE.Mesh(longCushionGeo, railCushionMaterial);
            cr.position.set(halfLongRail / 2 + 0.05, 1.08, zPos);
            tableGroup.add(cr);
        });

        const shortCushionGeo = new THREE.BoxGeometry(0.04, cushionH, this.physics.tableHeight - 0.2, 1, 1, 1);
        const leftCushion = new THREE.Mesh(shortCushionGeo, railCushionMaterial);
        leftCushion.position.set(-this.physics.tableWidth / 2 + 0.01, 1.08, 0);
        tableGroup.add(leftCushion);

        const rightCushion = new THREE.Mesh(shortCushionGeo, railCushionMaterial);
        rightCushion.position.set(this.physics.tableWidth / 2 - 0.01, 1.08, 0);
        tableGroup.add(rightCushion);

        // Pockets
        const pocketGeometry = new THREE.CircleGeometry(0.1, 8);
        const pocketMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

        const halfW = this.physics.tableWidth / 2;
        const halfH = this.physics.tableHeight / 2;
        const pocketPositions = [
            [-halfW, 1.06, -halfH],
            [halfW, 1.06, -halfH],
            [-halfW, 1.06, halfH],
            [halfW, 1.06, halfH],
            [0, 1.06, -halfH],
            [0, 1.06, halfH]
        ];

        this.pocketPositions = pocketPositions.map(pos => ({ x: pos[0], z: pos[2] }));

        pocketPositions.forEach(pos => {
            const pocket = new THREE.Mesh(pocketGeometry, pocketMaterial);
            pocket.rotation.x = -Math.PI / 2;
            pocket.position.set(...pos);
            tableGroup.add(pocket);

            // Pocket rim
            const rimGeo = new THREE.TorusGeometry(0.1, 0.015, 4, 8);
            const rimMat = new THREE.MeshLambertMaterial({ color: 0x2a1a0e });
            const rim = new THREE.Mesh(rimGeo, rimMat);
            rim.rotation.x = -Math.PI / 2;
            rim.position.set(pos[0], pos[1] + 0.01, pos[2]);
            tableGroup.add(rim);
        });

        // Head string (faint line)
        const headStringGeo = new THREE.PlaneGeometry(0.005, this.physics.tableHeight - 0.2);
        const headStringMat = new THREE.MeshBasicMaterial({ color: 0x1a8a3a, transparent: true, opacity: 0.35 });
        const headString = new THREE.Mesh(headStringGeo, headStringMat);
        headString.rotation.x = -Math.PI / 2;
        headString.position.set(-1, 1.06, 0);
        tableGroup.add(headString);

        // Foot spot
        const spotGeo = new THREE.CircleGeometry(0.015, 6);
        const spotMat = new THREE.MeshBasicMaterial({ color: 0x1a8a3a });
        const spot = new THREE.Mesh(spotGeo, spotMat);
        spot.rotation.x = -Math.PI / 2;
        spot.position.set(1, 1.06, 0);
        tableGroup.add(spot);

        this.scene.add(tableGroup);
        this.table = tableGroup;
    }

    createBalls() {
        this.balls = [];

        const ballConfigs = [
            { color: 0xf5f5f0, stripe: false, number: 0 },
            { color: 0xf5d200, stripe: false, number: 1 },
            { color: 0x0044cc, stripe: false, number: 2 },
            { color: 0xcc0000, stripe: false, number: 3 },
            { color: 0x6600aa, stripe: false, number: 4 },
            { color: 0xff8800, stripe: false, number: 5 },
            { color: 0x007700, stripe: false, number: 6 },
            { color: 0x880000, stripe: false, number: 7 },
            { color: 0x111111, stripe: false, number: 8 },
            { color: 0xf5d200, stripe: true, number: 9 },
            { color: 0x0044cc, stripe: true, number: 10 },
            { color: 0xcc0000, stripe: true, number: 11 },
            { color: 0x6600aa, stripe: true, number: 12 },
            { color: 0xff8800, stripe: true, number: 13 },
            { color: 0x007700, stripe: true, number: 14 },
            { color: 0x880000, stripe: true, number: 15 }
        ];

        const r = this.physics.ballRadius;
        const ballPositions = this.generateBallPositions();

        ballPositions.forEach((pos, index) => {
            const cfg = ballConfigs[index];
            let ball;

            if (cfg.stripe && index > 0) {
                ball = this.createStripedBall(cfg.color, r);
            } else if (index === 0) {
                const geo = new THREE.SphereGeometry(r, 10, 8);
                const mat = new THREE.MeshPhongMaterial({
                    color: 0xf5f5f0,
                    shininess: 80,
                    specular: 0x444444
                });
                ball = new THREE.Mesh(geo, mat);
            } else {
                const geo = new THREE.SphereGeometry(r, 8, 6);
                const mat = new THREE.MeshLambertMaterial({ color: cfg.color });
                ball = new THREE.Mesh(geo, mat);
            }

            ball.position.set(pos.x, 1.05 + r, pos.z);
            ball.castShadow = true;
            ball.userData = {
                velocity: new THREE.Vector3(0, 0, 0),
                number: cfg.number,
                isMoving: false,
                isPocketed: false,
                isSolid: index >= 1 && index <= 7,
                isStripe: index >= 9 && index <= 15,
                is8Ball: index === 8,
                isCueBall: index === 0
            };

            this.scene.add(ball);
            this.balls.push(ball);
        });
    }

    createStripedBall(color, radius) {
        const geo = new THREE.SphereGeometry(radius, 8, 8);
        const positions = geo.attributes.position;
        const colors = new Float32Array(positions.count * 3);

        const mainColor = new THREE.Color(color);
        const white = new THREE.Color(0xf5f5f0);

        for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i);
            const normalizedY = y / radius;

            const c = Math.abs(normalizedY) < 0.45 ? mainColor : white;
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }

        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
        return new THREE.Mesh(geo, mat);
    }

    generateBallPositions() {
        const positions = [];
        const spacing = this.physics.ballRadius * 2.2;

        // Cue ball (behind head string)
        positions.push({ x: -1.5, z: 0 });

        // Standard 8-ball rack: 8 in center, mix solids/stripes
        const rackOrder = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
        let rackIndex = 0;

        const tempPositions = [];
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col <= row; col++) {
                const x = 1 + row * spacing * 0.866;
                const z = (col - row / 2) * spacing;
                tempPositions.push({ x, z, ballNum: rackOrder[rackIndex] });
                rackIndex++;
            }
        }

        // Sort by ball number to match creation order
        tempPositions.sort((a, b) => a.ballNum - b.ballNum);
        tempPositions.forEach(p => positions.push({ x: p.x, z: p.z }));

        return positions;
    }

    createCue() {
        const cueGroup = new THREE.Group();

        // Shaft (lighter maple)
        const shaftGeometry = new THREE.CylinderGeometry(0.006, 0.01, 1.2, 6);
        const shaftMaterial = new THREE.MeshLambertMaterial({ color: 0xdeb887 });
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        shaft.position.x = 0.3;
        shaft.rotation.z = Math.PI / 2;
        cueGroup.add(shaft);

        // Butt (dark wood)
        const buttGeometry = new THREE.CylinderGeometry(0.01, 0.012, 0.4, 6);
        const buttMaterial = new THREE.MeshLambertMaterial({ color: 0x4a2c2a });
        const butt = new THREE.Mesh(buttGeometry, buttMaterial);
        butt.position.x = -0.5;
        butt.rotation.z = Math.PI / 2;
        cueGroup.add(butt);

        // Ferrule (white tip)
        const ferruleGeo = new THREE.CylinderGeometry(0.005, 0.006, 0.03, 6);
        const ferruleMat = new THREE.MeshBasicMaterial({ color: 0xf0f0f0 });
        const ferrule = new THREE.Mesh(ferruleGeo, ferruleMat);
        ferrule.position.x = 0.92;
        ferrule.rotation.z = Math.PI / 2;
        cueGroup.add(ferrule);

        // Irish linen wrap
        const wrapGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.15, 6);
        const wrapMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
        const wrap = new THREE.Mesh(wrapGeo, wrapMat);
        wrap.position.x = -0.2;
        wrap.rotation.z = Math.PI / 2;
        cueGroup.add(wrap);

        cueGroup.position.set(-2, 1.1, 0);
        cueGroup.visible = false;

        this.scene.add(cueGroup);
        this.cue = cueGroup;
    }

    createAimLine() {
        const material = new THREE.LineDashedMaterial({
            color: 0xffffff,
            dashSize: 0.05,
            gapSize: 0.04,
            transparent: true,
            opacity: 0.5
        });

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(9);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        this.aimLine = new THREE.Line(geometry, material);
        this.aimLine.visible = false;
        this.aimLine.computeLineDistances();
        this.scene.add(this.aimLine);
    }

    // ── Camera ──────────────────────────────────────────────────────────────
    positionCamera() {
        this.updateCameraPosition();
    }

    updateCameraPosition() {
        const dtScale = this._deltaSec * 60;
        const damp = 1 - Math.pow(1 - this.cameraDamp, dtScale);

        // If POV is active or restoring, blend between normal and POV views
        if (this.povActive || this.povLerp > 0.01) {
            // Lerp POV blend factor
            const targetLerp = this.povActive ? 1 : 0;
            this.povLerp += (targetLerp - this.povLerp) * 0.06;
            if (Math.abs(this.povLerp - targetLerp) < 0.005) this.povLerp = targetLerp;

            // POV target: low behind the cue ball looking along the aim
            const cueBall = this.balls[0];
            if (cueBall && !cueBall.userData.isPocketed) {
                const behindDist = 1.8;
                const povHeight = 1.35;
                const povX = cueBall.position.x - Math.cos(this.aimingAngle) * behindDist;
                const povZ = cueBall.position.z - Math.sin(this.aimingAngle) * behindDist;

                // Normal camera position
                const normX = Math.cos(this.savedCameraAngle) * this.savedCameraRadius;
                const normZ = Math.sin(this.savedCameraAngle) * this.savedCameraRadius;
                const normY = this.savedCameraHeight;

                // Blend positions
                const t = this.povLerp;
                const camX = normX + (povX - normX) * t;
                const camZ = normZ + (povZ - normZ) * t;
                const camY = normY + (povHeight - normY) * t;

                // Blend look targets
                const lookAheadDist = 2;
                const povLookX = cueBall.position.x + Math.cos(this.aimingAngle) * lookAheadDist;
                const povLookZ = cueBall.position.z + Math.sin(this.aimingAngle) * lookAheadDist;
                const povLookY = cueBall.position.y;

                const normLookX = this.cameraTarget.x;
                const normLookZ = this.cameraTarget.z;
                const normLookY = this.cameraTarget.y;

                const lookX = normLookX + (povLookX - normLookX) * t;
                const lookZ = normLookZ + (povLookZ - normLookZ) * t;
                const lookY = normLookY + (povLookY - normLookY) * t;

                this.camera.position.set(camX, camY, camZ);
                this.camera.lookAt(lookX, lookY, lookZ);
                return;
            }
        }

        this.cameraAngle += (this.cameraAngleTarget - this.cameraAngle) * damp;
        this.cameraRadius += (this.cameraRadiusTarget - this.cameraRadius) * damp;
        this.cameraHeight += (this.cameraHeightTarget - this.cameraHeight) * damp;

        if (this.camera && Math.abs(this.camera.fov - this.fovTarget) > 0.01) {
            this.camera.fov += (this.fovTarget - this.camera.fov) * damp;
            this.camera.updateProjectionMatrix();
        }

        const x = Math.cos(this.cameraAngle) * this.cameraRadius;
        const z = Math.sin(this.cameraAngle) * this.cameraRadius;

        this.camera.position.set(x, this.cameraHeight, z);
        this.camera.lookAt(this.cameraTarget);
    }

    startMenuAnimation() {
        this.menuAnimation = true;
        this.cameraAngle = 0;
        this.cameraRadius = 10;
        this.cameraHeight = 5;
        this.cameraAngleTarget = 0;
        this.cameraRadiusTarget = 10;
        this.cameraHeightTarget = 5;
    }

    stopMenuAnimation() {
        this.menuAnimation = false;
        this.cameraTransitioning = true;
    }

    startGameView() {
        this.cameraRadius = 5;
        this.cameraHeight = 3;
        this.cameraAngle = Math.PI;
        this.cameraRadiusTarget = 5;
        this.cameraHeightTarget = 3;
        this.cameraAngleTarget = Math.PI;
        this.cameraTarget.set(0, 1, 0);
    }

    // ── Aiming ──────────────────────────────────────────────────────────────
    startAiming() {
        if (this.balls[0].userData.isMoving) return;
        if (this.areBallsMoving()) return;

        this.isAiming = true;
        this.cue.visible = true;
        if (this.aimLine) this.aimLine.visible = true;
        this.updateCueAiming();
    }

    updateCueAiming() {
        if (!this.isAiming) return;

        const cueBall = this.balls[0];
        if (!cueBall || cueBall.userData.isPocketed) return;

        const distance = 0.15 + (this.isChargingShot ? this.shotPower * 0.003 : 0);

        const x = cueBall.position.x - Math.cos(this.aimingAngle) * distance;
        const z = cueBall.position.z - Math.sin(this.aimingAngle) * distance;

        this.cue.position.set(x, cueBall.position.y, z);
        this.cue.rotation.y = -this.aimingAngle;

        this.updateAimLine();
    }

    updateAimLine() {
        if (!this.aimLine || !this.isAiming) return;

        const cueBall = this.balls[0];
        const dir = new THREE.Vector3(
            Math.cos(this.aimingAngle),
            0,
            Math.sin(this.aimingAngle)
        );

        const start = new THREE.Vector3(cueBall.position.x, cueBall.position.y, cueBall.position.z);
        const maxDist = 6;
        let hitPoint = null;
        let hitNormal = null;
        let hitType = null;
        let minT = maxDist;

        const hitRadius = this.physics.ballRadius * 2;
        const hitRadiusSq = hitRadius * hitRadius;

        for (let i = 1; i < this.balls.length; i++) {
            const ball = this.balls[i];
            if (ball.userData.isPocketed) continue;
            const toBall = new THREE.Vector3(
                ball.position.x - start.x,
                0,
                ball.position.z - start.z
            );
            const t = toBall.dot(dir);
            if (t <= 0 || t > minT) continue;

            const closestX = start.x + dir.x * t;
            const closestZ = start.z + dir.z * t;
            const dx = ball.position.x - closestX;
            const dz = ball.position.z - closestZ;
            const distSq = dx * dx + dz * dz;

            if (distSq <= hitRadiusSq) {
                const thc = Math.sqrt(hitRadiusSq - distSq);
                const tHit = t - thc;
                if (tHit > 0 && tHit < minT) {
                    minT = tHit;
                    hitPoint = new THREE.Vector3(
                        start.x + dir.x * tHit,
                        start.y,
                        start.z + dir.z * tHit
                    );
                    hitNormal = new THREE.Vector3(
                        hitPoint.x - ball.position.x,
                        0,
                        hitPoint.z - ball.position.z
                    ).normalize();
                    hitType = 'ball';
                }
            }
        }

        const hw = this.physics.tableWidth / 2;
        const hh = this.physics.tableHeight / 2;
        const edges = [
            { axis: 'x', value: -hw, normal: new THREE.Vector3(1, 0, 0) },
            { axis: 'x', value: hw, normal: new THREE.Vector3(-1, 0, 0) },
            { axis: 'z', value: -hh, normal: new THREE.Vector3(0, 0, 1) },
            { axis: 'z', value: hh, normal: new THREE.Vector3(0, 0, -1) }
        ];

        edges.forEach((edge) => {
            const d = edge.axis === 'x' ? dir.x : dir.z;
            if (Math.abs(d) < 0.0001) return;
            const t = (edge.value - (edge.axis === 'x' ? start.x : start.z)) / d;
            if (t <= 0 || t > minT) return;
            const hitX = start.x + dir.x * t;
            const hitZ = start.z + dir.z * t;
            if (hitX < -hw - 0.05 || hitX > hw + 0.05 || hitZ < -hh - 0.05 || hitZ > hh + 0.05) return;
            minT = t;
            hitPoint = new THREE.Vector3(hitX, start.y, hitZ);
            hitNormal = edge.normal.clone();
            hitType = 'cushion';
        });

        const end = hitPoint || new THREE.Vector3(
            start.x + dir.x * maxDist,
            start.y,
            start.z + dir.z * maxDist
        );

        let second = end.clone();
        if (hitPoint && hitNormal) {
            if (hitType === 'cushion') {
                const reflect = dir.clone().sub(hitNormal.clone().multiplyScalar(2 * dir.dot(hitNormal)));
                second = hitPoint.clone().add(reflect.multiplyScalar(0.6));
            } else {
                const objectDir = hitNormal.clone().multiplyScalar(-1);
                second = hitPoint.clone().add(objectDir.multiplyScalar(0.5));
            }
        }

        const y = start.y;

        const positions = this.aimLine.geometry.attributes.position.array;
        positions[0] = start.x;
        positions[1] = y;
        positions[2] = start.z;
        positions[3] = end.x;
        positions[4] = y;
        positions[5] = end.z;
        positions[6] = second.x;
        positions[7] = y;
        positions[8] = second.z;

        this.aimLine.geometry.attributes.position.needsUpdate = true;
        this.aimLine.computeLineDistances();
        this.aimLine.visible = true;
    }

    areBallsMoving() {
        return this.balls.some(b => !b.userData.isPocketed && b.userData.isMoving);
    }

    // ── Input Handling ──────────────────────────────────────────────────────
    handleKeyDown(event) {
        switch (event.code) {
            case 'Escape':
                if (this.gameState === 'playing') {
                    this.pauseGame();
                } else if (this.gameState === 'paused') {
                    this.resumeGame();
                }
                break;

            case 'Space':
                if (this.gameState === 'playing' && !this.isChargingShot && !this.areBallsMoving()) {
                    this.startChargingShot();
                }
                event.preventDefault();
                break;

            case 'KeyR':
                if (this.gameState === 'playing') this.resetCamera();
                break;

            case 'KeyA':
            case 'ArrowLeft':
                if (this.gameState === 'playing' && this.isAiming) {
                    this.aimingAngle -= 0.03 * this.settings.aimSensitivity;
                    this.updateCueAiming();
                }
                break;

            case 'KeyD':
            case 'ArrowRight':
                if (this.gameState === 'playing' && this.isAiming) {
                    this.aimingAngle += 0.03 * this.settings.aimSensitivity;
                    this.updateCueAiming();
                }
                break;

            case 'KeyQ':
                if (this.gameState === 'playing') {
                    this.cameraAngleTarget -= 0.1 * this.settings.cameraSensitivity;
                }
                break;

            case 'KeyE':
                if (this.gameState === 'playing') {
                    this.cameraAngleTarget += 0.1 * this.settings.cameraSensitivity;
                }
                break;
        }
    }

    handleKeyUp(event) {
        switch (event.code) {
            case 'Space':
                if (this.gameState === 'playing' && this.isChargingShot) {
                    this.takeShot();
                }
                event.preventDefault();
                break;
        }
    }

    handleMouseMove(event) {
        if (this.gameState !== 'playing') return;
        this.updateMousePosition(event);

        if (this.isDraggingCamera) {
            const deltaX = event.clientX - this.lastMouseX;
            const deltaY = event.clientY - this.lastMouseY;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;

            this.cameraAngleTarget -= deltaX * 0.005 * this.settings.cameraSensitivity;
            this.cameraHeightTarget = Math.min(
                6,
                Math.max(1.5, this.cameraHeightTarget + deltaY * 0.01 * this.settings.cameraSensitivity)
            );
            return;
        }

        this.updateAimFromMouse();
    }

    handleMouseDown(event) {
        if (this.gameState !== 'playing') return;

        // Right-click or middle-click = orbit camera
        if (event.button === 2 || event.button === 1) {
            this.isDraggingCamera = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
            return;
        }

        if (event.button !== 0) return;
        if (this.areBallsMoving()) return;
        if (this.balls[0].userData.isPocketed) return;

        this.updateMousePosition(event);
        this.isAiming = true;
        this.cue.visible = true;
        if (this.aimLine) this.aimLine.visible = true;
        this.updateAimFromMouse();
        this.startChargingShot();
    }

    handleMouseUp(event) {
        if (this.gameState !== 'playing') return;

        if (event.button === 2 || event.button === 1) {
            this.isDraggingCamera = false;
            return;
        }

        if (event.button !== 0) return;

        if (this.isChargingShot) {
            this.takeShot();
        }
    }

    updateMousePosition(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        document.documentElement.style.setProperty('--cursor-x', event.clientX + 'px');
        document.documentElement.style.setProperty('--cursor-y', event.clientY + 'px');
    }

    lerpAngle(a, b, t) {
        const delta = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        return a + delta * t;
    }

    updateAimFromMouse() {
        if (!this.camera || !this.balls[0]) return;
        if (this.balls[0].userData.isPocketed) return;
        if (this.areBallsMoving()) return;

        const cueBall = this.balls[0];
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -cueBall.position.y);
        const hitPoint = new THREE.Vector3();

        this.raycaster.setFromCamera(this.mouse, this.camera);
        if (this.raycaster.ray.intersectPlane(plane, hitPoint)) {
            const dx = hitPoint.x - cueBall.position.x;
            const dz = hitPoint.z - cueBall.position.z;
            if (dx !== 0 || dz !== 0) {
                const targetAngle = Math.atan2(dz, dx);
                if (this.isAiming) {
                    const t = Math.min(1, 0.18 * this.settings.aimSensitivity);
                    this.aimingAngle = this.lerpAngle(this.aimingAngle, targetAngle, t);
                    this.updateCueAiming();
                } else {
                    this.aimingAngle = targetAngle;
                }
            }
        }
    }

    // ── Shot Mechanics ──────────────────────────────────────────────────────
    startChargingShot() {
        if (this.areBallsMoving()) return;
        if (this.balls[0].userData.isPocketed) return;

        if (!this.isAiming) {
            this.startAiming();
        }

        this.isChargingShot = true;
        this.shotPower = 0;

        if (this.settings.povCloseup) {
            // Save current camera for POV transition
            this.savedCameraAngle = this.cameraAngle;
            this.savedCameraRadius = this.cameraRadius;
            this.savedCameraHeight = this.cameraHeight;
            this.povActive = true;
            this.povLerp = 0;
        } else {
            this.povActive = false;
            this.povLerp = 0;
        }

        this.updateUI();
    }

    takeShot() {
        if (!this.isChargingShot) return;

        const power = this.shotPower;
        this.isChargingShot = false;
        this.isAiming = false;
        this.cue.visible = false;
        if (this.aimLine) this.aimLine.visible = false;
        this.pocketedThisTurn = false;
        this._foulThisTurn = false;

        // Begin restoring camera from POV
        this.povActive = false;

        if (power < 3) {
            this.updateUI();
            return;
        }

        this.sound.playHit(power / 100);

        const cueBall = this.balls[0];
        const force = power * 0.003;

        cueBall.userData.velocity.x = Math.cos(this.aimingAngle) * force;
        cueBall.userData.velocity.z = Math.sin(this.aimingAngle) * force;
        cueBall.userData.isMoving = true;

        this.shotPower = 0;
        this.updateUI();
    }

    resetCamera() {
        this.cameraAngle = Math.PI;
        this.cameraRadius = 5;
        this.cameraHeight = 3;
        this.cameraAngleTarget = Math.PI;
        this.cameraRadiusTarget = 5;
        this.cameraHeightTarget = 3;
        this.cameraTarget.set(0, 1, 0);
    }

    // ── Game State Management ───────────────────────────────────────────────
    pauseGame() {
        this.gameState = 'paused';
        document.getElementById('pauseMenu').classList.add('active');
        this.setGameCursor(false);
    }

    resumeGame() {
        this.gameState = 'playing';
        document.getElementById('pauseMenu').classList.remove('active');
        this.setGameCursor(this.settings.customCursor);
    }

    restartGame() {
        this.currentPlayer = 1;
        this.player1Score = 0;
        this.player2Score = 0;
        this.player1Balls = [];
        this.player2Balls = [];
        this.player1Type = null;
        this.player2Type = null;
        this.firstBallPocketed = false;
        this.pocketedThisTurn = false;
        this._foulThisTurn = false;
        this.isChargingShot = false;
        this.isAiming = false;
        this.shotPower = 0;

        if (this.cue) this.cue.visible = false;
        if (this.aimLine) this.aimLine.visible = false;

        this.resetBalls();
        this.resumeGame();
        this.updateUI();
        this.updatePocketedBallsUI();
    }

    resetBalls() {
        const positions = this.generateBallPositions();
        this.balls.forEach((ball, index) => {
            if (positions[index]) {
                ball.position.set(
                    positions[index].x,
                    1.05 + this.physics.ballRadius,
                    positions[index].z
                );
                ball.userData.velocity.set(0, 0, 0);
                ball.userData.isMoving = false;
                ball.userData.isPocketed = false;
                ball.visible = true;
                ball.rotation.set(0, 0, 0);
            }
        });
    }

    // ── Physics ─────────────────────────────────────────────────────────────
    updatePhysics(dtScale = 1) {
        const wasAnyMoving = this.areBallsMoving();
        let anyBallMoving = false;

        this.balls.forEach(ball => {
            if (ball.userData.isPocketed) return;

            const velocity = ball.userData.velocity;
            const speed = velocity.length();

            if (speed > 0.0015) {
                anyBallMoving = true;
                ball.userData.isMoving = true;

                // Move
                ball.position.addScaledVector(velocity, dtScale);

                // Visual roll
                if (speed > 0.003) {
                    const rollAxis = new THREE.Vector3(-velocity.z, 0, velocity.x).normalize();
                    const rollAngle = speed / this.physics.ballRadius;
                    ball.rotateOnWorldAxis(rollAxis, rollAngle);
                }

                // Friction
                velocity.multiplyScalar(Math.pow(this.physics.tableFriction, dtScale));

                // Collisions
                this.checkTableBoundaries(ball);
                this.checkBallCollisions(ball);
                this.checkPocketCollisions(ball);
            } else {
                velocity.set(0, 0, 0);
                ball.userData.isMoving = false;
            }
        });

        if (wasAnyMoving && !anyBallMoving) {
            this.endTurn();
        }
    }

    checkTableBoundaries(ball) {
        const pos = ball.position;
        const vel = ball.userData.velocity;
        const radius = this.physics.ballRadius;
        const hw = this.physics.tableWidth / 2;
        const hh = this.physics.tableHeight / 2;

        let hitCushion = false;

        if (pos.x - radius < -hw) {
            pos.x = -hw + radius;
            vel.x = -vel.x * 0.75;
            hitCushion = true;
        } else if (pos.x + radius > hw) {
            pos.x = hw - radius;
            vel.x = -vel.x * 0.75;
            hitCushion = true;
        }

        if (pos.z - radius < -hh) {
            pos.z = -hh + radius;
            vel.z = -vel.z * 0.75;
            hitCushion = true;
        } else if (pos.z + radius > hh) {
            pos.z = hh - radius;
            vel.z = -vel.z * 0.75;
            hitCushion = true;
        }

        if (hitCushion) {
            this.sound.playCushion();
        }
    }

    checkBallCollisions(ball1) {
        this.balls.forEach(ball2 => {
            if (ball1 === ball2 || ball2.userData.isPocketed) return;

            const dx = ball2.position.x - ball1.position.x;
            const dy = ball2.position.y - ball1.position.y;
            const dz = ball2.position.z - ball1.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const minDistance = this.physics.ballRadius * 2;

            if (distance < minDistance && distance > 0.0001) {
                // Normalized collision normal (manual, no mutation)
                const nx = dx / distance;
                const ny = dy / distance;
                const nz = dz / distance;

                // Relative velocity dotted with normal
                const dvx = ball1.userData.velocity.x - ball2.userData.velocity.x;
                const dvy = ball1.userData.velocity.y - ball2.userData.velocity.y;
                const dvz = ball1.userData.velocity.z - ball2.userData.velocity.z;
                const dvDotN = dvx * nx + dvy * ny + dvz * nz;

                if (dvDotN <= 0) return; // Already separating

                // Apply impulse (equal mass elastic collision)
                ball1.userData.velocity.x -= dvDotN * nx;
                ball1.userData.velocity.y -= dvDotN * ny;
                ball1.userData.velocity.z -= dvDotN * nz;
                ball2.userData.velocity.x += dvDotN * nx;
                ball2.userData.velocity.y += dvDotN * ny;
                ball2.userData.velocity.z += dvDotN * nz;

                // Separate overlapping balls
                const overlap = minDistance - distance;
                ball1.position.x -= nx * overlap * 0.5;
                ball1.position.y -= ny * overlap * 0.5;
                ball1.position.z -= nz * overlap * 0.5;
                ball2.position.x += nx * overlap * 0.5;
                ball2.position.y += ny * overlap * 0.5;
                ball2.position.z += nz * overlap * 0.5;

                ball2.userData.isMoving = true;

                // Sound based on impact
                const impactSpeed = Math.abs(dvDotN);
                if (impactSpeed > 0.008) {
                    this.sound.playHit(Math.min(impactSpeed * 8, 1));
                }
            }
        });
    }

    checkPocketCollisions(ball) {
        const pocketRadius = 0.13;

        this.pocketPositions.forEach(pocket => {
            const dx = ball.position.x - pocket.x;
            const dz = ball.position.z - pocket.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < pocketRadius) {
                this.pocketBall(ball);
            }
        });
    }

    pocketBall(ball) {
        if (ball.userData.isPocketed) return;

        ball.userData.isPocketed = true;
        ball.userData.isMoving = false;
        ball.userData.velocity.set(0, 0, 0);
        ball.visible = false;
        this.pocketedThisTurn = true;

        this.sound.playPocket();

        if (ball.userData.isCueBall) {
            this.handleFoul('SCRATCH! Cue ball pocketed');
        } else if (ball.userData.is8Ball) {
            this.handle8Ball();
        } else {
            this.handleRegularBallPocketed(ball);
        }
    }

    handleRegularBallPocketed(ball) {
        const num = ball.userData.number;

        // Assign types on first legal pocket
        if (!this.firstBallPocketed) {
            this.firstBallPocketed = true;
            if (ball.userData.isSolid) {
                this.player1Type = this.currentPlayer === 1 ? 'solids' : 'stripes';
                this.player2Type = this.currentPlayer === 1 ? 'stripes' : 'solids';
            } else if (ball.userData.isStripe) {
                this.player1Type = this.currentPlayer === 1 ? 'stripes' : 'solids';
                this.player2Type = this.currentPlayer === 1 ? 'solids' : 'stripes';
            }
            const typeStr = this.currentPlayer === 1 ? this.player1Type : this.player2Type;
            if (typeStr) this.showTurnMessage(`PLAYER ${this.currentPlayer}: ${typeStr.toUpperCase()}!`);
        }

        // Track pocketed balls
        if (this.currentPlayer === 1) {
            this.player1Balls.push(num);
            this.player1Score = this.player1Balls.length;
        } else {
            this.player2Balls.push(num);
            this.player2Score = this.player2Balls.length;
        }

        this.updateUI();
        this.updatePocketedBallsUI();
    }

    handleFoul(reason) {
        this.sound.playFoul();
        this.showTurnMessage(reason || 'FOUL!');

        // Reset cue ball behind head string
        setTimeout(() => {
            this.balls[0].position.set(-1.5, 1.05 + this.physics.ballRadius, 0);
            this.balls[0].visible = true;
            this.balls[0].userData.isPocketed = false;
            this.balls[0].userData.velocity.set(0, 0, 0);
            this.balls[0].userData.isMoving = false;
        }, 300);

        this._foulThisTurn = true;
    }

    handle8Ball() {
        const playerBalls = this.currentPlayer === 1 ? this.player1Balls : this.player2Balls;
        const hasPocketedAll = playerBalls.length >= 7;

        if (hasPocketedAll && !this.balls[0].userData.isPocketed) {
            // Winner!
            this.showGameOver(this.currentPlayer);
        } else {
            // Pocketed 8-ball too early or scratched — other player wins
            const otherPlayer = this.currentPlayer === 1 ? 2 : 1;
            this.showGameOver(otherPlayer);
        }
    }

    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.showTurnMessage(`PLAYER ${this.currentPlayer}'S TURN`);
        this.updateUI();
    }

    endTurn() {
        if (this._foulThisTurn) {
            this.switchPlayer();
            this._foulThisTurn = false;
            return;
        }

        if (!this.pocketedThisTurn) {
            this.switchPlayer();
        } else {
            this.showTurnMessage(`PLAYER ${this.currentPlayer} SHOOTS AGAIN!`);
        }
    }

    // ── UI Updates ──────────────────────────────────────────────────────────
    updateUI() {
        document.getElementById('player1Score').textContent = this.player1Score;
        document.getElementById('player2Score').textContent = this.player2Score;
        document.getElementById('currentPlayer').textContent = `Player ${this.currentPlayer}`;
        document.getElementById('shotPower').textContent = Math.round(this.shotPower);

        const p1TypeEl = document.getElementById('player1Type');
        const p2TypeEl = document.getElementById('player2Type');
        if (p1TypeEl) p1TypeEl.textContent = this.player1Type ? `(${this.player1Type})` : '';
        if (p2TypeEl) p2TypeEl.textContent = this.player2Type ? `(${this.player2Type})` : '';

        const powerFill = document.getElementById('shotPowerFill');
        if (powerFill) {
            const p = Math.round(this.shotPower);
            powerFill.style.width = `${p}%`;

            if (p < 40) {
                powerFill.style.background = 'linear-gradient(90deg, #00ff41, #44ff44)';
            } else if (p < 70) {
                powerFill.style.background = 'linear-gradient(90deg, #44ff44, #ffff00)';
            } else {
                powerFill.style.background = 'linear-gradient(90deg, #ffff00, #ff4444)';
            }
        }

        const p1El = document.getElementById('player1Label');
        const p2El = document.getElementById('player2Label');
        if (p1El) p1El.classList.toggle('active-player', this.currentPlayer === 1);
        if (p2El) p2El.classList.toggle('active-player', this.currentPlayer === 2);
    }

    updatePocketedBallsUI() {
        const ballColorMap = {
            1: '#f5d200', 2: '#0044cc', 3: '#cc0000', 4: '#6600aa',
            5: '#ff8800', 6: '#007700', 7: '#880000',
            9: '#f5d200', 10: '#0044cc', 11: '#cc0000', 12: '#6600aa',
            13: '#ff8800', 14: '#007700', 15: '#880000'
        };

        const renderBalls = (containerId, ballNums) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            ballNums.forEach(num => {
                const dot = document.createElement('span');
                dot.className = 'pocketed-ball' + (num >= 9 ? ' stripe' : '');
                dot.style.backgroundColor = ballColorMap[num] || '#888';
                dot.title = `Ball ${num}`;
                container.appendChild(dot);
            });
        };

        renderBalls('player1PocketedBalls', this.player1Balls);
        renderBalls('player2PocketedBalls', this.player2Balls);
    }

    // ── Animation Loop ──────────────────────────────────────────────────────
    updateCameraIntro() {
        if (this.menuAnimation) {
            this.cameraAngleTarget += 0.005;
            if (this.cameraAngleTarget > Math.PI * 4) {
                this.cameraAngleTarget = 0;
            }
        }

        if (this.cameraTransitioning) {
            this.cameraRadiusTarget += (5 - this.cameraRadiusTarget) * 0.2;
            this.cameraHeightTarget += (3 - this.cameraHeightTarget) * 0.2;

            if (Math.abs(this.cameraRadiusTarget - 5) < 0.05) {
                this.cameraTransitioning = false;
                this.cameraRadiusTarget = 5;
                this.cameraHeightTarget = 3;
            }
        }
    }

    updateShotCharging(deltaSec = 1 / 60) {
        if (this.isChargingShot) {
            const ratePerSec = 72 * this.settings.chargeRate;
            this.shotPower = Math.min(100, this.shotPower + ratePerSec * deltaSec);
            this.updateUI();

            if (this.isAiming) {
                this.updateCueAiming();
            }
        }
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const now = performance.now();
        if (!this._lastFrameTime) this._lastFrameTime = now;
        const deltaSec = Math.min(0.05, (now - this._lastFrameTime) / 1000);
        this._lastFrameTime = now;
        this._deltaSec = deltaSec;
        const dtScale = Math.min(3, deltaSec * 60);

        if (this.gameState === 'menu' || this.gameState === 'playing' || this.gameState === 'paused' || this.gameState === 'gameover') {
            this.updateCameraIntro();

            if (this.gameState === 'playing') {
                this.updateShotCharging(deltaSec);
                this.updatePhysics(dtScale);
            }

            this.updateCameraPosition();

            // Overhead lamp sway
            if (this.overheadLamp) {
                const time = Date.now() * 0.0005;
                this.overheadLamp.rotation.z = Math.sin(time) * 0.015;
                this.overheadLamp.rotation.x = Math.cos(time * 0.7) * 0.01;
            }

            // Window light flicker
            const time = Date.now() * 0.001;
            this.windows.forEach((win, index) => {
                const opacity = 0.2 + Math.sin(time + index) * 0.1;
                win.material.opacity = opacity;
            });

            this.renderer.render(this.scene, this.camera);
        }
    }

    // ── Settings ─────────────────────────────────────────────────────────────
    setGameCursor(isEnabled) {
        document.body.classList.toggle('game-cursor', isEnabled);
    }

    applySettings() {
        document.body.classList.toggle('scanlines-on', this.settings.scanlines);
        this.setGameCursor(this.gameState === 'playing' && this.settings.customCursor);

        this.fovTarget = this.settings.fov;
        if (this.camera) {
            this.camera.fov = this.settings.fov;
            this.camera.updateProjectionMatrix();
        }

        const gameScreen = document.getElementById('gameScreen');
        if (gameScreen) {
            gameScreen.classList.toggle('dither-effect', this.settings.dither);
        }
    }

    updateOptionsButtons() {
        const setBtn = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        const setRange = (id, valueId, value, formatter) => {
            const input = document.getElementById(id);
            const valueEl = document.getElementById(valueId);
            if (input) input.value = value;
            if (valueEl) valueEl.textContent = formatter ? formatter(value) : value.toFixed(2);
        };

        setBtn('toggleScanlines', `SCANLINES: ${this.settings.scanlines ? 'ON' : 'OFF'}`);
        setBtn('toggleCursor', `GAME CURSOR: ${this.settings.customCursor ? 'ON' : 'OFF'}`);
        setBtn('toggleDither', `DITHER: ${this.settings.dither ? 'ON' : 'OFF'}`);
        setBtn('toggleSound', `SOUND: ${this.settings.sound ? 'ON' : 'OFF'}`);
        setBtn('toggleJitter', `PS1 JITTER: ${this.settings.jitter ? 'ON' : 'OFF'}`);
        setBtn('togglePov', `POV CLOSE-UP: ${this.settings.povCloseup ? 'ON' : 'OFF'}`);

        setRange('aimSensitivity', 'aimSensitivityValue', this.settings.aimSensitivity, (v) => v.toFixed(2));
        setRange('cameraSensitivity', 'cameraSensitivityValue', this.settings.cameraSensitivity, (v) => v.toFixed(2));
        setRange('zoomSpeed', 'zoomSpeedValue', this.settings.zoomSpeed, (v) => v.toFixed(2));
        setRange('chargeRate', 'chargeRateValue', this.settings.chargeRate, (v) => v.toFixed(2));
        setRange('fovSetting', 'fovSettingValue', this.settings.fov, (v) => `${Math.round(v)}`);
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
    new RetroPoolGame();
});

document.addEventListener('mousemove', (e) => {
    document.documentElement.style.setProperty('--cursor-x', e.clientX + 'px');
    document.documentElement.style.setProperty('--cursor-y', e.clientY + 'px');
});
