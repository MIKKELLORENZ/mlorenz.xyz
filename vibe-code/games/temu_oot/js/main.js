import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";
import { regions, getRegionForX, regionWidth, regionDepth } from "./regions.js";
import { createPlayer } from "./player.js";
import { RegionLoader } from "./loader.js";
import { loadState, saveState } from "./storage.js";

const canvas = document.querySelector("#game-canvas");
const regionName = document.querySelector("#region-name");
const loadingStatus = document.querySelector("#loading-status");
const saveStatus = document.querySelector("#save-status");
const audioStatus = document.querySelector("#audio-status");
const staminaFill = document.querySelector(".stamina-fill");
const minimapDot = document.querySelector("#mini-dot");
const minimap = document.querySelector(".minimap");
const lockOverlay = document.querySelector("#lock-overlay");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7cc7ff);
scene.fog = new THREE.Fog(0x7cc7ff, 30, 280);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 800);

const world = new THREE.Group();
scene.add(world);

const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2833, 0.8);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff3d6, 0.9);
sun.position.set(40, 60, 20);
sun.castShadow = false;
scene.add(sun);

const loader = new RegionLoader(scene, world);
const worldWidth = regions.length * regionWidth;
const zLimit = regionDepth / 2 - 6;
const player = createPlayer(scene, { minX: 0, maxX: worldWidth - 1, minZ: -zLimit, maxZ: zLimit });

const cameraState = {
  yaw: 0,
  pitch: -0.2,
  distance: 12,
  sensitivity: 0.0022,
};

const audio = {
  context: null,
  gain: null,
  osc: null,
  muted: true,
};

const dayState = {
  time: 0,
  length: 120,
};

const clock = new THREE.Clock();
let activeRegion = null;
let currentSky = new THREE.Color(0x7cc7ff);
let saveCooldown = 0;
let pointerLocked = false;

const initAudio = () => {
  if (audio.context) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    audioStatus.textContent = "Audio: unsupported";
    return;
  }
  const context = new AudioContextClass();
  const osc = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.value = 70;
  filter.type = "lowpass";
  filter.frequency.value = 620;
  gain.gain.value = 0.04;
  osc.connect(filter).connect(gain).connect(context.destination);
  osc.start();
  audio.context = context;
  audio.osc = osc;
  audio.gain = gain;
  audio.muted = false;
  audioStatus.textContent = "Audio: on";
};

const setAudioMuted = (muted) => {
  if (!audio.gain) return;
  audio.muted = muted;
  audio.gain.gain.value = muted ? 0 : 0.04;
  audioStatus.textContent = muted ? "Audio: muted" : "Audio: on";
};

const updateAudioForRegion = (regionIndex) => {
  if (!audio.osc) return;
  const base = 60 + regionIndex * 6;
  audio.osc.frequency.value = base;
};

const loadSave = () => {
  const saved = loadState();
  if (!saved) return;
  if (saved.player) {
    player.group.position.set(saved.player.x ?? 20, 1, saved.player.z ?? 0);
  }
  if (saved.camera) {
    cameraState.yaw = saved.camera.yaw ?? cameraState.yaw;
    cameraState.pitch = saved.camera.pitch ?? cameraState.pitch;
  }
  if (typeof saved.time === "number") {
    dayState.time = saved.time;
  }
  saveStatus.textContent = "Save: restored";
};

const updateCamera = () => {
  const target = player.group.position.clone();
  const offset = new THREE.Vector3(
    Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch),
    Math.sin(cameraState.pitch),
    Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch)
  ).multiplyScalar(cameraState.distance);
  camera.position.copy(target).sub(offset);
  camera.lookAt(target.x, target.y + 1, target.z);
};

