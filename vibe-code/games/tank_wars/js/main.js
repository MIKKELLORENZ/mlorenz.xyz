const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ui = {
  menu: document.getElementById('menu'),
  hud: document.getElementById('hud'),
  controls: document.getElementById('controls'),
  weaponBar: document.getElementById('weaponBar'),
  draftModal: document.getElementById('draftModal'),
  draftText: document.getElementById('draftText'),
  draftGrid: document.getElementById('draftGrid'),
  draftP1List: document.getElementById('draftP1List'),
  draftP2List: document.getElementById('draftP2List'),
  winnerModal: document.getElementById('winnerModal'),
  winnerTitle: document.getElementById('winnerTitle'),
  winnerSubtitle: document.getElementById('winnerSubtitle'),
  winnerCanvas: document.getElementById('winnerCanvas'),
  confettiLayer: document.getElementById('confettiLayer'),
  winnerCloseBtn: document.getElementById('winnerCloseBtn'),
  nextGameBtn: document.getElementById('nextGameBtn'),
  pvpBtn: document.getElementById('pvpBtn'),
  pvaiBtn: document.getElementById('pvaiBtn'),
  muteBtn: document.getElementById('muteBtn'),
  newGameBtn: document.getElementById('newGameBtn'),
  turnText: document.getElementById('turnText'),
  windText: document.getElementById('windText'),
  weaponText: document.getElementById('weaponText'),
  score1: document.getElementById('score1'),
  score2: document.getElementById('score2'),
  angleText: document.getElementById('angleText'),
  powerFill: document.getElementById('powerFill'),
  powerNumText: document.getElementById('powerNumText'),
  fireBtn: document.getElementById('fireBtn'),
  angleDown: document.getElementById('angleDown'),
  angleUp: document.getElementById('angleUp'),
  powerDown: document.getElementById('powerDown'),
  powerUp: document.getElementById('powerUp'),
  message: document.getElementById('message'),
};

const WORLD = {
  width: 1200,
  height: 700,
  gravity: 520,
  maxWind: 170,
  tankRadius: 16,
};

const TARGET_SCORE = 220;
const BASELINE_POWER_BOOST = 1.05;

const WEAPONS = [
  { id: 'cannonBall', name: 'Cannon Ball', icon: 'assets/cannonBall.png', type: 'ballistic', damage: 30, radius: 36, speedMul: 1 },
  { id: 'babyMissile', name: 'Baby Missile', icon: 'assets/babyMissile.png', type: 'ballistic', damage: 16, radius: 22, speedMul: 1.08 },
  { id: 'bigShot', name: 'Big Shot', icon: 'assets/bigShot.png', type: 'ballistic', damage: 50, radius: 56, speedMul: 0.84 },
  { id: 'threeShot', name: '3 Shot', icon: 'assets/threeShot.png', type: 'threeShot', damage: 14, radius: 20, speedMul: 1.01 },
  { id: 'shotgun', name: 'Shotgun', icon: 'assets/shotgun.png', type: 'spread', damage: 12, radius: 19, speedMul: 1 },
  { id: 'bouncer', name: 'Bouncer', icon: 'assets/bouncer.png', type: 'bouncer', damage: 24, radius: 30, speedMul: 0.98, bounces: 2 },
  { id: 'groundHog', name: 'Ground Hog', icon: 'assets/groundHog.png', type: 'groundhog', damage: 42, radius: 45, speedMul: 0.95 },
  { id: 'drill', name: 'Drill', icon: 'assets/drill.png', type: 'drill', damage: 36, radius: 42, speedMul: 0.96 },
  { id: 'homingMissile', name: 'Homing Missile', icon: 'assets/homingMissile.png', type: 'homing', damage: 34, radius: 34, speedMul: 0.97 },
  { id: 'airStrike', name: 'Air Strike', icon: 'assets/airStrike.png', type: 'airStrike', damage: 22, radius: 24, speedMul: 0.92 },
  { id: 'dirtSlinger', name: 'Dirt Slinger', icon: 'assets/dirtSlinger.png', type: 'dirtSlinger', damage: 18, radius: 24, speedMul: 0.94 },
  { id: 'dirtMover', name: 'Dirt Mover', icon: 'assets/dirtMover.png', type: 'dirtMover', damage: 20, radius: 26, speedMul: 0.93 },
  { id: 'napalm', name: 'Napalm', icon: 'assets/napalm.png', type: 'napalm', damage: 26, radius: 30, speedMul: 0.92 },
  { id: 'laser', name: 'Laser', icon: 'assets/laser.png', type: 'laser', damage: 34, radius: 20, speedMul: 0 },
  { id: 'roller', name: 'Roller', icon: 'assets/roller.png', type: 'roller', damage: 34, radius: 34, speedMul: 0.9 },
  { id: 'mirv', name: 'MIRV', icon: 'assets/mirv.png', type: 'mirv', damage: 24, radius: 24, speedMul: 0.95 },
];

const PICKS_PER_PLAYER = WEAPONS.length;
const WEAPON_MAP = new Map(WEAPONS.map((w) => [w.id, w]));
const KEYS = new Set();

const state = {
  running: false,
  phase: 'menu',
  mode: 'pvp',
  aiDifficulty: 'medium',
  players: [],
  terrain: new Float32Array(WORLD.width),
  projectiles: [],
  particles: [],
  napalmDrops: [],
  floatingTexts: [],
  spawnQueue: [],
  pendingTurnEnd: 0,
  currentTurn: 0,
  roundWind: 0,
  shotsInRound: 0,
  roundNumber: 1,
  winner: null,
  aiThinking: false,
  muted: false,
  welcomeScreen: true,
  _welcomeBtns: [],
  _diffBtns: [],
  _showAiDiff: false,
  _welcomeHover: '',
  clouds: [],
  mountains: [],
  windParticles: [],
  draft: {
    availableWeaponIds: new Set(),
    drafter: 0,
    active: false,
  },
  hold: {
    angle: 0,
    power: 0,
  },
};

const audio = createAudioManager();
const winnerCtx = ui.winnerCanvas ? ui.winnerCanvas.getContext('2d') : null;
let cachedSkyGradient = null;
const hudCache = {
  turnText: null,
  windText: null,
  weaponText: null,
  score1: null,
  score2: null,
  angleText: null,
  powerWidth: null,
  powerNum: null,
  fireDisabled: null,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function sign(value) {
  return value < 0 ? -1 : 1;
}

function removeAtSwap(list, index) {
  const last = list.length - 1;
  if (index !== last) list[index] = list[last];
  list.pop();
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function describeWeapon(weapon) {
  return `${weapon.name} • Damage ${weapon.damage} • Radius ${weapon.radius} • ${weapon.type}`;
}

function setFireButtonState(disabled, force = false) {
  if (!ui.fireBtn) return;
  if (!force && hudCache.fireDisabled === disabled) return;
  hudCache.fireDisabled = disabled;
  ui.fireBtn.disabled = disabled;
  ui.fireBtn.classList.toggle('disabled', disabled);
}

function refreshMuteButton() {
  if (!ui.muteBtn) return;
  ui.muteBtn.textContent = state.muted ? 'Unmute' : 'Mute';
  ui.muteBtn.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
}

function showMessage(text) {
  ui.message.textContent = text;
}

function clearWinnerModal() {
  ui.winnerModal.classList.add('hidden');
  if (ui.confettiLayer) ui.confettiLayer.innerHTML = '';
}

function drawWinnerTank(winner) {
  if (!winnerCtx || !winner) return;
  const cw = ui.winnerCanvas.width;
  const ch = ui.winnerCanvas.height;
  winnerCtx.clearRect(0, 0, cw, ch);

  const g = winnerCtx.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, '#304a71');
  g.addColorStop(1, '#1a2c45');
  winnerCtx.fillStyle = g;
  winnerCtx.fillRect(0, 0, cw, ch);

  winnerCtx.fillStyle = 'rgba(255,255,255,0.15)';
  winnerCtx.beginPath();
  winnerCtx.arc(cw - 34, 28, 16, 0, Math.PI * 2);
  winnerCtx.fill();

  const x = cw * 0.5;
  const y = ch * 0.72;
  const dark = winner.id === 0 ? '#366f9f' : '#9a5b49';

  winnerCtx.fillStyle = '#1f2530';
  winnerCtx.fillRect(x - 34, y - 2, 68, 12);
  winnerCtx.fillStyle = '#2f3745';
  for (let i = -24; i <= 24; i += 12) {
    winnerCtx.beginPath();
    winnerCtx.arc(x + i, y + 10, 4.2, 0, Math.PI * 2);
    winnerCtx.fill();
  }

  winnerCtx.fillStyle = winner.color;
  winnerCtx.fillRect(x - 28, y - 18, 56, 16);
  winnerCtx.fillStyle = dark;
  winnerCtx.fillRect(x - 14, y - 27, 28, 10);

  const dirX = winner.facingLeft ? -1 : 1;
  const wAngle = dirX > 0 ? -0.45 : Math.PI + 0.45;

  winnerCtx.save();
  winnerCtx.translate(x, y - 21);
  winnerCtx.rotate(wAngle);
  winnerCtx.fillStyle = '#e8dfc8';
  winnerCtx.fillRect(8, -3, 28, 6);
  winnerCtx.fillStyle = '#fff4d7';
  winnerCtx.fillRect(34, -4, 5, 8);
  winnerCtx.restore();

  winnerCtx.fillStyle = dark;
  winnerCtx.beginPath();
  winnerCtx.arc(x, y - 21, 9, Math.PI, 0);
  winnerCtx.closePath();
  winnerCtx.fill();
}

function spawnConfetti() {
  if (!ui.confettiLayer) return;
  ui.confettiLayer.innerHTML = '';
  const colors = ['#7fd4ff', '#ff9270', '#ffe27f', '#8bffba', '#d6a8ff'];
  for (let i = 0; i < 64; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${2 + Math.random() * 1.8}s`;
    piece.style.animationDelay = `${Math.random() * 0.7}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    ui.confettiLayer.appendChild(piece);
  }
}

function showWinnerModal(winner, subtitle) {
  if (!winnerCtx && !winner) return;
  ui.winnerTitle.textContent = winner ? `${winner.name} Wins!` : 'Draw!';
  ui.winnerSubtitle.textContent = subtitle;
  if (winner) {
    drawWinnerTank(winner);
    spawnConfetti();
  } else if (winnerCtx) {
    winnerCtx.clearRect(0, 0, ui.winnerCanvas.width, ui.winnerCanvas.height);
  }
  ui.winnerModal.classList.remove('hidden');
}

function getWeaponById(id) {
  return WEAPON_MAP.get(id) || WEAPONS[0];
}

function getCurrentPlayer() {
  return state.players[state.currentTurn];
}

function getCurrentWeapon(player) {
  if (!player || player.loadout.length === 0) return null;
  const idx = clamp(player.selectedWeaponIndex, 0, player.loadout.length - 1);
  return getWeaponById(player.loadout[idx]);
}

function turretVector(player) {
  const dx = player.facingLeft ? -Math.cos(player.angle) : Math.cos(player.angle);
  const dy = -Math.sin(player.angle);
  return { dx, dy };
}

function createAudioManager() {
  const files = {
    fire: 'sounds/fire.wav',
    explosion: 'sounds/explosion.wav',
    win: 'sounds/win.wav',
    click: 'sounds/click.wav',
    zap: 'sounds/zap.wav',
  };

  const entries = {};
  const POOL_SIZE = 4;
  Object.entries(files).forEach(([name, path]) => {
    const pool = [];
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const audioEl = new Audio(path);
      audioEl.preload = 'auto';
      audioEl.volume = 0.45;
      pool.push(audioEl);
    }
    entries[name] = { pool, index: 0, failed: false };
    pool.forEach((clip) => {
      clip.addEventListener('error', () => {
        entries[name].failed = true;
      });
    });
  });

  let audioCtx;
  function beep(freq = 240, duration = 0.04) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'triangle';
      gain.gain.value = 0.0001;
      gain.gain.exponentialRampToValueAtTime(0.04, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // Ignore audio failures.
    }
  }

  function play(name) {
    try {
      if (state.muted) return;
      const entry = entries[name];
      if (entry && !entry.failed && entry.pool.length > 0) {
        const clip = entry.pool[entry.index];
        entry.index = (entry.index + 1) % entry.pool.length;
        clip.currentTime = 0;
        void clip.play().catch(() => beep(name === 'zap' ? 380 : 240));
      } else {
        beep(name === 'zap' ? 380 : 240);
      }
    } catch {
      // Game must continue silently if audio fails.
    }
  }

  function setMuted(value) {
    state.muted = Boolean(value);
  }

  function isMuted() {
    return state.muted;
  }

  return { play, setMuted, isMuted };
}

