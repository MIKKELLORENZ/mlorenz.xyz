/**
 * Moon Lander - iOS App Store Version
 * Retro Moon Lander Game with Capacitor Integration
 * Author: Mikkel Vind Lorenz, 2025
 */

// Capacitor Plugins Import
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

// Initialize Capacitor features
async function initCapacitor() {
    try {
        // Hide splash screen after app is ready
        await SplashScreen.hide();
        
        // Set status bar style
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#000000' });
        
        // Handle app state changes
        App.addListener('appStateChange', ({ isActive }) => {
            if (!isActive && gameStarted && !gameOver) {
                // Pause audio when app goes to background
                pauseAllAudio();
            } else if (isActive && gameStarted && !gameOver) {
                // Resume background music when app becomes active
                resumeBackgroundMusic();
            }
        });
        
        // Load high score from native storage
        const savedHighScore = await Preferences.get({ key: 'moonLanderHighScore' });
        if (savedHighScore.value) {
            highScore = parseInt(savedHighScore.value, 10);
        }
    } catch (error) {
        console.log('Capacitor init error (may be running in browser):', error);
    }
}

// Haptic feedback helper
async function triggerHaptic(style = 'light') {
    try {
        switch(style) {
            case 'heavy':
                await Haptics.impact({ style: ImpactStyle.Heavy });
                break;
            case 'medium':
                await Haptics.impact({ style: ImpactStyle.Medium });
                break;
            case 'light':
            default:
                await Haptics.impact({ style: ImpactStyle.Light });
                break;
        }
    } catch (e) {
        // Haptics not available
    }
}

// Save high score to native storage
async function saveHighScore(score) {
    try {
        await Preferences.set({
            key: 'moonLanderHighScore',
            value: score.toString()
        });
    } catch (e) {
        // Fallback to localStorage
        localStorage.setItem('moonLanderHighScore', score.toString());
    }
}

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
let width = 0;
let height = 0;

function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

resizeCanvas();

// Cache DOM elements for HUD updates
const hudElements = {
    miniFuelValue: document.getElementById('mini-fuel-value'),
    miniFuelBar: document.getElementById('mini-fuel-bar'),
    miniOxygenValue: document.getElementById('mini-oxygen-value'),
    miniOxygenBar: document.getElementById('mini-oxygen-bar'),
    scoreValue: document.getElementById('scoreValue'),
    highScoreValue: document.getElementById('highScoreValue'),
    verticalVelocityValue: document.getElementById('verticalVelocityValue'),
    horizontalVelocityValue: document.getElementById('horizontalVelocityValue'),
    heightValue: document.getElementById('heightValue')
};

// iOS is always touch-first
const touchControls = document.getElementById('touchControls');
touchControls.style.display = 'block';

// Touch control buttons
const mainThrustBtn = document.getElementById('mainThrustBtn');
const leftRotateBtn = document.getElementById('leftRotateBtn');
const rightRotateBtn = document.getElementById('rightRotateBtn');
const leftTranslateBtn = document.getElementById('leftTranslateBtn');
const rightTranslateBtn = document.getElementById('rightTranslateBtn');

// Touch control event listeners with haptic feedback
function setupTouchControls() {
    function bindHoldControl(element, key, { onPress, onRelease } = {}) {
        const press = async (e) => {
            e.preventDefault();
            keys[key] = true;
            element.classList.add('active');
            await triggerHaptic('light');
            if (onPress) onPress();
        };
        const release = (e) => {
            e.preventDefault();
            keys[key] = false;
            element.classList.remove('active');
            if (onRelease) onRelease();
        };

        element.addEventListener('pointerdown', press);
        element.addEventListener('pointerup', release);
        element.addEventListener('pointercancel', release);
        element.addEventListener('pointerleave', release);
    }

    // Main thrust (Up arrow)
    bindHoldControl(mainThrustBtn, 'arrowup', {
        onPress: () => {
            if (!mainThrusterStartTime) {
                mainThrusterStartTime = Date.now();
                if (mainThrusterReleaseTimer !== null) {
                    clearTimeout(mainThrusterReleaseTimer);
                    mainThrusterReleaseTimer = null;
                }
            }
        },
        onRelease: () => {
            if (mainEngineSoundPlaying && mainThrusterStartTime) {
                const thrusterDuration = Date.now() - mainThrusterStartTime;
                if (thrusterDuration >= MIN_THRUSTER_TIME) {
                    if (mainThrusterReleaseTimer !== null) {
                        clearTimeout(mainThrusterReleaseTimer);
                    }
                    mainThrusterReleaseTimer = setTimeout(() => {
                        pumpResetSound.currentTime = 0;
                        pumpResetSound.play();
                        mainThrusterReleaseTimer = null;
                    }, 1500);
                }
            }
            mainThrusterStartTime = null;
        }
    });

    // Left/Right rotation
    bindHoldControl(leftRotateBtn, 'arrowleft');
    bindHoldControl(rightRotateBtn, 'arrowright');

    // Translation (A/D)
    bindHoldControl(leftTranslateBtn, 'a');
    bindHoldControl(rightTranslateBtn, 'd');
}

setupTouchControls();

// Prevent default touch behaviors
document.body.addEventListener('touchstart', (e) => {
    if (e.target.closest('#touchControls')) {
        e.preventDefault();
    }
}, { passive: false });

document.body.addEventListener('touchmove', (e) => {
    if (gameStarted) {
        e.preventDefault();
    }
}, { passive: false });

touchControls.addEventListener('contextmenu', (e) => e.preventDefault());

// Loading screen elements
const loadingScreen = document.getElementById('loadingScreen');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const startButton = document.getElementById('startButton');

// Audio loading tracking
const soundFiles = {
    mainEngine: { src: 'audio/main_engine.mp3', loaded: false },
    rotationEngine: { src: 'audio/rotation_engine.mp3', loaded: false },
    breathing: { src: 'audio/breathing.mp3', loaded: false },
    background: { src: 'audio/background.mp3', loaded: false },
    crash: { src: 'audio/crash_2.mp3', loaded: false },
    fuelUp: { src: 'audio/fuel_up.mp3', loaded: false },
    pumpReset: { src: 'audio/pump_reset.mp3', loaded: false },
    riser: { src: 'audio/riser.mp3', loaded: false },
    gameOver: { src: 'audio/game_over.mp3', loaded: false },
    vesselStartup: { src: 'audio/vessel_startup.mp3', loaded: false }
};

let totalSounds = Object.keys(soundFiles).length;
let loadedSounds = 0;
let gameStarted = false;

// Audio setup with loading handlers
const mainEngineSound = new Audio();
mainEngineSound.src = soundFiles.mainEngine.src;
mainEngineSound.loop = true;

const rotationEngineSound = new Audio();
rotationEngineSound.src = soundFiles.rotationEngine.src;
rotationEngineSound.loop = true;

const breathingSound = new Audio();
breathingSound.src = soundFiles.breathing.src;
breathingSound.loop = false;

const backgroundSound = new Audio();
backgroundSound.src = soundFiles.background.src;
backgroundSound.loop = true;
backgroundSound.preload = "auto";

const crashSound = new Audio();
crashSound.src = soundFiles.crash.src;

const fuelUpSound = new Audio(soundFiles.fuelUp.src);
fuelUpSound.volume = 0.7;
fuelUpSound.preload = "auto";

const pumpResetSound = new Audio(soundFiles.pumpReset.src);
pumpResetSound.volume = 0.6;

const riserSound = new Audio(soundFiles.riser.src);
riserSound.volume = 0.7;
riserSound.loop = false;

const gameOverSound = new Audio(soundFiles.gameOver.src);
gameOverSound.loop = true;
gameOverSound.volume = 0.5;

const vesselStartupSound = new Audio(soundFiles.vesselStartup.src);
vesselStartupSound.volume = 0.15;

let riserSoundPlaying = false;
let gameOverSoundPlaying = false;
const LOW_OXYGEN_THRESHOLD = 5;

let mainThrusterReleaseTimer = null;
let mainThrusterStartTime = null;
const MIN_THRUSTER_TIME = 2750;

// Game over messages
const gameOverMessages = [
    "You're alone now. Only silence answers your calls.",
    "The stars look closer, but no one is coming.",
    "This was never meant to be your grave.",
    "No one knows you're here. No one ever will.",
    "Out here, your screams are forever silent.",
    "The darkness sees you—but it doesn't care.",
    "Home is just a distant memory now.",
    "Forever trapped in the vastness between worlds.",
    "Space takes without remorse or mercy.",
    "How small you are, beneath an uncaring sky.",
    "No signal. No rescue. Just emptiness.",
    "Your footprints vanish. No one will follow.",
    "Space swallows all hope eventually.",
    "You left Earth, but you'll never return.",
    "The universe never promised you'd survive.",
    "You were brave to venture this far—but now you're alone.",
    "Stars shine brighter as your vision fades.",
    "Silence reigns eternal beyond this point.",
    "You're not the first to be lost out here.",
    "Even the stars look cold tonight.",
    "You call for help, but only echoes reply.",
    "Your journey ends here, lost in endless void.",
    "You reached for the stars—but the void took you."
];

// Add loading event listeners
mainEngineSound.addEventListener('canplaythrough', () => handleSoundLoaded('mainEngine'));
rotationEngineSound.addEventListener('canplaythrough', () => handleSoundLoaded('rotationEngine'));
breathingSound.addEventListener('canplaythrough', () => handleSoundLoaded('breathing'));
backgroundSound.addEventListener('canplaythrough', () => handleSoundLoaded('background'));
crashSound.addEventListener('canplaythrough', () => handleSoundLoaded('crash'));
fuelUpSound.addEventListener('canplaythrough', () => handleSoundLoaded('fuelUp'));
pumpResetSound.addEventListener('canplaythrough', () => handleSoundLoaded('pumpReset'));
riserSound.addEventListener('canplaythrough', () => handleSoundLoaded('riser'));
gameOverSound.addEventListener('canplaythrough', () => handleSoundLoaded('gameOver'));
vesselStartupSound.addEventListener('canplaythrough', () => handleSoundLoaded('vesselStartup'));