const updateRegion = () => {
  const region = getRegionForX(player.group.position.x);
  if (region.id !== activeRegion?.id) {
    activeRegion = region;
    regionName.textContent = region.name;
    updateAudioForRegion(region.index);
    loader.setActiveRegion(region.index, 1);
  }

  loadingStatus.textContent = `Loading ${regions.indexOf(region) + 1} / ${regions.length}`;

  const loadTargets = [regions[region.index - 1], region, regions[region.index + 1]].filter(Boolean);
  loadTargets.forEach((target) => {
    loader.load(target).catch((error) => {
      console.error(error);
    });
  });

  const regionData = loader.get(region.id);
  if (regionData?.metadata?.sky) {
    currentSky.set(regionData.metadata.sky);
  }
  if (regionData?.metadata?.ground) {
    minimap.style.background = `radial-gradient(circle at 30% 30%, ${regionData.metadata.ground} 0%, #1e3a35 70%)`;
  }
};

const updateDayNight = (delta) => {
  dayState.time += delta;
  const cycle = (dayState.time % dayState.length) / dayState.length;
  const angle = cycle * Math.PI * 2;
  const daylight = Math.max(0, Math.sin(angle) * 0.6 + 0.45);
  const nightColor = new THREE.Color(0x0c1233);
  const blended = currentSky.clone().lerp(nightColor, 1 - daylight);
  scene.background = blended;
  scene.fog.color.copy(blended);

  sun.intensity = 0.2 + daylight * 0.9;
  hemi.intensity = 0.2 + daylight * 0.7;
  sun.position.set(Math.cos(angle) * 80, 18 + Math.sin(angle) * 60, Math.sin(angle) * 40);
  sun.color.setHSL(0.1, 0.5, 0.5 + daylight * 0.2);
};

const updateMinimap = () => {
  const region = getRegionForX(player.group.position.x);
  const localX = player.group.position.x - region.startX;
  const localZ = player.group.position.z + region.depth / 2;
  const xPercent = Math.min(1, Math.max(0, localX / region.width));
  const zPercent = Math.min(1, Math.max(0, localZ / region.depth));
  minimapDot.style.left = `${xPercent * 100}%`;
  minimapDot.style.top = `${(1 - zPercent) * 100}%`;
};

const updateStamina = () => {
  staminaFill.style.width = `${player.getStaminaRatio() * 100}%`;
};

const saveProgress = (delta) => {
  saveCooldown -= delta;
  if (saveCooldown > 0) return;
  const ok = saveState({
    player: { x: player.group.position.x, z: player.group.position.z },
    camera: { yaw: cameraState.yaw, pitch: cameraState.pitch },
    time: dayState.time,
  });
  saveStatus.textContent = ok ? "Save: ok" : "Save: failed";
  saveCooldown = 2.5;
};

const animate = () => {
  const delta = clock.getDelta();
  player.update(delta, cameraState.yaw);
  updateCamera();
  updateRegion();
  updateDayNight(delta);
  updateMinimap();
  updateStamina();
  saveProgress(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

const onResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

window.addEventListener("resize", onResize);

const onPointerLockChange = () => {
  pointerLocked = document.pointerLockElement === canvas;
  lockOverlay.classList.toggle("hidden", pointerLocked);
  document.body.classList.toggle("locked", pointerLocked);
  if (pointerLocked) {
    initAudio();
    if (audio.context?.state === "suspended") {
      audio.context.resume();
    }
  }
};

const requestLock = () => {
  canvas.requestPointerLock();
};

canvas.addEventListener("click", requestLock);
lockOverlay.addEventListener("click", requestLock);

document.addEventListener("pointerlockchange", onPointerLockChange);

document.addEventListener("mousemove", (event) => {
  if (!pointerLocked) return;
  cameraState.yaw -= event.movementX * cameraState.sensitivity;
  cameraState.pitch -= event.movementY * cameraState.sensitivity;
  cameraState.pitch = Math.max(-0.6, Math.min(0.25, cameraState.pitch));
});

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyM") {
    setAudioMuted(!audio.muted);
  }
});

loadSave();

updateRegion();
animate();