function buildTerrain() {
  const base = WORLD.height * rand(0.48, 0.76);
  const style = Math.floor(rand(0, 6));
  let y = base;
  const phaseA = rand(0, Math.PI * 2);
  const phaseB = rand(0, Math.PI * 2);
  const ampA = rand(40, 120);
  const ampB = rand(12, 50);
  const freqA = rand(0.003, 0.016);
  const freqB = rand(0.012, 0.04);
  for (let x = 0; x < WORLD.width; x += 1) {
    let target = base + Math.sin(x * freqA + phaseA) * ampA + Math.sin(x * freqB + phaseB) * ampB;
    if (style === 1) target += Math.abs(Math.sin(x * 0.005 + phaseA)) * 80 - 40;
    else if (style === 2) target += ((x % 200) < 100 ? -35 : 35) * Math.sin(x * 0.01);
    else if (style === 3) target += Math.sin(x * 0.003) * 130;
    else if (style === 4) {
      const cx = WORLD.width / 2;
      target -= Math.max(0, 90 - Math.abs(x - cx) * 0.18);
    } else if (style === 5) {
      target += Math.sin(x * 0.007 + phaseA) * 70 + Math.cos(x * 0.018 + phaseB) * 45;
    }
    target += rand(-5, 5);
    y += (target - y) * 0.08;
    state.terrain[x] = clamp(y, WORLD.height * 0.22, WORLD.height - 50);
  }
}

function carveTerrain(cx, cy, radius, strength = 1) {
  const minX = clamp(Math.floor(cx - radius - 1), 0, WORLD.width - 1);
  const maxX = clamp(Math.ceil(cx + radius + 1), 0, WORLD.width - 1);
  for (let x = minX; x <= maxX; x += 1) {
    const dx = x - cx;
    const distSq = dx * dx;
    if (distSq > radius * radius) continue;
    const dy = Math.sqrt(radius * radius - distSq);
    const craterBottom = cy + dy;
    if (state.terrain[x] < craterBottom) {
      state.terrain[x] += (craterBottom - state.terrain[x]) * strength;
      state.terrain[x] = Math.min(state.terrain[x], WORLD.height - 8);
    }
  }
}

function depositTerrain(cx, cy, radius, amount = 1) {
  const minX = clamp(Math.floor(cx - radius - 1), 0, WORLD.width - 1);
  const maxX = clamp(Math.ceil(cx + radius + 1), 0, WORLD.width - 1);
  for (let x = minX; x <= maxX; x += 1) {
    const dx = x - cx;
    const distSq = dx * dx;
    if (distSq > radius * radius) continue;
    const dy = Math.sqrt(radius * radius - distSq);
    const moundTop = cy - dy;
    if (state.terrain[x] > moundTop) state.terrain[x] -= (state.terrain[x] - moundTop) * amount;
    state.terrain[x] = clamp(state.terrain[x], WORLD.height * 0.3, WORLD.height - 8);
  }
}

function groundAt(x) {
  return state.terrain[clamp(Math.round(x), 0, WORLD.width - 1)];
}

function buildDecor() {
  state.clouds = [];
  state.mountains = [];
  state.windParticles = [];

  for (let i = 0; i < 7; i += 1) {
    state.clouds.push({ x: rand(0, WORLD.width), y: rand(70, 240), w: rand(80, 170), h: rand(28, 52), speed: rand(6, 16) });
  }

  for (let i = 0; i < 10; i += 1) {
    state.mountains.push({ x: i * 140 + rand(-30, 30), h: rand(70, 150), w: rand(140, 220) });
  }

  for (let i = 0; i < 120; i += 1) {
    state.windParticles.push({ x: rand(0, WORLD.width), y: rand(20, WORLD.height * 0.55), len: rand(6, 14), speed: rand(20, 60), alpha: rand(0.14, 0.34) });
  }
}

function createPlayers(mode) {
  return [
    {
      id: 0,
      name: 'Player 1',
      isAI: false,
      color: '#66b7ff',
      score: 0,
      x: 170,
      y: 0,
      vx: 0,
      vy: 0,
      angle: Math.PI / 4,
      power: 430,
      facingLeft: false,
      loadout: [],
      selectedWeaponIndex: 0,
    },
    {
      id: 1,
      name: mode === 'pvai' ? 'AI' : 'Player 2',
      isAI: mode === 'pvai',
      color: '#ff9270',
      score: 0,
      x: WORLD.width - 170,
      y: 0,
      vx: 0,
      vy: 0,
      angle: Math.PI / 4,
      power: 430,
      facingLeft: true,
      loadout: [],
      selectedWeaponIndex: 0,
    },
  ];
}

function placePlayersOnTerrain() {
  const p1 = state.players[0];
  const p2 = state.players[1];
  p1.x = rand(100, 250);
  p2.x = rand(WORLD.width - 250, WORLD.width - 100);
  p1.y = groundAt(p1.x) - WORLD.tankRadius;
  p2.y = groundAt(p2.x) - WORLD.tankRadius;
  p1.vx = p1.vy = p2.vx = p2.vy = 0;
  p1.facingLeft = false;
  p2.facingLeft = true;
}

function renderDraftPreviews() {
  const renderList = (player) => {
    if (player.loadout.length === 0) return '<div class="picked-empty">No picks yet</div>';
    return player.loadout.map((weaponId) => {
      const weapon = getWeaponById(weaponId);
      return `<div class="picked-item" title="${describeWeapon(weapon)}"><img class="weapon-icon weapon-icon-img" src="${weapon.icon}" alt="${weapon.name}" /><span>${weapon.name}</span></div>`;
    }).join('');
  };

  ui.draftP1List.innerHTML = renderList(state.players[0]);
  ui.draftP2List.innerHTML = renderList(state.players[1]);
}

function isDraftDone() {
  return state.players.every((p) => p.loadout.length >= PICKS_PER_PLAYER);
}