startButton.addEventListener('click', startGame);

// Handle sound loading
function handleSoundLoaded(soundName) {
    if (!soundFiles[soundName].loaded) {
        soundFiles[soundName].loaded = true;
        loadedSounds++;
        
        const progress = Math.floor((loadedSounds / totalSounds) * 100);
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${progress}%`;
        
        if (loadedSounds === totalSounds) {
            setTimeout(() => {
                document.getElementById('progressContainer').style.display = "none";
                progressText.style.display = "none";
                startButton.style.display = "block";
                showControlsInstructions();
            }, 500);
        }
    }
}

// Set volume for sounds
mainEngineSound.volume = 0.5;
rotationEngineSound.volume = 0.40;
backgroundSound.volume = 0.5;
crashSound.volume = 0.40;
breathingSound.volume = 1.00;

let mainEngineSoundPlaying = false;
let rotationEngineSoundPlaying = false;
let breathingSoundPlaying = false;
let translationEngineSoundPlaying = false;

// Pause/Resume audio helpers for app state changes
function pauseAllAudio() {
    backgroundSound.pause();
    mainEngineSound.pause();
    rotationEngineSound.pause();
    breathingSound.pause();
    riserSound.pause();
    gameOverSound.pause();
}

function resumeBackgroundMusic() {
    if (!gameOver) {
        backgroundSound.play().catch(() => {});
    }
}

// Stars with subtle visuals
let stars = [];
let nebulaClouds = [];
let shootingStars = [];
const NUM_STARS = 600;
const NUM_NEBULA_CLOUDS = 5;
const STAR_COLORS = [
    '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF',
    '#E8E8F0', '#F0F0FF',
    '#FFF8F0', '#FFFAF5'
];
const STAR_MIN_RADIUS = 0.2;
const STAR_MAX_RADIUS = 1.0;

function generateStars() {
    stars = [];
    nebulaClouds = [];
    
    for (let i = 0; i < NUM_NEBULA_CLOUDS; i++) {
        nebulaClouds.push({
            x: Math.random() * width * 3 - width * 0.5,
            y: Math.random() * height * 1.5,
            radius: 150 + Math.random() * 200,
            color: [
                `rgba(80, 40, 120, ${0.015 + Math.random() * 0.015})`,
                `rgba(40, 60, 120, ${0.015 + Math.random() * 0.015})`,
                `rgba(100, 40, 60, ${0.01 + Math.random() * 0.01})`,
                `rgba(40, 80, 80, ${0.01 + Math.random() * 0.01})`,
            ][Math.floor(Math.random() * 4)],
            parallax: 0.1 + Math.random() * 0.2
        });
    }
    
    for (let i = 0; i < NUM_STARS; i++) {
        const isBrightStar = Math.random() < 0.02;
        stars.push({
            x: Math.random() * width * 2,
            y: Math.random() * height * 2,
            radius: isBrightStar ? 
                (0.8 + Math.random() * 0.4) : 
                (Math.random() * (STAR_MAX_RADIUS - STAR_MIN_RADIUS) + STAR_MIN_RADIUS),
            color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
            alpha: Math.random() * 0.3 + 0.3,
            twinkleSpeed: Math.random() * 0.008 + 0.003,
            twinkleDirection: Math.random() < 0.5 ? 1 : -1,
            parallax: Math.random() * 0.5 + 0.5,
            hasCross: false,
            glowSize: isBrightStar ? 1 : 0
        });
    }
}

function updateShootingStars(deltaTimeSec) {
    if (Math.random() < 0.001) {
        shootingStars.push({
            x: Math.random() * width * 2,
            y: Math.random() * height * 0.5,
            vx: -300 - Math.random() * 200,
            vy: 150 + Math.random() * 100,
            length: 50 + Math.random() * 100,
            alpha: 1.0,
            life: 1.0
        });
    }
    
    for (let star of shootingStars) {
        star.x += star.vx * deltaTimeSec;
        star.y += star.vy * deltaTimeSec;
        star.life -= deltaTimeSec * 1.5;
        star.alpha = star.life;
    }
    shootingStars = shootingStars.filter(s => s.life > 0);
}

generateStars();

// Function to start the game after loading
async function startGame() {
    gameStarted = true;
    loadingScreen.style.display = 'none';
    
    await triggerHaptic('medium');
    playBackgroundMusic();
    
    requestAnimationFrame(gameLoop);
}

function playBackgroundMusic() {
    if (backgroundSound.readyState >= 2) {
        backgroundSound.currentTime = 0;
        const playPromise = backgroundSound.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log("Autoplay prevented");
            });
        }
    } else {
        backgroundSound.addEventListener('canplaythrough', function playWhenReady() {
            backgroundSound.play();
            backgroundSound.removeEventListener('canplaythrough', playWhenReady);
        });
    }
}

function fadeAudioVolume(audioElement, startVolume, endVolume, durationMs) {
    const startTime = Date.now();
    const volumeChange = endVolume - startVolume;
    
    audioElement.volume = startVolume;
    
    function updateVolume() {
        const currentTime = Date.now();
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        
        const newVolume = startVolume + volumeChange * progress;
        audioElement.volume = newVolume;
        
        if (progress < 1) {
            requestAnimationFrame(updateVolume);
        }
    }
    
    requestAnimationFrame(updateVolume);
}

// Game variables
let oxygen = 60;
let fuel = 1700;
let score = 0;
let gameOver = false;

let highScore = parseInt(localStorage.getItem('moonLanderHighScore') || '0', 10);

let gravity = 27;

const lander = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    mass: 1,
    crashed: false,
    landed: false,
    explosionParticles: [],
    debrisParticles: [],
    currentPlatform: null,
    speed: 0,
    controlsDisabled: false,
    crashTime: null,
    gameOverShown: false
};

const keys = {};

let terrain = [];
let landingZones = [];
let rocks = [];
let craterMarks = [];
let meteorites = [];

let cameraX = 0;
let cameraY = 0;

let dustParticles = [];
let floatingScoreTexts = [];

function generateLandscape() {
    terrain = [];
    landingZones = [];
    craterMarks = [];
    rocks = [];
    let points = [];
    let numPoints = 8000;
    let segmentWidth = 300;
    
    for (let i = 0; i <= numPoints; i++) {
        let x = i * segmentWidth;
        let y = height - Math.random() * 360 - 100;
        points.push({ x, y });
    }

    let platformSpacing = 200;
    let lastPlatformX = -platformSpacing;

    for (let i = 2; i < points.length - 2; i++) {
        let x = points[i].x;
        if (Math.abs(x - lastPlatformX) < platformSpacing) continue;

        let y = Math.min(points[i].y, points[i + 1].y);
        let platformWidth = 50 + Math.random() * 100;

        let leftSlope = Math.abs(points[i].y - points[i - 1].y);
        let rightSlope = Math.abs(points[i + 2].y - points[i + 1].y);
        if (leftSlope > 100 || rightSlope > 100) continue;

        landingZones.push({
            x,
            y,
            width: platformWidth,
            landed: false,
            points: Math.floor(200 - platformWidth),
        });

        points[i].y = y;
        points[i + 1].y = y;
        points[i + 1].x = x + platformWidth;

        lastPlatformX = x;
    }

    if (landingZones.length === 0) {
        let index = Math.floor(numPoints / 2);
        let x = points[index].x;
        let y = points[index].y;
        let platformWidth = 150;

        landingZones.push({
            x,
            y,
            width: platformWidth,
            landed: false,
            points: Math.floor(200 - platformWidth),
        });
        points[index].y = y;
        points[index + 1].y = y;
        points[index + 1].x = x + platformWidth;
    }

    terrain = points;

    if (landingZones.length > 0) {
        let startingZone = landingZones[Math.floor(Math.random() * landingZones.length)];
        lander.x = startingZone.x + startingZone.width / 2;
        lander.y = startingZone.y - 200;
        cameraX = lander.x - width / 1.5;
        cameraY = lander.y - height / 2;
    } else {
        lander.x = width / 2;
        lander.y = height / 2;
        cameraX = lander.x - width / 2;
        cameraY = lander.y - height / 2;
    }

    for (let i = 0; i < 50; i++) {
        let craterX = Math.random() * terrain[terrain.length - 1].x;
        let craterY = getTerrainHeightAt(craterX);
        craterMarks.push({
            x: craterX,
            y: craterY,
            radius: 10 + Math.random() * 15,
        });
    }

    for (let i = 0; i < 100; i++) {
        let rockX = Math.random() * terrain[terrain.length - 1].x;
        let rockY = getTerrainHeightAt(rockX);
        rocks.push({
            x: rockX,
            y: rockY,
            size: 2 + Math.random() * 3,
        });
    }
}

generateLandscape();

let resizeRaf = null;
function requestResize() {
    if (resizeRaf !== null) return;
    resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        onResize();
    });
}

window.addEventListener('resize', requestResize);
window.addEventListener('orientationchange', requestResize);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', requestResize);
}
document.getElementById('restartButton').addEventListener('click', restartGame);

function onResize() {
    resizeCanvas();
    generateStars();
    generateLandscape();
    updateHUD();
}

function getTerrainHeightAt(x) {
    if (terrain.length < 2) return height;
    
    let left = 0;
    let right = terrain.length - 2;
    
    while (left <= right) {
        const mid = (left + right) >> 1;
        const p1 = terrain[mid];
        const p2 = terrain[mid + 1];
        
        if (x >= p1.x && x <= p2.x) {
            const t = (x - p1.x) / (p2.x - p1.x);
            return p1.y + t * (p2.y - p1.y);
        } else if (x < p1.x) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }
    return height;
}

function update(deltaTime) {
    if (gameOver) {
        let deltaTimeSec = deltaTime / 1000;
        updateDebrisAfterGameOver(deltaTimeSec);
        return;
    }

    let deltaTimeSec = deltaTime / 1000;

    if (lander.crashed) {
        for (let particle of lander.explosionParticles) {
            particle.x += particle.vx * deltaTimeSec;
            particle.y += particle.vy * deltaTimeSec;
            particle.vy += gravity * deltaTimeSec;
            particle.alpha -= deltaTimeSec;
            
            const groundY = getTerrainHeightAt(particle.x);
            if (particle.y >= groundY) {
                particle.y = groundY - 1;
                particle.vy = -particle.vy * 0.3;
                particle.vx *= 0.5;
            }
        }
        lander.explosionParticles = lander.explosionParticles.filter(p => p.alpha > 0);

        for (let debris of lander.debrisParticles) {
            debris.x += debris.vx * deltaTimeSec;
            debris.y += debris.vy * deltaTimeSec;
            debris.vy += gravity * deltaTimeSec;
            debris.angle += debris.angularVelocity * deltaTimeSec;

            const groundY = getTerrainHeightAt(debris.x);
            if (debris.y + debris.height/2 >= groundY) {
                debris.y = groundY - debris.height/2;
                if (Math.abs(debris.vy) > 5) {
                    debris.vy = -debris.vy * 0.4;
                    debris.vx *= 0.7;
                    debris.angularVelocity *= 0.7;
                } else {
                    debris.vy = 0;
                    debris.vx *= 0.95;
                    debris.angularVelocity *= 0.95;
                    if (Math.abs(debris.vx) < 1) debris.vx = 0;
                    if (Math.abs(debris.angularVelocity) < 0.1) debris.angularVelocity = 0;
                }
            }
        }

        if (lander.crashTime && Date.now() - lander.crashTime > 1500 && !lander.gameOverShown) {
            lander.gameOverShown = true;
            endGame('Crash! \n Game Over. \n Final Score: ' + score);
        }
        return;
    }

    oxygen -= deltaTimeSec;
    if (oxygen <= 0) {
        oxygen = 0;
        lander.controlsDisabled = true;
        if (breathingSoundPlaying) {
            breathingSound.pause();
            breathingSound.currentTime = 0;
            breathingSoundPlaying = false;
        }
        if (lander.landed && !lander.crashed) {
            endGame('Out of Oxygen! Game Over. Final Score: ' + score);
        }
    }

    if (oxygen <= LOW_OXYGEN_THRESHOLD && oxygen > 0) {
        if (!riserSoundPlaying) {
            riserSound.currentTime = 0;
            riserSound.play();
            riserSoundPlaying = true;
        }
    } else {
        if (riserSoundPlaying) {
            riserSound.pause();
            riserSound.currentTime = 0;
            riserSoundPlaying = false;
        }
    }

    if (oxygen <= 10 && oxygen > 0) {
        if (!breathingSoundPlaying) {
            breathingSound.play();
            breathingSoundPlaying = true;
        }
    } else {
        if (breathingSoundPlaying) {
            breathingSound.pause();
            breathingSound.currentTime = 0;
            breathingSoundPlaying = false;
        }
    }

    if (!lander.controlsDisabled && fuel > 0) {
        if (keys['arrowup']) {
            let thrust = 65;
            let adjustedThrust = thrust * (1 + (1700 - fuel) / 1700);
            lander.vx += adjustedThrust * Math.sin(lander.angle) * deltaTimeSec;
            lander.vy -= adjustedThrust * Math.cos(lander.angle) * deltaTimeSec;
            fuel -= 0.49;

            emitDustParticles(deltaTimeSec);
        }
        if (keys['arrowleft']) {
            lander.angularVelocity -= 90 * Math.PI / 180 * deltaTimeSec;
            fuel -= 0.14;
        }
        if (keys['arrowright']) {
            lander.angularVelocity += 90 * Math.PI / 180 * deltaTimeSec;
            fuel -= 0.14;
        }
        if (keys['d']) {
            let thrust = 27;
            lander.vx += thrust * Math.sin(lander.angle - Math.PI / 2) * deltaTimeSec;
            lander.vy -= thrust * Math.cos(lander.angle - Math.PI / 2) * deltaTimeSec;
            fuel -= 0.14;
        }
        if (keys['a']) {
            let thrust = 27;
            lander.vx += thrust * Math.sin(lander.angle + Math.PI / 2) * deltaTimeSec;
            lander.vy -= thrust * Math.cos(lander.angle + Math.PI / 2) * deltaTimeSec;
            fuel -= 0.14;
        }
    }

    // Sound management for main engine
    if (!lander.controlsDisabled && fuel > 0 && !lander.crashed) {
        if (keys['arrowup']) {
            if (!mainEngineSoundPlaying) {
                mainEngineSound.play();
                mainEngineSoundPlaying = true;
            }
        } else {
            if (mainEngineSoundPlaying) {
                mainEngineSound.pause();
                mainEngineSound.currentTime = 0;
                mainEngineSoundPlaying = false;
            }
        }
    } else {
        if (mainEngineSoundPlaying) {
            mainEngineSound.pause();
            mainEngineSound.currentTime = 0;
            mainEngineSoundPlaying = false;
        }
    }

    // Translation engine sound
    if (!lander.controlsDisabled && fuel > 0 && !lander.crashed) {
        if (keys['a'] || keys['d']) {
            if (!translationEngineSoundPlaying) {
                rotationEngineSound.play();
                translationEngineSoundPlaying = true;
            }
        } else {
            if (translationEngineSoundPlaying) {
                if (!keys['arrowleft'] && !keys['arrowright']) {
                    rotationEngineSound.pause();
                    rotationEngineSound.currentTime = 0;
                }
                translationEngineSoundPlaying = false;
            }
        }
    } else {
        if (translationEngineSoundPlaying) {
            if (!rotationEngineSoundPlaying) {
                rotationEngineSound.pause();
                rotationEngineSound.currentTime = 0;
            }
            translationEngineSoundPlaying = false;
        }
    }

    // Rotation engine sound
    if (!lander.controlsDisabled && fuel > 0 && !lander.crashed) {
        if (keys['arrowleft'] || keys['arrowright']) {
            if (!rotationEngineSoundPlaying) {
                if (!translationEngineSoundPlaying) {
                    rotationEngineSound.play();
                }
                rotationEngineSoundPlaying = true;
            }
        } else {
            if (rotationEngineSoundPlaying) {
                if (!translationEngineSoundPlaying) {
                    rotationEngineSound.pause();
                    rotationEngineSound.currentTime = 0;
                }
                rotationEngineSoundPlaying = false;
            }
        }
    } else {
        if (rotationEngineSoundPlaying) {
            if (!translationEngineSoundPlaying) {
                rotationEngineSound.pause();
                rotationEngineSound.currentTime = 0;
            }
            rotationEngineSoundPlaying = false;
        }
    }

    lander.vy += gravity * deltaTimeSec;
    lander.x += lander.vx * deltaTimeSec;
    lander.y += lander.vy * deltaTimeSec;
    lander.angle += lander.angularVelocity * deltaTimeSec;

    if (lander.angle > Math.PI) lander.angle -= 2 * Math.PI;
    if (lander.angle < -Math.PI) lander.angle += 2 * Math.PI;

    lander.speed = Math.sqrt(lander.vx * lander.vx + lander.vy * lander.vy);

    cameraX = lander.x - width / 2;
    cameraY = lander.y - height / 2;

    let landerBottom = { x: lander.x, y: lander.y + 26 };
    const groundY = getTerrainHeightAt(landerBottom.x);
    
    if (landerBottom.y >= groundY) {
        lander.y = groundY - 26;

        let safeLandingSpeed = 57;
        let verticalSpeed = lander.vy;
        
        const crashVx = lander.vx;
        const crashVy = lander.vy;

        lander.vx = 0;
        lander.vy = 0;
        lander.angularVelocity = 0;

        if (verticalSpeed > safeLandingSpeed || Math.abs(lander.angle) > Math.PI / 6) {
            crash(crashVx, crashVy);
        } else {
            let landedOnPlatform = false;
            for (let zone of landingZones) {
                if (lander.x >= zone.x && lander.x <= zone.x + zone.width) {
                    landedOnPlatform = true;
                    if (!zone.landed) {
                        successfulLanding(zone);
                        zone.landed = true;
                        lander.currentPlatform = zone;
                    } else {
                        lander.currentPlatform = zone;
                    }
                    break;
                }
            }
            if (!landedOnPlatform) {
                crash(crashVx, crashVy);
            } else {
                lander.landed = true;
                if (oxygen <= 0) {
                    endGame('Out of Oxygen! Game Over. Final Score: ' + score);
                }
            }
        }
    }

    if (lander.landed && lander.y + 20 < lander.currentPlatform.y - 1) {
        lander.landed = false;
        lander.currentPlatform = null;
    }

    updateMeteorites(deltaTimeSec);
    updateDustParticles(deltaTimeSec);
    updateFloatingScoreTexts(deltaTimeSec);
    updateStars(deltaTimeSec);
    updateHUD();
}

function updateDebrisAfterGameOver(deltaTimeSec) {
    if (!lander.crashed) return;
    
    for (let debris of lander.debrisParticles) {
        debris.x += debris.vx * deltaTimeSec;
        debris.y += debris.vy * deltaTimeSec;
        debris.vy += gravity * deltaTimeSec;
        debris.angle += debris.angularVelocity * deltaTimeSec;
        
        const groundY = getTerrainHeightAt(debris.x);
        if (debris.y + debris.height/2 >= groundY) {
            debris.y = groundY - debris.height/2;
            
            if (Math.abs(debris.vy) > 5) {
                debris.vy = -debris.vy * 0.4;
                debris.vx *= 0.7;
                debris.angularVelocity *= 0.7;
            } else {
                debris.vy = 0;
                debris.vx *= 0.95;
                debris.angularVelocity *= 0.95;
                
                if (Math.abs(debris.vx) < 1) debris.vx = 0;
                if (Math.abs(debris.angularVelocity) < 0.1) debris.angularVelocity = 0;
            }
        }
    }
    
    for (let particle of lander.explosionParticles) {
        particle.x += particle.vx * deltaTimeSec;
        particle.y += particle.vy * deltaTimeSec;
        particle.vy += gravity * deltaTimeSec;
        particle.alpha -= deltaTimeSec;
        
        const groundY = getTerrainHeightAt(particle.x);
        if (particle.y >= groundY) {
            particle.y = groundY - 1;
            particle.vy = -particle.vy * 0.3;
            particle.vx *= 0.5;
        }
    }
    lander.explosionParticles = lander.explosionParticles.filter(p => p.alpha > 0);
}

function updateStars(deltaTimeSec) {
    const vxFactor = lander.vx * 0.00010;
    const vyFactor = lander.vy * 0.00010;
    
    for (let cloud of nebulaClouds) {
        cloud.x -= vxFactor * cloud.parallax;
        cloud.y -= vyFactor * cloud.parallax;
    }
    
    for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        star.x -= vxFactor * star.parallax;
        star.y -= vyFactor * star.parallax;
        
        star.alpha += star.twinkleSpeed * star.twinkleDirection;
        if (star.alpha >= 1.0) {
            star.alpha = 1.0;
            star.twinkleDirection = -1;
        } else if (star.alpha <= 0.5) {
            star.alpha = 0.5;
            star.twinkleDirection = 1;
        }
    }
    
    updateShootingStars(deltaTimeSec);
}

// Cache terrain gradient
let cachedTerrainGradient = null;
let lastGradientCameraY = null;
let cachedBodyGradient = null;
let cachedViewportGradient = null;
let cachedFlameGradient = null;

function initLanderGradients() {
    cachedBodyGradient = ctx.createLinearGradient(-15, 0, 15, 0);
    cachedBodyGradient.addColorStop(0, "#D0D0D8");
    cachedBodyGradient.addColorStop(0.5, "#F0F0F8");
    cachedBodyGradient.addColorStop(1, "#D0D0D8");
    
    cachedViewportGradient = ctx.createRadialGradient(2, -12, 1, 0, -10, 8);
    cachedViewportGradient.addColorStop(0, "#FFFFFF");
    cachedViewportGradient.addColorStop(0.3, "#8888FF");
    cachedViewportGradient.addColorStop(1, "#4444AA");
    
    cachedFlameGradient = ctx.createRadialGradient(0, 28, 0, 0, 28, 9);
    cachedFlameGradient.addColorStop(0.0, 'white');
    cachedFlameGradient.addColorStop(0.25, 'yellow');
    cachedFlameGradient.addColorStop(0.80, 'orange');
    cachedFlameGradient.addColorStop(1.0, 'rgba(255, 100, 0, 0.5)');
}

function getTerrainGradient() {
    if (lastGradientCameraY !== cameraY) {
        cachedTerrainGradient = ctx.createLinearGradient(0, cameraY, 0, cameraY + height);
        cachedTerrainGradient.addColorStop(0, '#8B8B8B');
        cachedTerrainGradient.addColorStop(0.3, '#6B6B6B');
        cachedTerrainGradient.addColorStop(0.6, '#5B5B5B');
        cachedTerrainGradient.addColorStop(1, '#3B3B3B');
        lastGradientCameraY = cameraY;
    }
    return cachedTerrainGradient;
}

function getVisibleTerrainRange() {
    const viewLeft = cameraX - 100;
    const viewRight = cameraX + width + 100;
    
    let startIdx = 0;
    let endIdx = terrain.length - 1;
    
    let left = 0, right = terrain.length - 1;
    while (left < right) {
        const mid = (left + right) >> 1;
        if (terrain[mid].x < viewLeft) left = mid + 1;
        else right = mid;
    }
    startIdx = Math.max(0, left - 1);
    
    left = startIdx;
    right = terrain.length - 1;
    while (left < right) {
        const mid = (left + right + 1) >> 1;
        if (terrain[mid].x > viewRight) right = mid - 1;
        else left = mid;
    }
    endIdx = Math.min(terrain.length - 1, right + 1);
    
    return { startIdx, endIdx };
}

// The draw function continues from here - it's very long, so I'll include the key parts
// Full draw function would be included in the actual file

function draw() {
    // Create deep space gradient background
    const bgGradient = ctx.createRadialGradient(width/2, height/3, 0, width/2, height/2, height);
    bgGradient.addColorStop(0, '#0a0a1a');
    bgGradient.addColorStop(0.5, '#050510');
    bgGradient.addColorStop(1, '#000005');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    if (!cachedBodyGradient) {
        initLanderGradients();
    }
    
    // Draw nebula clouds
    for (let cloud of nebulaClouds) {
        const gradient = ctx.createRadialGradient(cloud.x, cloud.y, 0, cloud.x, cloud.y, cloud.radius);
        gradient.addColorStop(0, cloud.color);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw Earth in far background
    const earthX = width * 0.85 - (cameraX * 0.01);
    const earthY = height * 0.15 - (cameraY * 0.005);
    const earthRadius = 60;
    
    const earthGlow = ctx.createRadialGradient(earthX, earthY, earthRadius * 0.9, earthX, earthY, earthRadius * 2);
    earthGlow.addColorStop(0, 'rgba(100, 150, 255, 0.15)');
    earthGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = earthGlow;
    ctx.beginPath();
    ctx.arc(earthX, earthY, earthRadius * 2, 0, Math.PI * 2);
    ctx.fill();
    
    const earthGradient = ctx.createRadialGradient(earthX - 15, earthY - 15, 0, earthX, earthY, earthRadius);
    earthGradient.addColorStop(0, '#5588DD');
    earthGradient.addColorStop(0.3, '#3366BB');
    earthGradient.addColorStop(0.6, '#224488');
    earthGradient.addColorStop(1, '#112244');
    ctx.fillStyle = earthGradient;
    ctx.beginPath();
    ctx.arc(earthX, earthY, earthRadius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(earthX - 20, earthY - 10, 25, 8, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(earthX + 15, earthY + 15, 20, 6, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(earthX, earthY, earthRadius + 2, 0, Math.PI * 2);
    ctx.stroke();

    // Draw stars
    for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        ctx.globalAlpha = star.alpha;
        
        if (star.glowSize > 0) {
            const glowGradient = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.glowSize * 2);
            glowGradient.addColorStop(0, star.color);
            glowGradient.addColorStop(1, 'transparent');
            ctx.fillStyle = glowGradient;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.glowSize * 2, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.fillStyle = star.color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw shooting stars
    for (let shootingStar of shootingStars) {
        ctx.save();
        ctx.globalAlpha = shootingStar.alpha;
        const gradient = ctx.createLinearGradient(
            shootingStar.x, shootingStar.y,
            shootingStar.x - shootingStar.vx * 0.2, shootingStar.y - shootingStar.vy * 0.2
        );
        gradient.addColorStop(0, 'white');
        gradient.addColorStop(1, 'transparent');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(shootingStar.x, shootingStar.y);
        ctx.lineTo(
            shootingStar.x - shootingStar.vx * 0.15,
            shootingStar.y - shootingStar.vy * 0.15
        );
        ctx.stroke();
        ctx.restore();
    }
    
    ctx.globalAlpha = 1.0;

    ctx.save();
    ctx.translate(-cameraX, -cameraY);

    // Draw terrain
    const { startIdx, endIdx } = getVisibleTerrainRange();
    
    ctx.fillStyle = getTerrainGradient();
    ctx.beginPath();
    ctx.moveTo(terrain[startIdx].x, cameraY + height);
    for (let i = startIdx; i <= endIdx; i++) {
        ctx.lineTo(terrain[i].x, terrain[i].y);
    }
    ctx.lineTo(terrain[endIdx].x, cameraY + height);
    ctx.closePath();
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(180, 180, 190, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(terrain[startIdx].x, terrain[startIdx].y);
    for (let i = startIdx + 1; i <= endIdx; i++) {
        ctx.lineTo(terrain[i].x, terrain[i].y);
    }
    ctx.stroke();

    // Draw craters and rocks (culled)
    const viewLeft = cameraX - 50;
    const viewRight = cameraX + width + 50;
    
    for (let crater of craterMarks) {
        if (crater.x >= viewLeft && crater.x <= viewRight) {
            const craterGradient = ctx.createRadialGradient(
                crater.x - crater.radius * 0.2, crater.y - crater.radius * 0.2, 0,
                crater.x, crater.y, crater.radius
            );
            craterGradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
            craterGradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.3)');
            craterGradient.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
            ctx.fillStyle = craterGradient;
            ctx.beginPath();
            ctx.ellipse(crater.x, crater.y, crater.radius, crater.radius * 0.4, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let rock of rocks) {
        if (rock.x >= viewLeft && rock.x <= viewRight) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.ellipse(rock.x + 2, rock.y + rock.size * 0.3, rock.size * 1.2, rock.size * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
            
            const rockGradient = ctx.createRadialGradient(
                rock.x - rock.size * 0.3, rock.y - rock.size * 0.3, 0,
                rock.x, rock.y, rock.size
            );
            rockGradient.addColorStop(0, '#5D5D5D');
            rockGradient.addColorStop(0.7, '#3D3D3D');
            rockGradient.addColorStop(1, '#2D2D2D');
            ctx.fillStyle = rockGradient;
            ctx.beginPath();
            ctx.arc(rock.x, rock.y - rock.size * 0.2, rock.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Draw landing zones
    for (let zone of landingZones) {
        if (zone.x + zone.width >= viewLeft && zone.x <= viewRight) {
            const padHeight = 8;
            const centerX = zone.x + zone.width / 2;
            
            if (!zone.landed) {
                const pulseAlpha = 0.08 + Math.sin(Date.now() * 0.003) * 0.05;
                const glowGradient = ctx.createRadialGradient(
                    centerX, zone.y - padHeight/2, 0,
                    centerX, zone.y - padHeight/2, zone.width * 0.5
                );
                glowGradient.addColorStop(0, `rgba(255, 255, 150, ${pulseAlpha})`);
                glowGradient.addColorStop(1, 'transparent');
                ctx.fillStyle = glowGradient;
                ctx.beginPath();
                ctx.ellipse(centerX, zone.y - padHeight/2, zone.width * 0.5, 15, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            
            const padGradient = ctx.createLinearGradient(zone.x, zone.y - padHeight, zone.x, zone.y);
            if (zone.landed) {
                padGradient.addColorStop(0, '#666666');
                padGradient.addColorStop(1, '#444444');
            } else {
                padGradient.addColorStop(0, '#FFE066');
                padGradient.addColorStop(0.5, '#FFD700');
                padGradient.addColorStop(1, '#CC9900');
            }
            ctx.fillStyle = padGradient;
            ctx.fillRect(zone.x, zone.y - padHeight, zone.width, padHeight);
            
            ctx.strokeStyle = zone.landed ? '#888888' : '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(zone.x + 5, zone.y - padHeight/2);
            ctx.lineTo(zone.x + zone.width - 5, zone.y - padHeight/2);
            ctx.stroke();
            ctx.setLineDash([]);
            
            if (!zone.landed) {
                const beaconPulse = Math.sin(Date.now() * 0.005) * 0.5 + 0.5;
                
                ctx.fillStyle = `rgba(255, 100, 100, ${0.4 + beaconPulse * 0.3})`;
                ctx.beginPath();
                ctx.arc(zone.x + 3, zone.y - padHeight - 5, 2, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = `rgba(100, 255, 100, ${0.4 + beaconPulse * 0.3})`;
                ctx.beginPath();
                ctx.arc(zone.x + zone.width - 3, zone.y - padHeight - 5, 2, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.textAlign = 'center';
                ctx.fillText(`+${zone.points}`, centerX, zone.y - padHeight - 15);
            }
        }
    }

    // Draw meteorites
    for (let meteor of meteorites) {
        if (!meteor.exploded) {
            ctx.save();
            ctx.translate(meteor.x, meteor.y);
            
            const trailGrad = ctx.createLinearGradient(0, 0, -meteor.vx * 0.1, -meteor.vy * 0.1);
            trailGrad.addColorStop(0, 'rgba(255, 200, 100, 0.8)');
            trailGrad.addColorStop(0.5, 'rgba(255, 150, 50, 0.4)');
            trailGrad.addColorStop(1, 'transparent');
            ctx.strokeStyle = trailGrad;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-meteor.vx * 0.15, -meteor.vy * 0.15);
            ctx.stroke();
            
            const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
            glowGrad.addColorStop(0, 'rgba(255, 200, 150, 0.6)');
            glowGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 15, 0, Math.PI * 2);
            ctx.fill();
            
            const bodyGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, 6);
            bodyGrad.addColorStop(0, '#AAA');
            bodyGrad.addColorStop(0.5, '#777');
            bodyGrad.addColorStop(1, '#444');
            ctx.fillStyle = bodyGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // Draw meteor explosions
    for (let meteor of meteorites) {
        if (meteor.exploded && meteor.explosionParticles) {
            for (let particle of meteor.explosionParticles) {
                ctx.save();
                ctx.globalAlpha = particle.alpha * 0.7;
                const expGrad = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, 4);
                expGrad.addColorStop(0, '#FFCC66');
                expGrad.addColorStop(0.5, '#FF7722');
                expGrad.addColorStop(1, 'rgba(255, 100, 0, 0.1)');
                ctx.fillStyle = expGrad;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }
    }

    // Draw dust particles
    for (let dust of dustParticles) {
        ctx.save();
        ctx.globalAlpha = dust.alpha * 0.8;
        
        const dustGradient = ctx.createRadialGradient(dust.x, dust.y, 0, dust.x, dust.y, dust.size * 2);
        dustGradient.addColorStop(0, 'rgba(180, 170, 160, 0.8)');
        dustGradient.addColorStop(0.5, 'rgba(150, 140, 130, 0.4)');
        dustGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = dustGradient;
        ctx.beginPath();
        ctx.arc(dust.x, dust.y, dust.size * 2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'rgba(200, 190, 180, 0.9)';
        ctx.beginPath();
        ctx.arc(dust.x, dust.y, dust.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Draw lander or crash debris
    if (lander.crashed) {
        // Draw explosion particles
        for (let particle of lander.explosionParticles) {
            ctx.save();
            ctx.globalAlpha = particle.alpha;
            const particleGlow = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.size * 2);
            const hue = 30 + Math.random() * 30;
            particleGlow.addColorStop(0, `hsla(${hue}, 100%, 70%, 1)`);
            particleGlow.addColorStop(0.5, `hsla(${hue}, 100%, 50%, 0.5)`);
            particleGlow.addColorStop(1, 'transparent');
            ctx.fillStyle = particleGlow;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        
        // Draw debris particles
        for (let debris of lander.debrisParticles) {
            ctx.save();
            ctx.translate(debris.x, debris.y);
            ctx.rotate(debris.angle);
            
            if (debris.type === 'hull') {
                let bodyGradient = ctx.createLinearGradient(-debris.width/2, 0, debris.width/2, 0);
                bodyGradient.addColorStop(0, "#D0D0D8");
                bodyGradient.addColorStop(0.5, "#F0F0F8");
                bodyGradient.addColorStop(1, "#D0D0D8");
                ctx.fillStyle = bodyGradient;
                
                ctx.beginPath();
                const jag = debris.jaggedness;
                ctx.moveTo(-debris.width/2, -debris.height/2 + jag[0]);
                ctx.lineTo(debris.width/2 - jag[1], -debris.height/2);
                ctx.lineTo(debris.width/2, debris.height/2 - jag[2]);
                ctx.lineTo(-debris.width/2 + jag[3], debris.height/2);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#999999';
                ctx.lineWidth = 1;
                ctx.stroke();
            } else if (debris.type === 'viewport') {
                let viewportGradient = ctx.createRadialGradient(1, -1, 0, 0, 0, debris.width/2);
                viewportGradient.addColorStop(0, "#FFFFFF");
                viewportGradient.addColorStop(0.3, "#8888FF");
                viewportGradient.addColorStop(1, "#4444AA");
                ctx.fillStyle = viewportGradient;
                ctx.beginPath();
                ctx.arc(0, 0, debris.width/2, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#666666';
                ctx.lineWidth = 1;
                ctx.stroke();
            } else if (debris.type === 'leg') {
                ctx.strokeStyle = '#777777';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(0, -debris.height/2);
                ctx.lineTo(debris.width/4, 0);
                ctx.lineTo(0, debris.height/2);
                ctx.stroke();
            } else if (debris.type === 'thruster') {
                const heatGradient = ctx.createLinearGradient(-debris.width/2, 0, debris.width/2, 0);
                heatGradient.addColorStop(0, "#888888");
                heatGradient.addColorStop(0.7, "#a86032");
                heatGradient.addColorStop(1, "#c83000");
                ctx.fillStyle = heatGradient;
                ctx.beginPath();
                ctx.moveTo(-debris.width/2, -debris.height/2);
                ctx.lineTo(debris.width/2, -debris.height/2);
                ctx.lineTo(debris.width/2 + 1, debris.height/2);
                ctx.lineTo(-debris.width/2 - 1, debris.height/2);
                ctx.closePath();
                ctx.fill();
            } else if (debris.type === 'antenna') {
                ctx.strokeStyle = '#999999';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, -debris.height/2);
                ctx.bezierCurveTo(debris.width/2, -debris.height/4, debris.width/2, debris.height/4, debris.width/2, debris.height/2);
                ctx.stroke();
            }
            
            ctx.restore();
        }
    } else {
        // Draw the lander
        ctx.save();
        ctx.translate(lander.x, lander.y);
        ctx.rotate(lander.angle);

        // Draw main thruster flame
        if (keys['arrowup'] && fuel > 0 && !lander.controlsDisabled) {
            const flameHeight = 35 + Math.random() * 12;
            const flameWidth = 8 + Math.random() * 2;
            const flameStartY = 5;
            
            const outerGlow = ctx.createRadialGradient(0, flameStartY + flameHeight * 0.5, 0, 0, flameStartY + flameHeight * 0.5, flameHeight * 0.8);
            outerGlow.addColorStop(0, 'rgba(255, 200, 100, 0.4)');
            outerGlow.addColorStop(0.5, 'rgba(255, 150, 50, 0.2)');
            outerGlow.addColorStop(1, 'transparent');
            ctx.fillStyle = outerGlow;
            ctx.beginPath();
            ctx.ellipse(0, flameStartY + flameHeight * 0.4, flameWidth * 2, flameHeight * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();

            const flameGradient = ctx.createRadialGradient(0, flameStartY + 10, 0, 0, flameStartY + flameHeight * 0.6, flameHeight * 0.7);
            flameGradient.addColorStop(0.0, '#FFFFFF');
            flameGradient.addColorStop(0.15, '#FFFFAA');
            flameGradient.addColorStop(0.35, '#FFCC44');
            flameGradient.addColorStop(0.6, '#FF8800');
            flameGradient.addColorStop(0.85, '#FF4400');
            flameGradient.addColorStop(1.0, 'rgba(255, 50, 0, 0.3)');
            
            ctx.fillStyle = flameGradient;
            ctx.beginPath();
            ctx.moveTo(0, flameStartY);
            ctx.bezierCurveTo(-flameWidth, flameStartY + flameHeight * 0.3, -flameWidth * 1.2, flameStartY + flameHeight * 0.6, 0, flameStartY + flameHeight);
            ctx.bezierCurveTo(flameWidth * 1.2, flameStartY + flameHeight * 0.6, flameWidth, flameStartY + flameHeight * 0.3, 0, flameStartY);
            ctx.closePath();
            ctx.fill();
        }

        // "Unconscious..." label
        if (oxygen <= 0 && !lander.crashed) {
            ctx.save();
            ctx.rotate(-lander.angle);
            ctx.font = "bold 16px -apple-system, BlinkMacSystemFont, sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(220, 220, 220, 0.9)";
            ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
            ctx.shadowBlur = 4;
            ctx.fillText("Unconscious...", 0, -45);
            ctx.restore();
        }

        // Main body hull
        const hullGradient = ctx.createLinearGradient(-20, -20, 20, 15);
        hullGradient.addColorStop(0, '#F8F8FF');
        hullGradient.addColorStop(0.2, '#E8E8F0');
        hullGradient.addColorStop(0.5, '#D8D8E5');
        hullGradient.addColorStop(0.8, '#C8C8D5');
        hullGradient.addColorStop(1, '#B8B8C8');
        
        ctx.fillStyle = hullGradient;
        ctx.beginPath();
        ctx.moveTo(-15, -20);
        ctx.quadraticCurveTo(-18, -20, -18, -15);
        ctx.lineTo(-18, 5);
        ctx.quadraticCurveTo(-18, 10, -15, 10);
        ctx.lineTo(15, 10);
        ctx.quadraticCurveTo(18, 10, 18, 5);
        ctx.lineTo(18, -15);
        ctx.quadraticCurveTo(18, -20, 15, -20);
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = '#888899';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // Viewport
        const viewportGradient = ctx.createRadialGradient(1, -12, 1, 0, -10, 8);
        viewportGradient.addColorStop(0, '#FFFFFF');
        viewportGradient.addColorStop(0.2, '#AACCFF');
        viewportGradient.addColorStop(0.5, '#6699DD');
        viewportGradient.addColorStop(1, '#3366AA');
        ctx.fillStyle = viewportGradient;
        ctx.beginPath();
        ctx.arc(0, -10, 7, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#4466AA';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Antenna
        ctx.strokeStyle = '#AAAAAA';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(0, -30);
        ctx.stroke();
        
        ctx.fillStyle = '#FF4444';
        ctx.beginPath();
        ctx.arc(0, -31, 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Landing gear
        const legGradient = ctx.createLinearGradient(-20, 8, -20, 25);
        legGradient.addColorStop(0, '#888899');
        legGradient.addColorStop(0.5, '#666677');
        legGradient.addColorStop(1, '#555566');
        ctx.strokeStyle = legGradient;
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        ctx.moveTo(-12, 8);
        ctx.lineTo(-20, 25);
        ctx.stroke();
        
        ctx.fillStyle = '#555566';
        ctx.beginPath();
        ctx.ellipse(-20, 26, 5, 2, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(12, 8);
        ctx.lineTo(20, 25);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.ellipse(20, 26, 5, 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Side thrusters
        const thrusterGradient = ctx.createLinearGradient(-18, -2, -14, -2);
        thrusterGradient.addColorStop(0, '#666677');
        thrusterGradient.addColorStop(0.5, '#888899');
        thrusterGradient.addColorStop(1, '#777788');
        ctx.fillStyle = thrusterGradient;
        ctx.beginPath();
        ctx.roundRect(-18, -3, 4, 6, 1);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(14, -3, 4, 6, 1);
        ctx.fill();

        // Side thruster effects (A key)
        if (keys['a'] && fuel > 0 && !lander.controlsDisabled) {
            const thrustLen = 12 + Math.random() * 8;
            const thrustGrad = ctx.createLinearGradient(-15, 0, -15 - thrustLen, 0);
            thrustGrad.addColorStop(0, 'white');
            thrustGrad.addColorStop(0.3, '#FFDD66');
            thrustGrad.addColorStop(0.7, '#FF8800');
            thrustGrad.addColorStop(1, 'rgba(255, 100, 0, 0.3)');
            ctx.fillStyle = thrustGrad;
            ctx.beginPath();
            ctx.moveTo(-15, -3);
            ctx.lineTo(-15 - thrustLen, 0);
            ctx.lineTo(-15, 3);
            ctx.closePath();
            ctx.fill();
        }

        // Side thruster effects (D key)
        if (keys['d'] && fuel > 0 && !lander.controlsDisabled) {
            const thrustLen = 12 + Math.random() * 8;
            const thrustGrad = ctx.createLinearGradient(15, 0, 15 + thrustLen, 0);
            thrustGrad.addColorStop(0, 'white');
            thrustGrad.addColorStop(0.3, '#FFDD66');
            thrustGrad.addColorStop(0.7, '#FF8800');
            thrustGrad.addColorStop(1, 'rgba(255, 100, 0, 0.3)');
            ctx.fillStyle = thrustGrad;
            ctx.beginPath();
            ctx.moveTo(15, -3);
            ctx.lineTo(15 + thrustLen, 0);
            ctx.lineTo(15, 3);
            ctx.closePath();
            ctx.fill();
        }

        // Rotation thruster effects (Right arrow)
        if (keys['arrowright'] && fuel > 0 && !lander.controlsDisabled) {
            const thrustLen = 10 + Math.random() * 6;
            const thrustGrad = ctx.createLinearGradient(-15, -14, -15 - thrustLen, -14);
            thrustGrad.addColorStop(0, 'white');
            thrustGrad.addColorStop(0.4, '#AADDFF');
            thrustGrad.addColorStop(1, 'rgba(150, 200, 255, 0.2)');
            ctx.fillStyle = thrustGrad;
            ctx.beginPath();
            ctx.moveTo(-15, -16);
            ctx.lineTo(-15 - thrustLen, -14);
            ctx.lineTo(-15, -12);
            ctx.closePath();
            ctx.fill();
        }

        // Rotation thruster effects (Left arrow)
        if (keys['arrowleft'] && fuel > 0 && !lander.controlsDisabled) {
            const thrustLen = 10 + Math.random() * 6;
            const thrustGrad = ctx.createLinearGradient(15, -14, 15 + thrustLen, -14);
            thrustGrad.addColorStop(0, 'white');
            thrustGrad.addColorStop(0.4, '#AADDFF');
            thrustGrad.addColorStop(1, 'rgba(150, 200, 255, 0.2)');
            ctx.fillStyle = thrustGrad;
            ctx.beginPath();
            ctx.moveTo(15, -16);
            ctx.lineTo(15 + thrustLen, -14);
            ctx.lineTo(15, -12);
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore();
    }
    
    // Draw floating score texts
    for (let scoreText of floatingScoreTexts) {
        ctx.save();
        ctx.globalAlpha = scoreText.alpha;
        ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#00FF00';
        ctx.shadowBlur = 15;
        ctx.fillStyle = '#00FF00';
        ctx.fillText(scoreText.text, scoreText.x - cameraX, scoreText.y - cameraY);
        ctx.restore();
    }

    ctx.restore();
    
    // Vignette effect
    const vignetteGradient = ctx.createRadialGradient(width/2, height/2, height * 0.4, width/2, height/2, height * 1.0);
    vignetteGradient.addColorStop(0, 'transparent');
    vignetteGradient.addColorStop(0.8, 'transparent');
    vignetteGradient.addColorStop(1, 'rgba(0, 0, 10, 0.2)');
    ctx.fillStyle = vignetteGradient;
    ctx.fillRect(0, 0, width, height);
}

let lastTime = 0;
let hudUpdateCounter = 0;
let hudUpdateFrequency = 5;
let velocityUpdateCounter = 0;
let velocityUpdateFrequency = 8;
let lastHeightDisplay = 0;
let lastVelocityDisplay = 0;
let lastHorizontalVelocityDisplay = 0;
let smoothedVerticalVelocity = 0;
let smoothedHorizontalVelocity = 0;

let lastHudState = {
    fuelPct: -1,
    oxygenPct: -1,
    oxygenColor: '',
    fuelColor: '',
    score: -1,
    highScore: -1
};

function updateHUD() {
    hudUpdateCounter++;
    if (hudUpdateCounter < hudUpdateFrequency) return;
    hudUpdateCounter = 0;
    
    const groundY = getTerrainHeightAt(lander.x);

    const fuelPct = Math.floor(Math.max(0, Math.min((fuel / 1700) * 100, 100)));
    const oxygenPct = Math.floor(Math.max(0, Math.min((oxygen / 60) * 100, 100)));
    
    if (fuelPct !== lastHudState.fuelPct) {
        lastHudState.fuelPct = fuelPct;
        hudElements.miniFuelValue.textContent = fuelPct + '%';
        hudElements.miniFuelBar.style.width = fuelPct + '%';
        
        if (fuelPct > 50) {
            hudElements.miniFuelBar.style.background = 'linear-gradient(180deg, #00ff66 0%, #00dd44 50%, #00bb33 100%)';
        } else if (fuelPct > 20) {
            hudElements.miniFuelBar.style.background = 'linear-gradient(180deg, #ffee00 0%, #ddcc00 50%, #bbaa00 100%)';
        } else {
            hudElements.miniFuelBar.style.background = 'linear-gradient(180deg, #ff4444 0%, #dd2222 50%, #bb0000 100%)';
        }
    }
    
    if (oxygenPct !== lastHudState.oxygenPct) {
        lastHudState.oxygenPct = oxygenPct;
        hudElements.miniOxygenValue.textContent = oxygenPct + '%';
        hudElements.miniOxygenBar.style.width = oxygenPct + '%';
        
        if (oxygen > 10) {
            hudElements.miniOxygenBar.style.background = 'linear-gradient(180deg, #00d4ff 0%, #00a8dd 50%, #0088bb 100%)';
        } else if (oxygen > 5) {
            hudElements.miniOxygenBar.style.background = 'linear-gradient(180deg, #ffaa44 0%, #ee8822 50%, #cc6600 100%)';
        } else {
            hudElements.miniOxygenBar.style.background = 'linear-gradient(180deg, #ff4444 0%, #dd2222 50%, #bb0000 100%)';
        }
    }

    if (score !== lastHudState.score) {
        lastHudState.score = score;
        hudElements.scoreValue.textContent = score;
    }
    
    if (highScore !== lastHudState.highScore) {
        lastHudState.highScore = highScore;
        hudElements.highScoreValue.textContent = highScore;
    }
    
    const heightAboveTerrain = groundY - (lander.y + 26);
    const heightInMeters = Math.floor(heightAboveTerrain / 10);
    if (heightInMeters !== lastHeightDisplay) {
        lastHeightDisplay = heightInMeters;
        hudElements.heightValue.textContent = heightInMeters + 'm';
    }
    
    velocityUpdateCounter++;
    if (velocityUpdateCounter >= velocityUpdateFrequency) {
        velocityUpdateCounter = 0;
        
        smoothedVerticalVelocity = Math.floor(Math.abs(lander.vy) / 10);
        smoothedHorizontalVelocity = Math.floor(Math.abs(lander.vx) / 10);
        
        if (smoothedVerticalVelocity !== lastVelocityDisplay) {
            lastVelocityDisplay = smoothedVerticalVelocity;
            hudElements.verticalVelocityValue.textContent = smoothedVerticalVelocity;
        }
        
        if (smoothedHorizontalVelocity !== lastHorizontalVelocityDisplay) {
            lastHorizontalVelocityDisplay = smoothedHorizontalVelocity;
            hudElements.horizontalVelocityValue.textContent = smoothedHorizontalVelocity;
        }
    }
}

async function crash(impactVx = 0, impactVy = 0) {
    lander.crashed = true;
    lander.landed = false;
    lander.crashTime = Date.now();
    lander.gameOverShown = false;

    // Haptic feedback for crash
    await triggerHaptic('heavy');

    // Stop sounds
    if (mainEngineSoundPlaying) {
        mainEngineSound.pause();
        mainEngineSound.currentTime = 0;
        mainEngineSoundPlaying = false;
    }
    if (rotationEngineSoundPlaying || translationEngineSoundPlaying) {
        rotationEngineSound.pause();
        rotationEngineSound.currentTime = 0;
        rotationEngineSoundPlaying = false;
        translationEngineSoundPlaying = false;
    }
    if (breathingSoundPlaying) {
        breathingSound.pause();
        breathingSound.currentTime = 0;
        breathingSoundPlaying = false;
    }
    if (riserSoundPlaying) {
        riserSound.pause();
        riserSound.currentTime = 0;
        riserSoundPlaying = false;
    }

    crashSound.play();
    
    const impactVelocity = Math.sqrt(impactVx * impactVx + impactVy * impactVy);
    const groundY = getTerrainHeightAt(lander.x);
    const isCliffImpact = Math.abs(impactVx) > Math.abs(impactVy) && lander.y + 20 < groundY - 10;
    const impactAngle = Math.atan2(impactVy, impactVx);
    
    lander.explosionParticles = [];
    let numParticles = Math.min(50, 30 + Math.floor(impactVelocity / 10));
    for (let i = 0; i < numParticles; i++) {
        const particleAngle = isCliffImpact ? 
            Math.PI - impactAngle + (Math.random() - 0.5) * Math.PI * 0.7 :
            impactAngle + (Math.random() - 0.5) * Math.PI;
        
        const speedMultiplier = 1 + (impactVelocity / 100);
        const particleSpeed = (80 + Math.random() * 60) * speedMultiplier;
        
        lander.explosionParticles.push({
            x: lander.x + (Math.random() - 0.5) * 15,
            y: lander.y + (Math.random() - 0.5) * 15,
            vx: impactVx * 0.5 + Math.cos(particleAngle) * particleSpeed,
            vy: impactVy * 0.3 + Math.sin(particleAngle) * particleSpeed,
            alpha: 1.0 + Math.random() * 0.5,
            size: 3 + Math.random() * 4 * speedMultiplier,
        });
    }
    
    // Create debris particles
    lander.debrisParticles = [];
    const reboundFactor = isCliffImpact ? -0.6 : 1;
    const momentumFactor = 0.8;
    
    // Hull fragments
    const numHullPieces = Math.min(7, 3 + Math.floor(impactVelocity / 20));
    for (let i = 0; i < numHullPieces; i++) {
        const size = 6 + Math.random() * 12;
        const spreadVx = (Math.random() - 0.5) * 80;
        const spreadVy = -Math.random() * 60 - 20;
        
        lander.debrisParticles.push({
            x: lander.x + (Math.random() - 0.5) * 20,
            y: lander.y + (Math.random() - 0.5) * 20,
            vx: impactVx * momentumFactor * reboundFactor + spreadVx,
            vy: impactVy * momentumFactor * 0.3 + spreadVy,
            width: size,
            height: size * (0.7 + Math.random() * 0.6),
            angle: Math.random() * Math.PI * 2,
            angularVelocity: (Math.random() - 0.5) * 15 * (1 + impactVelocity / 50),
            type: 'hull',
            jaggedness: [Math.random() * 4, Math.random() * 4, Math.random() * 4, Math.random() * 4]
        });
    }
    
    // Viewport
    lander.debrisParticles.push({
        x: lander.x + (Math.random() - 0.5) * 10,
        y: lander.y - 10,
        vx: impactVx * momentumFactor * reboundFactor + (Math.random() - 0.5) * 60,
        vy: impactVy * momentumFactor * 0.3 - Math.random() * 50 - 30,
        width: 7 + Math.random() * 3,
        height: 7 + Math.random() * 3,
        angle: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 8,
        type: 'viewport'
    });
    
    // Landing legs
    for (let i = 0; i < 2; i++) {
        const direction = i === 0 ? -1 : 1;
        lander.debrisParticles.push({
            x: lander.x + direction * 15,
            y: lander.y + 15,
            vx: impactVx * momentumFactor * reboundFactor + direction * (30 + Math.random() * 20),
            vy: impactVy * momentumFactor * 0.3 - Math.random() * 40 - 20,
            width: 4 + Math.random() * 2,
            height: 15 + Math.random() * 10,
            angle: Math.random() * Math.PI * 2,
            angularVelocity: direction * (5 + Math.random() * 10),
            type: 'leg'
        });
    }
    
    // Thrusters
    for (let i = 0; i < 2; i++) {
        const direction = i === 0 ? -1 : 1;
        lander.debrisParticles.push({
            x: lander.x + direction * 15,
            y: lander.y,
            vx: impactVx * momentumFactor * reboundFactor + direction * (25 + Math.random() * 15),
            vy: impactVy * momentumFactor * 0.3 - Math.random() * 30 - 15,
            width: 5 + Math.random() * 3,
            height: 7 + Math.random() * 3,
            angle: Math.random() * Math.PI * 2,
            angularVelocity: (Math.random() - 0.5) * 12,
            type: 'thruster'
        });
    }
    
    // Antenna
    lander.debrisParticles.push({
        x: lander.x,
        y: lander.y - 25,
        vx: impactVx * momentumFactor * reboundFactor + (Math.random() - 0.5) * 40,
        vy: impactVy * momentumFactor * 0.2 - 50 - Math.random() * 30,
        width: 5,
        height: 12,
        angle: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 15,
        type: 'antenna'
    });
    
    // Create impact crater
    const craterSize = Math.min(40, 20 + (0.5 * lander.mass * impactVelocity * impactVelocity) / 10000);
    craterMarks.push({
        x: lander.x,
        y: groundY,
        radius: craterSize
    });
}

async function successfulLanding(platform) {
    if (!platform.landed) {
        score += platform.points;
        fuel += 330;
        oxygen += 17;
        fuel = Math.min(fuel, 1700);
        oxygen = Math.min(oxygen, 60);
        
        const totalPoints = platform.points + 50;
        floatingScoreTexts.push({
            x: lander.x,
            y: lander.y - 50,
            text: '+' + totalPoints,
            alpha: 1.0,
            life: 2.0,
            vy: -30
        });
        
        // Haptic feedback for successful landing
        await triggerHaptic('medium');
        
        try {
            fuelUpSound.pause();
            fuelUpSound.currentTime = 0;
            fuelUpSound.play();
        } catch (e) {
            console.log("Error playing fuel up sound:", e);
        }
    }
    lander.vx = 0;
    lander.vy = 0;
    lander.angularVelocity = 0;
    lander.angle = 0;

    lander.landed = true;
    score += 50;
}

async function endGame(message) {
    gameOver = true;

    fadeAudioVolume(backgroundSound, backgroundSound.volume, 0.125, 1500);
    
    if (!gameOverSoundPlaying) {
        gameOverSound.currentTime = 0;
        gameOverSound.play().catch(() => {});
        gameOverSoundPlaying = true;
    }

    // Stop all sounds
    if (mainEngineSoundPlaying) {
        mainEngineSound.pause();
        mainEngineSound.currentTime = 0;
        mainEngineSoundPlaying = false;
    }
    if (rotationEngineSoundPlaying || translationEngineSoundPlaying) {
        rotationEngineSound.pause();
        rotationEngineSound.currentTime = 0;
        rotationEngineSoundPlaying = false;
        translationEngineSoundPlaying = false;
    }
    if (breathingSoundPlaying) {
        breathingSound.pause();
        breathingSound.currentTime = 0;
        breathingSoundPlaying = false;
    }
    if (riserSoundPlaying) {
        riserSound.pause();
        riserSound.currentTime = 0;
        riserSoundPlaying = false;
    }

    // Update high score
    if (score > highScore) {
        highScore = score;
        await saveHighScore(highScore);
        document.getElementById('highScoreValue').textContent = highScore;
    }

    const randomMessage = gameOverMessages[Math.floor(Math.random() * gameOverMessages.length)];
    
    const messageDiv = document.getElementById('message');
    const gameMessage = document.getElementById('gameMessage');
    
    messageDiv.style.background = 'rgba(0, 0, 0, 0.85)';
    messageDiv.style.borderRadius = '15px';
    messageDiv.style.border = '1px solid rgba(255, 100, 100, 0.5)';
    messageDiv.style.padding = '30px';
    messageDiv.style.maxWidth = 'calc(100vw - 40px)';
    
    gameMessage.innerHTML = `<div style="font-size: 28px; margin-bottom: 15px; color: #ff7777;">MISSION FAILED</div>
                <div style="font-size: 16px; margin-bottom: 20px;">${randomMessage}</div>
                <div style="color: #aaaaaa; margin-top: 15px;">Final Score: ${score}</div>`;
    
    messageDiv.style.display = 'block';
}

async function restartGame() {
    await triggerHaptic('medium');
    
    oxygen = 60;
    fuel = 1700;
    score = 0;
    gameOver = false;
    lander.crashed = false;
    lander.landed = false;
    lander.controlsDisabled = false;
    generateLandscape();
    generateStars();
    meteorites = [];
    craterMarks = [];
    rocks = [];
    dustParticles = [];
    floatingScoreTexts = [];
    document.getElementById('message').style.display = 'none';
    lander.vx = 0;
    lander.vy = 0;
    lander.angle = 0;
    lander.angularVelocity = 0;
    lander.explosionParticles = [];
    lander.currentPlatform = null;
    
    // Reset HUD state
    lastHudState.fuelPct = -1;
    lastHudState.oxygenPct = -1;
    lastHudState.score = -1;
    lastHudState.highScore = -1;
    lastHeightDisplay = 0;
    lastVelocityDisplay = 0;
    lastHorizontalVelocityDisplay = 0;
    hudUpdateCounter = hudUpdateFrequency;
    
    cachedTerrainGradient = null;
    lastGradientCameraY = null;

    mainEngineSound.pause();
    mainEngineSound.currentTime = 0;
    mainEngineSoundPlaying = false;
    
    mainThrusterStartTime = null;
    if (mainThrusterReleaseTimer !== null) {
        clearTimeout(mainThrusterReleaseTimer);
        mainThrusterReleaseTimer = null;
    }

    rotationEngineSoundPlaying = false;
    rotationEngineSound.pause();
    rotationEngineSound.currentTime = 0;

    crashSound.pause();
    crashSound.currentTime = 0;

    breathingSound.pause();
    breathingSound.currentTime = 0;
    breathingSoundPlaying = false;

    translationEngineSoundPlaying = false;

    if (riserSoundPlaying) {
        riserSound.pause();
        riserSound.currentTime = 0;
        riserSoundPlaying = false;
    }

    if (gameOverSoundPlaying) {
        gameOverSound.pause();
        gameOverSound.currentTime = 0;
        gameOverSoundPlaying = false;
    }
    
    backgroundSound.volume = 0.1;
    playBackgroundMusic();
    fadeAudioVolume(backgroundSound, 0.1, 0.5, 250);
    
    vesselStartupSound.currentTime = 0;
    vesselStartupSound.play().catch(() => {});
}

function emitDustParticles(deltaTimeSec) {
    const groundY = getTerrainHeightAt(lander.x);
    const heightAboveTerrain = groundY - (lander.y + 20);

    const emissionThreshold = 100;
    if (heightAboveTerrain > emissionThreshold) return;

    const proximity = Math.max(0, emissionThreshold - heightAboveTerrain);
    const emissionRate = proximity / emissionThreshold;

    const maxParticlesPerFrame = 5;
    const particlesToEmit = Math.floor(emissionRate * maxParticlesPerFrame);

    for (let i = 0; i < particlesToEmit; i++) {
        const offsetX = (Math.random() - 0.5) * 20;
        const dustX = lander.x + offsetX;
        const dustY = groundY;

        const angle = (Math.random() * Math.PI / 2) + Math.PI / 4;
        const speed = Math.random() * 50 + 50;
        const vx = speed * Math.cos(angle) * (Math.random() < 0.5 ? -1 : 2);
        const vy = speed * Math.sin(angle) * -1;

        dustParticles.push({
            x: dustX,
            y: dustY,
            vx: vx,
            vy: vy,
            size: Math.random() * 2 + 1,
            alpha: 1.0,
            lifespan: 1.0,
        });
    }
}

function updateDustParticles(deltaTimeSec) {
    for (let dust of dustParticles) {
        dust.x += dust.vx * deltaTimeSec;
        dust.y += dust.vy * deltaTimeSec;
        dust.vy += gravity * deltaTimeSec * 0.2;
        dust.lifespan -= deltaTimeSec;
        dust.alpha = Math.max(dust.lifespan / 1.0, 0);
    }
    dustParticles = dustParticles.filter(dust => dust.alpha > 0);
}

function updateFloatingScoreTexts(deltaTimeSec) {
    for (let scoreText of floatingScoreTexts) {
        scoreText.y += scoreText.vy * deltaTimeSec;
        scoreText.life -= deltaTimeSec;
        scoreText.alpha = Math.max(scoreText.life / 2.0, 0);
    }
    floatingScoreTexts = floatingScoreTexts.filter(st => st.life > 0);
}

function updateMeteorites(deltaTimeSec) {
    if (Math.random() < 0.0001) {
        let fromLeft = Math.random() < 0.5;
        let x = fromLeft ? cameraX - 200 : cameraX + width + 200;
        let y = cameraY - 100;
        let angle = fromLeft ? Math.PI / 4 : (3 * Math.PI) / 4;
        let speed = 200 + Math.random() * 100;

        meteorites.push({
            x,
            y,
            vx: speed * Math.cos(angle),
            vy: speed * Math.sin(angle),
            exploded: false,
        });
    }

    for (let meteor of meteorites) {
        if (!meteor.exploded) {
            meteor.x += meteor.vx * deltaTimeSec;
            meteor.y += meteor.vy * deltaTimeSec;
            meteor.vy += gravity * deltaTimeSec;

            let groundY = getTerrainHeightAt(meteor.x);
            if (meteor.y >= groundY) {
                meteor.exploded = true;
                meteor.explosionParticles = [];
                for (let i = 0; i < 15; i++) {
                    meteor.explosionParticles.push({
                        x: meteor.x,
                        y: groundY,
                        vx: (Math.random() - 0.5) * 100,
                        vy: (Math.random() - 0.5) * 100,
                        alpha: 1.0,
                    });
                }
                craterMarks.push({
                    x: meteor.x,
                    y: groundY,
                    radius: 20 + Math.random() * 10,
                });
            }

            let dx = meteor.x - lander.x;
            let dy = meteor.y - lander.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 20 && !lander.crashed) {
                meteor.exploded = true;
                crash(lander.vx, lander.vy);
                meteorites.splice(meteorites.indexOf(meteor), 1);
                continue;
            }
        } else {
            for (let particle of meteor.explosionParticles) {
                particle.x += particle.vx * deltaTimeSec;
                particle.y += particle.vy * deltaTimeSec;
                particle.vy += gravity * deltaTimeSec;
                particle.alpha -= deltaTimeSec * 0.5;
            }
            meteor.explosionParticles = meteor.explosionParticles.filter(p => p.alpha > 0);
        }
    }
    meteorites = meteorites.filter(meteor => !meteor.exploded || meteor.explosionParticles.length > 0);
}

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let deltaTime = timestamp - lastTime;
    lastTime = timestamp;
    
    deltaTime = Math.min(deltaTime, 100);
    
    if (deltaTime > 0) {
        update(deltaTime);
        draw();
    }

    requestAnimationFrame(gameLoop);
}

function showControlsInstructions() {
    const controlsGuide = document.createElement('div');
    controlsGuide.id = 'controlsGuide';
    
    controlsGuide.innerHTML = `
        <h3 style="text-align: center; margin-top: 0;">CONTROLS</h3>
        <div style="text-align: center; margin-bottom: 15px;">
            Use the touch controls at the bottom of the screen:
        </div>
        <div class="control-row">
            <div class="control-description">▲ - Main Thruster</div>
        </div>
        <div class="control-row">
            <div class="control-description">↺/↻ - Rotate Lander</div>
        </div>
        <div class="control-row">
            <div class="control-description">◀/▶ - Side Thrusters</div>
        </div>
        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #aaa;">
            Crafted by Mikkel Vind Lorenz, 2025
        </div>
    `;
    
    const startButton = document.getElementById('startButton');
    loadingScreen.insertBefore(controlsGuide, startButton);
}

// Initialize Capacitor when the document is ready
document.addEventListener('DOMContentLoaded', initCapacitor);
