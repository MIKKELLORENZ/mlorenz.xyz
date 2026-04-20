import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const createPlayer = (scene, options = {}) => {
  const limits = {
    minX: options.minX ?? 0,
    maxX: options.maxX ?? 2000,
    minZ: options.minZ ?? -80,
    maxZ: options.maxZ ?? 80,
  };
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 0.8, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2ca24b })
  );
  body.castShadow = false;

  const shield = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.6, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x7c5a2b })
  );
  shield.position.set(0.35, 0.2, 0.35);
  shield.rotation.y = Math.PI * 0.2;

  group.add(body, shield);
  group.position.set(20, 1, 0);

  scene.add(group);

  const state = {
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    speed: 6,
    sprint: 10,
    stamina: 100,
    staminaMax: 100,
    staminaDrain: 28,
    staminaRegen: 18,
  };

  const keys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
  };

  const onKey = (event, value) => {
    switch (event.code) {
      case "KeyW":
      case "ArrowUp":
        keys.forward = value;
        break;
      case "KeyS":
      case "ArrowDown":
        keys.back = value;
        break;
      case "KeyA":
      case "ArrowLeft":
        keys.left = value;
        break;
      case "KeyD":
      case "ArrowRight":
        keys.right = value;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        keys.sprint = value;
        break;
      default:
        break;
    }
  };

  window.addEventListener("keydown", (event) => onKey(event, true));
  window.addEventListener("keyup", (event) => onKey(event, false));

  const update = (delta, yaw = 0) => {
    state.direction.set(0, 0, 0);
    if (keys.forward) state.direction.z -= 1;
    if (keys.back) state.direction.z += 1;
    if (keys.left) state.direction.x -= 1;
    if (keys.right) state.direction.x += 1;

    const moving = state.direction.lengthSq() > 0;
    const canSprint = keys.sprint && state.stamina > 0;
    const speed = canSprint ? state.sprint : state.speed;

    if (moving) {
      state.direction.normalize();
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const move = new THREE.Vector3()
        .addScaledVector(right, state.direction.x)
        .addScaledVector(forward, state.direction.z);
      move.normalize();
      state.velocity.x = move.x * speed;
      state.velocity.z = move.z * speed;
      group.rotation.y = Math.atan2(state.velocity.x, state.velocity.z);
    } else {
      state.velocity.x = 0;
      state.velocity.z = 0;
    }

    if (canSprint && moving) {
      state.stamina = Math.max(0, state.stamina - state.staminaDrain * delta);
    } else {
      state.stamina = Math.min(state.staminaMax, state.stamina + state.staminaRegen * delta);
    }

    group.position.x += state.velocity.x * delta;
    group.position.z += state.velocity.z * delta;
    group.position.y = 1;

    group.position.x = Math.min(limits.maxX, Math.max(limits.minX, group.position.x));
    group.position.z = Math.min(limits.maxZ, Math.max(limits.minZ, group.position.z));
  };

  const getStaminaRatio = () => state.stamina / state.staminaMax;

  return { group, update, getStaminaRatio };
};

export { createPlayer };