function renderDraftGrid() {
  const current = state.players[state.draft.drafter];
  ui.draftText.textContent = `${current.name}: choose weapon ${current.loadout.length + 1}/${PICKS_PER_PLAYER}`;

  const randomBtn = document.getElementById('draftRandomizeBtn');
  if (randomBtn) randomBtn.classList.toggle('hidden', current.isAI);

  ui.draftGrid.innerHTML = WEAPONS.map((weapon) => {
    const taken = !state.draft.availableWeaponIds.has(weapon.id);
    return `
      <button class="draft-item ${taken ? 'taken' : ''}" data-weapon-id="${weapon.id}" ${taken ? 'disabled' : ''} title="${describeWeapon(weapon)}">
        <img class="weapon-icon weapon-icon-img" src="${weapon.icon}" alt="${weapon.name}" />
        <span>${weapon.name}</span>
      </button>
    `;
  }).join('');

  ui.draftGrid.querySelectorAll('.draft-item').forEach((button) => {
    button.addEventListener('click', () => {
      chooseDraftWeapon(button.dataset.weaponId);
    });
  });

  renderDraftPreviews();
}

function chooseDraftWeapon(weaponId) {
  if (!state.draft.active || !state.draft.availableWeaponIds.has(weaponId)) return;
  const drafter = state.players[state.draft.drafter];
  drafter.loadout.push(weaponId);
  state.draft.availableWeaponIds.delete(weaponId);
  audio.play('click');

  if (drafter.loadout.length >= PICKS_PER_PLAYER) {
    const nextIdx = 1 - state.draft.drafter;
    if (state.players[nextIdx].loadout.length >= PICKS_PER_PLAYER) {
      state.draft.active = false;
      completeDraftAndStartGame();
      return;
    }
    state.draft.drafter = nextIdx;
    state.draft.availableWeaponIds = new Set(WEAPONS.map((w) => w.id));
    renderDraftGrid();
    maybeAutoDraft();
    return;
  }

  renderDraftGrid();
}

function randomizeRemaining() {
  if (!state.draft.active) return;
  const p0 = state.players[0];
  const p1 = state.players[1];

  /* Gather all weapons neither player has yet */
  const owned = new Set([...p0.loadout, ...p1.loadout]);
  const pool = WEAPONS.map((w) => w.id).filter((id) => !owned.has(id));

  /* Shuffle */
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  /* Distribute alternately starting with current drafter */
  let turn = state.draft.drafter;
  for (const wId of pool) {
    const target = state.players[turn];
    if (target.loadout.length < PICKS_PER_PLAYER) {
      target.loadout.push(wId);
    } else {
      state.players[1 - turn].loadout.push(wId);
    }
    turn = 1 - turn;
  }

  state.draft.availableWeaponIds.clear();
  state.draft.active = false;
  audio.play('click');
  completeDraftAndStartGame();
}

function maybeAutoDraft() {
  if (!state.draft.active) return;
  const current = state.players[state.draft.drafter];
  if (!current.isAI) return;

  const preference = ['bigShot', 'homingMissile', 'airStrike', 'groundHog', 'napalm', 'bouncer', 'laser', 'mirv', 'cannonBall', 'drill', 'threeShot', 'roller', 'shotgun', 'babyMissile', 'dirtMover', 'dirtSlinger'];
  const available = [...state.draft.availableWeaponIds];
  const sorted = available.sort((a, b) => {
    const ai = preference.indexOf(a);
    const bi = preference.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  setTimeout(() => {
    if (state.phase !== 'draft' || !state.draft.active) return;
    for (const id of sorted) {
      current.loadout.push(id);
      state.draft.availableWeaponIds.delete(id);
    }
    audio.play('click');
    const nextIdx = 1 - state.draft.drafter;
    if (state.players[nextIdx].loadout.length >= PICKS_PER_PLAYER) {
      state.draft.active = false;
      completeDraftAndStartGame();
      return;
    }
    state.draft.drafter = nextIdx;
    state.draft.availableWeaponIds = new Set(WEAPONS.map((w) => w.id));
    renderDraftGrid();
    maybeAutoDraft();
  }, 420);
}

function startDraft(mode) {
  state.mode = mode;
  state.running = false;
  state.phase = 'draft';
  state.welcomeScreen = false;
  state.players = createPlayers(mode);
  state.draft.availableWeaponIds = new Set(WEAPONS.map((w) => w.id));
  state.draft.drafter = 0;
  state.draft.active = true;

  ui.menu.classList.remove('visible');
  ui.draftModal.classList.remove('hidden');
  ui.hud.classList.add('hidden');
  ui.controls.classList.add('hidden');
  ui.weaponBar.classList.add('hidden');
  showMessage('Draft weapons first, then battle starts.');

  renderDraftGrid();
  maybeAutoDraft();
}

function rerollRoundWind() {
  state.roundWind = rand(-WORLD.maxWind, WORLD.maxWind);
}

function completeDraftAndStartGame() {
  state.phase = 'aim';
  state.running = true;
  state.currentTurn = 0;
  state.shotsInRound = 0;
  state.roundNumber = 1;
  state.pendingTurnEnd = 0;
  state.winner = null;
  state.aiThinking = false;
  state.spawnQueue.length = 0;

  buildTerrain();
  placePlayersOnTerrain();
  buildDecor();
  state.projectiles.length = 0;
  state.particles.length = 0;
  state.napalmDrops.length = 0;
  state.floatingTexts.length = 0;

  rerollRoundWind();
  ui.draftModal.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.controls.classList.remove('hidden');
  ui.weaponBar.classList.remove('hidden');

  showMessage(`Battle started. First to ${TARGET_SCORE} points wins.`);
  syncHud(true);
  renderWeaponBar();
}

function syncHud(force = false) {
  if (state.players.length < 2 || state.phase === 'menu' || state.phase === 'draft') {
    const resetValues = {
      turnText: '-',
      windText: '0 m/s²',
      weaponText: '-',
      score1: '0',
      score2: '0',
      angleText: '-',
      powerWidth: '0%',
      powerNum: '0',
    };
    if (force || hudCache.turnText !== resetValues.turnText) {
      ui.turnText.textContent = resetValues.turnText;
      hudCache.turnText = resetValues.turnText;
    }
    if (force || hudCache.windText !== resetValues.windText) {
      ui.windText.textContent = resetValues.windText;
      hudCache.windText = resetValues.windText;
    }
    if (force || hudCache.weaponText !== resetValues.weaponText) {
      ui.weaponText.textContent = resetValues.weaponText;
      hudCache.weaponText = resetValues.weaponText;
    }
    if (force || hudCache.score1 !== resetValues.score1) {
      ui.score1.textContent = resetValues.score1;
      hudCache.score1 = resetValues.score1;
    }
    if (force || hudCache.score2 !== resetValues.score2) {
      ui.score2.textContent = resetValues.score2;
      hudCache.score2 = resetValues.score2;
    }
    if (force || hudCache.angleText !== resetValues.angleText) {
      ui.angleText.textContent = resetValues.angleText;
      hudCache.angleText = resetValues.angleText;
    }
    if (force || hudCache.powerWidth !== resetValues.powerWidth) {
      ui.powerFill.style.width = resetValues.powerWidth;
      hudCache.powerWidth = resetValues.powerWidth;
    }
    if (ui.powerNumText && (force || hudCache.powerNum !== resetValues.powerNum)) {
      ui.powerNumText.textContent = resetValues.powerNum;
      hudCache.powerNum = resetValues.powerNum;
    }
    setFireButtonState(true, force);
    return;
  }

  const current = getCurrentPlayer();
  const weapon = getCurrentWeapon(current);
  const turnText = current.name;
  const windText = `${state.roundWind.toFixed(0)} m/s²`;
  const weaponText = weapon ? weapon.name : 'No Ammo';
  const score1 = Math.round(state.players[0].score).toString();
  const score2 = Math.round(state.players[1].score).toString();
  const angleText = current.isAI ? '...' : `${Math.round((current.angle * 180) / Math.PI)}°`;
  const powerPct = Math.round((current.power - 200) / (760 - 200) * 100);
  const powerWidth = current.isAI ? '0%' : `${powerPct}%`;
  const powerNum = current.isAI ? '...' : `${powerPct}`;

  if (force || hudCache.turnText !== turnText) {
    ui.turnText.textContent = turnText;
    hudCache.turnText = turnText;
  }
  if (force || hudCache.windText !== windText) {
    ui.windText.textContent = windText;
    hudCache.windText = windText;
  }
  if (force || hudCache.weaponText !== weaponText) {
    ui.weaponText.textContent = weaponText;
    hudCache.weaponText = weaponText;
  }
  if (force || hudCache.score1 !== score1) {
    ui.score1.textContent = score1;
    hudCache.score1 = score1;
  }
  if (force || hudCache.score2 !== score2) {
    ui.score2.textContent = score2;
    hudCache.score2 = score2;
  }
  if (force || hudCache.angleText !== angleText) {
    ui.angleText.textContent = angleText;
    hudCache.angleText = angleText;
  }
  if (force || hudCache.powerWidth !== powerWidth) {
    ui.powerFill.style.width = powerWidth;
    hudCache.powerWidth = powerWidth;
  }
  if (ui.powerNumText && (force || hudCache.powerNum !== powerNum)) {
    ui.powerNumText.textContent = powerNum;
    hudCache.powerNum = powerNum;
  }

  setFireButtonState(!(state.phase === 'aim' && !current.isAI && current.loadout.length > 0), force);
}

function renderWeaponBar() {
  if (state.phase === 'menu' || state.phase === 'draft' || state.players.length < 2) {
    ui.weaponBar.innerHTML = '';
    return;
  }

  const player = getCurrentPlayer();
  if (player.loadout.length === 0) {
    ui.weaponBar.innerHTML = '<div class="hint">No weapons left for this player</div>';
    return;
  }

  ui.weaponBar.innerHTML = player.loadout.map((weaponId, idx) => {
    const weapon = getWeaponById(weaponId);
    const active = idx === player.selectedWeaponIndex;
    return `
      <button class="weapon-chip ${active ? 'active' : ''}" data-weapon-index="${idx}" title="${describeWeapon(weapon)}">
        <img class="weapon-icon weapon-icon-img" src="${weapon.icon}" alt="${weapon.name}" />
        <span>${weapon.name}</span>
      </button>
    `;
  }).join('');

  if (!player.isAI && state.phase === 'aim') {
    ui.weaponBar.querySelectorAll('.weapon-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        player.selectedWeaponIndex = Number(chip.dataset.weaponIndex);
        renderWeaponBar();
        syncHud();
      });
    });
  }
}

function resetToMenu() {
  state.running = false;
  state.phase = 'menu';
  state.players = [];
  state.projectiles.length = 0;
  state.particles.length = 0;
  state.napalmDrops.length = 0;
  state.floatingTexts.length = 0;
  state.spawnQueue.length = 0;
  state.welcomeScreen = true;
  state._showAiDiff = false;

  ui.menu.classList.remove('visible');
  ui.draftModal.classList.add('hidden');
  const aiDiffEl = document.getElementById('aiDifficultySelect');
  if (aiDiffEl) aiDiffEl.classList.add('hidden');
  clearWinnerModal();
  ui.hud.classList.add('hidden');
  ui.controls.classList.add('hidden');
  ui.weaponBar.classList.add('hidden');
  showMessage('');
  syncHud(true);
}

function emitExplosion(x, y, color = '#ffb16a', count = 22) {
  for (let i = 0; i < count; i += 1) {
    state.particles.push({ x, y, vx: rand(-160, 160), vy: rand(-220, 40), life: rand(0.35, 0.9), maxLife: 1, size: rand(2, 4.4), color });
  }
}

function addPoints(playerId, amount) {
  const player = state.players[playerId];
  if (player) {
    player.score += amount;
    player.score = Math.max(0, player.score);
  }
}

function checkWinner() {
  const p1 = state.players[0];
  const p2 = state.players[1];
  if (!p1 || !p2) return false;

  if (p1.score >= TARGET_SCORE || p2.score >= TARGET_SCORE) {
    state.phase = 'gameover';
    state.winner = p1.score >= TARGET_SCORE ? p1 : p2;
    showMessage(`${state.winner.name} wins with ${Math.round(state.winner.score)} points. Press New Game.`);
    showWinnerModal(state.winner, `Victory by score: ${Math.round(state.winner.score)} points`);
    audio.play('win');
    return true;
  }
  return false;
}

function bothOutOfWeapons() {
  return state.players.every((player) => player.loadout.length === 0);
}

/* ---------- floating damage texts ---------- */
function spawnFloatingText(x, y, text, color) {
  state.floatingTexts.push({ x, y, text, color, life: 1.2 });
}

function updateFloatingTexts(dt) {
  for (let i = state.floatingTexts.length - 1; i >= 0; i -= 1) {
    const ft = state.floatingTexts[i];
    ft.y -= 38 * dt;
    ft.life -= dt;
    if (ft.life <= 0) removeAtSwap(state.floatingTexts, i);
  }
}

function drawFloatingTexts() {
  for (const ft of state.floatingTexts) {
    const alpha = clamp(ft.life / 0.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = ft.color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

function applyExplosion(x, y, radius, damage, ownerId, knockback = 120) {
  carveTerrain(x, y, radius, 1);
  emitExplosion(x, y);
  audio.play('explosion');

  for (const tank of state.players) {
    const dx = tank.x - x;
    const dy = tank.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= radius + WORLD.tankRadius) {
      const t = 1 - dist / (radius + WORLD.tankRadius);
      const dealt = Math.max(0, damage * t);
      if (tank.id !== ownerId) {
        addPoints(ownerId, dealt);
        spawnFloatingText(tank.x, tank.y - WORLD.tankRadius - 10, `+${Math.round(dealt)}`, '#ffee58');
      } else {
        addPoints(ownerId, -dealt * 0.2);
        spawnFloatingText(tank.x, tank.y - WORLD.tankRadius - 10, `-${Math.round(dealt * 0.2)}`, '#ff5252');
      }
      tank.vx += sign(dx || (tank.id === 0 ? -1 : 1)) * knockback * t;
      tank.vy -= knockback * 0.65 * t;
    }
  }

  checkWinner();
}

function applyLaser(player, enemy) {
  const turret = turretVector(player);
  const startX = player.x + turret.dx * 34;
  const startY = player.y - 16 + turret.dy * 34;
  let hitX = startX;
  let hitY = startY;

  for (let l = 0; l < 1100; l += 4) {
    const px = startX + turret.dx * l;
    const py = startY + turret.dy * l;
    if (px < 0 || px >= WORLD.width || py >= WORLD.height || py < 0) {
      hitX = clamp(px, 0, WORLD.width - 1);
      hitY = clamp(py, 0, WORLD.height - 1);
      break;
    }
    if (py >= groundAt(px)) {
      hitX = px;
      hitY = py;
      break;
    }
    if (Math.hypot(enemy.x - px, enemy.y - py) <= WORLD.tankRadius + 6) {
      hitX = px;
      hitY = py;
      break;
    }
  }

  emitExplosion(hitX, hitY, '#8be6ff', 24);
  carveTerrain(hitX, hitY, 18, 0.6);
  applyExplosion(hitX, hitY, 20, 34, player.id, 95);
  state.particles.push({ laser: true, x1: startX, y1: startY, x2: hitX, y2: hitY, life: 0.15, maxLife: 0.15 });
  audio.play('zap');
}

function spawnProjectile(player, weapon, angleOffset = 0, powerMul = 1) {
  const base = turretVector(player);
  const a = Math.atan2(base.dy, base.dx) + angleOffset;
  const dirX = Math.cos(a);
  const dirY = Math.sin(a);
  const speed = player.power * weapon.speedMul * powerMul * BASELINE_POWER_BOOST;

  state.projectiles.push({
    weaponId: weapon.id,
    ownerId: player.id,
    x: player.x + dirX * 34,
    y: player.y - 16 + dirY * 34,
    vx: dirX * speed,
    vy: dirY * speed,
    life: 8,
    age: 0,
    trailColor: player.id === 0 ? '#8ec7ff' : '#ffc3b2',
    bounceRemaining: weapon.bounces || 0,
    splitDone: false,
    rolling: weapon.type === 'roller',
    burrow: false,
    triggerArmed: weapon.type === 'airStrike',
  });
}

function queueSpawn(delay, fn) {
  state.spawnQueue.push({ delay, fn });
}

function consumeCurrentWeapon(player) {
  if (!player || player.loadout.length === 0) return null;
  const index = clamp(player.selectedWeaponIndex, 0, player.loadout.length - 1);
  const weaponId = player.loadout[index];
  player.loadout.splice(index, 1);
  if (player.selectedWeaponIndex >= player.loadout.length) {
    player.selectedWeaponIndex = Math.max(0, player.loadout.length - 1);
  }
  return getWeaponById(weaponId);
}

function fireCurrentWeapon() {
  if (!state.running || state.phase !== 'aim') return;
  const player = getCurrentPlayer();
  if (!player) return;
  if (player.isAI && state.aiThinking) return;

  const weapon = consumeCurrentWeapon(player);
  if (!weapon) {
    showMessage(`${player.name} has no weapons left.`);
    beginTurnEndDelay(0.35);
    return;
  }

  const enemy = state.players[1 - state.currentTurn];
  state.phase = 'projectile';

  if (weapon.type === 'laser') {
    applyLaser(player, enemy);
    beginTurnEndDelay();
    renderWeaponBar();
    syncHud();
    return;
  }

  if (weapon.type === 'threeShot') {
    for (let i = 0; i < 3; i += 1) {
      queueSpawn(i * 0.12, () => spawnProjectile(player, { ...weapon, type: 'ballistic' }, rand(-0.02, 0.02), 0.98 + i * 0.02));
    }
  } else if (weapon.type === 'spread') {
    for (let i = 0; i < 6; i += 1) {
      const offset = (-0.2 + i * 0.08) + rand(-0.01, 0.01);
      spawnProjectile(player, weapon, offset, 0.93 + Math.abs(2.5 - i) * 0.025);
    }
  } else {
    spawnProjectile(player, weapon);
  }

  audio.play('fire');
  renderWeaponBar();
  syncHud();
}

function beginTurnEndDelay(duration = 0.55) {
  state.pendingTurnEnd = duration;
}

function canCurrentPlayerAct() {
  const current = getCurrentPlayer();
  return current && current.loadout.length > 0;
}

function endTurnIfNeeded() {
  if (state.phase === 'gameover') return;
  state.currentTurn = 1 - state.currentTurn;
  state.shotsInRound += 1;

  if (state.shotsInRound >= 2) {
    state.shotsInRound = 0;
    state.roundNumber += 1;
    showMessage(`Round ${state.roundNumber}: Wind remains ${state.roundWind.toFixed(0)} m/s².`);
  } else {
    showMessage('Opponent\'s turn.');
  }

  if (bothOutOfWeapons()) {
    state.phase = 'gameover';
    const p1 = state.players[0];
    const p2 = state.players[1];
    if (Math.round(p1.score) === Math.round(p2.score)) {
      state.winner = null;
      showMessage(`Out of weapons. Draw at ${Math.round(p1.score)} - ${Math.round(p2.score)}.`);
      showWinnerModal(null, `Out of weapons. Final score: ${Math.round(p1.score)} - ${Math.round(p2.score)}`);
    } else {
      state.winner = p1.score > p2.score ? p1 : p2;
      showMessage(`Out of weapons. ${state.winner.name} wins on points (${Math.round(state.winner.score)}).`);
      showWinnerModal(state.winner, `Out of weapons. Final score: ${Math.round(p1.score)} - ${Math.round(p2.score)}`);
    }
    audio.play('win');
    syncHud();
    return;
  }

  if (!canCurrentPlayerAct()) {
    showMessage(`${getCurrentPlayer().name} has no weapons. Turn skipped.`);
    beginTurnEndDelay(0.45);
    state.phase = 'projectile';
  } else {
    state.phase = 'aim';
  }

  syncHud();
  renderWeaponBar();
}

function updateTankPhysics(dt) {
  for (const tank of state.players) {
    tank.vy += WORLD.gravity * dt;
    tank.x += tank.vx * dt;
    tank.y += tank.vy * dt;

    tank.x = clamp(tank.x, WORLD.tankRadius, WORLD.width - WORLD.tankRadius);
    const ground = groundAt(tank.x) - WORLD.tankRadius;
    if (tank.y > ground) {
      tank.y = ground;
      tank.vy = 0;
      tank.vx *= 0.75;
      if (Math.abs(tank.vx) < 2) tank.vx = 0;
    } else {
      tank.vx *= 0.995;
    }

    tank.facingLeft = tank.x >= WORLD.width / 2;
  }
}

function spawnAirStrikeDrops(ownerId, x) {
  for (let i = -2; i <= 2; i += 1) {
    const spawnX = clamp(x + i * 26 + rand(-8, 8), 20, WORLD.width - 20);
    state.projectiles.push({
      weaponId: 'airStrikeDrop',
      ownerId,
      x: spawnX,
      y: 12 + rand(0, 18),
      vx: rand(-12, 12),
      vy: rand(40, 70),
      life: 3.2,
      age: 0,
      trailColor: '#ffd5b0',
      bounceRemaining: 0,
      splitDone: true,
      rolling: false,
      burrow: false,
      triggerArmed: false,
      synthetic: { damage: 22, radius: 24 },
    });
  }
}

function resolveProjectileImpact(projectile, x, y) {
  const weapon = projectile.synthetic ? { type: 'ballistic', ...projectile.synthetic } : getWeaponById(projectile.weaponId);
  const ownerId = projectile.ownerId;

  if (weapon.type === 'dirtSlinger') {
    applyExplosion(x, y, weapon.radius, weapon.damage, ownerId, 100);
    depositTerrain(x, y + 8, 56, 0.7);
    emitExplosion(x, y, '#a58d6f', 26);
    return false;
  }

  if (weapon.type === 'dirtMover') {
    applyExplosion(x, y, weapon.radius, weapon.damage, ownerId, 100);
    carveTerrain(x, y, 34, 0.8);
    const dir = sign(state.players[1 - ownerId].x - x);
    depositTerrain(clamp(x + dir * 90, 0, WORLD.width - 1), y + 8, 42, 0.65);
    emitExplosion(x, y, '#9f8a70', 28);
    return false;
  }

  if (weapon.type === 'groundhog') {
    if (!projectile.burrow && y >= groundAt(x)) {
      projectile.burrow = true;
      projectile.life = 0.9;
      projectile.y = groundAt(x) + 3;
      projectile.vx = sign(projectile.vx || 1) * 280;
      projectile.vy = 0;
      return true;
    }
    applyExplosion(x, y, weapon.radius, weapon.damage, ownerId, 140);
    return false;
  }

  if (weapon.type === 'drill') {
    if (!projectile.burrow && y >= groundAt(x)) {
      projectile.burrow = true;
      projectile.life = 0.7;
      projectile.vx = 0;
      projectile.vy = 320;
      return true;
    }
    applyExplosion(x, y, weapon.radius, weapon.damage, ownerId, 130);
    return false;
  }

  if (weapon.type === 'napalm') {
    applyExplosion(x, y, weapon.radius, weapon.damage, ownerId, 118);
    for (let i = 0; i < 12; i += 1) {
      state.napalmDrops.push({ ownerId, x: x + rand(-26, 26), y: y - rand(8, 36), vx: rand(-40, 40), vy: rand(-38, -10), life: rand(1.1, 2.1), tick: rand(0.07, 0.16) });
    }
    return false;
  }

  if (weapon.type === 'roller') {
    if (!projectile.rolling && y >= groundAt(x)) {
      projectile.rolling = true;
      projectile.vy = 0;
      projectile.vx = sign(projectile.vx || 1) * 165;
      projectile.life = 1.3;
      return true;
    }
  }

  applyExplosion(x, y, weapon.radius, weapon.damage, ownerId, 130);
  return false;
}

function updateSpawnQueue(dt) {
  for (let i = state.spawnQueue.length - 1; i >= 0; i -= 1) {
    const item = state.spawnQueue[i];
    item.delay -= dt;
    if (item.delay <= 0) {
      item.fn();
      state.spawnQueue.splice(i, 1);
    }
  }
}

function updateProjectiles(dt) {
  updateSpawnQueue(dt);
  if (state.projectiles.length === 0) return;

  for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
    const p = state.projectiles[i];
    const weapon = p.synthetic ? { type: 'ballistic' } : getWeaponById(p.weaponId);
    p.age += dt;
    p.life -= dt;

    if (!p.rolling) {
      p.vy += WORLD.gravity * dt;
      p.vx += state.roundWind * dt;
    }

    if (weapon.type === 'homing' && p.age > 0.4) {
      const enemy = state.players.find((t) => t.id !== p.ownerId);
      const desired = Math.atan2(enemy.y - p.y, enemy.x - p.x);
      const current = Math.atan2(p.vy, p.vx);
      const delta = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
      const next = current + clamp(delta, -0.05, 0.05);
      const speed = Math.hypot(p.vx, p.vy);
      p.vx = Math.cos(next) * speed;
      p.vy = Math.sin(next) * speed;
    }

    if (weapon.type === 'airStrike' && p.triggerArmed) {
      const enemy = state.players[1 - p.ownerId];
      const reachedPeak = p.vy > 0 && p.age > 0.5;
      const aboveEnemy = Math.abs(p.x - enemy.x) < 50 && p.y < enemy.y - 80;
      if (aboveEnemy || reachedPeak) {
        spawnAirStrikeDrops(p.ownerId, enemy.x);
        emitExplosion(p.x, p.y, '#ffc17d', 14);
        removeAtSwap(state.projectiles, i);
        continue;
      }
    }

    if (weapon.type === 'mirv' && !p.splitDone && p.vy > 10 && p.age > 0.45) {
      p.splitDone = true;
      for (let k = -2; k <= 2; k += 1) {
        state.projectiles.push({
          weaponId: 'mirvChild',
          ownerId: p.ownerId,
          x: p.x,
          y: p.y,
          vx: p.vx * 0.45 + k * 65,
          vy: -120 - Math.abs(k) * 20,
          life: 2.2,
          age: 0,
          trailColor: p.trailColor,
          synthetic: { damage: 18, radius: 16 },
        });
      }
    }

    const subSteps = 3;
    let removed = false;

    for (let s = 0; s < subSteps; s += 1) {
      p.x += (p.vx * dt) / subSteps;
      p.y += (p.vy * dt) / subSteps;

      if (p.burrow) {
        carveTerrain(p.x, p.y + 3, 6, 0.2);
      }

      if (weapon.type === 'bouncer' && p.y >= groundAt(p.x) && p.bounceRemaining > 0) {
        p.y = groundAt(p.x) - 3;
        p.vy = -Math.abs(p.vy) * 0.68;
        p.vx *= 0.92;
        p.bounceRemaining -= 1;
        continue;
      }

      for (const tank of state.players) {
        if (Math.hypot(tank.x - p.x, tank.y - p.y) <= WORLD.tankRadius + 3) {
          resolveProjectileImpact(p, p.x, p.y);
          removeAtSwap(state.projectiles, i);
          removed = true;
          break;
        }
      }
      if (removed) break;

      if (p.x < 0 || p.x >= WORLD.width || p.y > WORLD.height || p.life <= 0) {
        resolveProjectileImpact(p, clamp(p.x, 0, WORLD.width - 1), clamp(p.y, 0, WORLD.height - 1));
        removeAtSwap(state.projectiles, i);
        removed = true;
        break;
      }

      if (p.y >= groundAt(p.x)) {
        const keep = resolveProjectileImpact(p, p.x, p.y);
        if (!keep) {
          removeAtSwap(state.projectiles, i);
          removed = true;
        }
        break;
      }
    }

    if (!removed) {
      state.particles.push({ x: p.x, y: p.y, vx: -p.vx * 0.03 + rand(-4, 4), vy: -p.vy * 0.03 + rand(-4, 4), life: 0.22, maxLife: 0.22, size: 1.8, color: p.trailColor });
    }
  }

  if (state.projectiles.length === 0 && state.spawnQueue.length === 0 && state.phase === 'projectile') beginTurnEndDelay();
}

function updateNapalm(dt) {
  for (let i = state.napalmDrops.length - 1; i >= 0; i -= 1) {
    const drop = state.napalmDrops[i];
    drop.life -= dt;
    drop.tick -= dt;
    drop.vy += WORLD.gravity * 0.5 * dt;
    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;

    if (drop.x < 0 || drop.x >= WORLD.width || drop.life <= 0) {
      removeAtSwap(state.napalmDrops, i);
      continue;
    }

    if (drop.tick <= 0 || drop.y >= groundAt(drop.x)) {
      const gx = clamp(drop.x + rand(-8, 8), 0, WORLD.width - 1);
      const gy = groundAt(gx);
      carveTerrain(gx, gy, rand(8, 12), 0.5);
      emitExplosion(gx, gy - 2, '#ff7a3f', 6);
      for (const tank of state.players) {
        const d = Math.hypot(tank.x - gx, tank.y - gy);
        if (d < 26) {
          const pts = rand(2.2, 4.4);
          if (tank.id !== drop.ownerId) {
            addPoints(drop.ownerId, pts);
            spawnFloatingText(tank.x, tank.y - WORLD.tankRadius - 10, `+${Math.round(pts)}`, '#ff7a3f');
          } else {
            const penalty = pts * 0.2;
            addPoints(drop.ownerId, -penalty);
            spawnFloatingText(tank.x, tank.y - WORLD.tankRadius - 10, `-${Math.round(penalty)}`, '#ff5252');
          }
          tank.vx += sign(tank.x - gx) * 16;
          tank.vy -= 12;
        }
      }
      drop.tick = rand(0.05, 0.14);
      drop.y = gy - rand(4, 12);
      drop.vx *= 0.5;
      drop.vy = rand(-40, -8);
    }
  }

  checkWinner();
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      removeAtSwap(state.particles, i);
      continue;
    }
    if (!p.laser && !p.lightning) {
      p.vy += 180 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
}

function updateDecor(dt) {
  for (const cloud of state.clouds) {
    cloud.x += (cloud.speed + state.roundWind * 0.06) * dt;
    if (cloud.x > WORLD.width + 120) cloud.x = -180;
    if (cloud.x < -200) cloud.x = WORLD.width + 100;
  }

  for (const particle of state.windParticles) {
    particle.x += (particle.speed + state.roundWind * 0.8) * dt;
    if (particle.x > WORLD.width + 30) particle.x = -30;
    if (particle.x < -30) particle.x = WORLD.width + 30;
  }
}

/* keyboard hold tracking */
const keyHold = { angle: 0, power: 0, angleStepped: false, powerStepped: false };

function updateInput(dt) {
  if (state.phase !== 'aim') return;
  const player = getCurrentPlayer();
  if (!player || player.isAI) return;

  const angleRate = 1.35;
  const powerRate = 290;
  const holdThreshold = 0.8; /* seconds before auto-repeat kicks in */

  /* resolve direction from keys */
  let aDir = 0;
  let pDir = 0;
  if (KEYS.has('ArrowUp') || KEYS.has('KeyW')) aDir = 1;
  if (KEYS.has('ArrowDown') || KEYS.has('KeyS')) aDir = -1;
  if (KEYS.has('ArrowRight') || KEYS.has('KeyD')) pDir = 1;
  if (KEYS.has('ArrowLeft') || KEYS.has('KeyA')) pDir = -1;

  /* angle from keys */
  if (aDir !== 0) {
    if (!keyHold.angleStepped) {
      player.angle = clamp(player.angle + aDir * (Math.PI / 180), 0.16, Math.PI / 2 - 0.07);
      keyHold.angleStepped = true;
      keyHold.angle = 0;
    } else {
      keyHold.angle += dt;
      if (keyHold.angle >= holdThreshold) {
        player.angle = clamp(player.angle + aDir * angleRate * dt, 0.16, Math.PI / 2 - 0.07);
      }
    }
  } else {
    keyHold.angle = 0;
    keyHold.angleStepped = false;
  }

  /* power from keys */
  if (pDir !== 0) {
    if (!keyHold.powerStepped) {
      player.power = clamp(player.power + pDir * ((760 - 200) / 100), 200, 760);
      keyHold.powerStepped = true;
      keyHold.power = 0;
    } else {
      keyHold.power += dt;
      if (keyHold.power >= holdThreshold) {
        player.power = clamp(player.power + pDir * powerRate * dt, 200, 760);
      }
    }
  } else {
    keyHold.power = 0;
    keyHold.powerStepped = false;
  }

  /* button-based hold (already has 1s delay before setting state.hold) */
  player.angle = clamp(player.angle + state.hold.angle * angleRate * dt, 0.16, Math.PI / 2 - 0.07);
  player.power = clamp(player.power + state.hold.power * powerRate * dt, 200, 760);
}

function clearHoldIfNoKey(code) {
  /* no-op; keyboard holds are now tracked in updateInput via KEYS set */
}

function estimateDamageFromExplosion(x, y, radius, target) {
  const dist = Math.hypot(target.x - x, target.y - y);
  if (dist > radius + WORLD.tankRadius) return 0;
  return 1 - dist / (radius + WORLD.tankRadius);
}

function simulateCandidate(player, enemy, weapon, angle, power, wind) {
  if (weapon.type === 'laser') {
    const dirX = player.facingLeft ? -Math.cos(angle) : Math.cos(angle);
    const dirY = -Math.sin(angle);
    for (let l = 0; l < 1000; l += 4) {
      const x = player.x + dirX * l;
      const y = player.y - 8 + dirY * l;
      if (x < 0 || x >= WORLD.width || y < 0 || y >= WORLD.height) break;
      if (y >= groundAt(x)) break;
      if (Math.hypot(enemy.x - x, enemy.y - y) <= WORLD.tankRadius + 8) return 1.15;
    }
    return 0.08;
  }

  let x = player.x + (player.facingLeft ? -Math.cos(angle) : Math.cos(angle)) * 34;
  let y = player.y - 16 - Math.sin(angle) * 34;
  let vx = (player.facingLeft ? -Math.cos(angle) : Math.cos(angle)) * power * weapon.speedMul * BASELINE_POWER_BOOST;
  let vy = -Math.sin(angle) * power * weapon.speedMul * BASELINE_POWER_BOOST;

  for (let i = 0; i < 280; i += 1) {
    vy += WORLD.gravity / 60;
    vx += wind / 60;
    x += vx / 60;
    y += vy / 60;
    if (x < 0 || x >= WORLD.width || y >= WORLD.height || y < 0) break;

    if (weapon.type === 'airStrike') {
      if (vy > 0 && i > 30) {
        const center = estimateDamageFromExplosion(enemy.x, enemy.y - 20, 24, enemy);
        return center * 1.1;
      }
    }

    if (y >= groundAt(x) || Math.hypot(enemy.x - x, enemy.y - y) <= WORLD.tankRadius + 3) {
      return estimateDamageFromExplosion(x, y, weapon.radius, enemy);
    }
  }

  return 0;
}

function computeAiMove() {
  const ai = getCurrentPlayer();
  const enemy = state.players[1 - state.currentTurn];
  if (!ai || !enemy || ai.loadout.length === 0) return;

  const diff = state.aiDifficulty;
  const angleSteps = diff === 'easy' ? 6 : diff === 'medium' ? 12 : 18;
  const powerSteps = diff === 'easy' ? 6 : diff === 'medium' ? 10 : 16;
  const noise = diff === 'easy' ? 6.0 : diff === 'medium' ? 2.0 : 0.8;

  let best = { score: -Infinity, weaponIndex: ai.selectedWeaponIndex, angle: Math.PI / 4, power: 460 };

  for (let wi = 0; wi < ai.loadout.length; wi += 1) {
    const weapon = getWeaponById(ai.loadout[wi]);
    for (let a = 0; a < angleSteps; a += 1) {
      const angle = 0.2 + (a / Math.max(1, angleSteps - 1)) * 1.2;
      for (let p = 0; p < powerSteps; p += 1) {
        const power = 220 + p * (540 / Math.max(1, powerSteps - 1));
        const hit = simulateCandidate(ai, enemy, weapon, angle, power, state.roundWind);
        const selfRisk = simulateCandidate(ai, ai, weapon, angle, power, state.roundWind) * 0.7;
        const score = hit * (weapon.damage + weapon.radius * 0.2) - selfRisk * 34 + rand(-noise, noise);
        if (score > best.score) best = { score, weaponIndex: wi, angle, power };
      }
    }
  }

  ai.selectedWeaponIndex = best.weaponIndex;
  ai.angle = best.angle;
  ai.power = clamp(best.power, 220, 760);
}

function updateAiTurn() {
  const player = getCurrentPlayer();
  if (!player || !player.isAI || state.phase !== 'aim' || state.aiThinking) return;

  if (player.loadout.length === 0) {
    beginTurnEndDelay(0.4);
    state.phase = 'projectile';
    return;
  }

  state.aiThinking = true;
  showMessage('AI is calculating trajectory...');
  setTimeout(() => {
    if (state.phase !== 'aim' || state.currentTurn !== player.id) {
      state.aiThinking = false;
      return;
    }
    computeAiMove();
    syncHud();
    renderWeaponBar();
    setTimeout(() => {
      state.aiThinking = false;
      fireCurrentWeapon();
    }, 220);
  }, clamp(380 + Math.abs(state.roundWind) * 2.1, 380, 760));
}

function drawSky() {
  if (!cachedSkyGradient) {
    cachedSkyGradient = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    cachedSkyGradient.addColorStop(0, '#3b537b');
    cachedSkyGradient.addColorStop(1, '#121c2e');
  }
  ctx.fillStyle = cachedSkyGradient;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  const moonX = WORLD.width * 0.82;
  const moonY = 90;
  ctx.fillStyle = 'rgba(238,245,255,0.26)';
  ctx.beginPath();
  ctx.arc(moonX, moonY, 30, 0, Math.PI * 2);
  ctx.fill();
}

function drawMountains() {
  ctx.fillStyle = 'rgba(35, 49, 76, 0.52)';
  for (const m of state.mountains) {
    ctx.beginPath();
    ctx.moveTo(m.x, WORLD.height * 0.68);
    ctx.lineTo(m.x + m.w * 0.5, WORLD.height * 0.68 - m.h);
    ctx.lineTo(m.x + m.w, WORLD.height * 0.68);
    ctx.closePath();
    ctx.fill();
  }
}

function drawClouds() {
  for (const cloud of state.clouds) {
    ctx.fillStyle = 'rgba(228, 241, 255, 0.16)';
    ctx.beginPath();
    ctx.ellipse(cloud.x, cloud.y, cloud.w * 0.5, cloud.h * 0.48, 0, 0, Math.PI * 2);
    ctx.ellipse(cloud.x - cloud.w * 0.25, cloud.y + 4, cloud.w * 0.35, cloud.h * 0.4, 0, 0, Math.PI * 2);
    ctx.ellipse(cloud.x + cloud.w * 0.2, cloud.y + 2, cloud.w * 0.34, cloud.h * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWindIndicator() {
  const x = WORLD.width / 2;
  const y = 30;
  const len = clamp(Math.abs(state.roundWind) * 0.58, 12, 125);
  const dir = sign(state.roundWind || 1);

  ctx.strokeStyle = '#d4e7ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dir * len, y);
  ctx.stroke();

  const tipX = x + dir * len;
  ctx.beginPath();
  ctx.moveTo(tipX, y);
  ctx.lineTo(tipX - dir * 11, y - 6);
  ctx.lineTo(tipX - dir * 11, y + 6);
  ctx.closePath();
  ctx.fillStyle = '#d4e7ff';
  ctx.fill();

  for (const p of state.windParticles) {
    ctx.strokeStyle = `rgba(210, 235, 255, ${p.alpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + dir * p.len, p.y + rand(-0.2, 0.2));
    ctx.stroke();
  }
}

function drawTerrain() {
  ctx.fillStyle = '#4e3f32';
  ctx.beginPath();
  ctx.moveTo(0, WORLD.height);
  for (let x = 0; x < WORLD.width; x += 1) ctx.lineTo(x, state.terrain[x]);
  ctx.lineTo(WORLD.width, WORLD.height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#7f6750';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, state.terrain[0]);
  for (let x = 1; x < WORLD.width; x += 2) ctx.lineTo(x, state.terrain[x]);
  ctx.stroke();

  ctx.fillStyle = 'rgba(87, 130, 87, 0.14)';
  ctx.beginPath();
  ctx.moveTo(0, state.terrain[0]);
  for (let x = 1; x < WORLD.width; x += 4) ctx.lineTo(x, state.terrain[x] - 2);
  for (let x = WORLD.width - 1; x >= 0; x -= 4) ctx.lineTo(x, state.terrain[x] + 6);
  ctx.closePath();
  ctx.fill();
}

function drawTank(tank, isCurrent) {
  if (!tank) return;
  ctx.save();
  ctx.translate(tank.x, tank.y);

  const dark = tank.id === 0 ? '#366f9f' : '#9a5b49';
  const highlight = tank.id === 0 ? '#5196d1' : '#c47560';

  /* ── Tracks ── */
  ctx.fillStyle = '#1a1f28';
  const trackPath = new Path2D();
  trackPath.moveTo(-24, 0);
  trackPath.lineTo(-22, 10);
  trackPath.lineTo(22, 10);
  trackPath.lineTo(24, 0);
  trackPath.closePath();
  ctx.fill(trackPath);
  ctx.fillStyle = '#2a3240';
  for (let i = -18; i <= 18; i += 9) {
    ctx.beginPath();
    ctx.arc(i, 7, 3.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#3a4555';
  ctx.lineWidth = 0.8;
  for (let i = -18; i <= 18; i += 9) {
    ctx.beginPath();
    ctx.arc(i, 7, 3.8, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* ── Body ── */
  ctx.fillStyle = tank.color;
  const bodyPath = new Path2D();
  bodyPath.moveTo(-20, 0);
  bodyPath.lineTo(-18, -14);
  bodyPath.lineTo(18, -14);
  bodyPath.lineTo(20, 0);
  bodyPath.closePath();
  ctx.fill(bodyPath);
  // Body top bevel
  ctx.fillStyle = highlight;
  ctx.fillRect(-16, -14, 32, 3);
  // Body shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(-18, -4, 36, 4);

  /* ── Barrel ── */
  const turret = turretVector(tank);
  const barrelAngle = Math.atan2(turret.dy, turret.dx);
  ctx.save();
  ctx.translate(0, -17);
  ctx.rotate(barrelAngle);
  // barrel shadow
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(8, -1, 24, 5);
  // barrel body
  ctx.fillStyle = isCurrent ? '#e0d9c6' : '#a8b4c4';
  ctx.beginPath();
  ctx.moveTo(8, -3.5);
  ctx.lineTo(30, -2.5);
  ctx.lineTo(30, 2.5);
  ctx.lineTo(8, 3.5);
  ctx.closePath();
  ctx.fill();
  // barrel rim
  ctx.fillStyle = isCurrent ? '#fff4d7' : '#dbe5f6';
  ctx.fillRect(30, -3.5, 4, 7);
  // barrel highlight stripe
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(10, -3, 20, 1.5);
  ctx.restore();

  /* ── Turret dome ── */
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(0, -15, 10, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  // dome highlight
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.arc(0, -15, 10, Math.PI + 0.3, -0.3);
  ctx.closePath();
  ctx.fill();

  /* ── Current-turn indicator ── */
  if (isCurrent && state.phase === 'aim') {
    const t = performance.now() / 700;
    const bob = Math.sin(t) * 3;
    ctx.fillStyle = tank.color;
    ctx.beginPath();
    ctx.moveTo(0, -34 + bob);
    ctx.lineTo(-5, -40 + bob);
    ctx.lineTo(5, -40 + bob);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawProjectiles() {
  for (const p of state.projectiles) {
    ctx.fillStyle = '#ffe4aa';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const alpha = clamp(p.life / (p.maxLife || 1), 0, 1);
    if (p.laser) {
      ctx.strokeStyle = `rgba(142, 237, 255, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      continue;
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color || '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size || 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const fire of state.napalmDrops) {
    ctx.fillStyle = '#ff7a3f';
    ctx.beginPath();
    ctx.arc(fire.x, fire.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCrosshair() {
  if (state.phase !== 'aim' || state.players.length < 2) return;
  const player = getCurrentPlayer();
  if (!player || player.isAI) return;

  const turr = turretVector(player);
  const dist = 52;
  const cx = player.x + turr.dx * dist;
  const cy = player.y - 16 + turr.dy * dist;
  const size = 7;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 60, 50, 0.72)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - size, cy); ctx.lineTo(cx + size, cy);
  ctx.moveTo(cx, cy - size); ctx.lineTo(cx, cy + size);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawWelcomeScreen() {
  const w = WORLD.width;
  const h = WORLD.height;

  /* dark overlay */
  ctx.fillStyle = 'rgba(8, 14, 24, 0.55)';
  ctx.fillRect(0, 0, w, h);

  /* title */
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 56px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#7fd4ff';
  ctx.shadowColor = 'rgba(80, 180, 255, 0.45)';
  ctx.shadowBlur = 24;
  ctx.fillText('WELCOME TO', w / 2, h * 0.26);
  ctx.font = 'bold 72px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(255,255,255,0.35)';
  ctx.shadowBlur = 30;
  ctx.fillText('TANK WARS', w / 2, h * 0.38);
  ctx.shadowBlur = 0;

  /* subtitle */
  ctx.font = '18px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9aaccc';
  ctx.fillText('Choose your battle mode', w / 2, h * 0.48);

  /* buttons */
  const btnW = 260;
  const btnH = 58;
  const gap = 24;
  const bx1 = w / 2 - btnW - gap / 2;
  const bx2 = w / 2 + gap / 2;
  const by = h * 0.56;

  state._welcomeBtns = [
    { x: bx1, y: by, w: btnW, h: btnH, action: 'pvp', label: 'Player vs Player', color: '#38639c' },
    { x: bx2, y: by, w: btnW, h: btnH, action: 'pvai', label: 'Player vs AI', color: '#38639c' },
  ];

  for (const btn of state._welcomeBtns) {
    const hover = state._welcomeHover === btn.action;
    ctx.fillStyle = hover ? '#4a7cc0' : btn.color;
    ctx.strokeStyle = hover ? '#7fd4ff' : '#4a72a0';
    ctx.lineWidth = 2;
    const r = 14;
    ctx.beginPath();
    ctx.moveTo(btn.x + r, btn.y);
    ctx.lineTo(btn.x + btn.w - r, btn.y);
    ctx.quadraticCurveTo(btn.x + btn.w, btn.y, btn.x + btn.w, btn.y + r);
    ctx.lineTo(btn.x + btn.w, btn.y + btn.h - r);
    ctx.quadraticCurveTo(btn.x + btn.w, btn.y + btn.h, btn.x + btn.w - r, btn.y + btn.h);
    ctx.lineTo(btn.x + r, btn.y + btn.h);
    ctx.quadraticCurveTo(btn.x, btn.y + btn.h, btn.x, btn.y + btn.h - r);
    ctx.lineTo(btn.x, btn.y + r);
    ctx.quadraticCurveTo(btn.x, btn.y, btn.x + r, btn.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px Inter, system-ui, sans-serif';
    ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
  }

  /* AI difficulty sub-row */
  if (state._showAiDiff) {
    const diffY = by + btnH + 20;
    ctx.font = '15px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#9aaccc';
    ctx.fillText('AI Difficulty:', w / 2, diffY - 6);

    const diffs = ['easy', 'medium', 'hard'];
    const dBtnW = 110;
    const dGap = 14;
    const totalW = diffs.length * dBtnW + (diffs.length - 1) * dGap;
    const startX = w / 2 - totalW / 2;
    const dBtnY = diffY + 8;
    state._diffBtns = [];
    diffs.forEach((d, i) => {
      const dx = startX + i * (dBtnW + dGap);
      const hover = state._welcomeHover === d;
      ctx.fillStyle = hover ? '#7fd4ff' : '#1a2c45';
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 1.5;
      roundedRectPath(ctx, dx, dBtnY, dBtnW, 36, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hover ? '#000' : '#7fd4ff';
      ctx.font = 'bold 15px Inter, system-ui, sans-serif';
      ctx.fillText(d.charAt(0).toUpperCase() + d.slice(1), dx + dBtnW / 2, dBtnY + 19);
      state._diffBtns.push({ x: dx, y: dBtnY, w: dBtnW, h: 36, action: d });
    });
  }

  /* hint */
  const hintY = state._showAiDiff ? by + btnH + 80 : by + btnH + 28;
  ctx.font = '14px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(154,172,204,0.7)';
  ctx.fillText('Wind stays constant for the whole match', w / 2, hintY);

  ctx.restore();
}

function draw() {
  drawSky();
  drawMountains();
  drawClouds();

  if (state.welcomeScreen) {
    drawWelcomeScreen();
    return;
  }

  if (state.phase === 'menu' || state.phase === 'draft' || state.players.length < 2) return;

  drawWindIndicator();
  drawTerrain();
  drawCrosshair();
  drawProjectiles();
  drawParticles();
  drawTank(state.players[0], state.currentTurn === 0);
  drawTank(state.players[1], state.currentTurn === 1);
  drawFloatingTexts();
}

let lastTime = performance.now();
let accumulator = 0;
const FIXED_DT = 1 / 60;

function update(dt) {
  updateDecor(dt);
  if (!state.running) return;

  updateInput(dt);
  updateAiTurn();
  updateProjectiles(dt);
  updateTankPhysics(dt);
  updateNapalm(dt);
  updateFloatingTexts(dt);
  updateParticles(dt);

  if (state.pendingTurnEnd > 0) {
    state.pendingTurnEnd -= dt;
    if (state.pendingTurnEnd <= 0 && state.projectiles.length === 0 && state.spawnQueue.length === 0 && state.phase !== 'gameover') {
      endTurnIfNeeded();
    }
  }

  syncHud();
}

function frame(now) {
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += delta;

  while (accumulator >= FIXED_DT) {
    update(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  draw();
  requestAnimationFrame(frame);
}

function setHold(control, value) {
  state.hold[control] = value;
}

/* ---- Hold-button system: tap = 1 step, hold 1s = auto-repeat ---- */
const holdTimers = {};

function wireHoldButton(button, control, dir) {
  function singleStep() {
    const player = getCurrentPlayer();
    if (!player || player.isAI || state.phase !== 'aim') return;
    if (control === 'angle') {
      player.angle = clamp(player.angle + dir * (1 * Math.PI / 180), 0.16, Math.PI / 2 - 0.07);
    } else {
      player.power = clamp(player.power + dir * ((760 - 200) / 100), 200, 760);
    }
    syncHud();
  }

  const key = `${control}_${dir}`;

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    singleStep();
    holdTimers[key] = { timeout: setTimeout(() => {
      setHold(control, dir);
      holdTimers[key].active = true;
    }, 800), active: false };
  });

  const stop = () => {
    if (holdTimers[key]) {
      clearTimeout(holdTimers[key].timeout);
      if (holdTimers[key].active && state.hold[control] === dir) setHold(control, 0);
      delete holdTimers[key];
    }
  };
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('pointercancel', stop);
}

function wireUi() {
  if (ui.pvpBtn) ui.pvpBtn.addEventListener('click', () => { state.welcomeScreen = false; startDraft('pvp'); });
  if (ui.pvaiBtn) ui.pvaiBtn.addEventListener('click', () => {
    const el = document.getElementById('aiDifficultySelect');
    if (el) el.classList.toggle('hidden');
  });

  document.querySelectorAll('.ai-diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.aiDifficulty = btn.dataset.diff;
      const el = document.getElementById('aiDifficultySelect');
      if (el) el.classList.add('hidden');
      state.welcomeScreen = false;
      startDraft('pvai');
    });
  });

  ui.newGameBtn.addEventListener('click', () => {
    if (state.phase === 'menu' || state.phase === 'gameover' || !state.running || window.confirm('Abandon current game and return to menu?')) {
      resetToMenu();
    }
  });
  ui.winnerCloseBtn.addEventListener('click', resetToMenu);
  if (ui.muteBtn) {
    ui.muteBtn.addEventListener('click', () => {
      const next = !audio.isMuted();
      audio.setMuted(next);
      refreshMuteButton();
    });
  }
  if (ui.nextGameBtn) {
    ui.nextGameBtn.addEventListener('click', () => {
      clearWinnerModal();
      startDraft(state.mode);
    });
  }
  ui.fireBtn.addEventListener('click', fireCurrentWeapon);
  ui.fireBtn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    fireCurrentWeapon();
  });

  const draftRandBtn = document.getElementById('draftRandomizeBtn');
  if (draftRandBtn) draftRandBtn.addEventListener('click', randomizeRemaining);

  wireHoldButton(ui.angleDown, 'angle', -1);
  wireHoldButton(ui.angleUp, 'angle', 1);
  wireHoldButton(ui.powerDown, 'power', -1);
  wireHoldButton(ui.powerUp, 'power', 1);

  window.addEventListener('pointerup', () => {
    state.hold.angle = 0;
    state.hold.power = 0;
  });

  window.addEventListener('keydown', (event) => {
    KEYS.add(event.code);
    if (event.code === 'Space') {
      event.preventDefault();
      fireCurrentWeapon();
    }
  });

  window.addEventListener('keyup', (event) => {
    KEYS.delete(event.code);
    clearHoldIfNoKey(event.code);
  });

  /* --- Welcome screen canvas interactions --- */
  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function hitTest(mx, my, btn) {
    return mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h;
  }

  canvas.addEventListener('mousemove', (e) => {
    if (!state.welcomeScreen) { canvas.style.cursor = 'default'; return; }
    const { x, y } = canvasCoords(e);
    let found = '';
    if (state._welcomeBtns) {
      for (const btn of state._welcomeBtns) {
        if (hitTest(x, y, btn)) found = btn.action;
      }
    }
    if (state._showAiDiff && state._diffBtns) {
      for (const btn of state._diffBtns) {
        if (hitTest(x, y, btn)) found = btn.action;
      }
    }
    state._welcomeHover = found;
    canvas.style.cursor = found ? 'pointer' : 'default';
  });

  function handleWelcomeTap(e) {
    if (!state.welcomeScreen) return;
    const { x, y } = canvasCoords(e);
    if (state._welcomeBtns) {
      for (const btn of state._welcomeBtns) {
        if (hitTest(x, y, btn)) {
          if (btn.action === 'pvp') {
            state.welcomeScreen = false;
            ui.menu.classList.remove('visible');
            startDraft('pvp');
          } else if (btn.action === 'pvai') {
            state._showAiDiff = !state._showAiDiff;
          }
          return;
        }
      }
    }
    if (state._showAiDiff && state._diffBtns) {
      for (const btn of state._diffBtns) {
        if (hitTest(x, y, btn)) {
          state.aiDifficulty = btn.action;
          state._showAiDiff = false;
          state.welcomeScreen = false;
          ui.menu.classList.remove('visible');
          startDraft('pvai');
          return;
        }
      }
    }
  }

  canvas.addEventListener('click', handleWelcomeTap);
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.welcomeScreen) return;
    e.preventDefault();
    handleWelcomeTap(e);
  });
}

function boot() {
  buildTerrain();
  buildDecor();
  wireUi();
  refreshMuteButton();
  resetToMenu();
  requestAnimationFrame(frame);
}

boot();
