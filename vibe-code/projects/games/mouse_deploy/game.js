(() => {
  'use strict';

  const TEAM_USER = 'user';
  const TEAM_AI = 'ai';

  const PICKUP_SPEED = 'speed';
  const PICKUP_FREEZE = 'freeze';
  const PICKUP_TRUTH = 'truth';

  const DIRS = [
    { name: 'N', dx: 0, dy: -1, bit: 1, opp: 4 },
    { name: 'E', dx: 1, dy: 0, bit: 2, opp: 8 },
    { name: 'S', dx: 0, dy: 1, bit: 4, opp: 1 },
    { name: 'W', dx: -1, dy: 0, bit: 8, opp: 2 },
  ];

  const DIR_INDEX = { N: 0, E: 1, S: 2, W: 3 };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function nowMs() {
    return performance.now();
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6D2B79F5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function safeInt(v, fallback) {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  class AudioBus {
    constructor() {
      this.enabled = true;
      this._cache = new Map();
      this._looping = new Map(); // Track looping sounds
      this._bgMusic = null;      // Background music element
      this._bgMusicGain = null;  // For ducking
      this._audioContext = null;
      this._duckingActive = false;
      this._duckTimeout = null;
      this._loadedCount = 0;
      this._totalCount = 0;
      this.onLoadProgress = null; // Callback for loading progress
      
      // ========================================
      // VOLUME CONFIGURATION - Adjust these values (0.0 to 1.0)
      // ========================================
      this._volumes = {
        // Background music
        bg_music: 0.35,
        end_strings: 0.40,
        
        // General SFX
        deploy: 0.35,
        alert: 0.35,
        
        // Win/Lose
        win: 0.40,
        lose: 0.40,
        final_win: 0.45,
        
        // Pickups
        freeze: 0.35,
        speed_boost: 0.30,
        truth: 0.35,
        bomb: 0.40,
        
        // Cats
        ai_cat: 0.35,
        player_cat: 0.35,
        cat_eats: 0.40,
        mouse_being_eaten: 0.35,
        
        // Walk sounds (ambient loops)
        walk_1: 0.40,
        walk_2: 0.40,
        
        // Destroy
        destroy: 0.45,
        
        // Bad stomach (decoy cheese)
        bad_stomach: 0.40,
        
        // Laser fence
        laser_fence_deploy: 0.45,
        electric_zap: 0.50,
      };
      // ========================================
      
      this._map = {
        deploy: 'sounds/deploy.mp3',
        win: 'sounds/win.mp3',
        alert: 'sounds/alert.mp3',
        bomb: 'sounds/bomb.mp3',
        freeze: 'sounds/freeze.mp3',
        final_win: 'sounds/final_win.mp3',
        lose: 'sounds/lose.mp3',
        ai_cat: 'sounds/ai_cat.mp3',
        player_cat: 'sounds/player_cat.mp3',
        cat_eats: 'sounds/cat_eats.mp3',
        mouse_being_eaten: 'sounds/mouse_being_eaten.mp3',
        speed_boost: 'sounds/speed_boost.mp3',
        truth: 'sounds/truth.mp3',
        walk_1: 'sounds/walk_1.mp3',
        walk_2: 'sounds/walk_2.mp3',
        bg_music: 'sounds/bg_music.mp3',
        end_strings: 'sounds/end_strings.mp3',
        destroy: 'sounds/destroy.mp3',
        bad_stomach: 'sounds/bad_stomach.mp3',
        laser_fence_deploy: 'sounds/laser_fence_deploy.mp3',
        electric_zap: 'sounds/electric_zap.mp3',
      };
      
      // Sounds that should NOT trigger ducking (walk sounds + bg music itself)
      this._noDuckSounds = new Set(['walk_1', 'walk_2', 'bg_music', 'end_strings']);
      
      // Track which dramatic music is playing
      this._endStringsPlaying = false;
      this._endStringsAudio = null;
    }
    
    // Preload all sounds with progress tracking
    preloadAll() {
      return new Promise((resolve) => {
        const entries = Object.entries(this._map);
        this._totalCount = entries.length;
        this._loadedCount = 0;
        
        if (entries.length === 0) {
          resolve();
          return;
        }
        
        const checkComplete = () => {
          if (this._loadedCount >= this._totalCount) {
            resolve();
          }
        };
        
        for (const [name, src] of entries) {
          const audio = new Audio();
          audio.preload = 'auto';
          audio.volume = this._volumes[name] ?? 0.35;
          
          const onLoaded = () => {
            this._loadedCount++;
            this._cache.set(src, audio);
            
            // Special handling for bg_music
            if (name === 'bg_music') {
              audio.loop = true;
              this._bgMusic = audio;
            }
            
            // Special handling for end_strings (dramatic finish music)
            if (name === 'end_strings') {
              audio.loop = true;
              this._endStringsAudio = audio;
            }
            
            // Report progress
            if (this.onLoadProgress) {
              this.onLoadProgress(this._loadedCount, this._totalCount);
            }
            
            checkComplete();
          };
          
          audio.addEventListener('canplaythrough', onLoaded, { once: true });
          audio.addEventListener('error', () => {
            console.warn(`Failed to load: ${src}`);
            this._loadedCount++;
            if (this.onLoadProgress) {
              this.onLoadProgress(this._loadedCount, this._totalCount);
            }
            checkComplete();
          }, { once: true });
          
          // Timeout fallback in case audio never loads
          setTimeout(() => {
            if (!this._cache.has(src)) {
              this._loadedCount++;
              if (this.onLoadProgress) {
                this.onLoadProgress(this._loadedCount, this._totalCount);
              }
              checkComplete();
            }
          }, 5000);
          
          audio.src = src;
          audio.load();
        }
      });
    }
    
    // Resume audio context on user interaction
    resumeContext() {
      if (!this._audioContext) {
        this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this._audioContext.state === 'suspended') {
        this._audioContext.resume();
      }
    }
    
    // Prepare background music (call on user interaction, like START button)
    prepareBgMusic() {
      this.resumeContext();
      if (this._bgMusic && !this._bgMusicGain && this._audioContext) {
        try {
          // Setup Web Audio nodes
          const source = this._audioContext.createMediaElementSource(this._bgMusic);
          const gainNode = this._audioContext.createGain();
          gainNode.gain.value = this._volumes.bg_music;
          source.connect(gainNode);
          gainNode.connect(this._audioContext.destination);
          this._bgMusicGain = gainNode;
        } catch (e) {
          console.warn("Bg music preparation failed:", e);
        }
      }
    }
    
    // Start background music
    startBgMusic() {
      if (!this.enabled) return;
      
      this.resumeContext();
      this.prepareBgMusic();

      if (this._bgMusic) {
        this._bgMusic.currentTime = 0;
        const p = this._bgMusic.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn("Bg music play failed:", err);
          });
        }
      }
    }
    
    // Pause background music (for round end)
    pauseBgMusic() {
      if (this._bgMusic) {
        try {
          this._bgMusic.pause();
        } catch {}
      }
    }
    
    // Resume background music (for next round)
    resumeBgMusic() {
      if (!this.enabled) return;
      this.resumeContext();
      
      if (this._bgMusic) {
        const p = this._bgMusic.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      }
    }
    
    // Stop background music completely
    stopBgMusic() {
      if (this._bgMusic) {
        try {
          this._bgMusic.pause();
          this._bgMusic.currentTime = 0;
        } catch {}
      }
      if (this._duckTimeout) {
        clearTimeout(this._duckTimeout);
        this._duckTimeout = null;
      }
      this._duckingActive = false;
    }
    
    // Start dramatic end strings music (for near-goal zoom)
    startEndStrings() {
      if (!this.enabled || this._endStringsPlaying) return;
      
      // Pause bg music
      if (this._bgMusic) {
        try { this._bgMusic.pause(); } catch {}
      }
      
      // Play end strings
      if (this._endStringsAudio) {
        this._endStringsAudio.currentTime = 0;
        this._endStringsAudio.volume = this._volumes.end_strings ?? 0.4;
        const p = this._endStringsAudio.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn("End strings play failed:", err);
          });
        }
        this._endStringsPlaying = true;
      }
    }
    
    // Stop end strings and optionally resume bg music
    stopEndStrings(resumeBg = false) {
      if (this._endStringsAudio) {
        try {
          this._endStringsAudio.pause();
          this._endStringsAudio.currentTime = 0;
        } catch {}
      }
      this._endStringsPlaying = false;
      
      if (resumeBg && this._bgMusic && this.enabled) {
        const p = this._bgMusic.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      }
    }
    
    // Duck the background music temporarily
    _duckBgMusic() {
      if (!this._bgMusicGain || !this._audioContext) return;
      
      const now = this._audioContext.currentTime;
      const duckLevel = this._volumes.bg_music * 0.3; // Duck to 30% of normal
      const normalLevel = this._volumes.bg_music;
      
      // Quick fade down
      this._bgMusicGain.gain.cancelScheduledValues(now);
      this._bgMusicGain.gain.setValueAtTime(this._bgMusicGain.gain.value, now);
      this._bgMusicGain.gain.linearRampToValueAtTime(duckLevel, now + 0.05);
      
      this._duckingActive = true;
      
      // Clear any existing timeout
      if (this._duckTimeout) {
        clearTimeout(this._duckTimeout);
      }
      
      // Fade back up after SFX finishes (300ms should cover most short SFX)
      this._duckTimeout = setTimeout(() => {
        if (this._bgMusicGain && this._audioContext) {
          const t = this._audioContext.currentTime;
          this._bgMusicGain.gain.cancelScheduledValues(t);
          this._bgMusicGain.gain.setValueAtTime(this._bgMusicGain.gain.value, t);
          this._bgMusicGain.gain.linearRampToValueAtTime(normalLevel, t + 0.15);
        }
        this._duckingActive = false;
      }, 300);
    }

    playSound(effectName) {
      if (!this.enabled) return;
      const src = this._map[effectName];
      if (!src) return;
      
      this.resumeContext(); // Try to resume on every sound play
      
      // Duck background music for SFX (except walk sounds)
      if (!this._noDuckSounds.has(effectName)) {
        this._duckBgMusic();
      }
      
      try {
        let audio = this._cache.get(src);
        if (!audio) {
          audio = new Audio(src);
          audio.preload = 'auto';
          audio.volume = this._volumes[effectName] ?? 0.35;
          this._cache.set(src, audio);
        }
        const a = audio.cloneNode(true);
        a.volume = this._volumes[effectName] ?? 0.35;
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // Must not crash if files are missing.
      }
    }

    startLoop(effectName) {
      if (!this.enabled) return;
      if (this._looping.has(effectName)) return; // Already playing
      const src = this._map[effectName];
      if (!src) return;
      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = this._volumes[effectName] ?? 0.25;
        audio.loop = true;
        this._looping.set(effectName, audio);
        const p = audio.play();
        if (p && typeof p.catch === 'function') p.catch(() => {
          this._looping.delete(effectName);
        });
      } catch {
        // Ignore errors
      }
    }

    stopLoop(effectName) {
      const audio = this._looping.get(effectName);
      if (audio) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {}
        this._looping.delete(effectName);
      }
    }

    stopAllLoops() {
      for (const [name, audio] of this._looping) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {}
      }
      this._looping.clear();
    }
  }

  class Maze {
    constructor(w, h, rng) {
      this.w = w;
      this.h = h;
      this.rng = rng;
      this.cells = new Uint8Array(w * h);
      this.goal = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
      this.userStart = { x: 0, y: h - 1 };
      this.aiStart = { x: w - 1, y: 0 };

      const manhattanStartToGoal =
        Math.abs(this.userStart.x - this.goal.x) +
        Math.abs(this.userStart.y - this.goal.y);
      // If the shortest path is too close to Manhattan distance, it tends to feel
      // like a straight-shot. Enforce a stricter minimum to prevent easy corridors.
      const minAcceptable = Math.floor(manhattanStartToGoal * 1.8); // Increased to 1.8 for more winding paths
      const minTurnCount = 6; // Require at least this many direction changes

      // Generate two independent maze halves; regenerate until path lengths match.
      for (let tries = 0; tries < 300; tries++) {
        this._resetWalls();
        this._generateIndependentHalves();
        const d = this.computeDistanceMap(this.goal.x, this.goal.y);
        const du = d[this.index(this.userStart.x, this.userStart.y)];
        const da = d[this.index(this.aiStart.x, this.aiStart.y)];
        
        // Basic checks: paths must exist, be equal, and meet minimum length
        if (!Number.isFinite(du) || !Number.isFinite(da) || du !== da || du < minAcceptable) continue;
        
        // Advanced check: count direction changes to ensure path isn't too straight
        const userTurns = this._countPathTurns(this.userStart.x, this.userStart.y, d);
        const aiTurns = this._countPathTurns(this.aiStart.x, this.aiStart.y, d);
        
        // Reject if either path is too straight (not enough turns)
        if (userTurns < minTurnCount || aiTurns < minTurnCount) continue;
        
        // Maze passed all checks
        break;
      }

      // Hard guarantee: if still mismatched, carve balanced corridors.
      {
        const d = this.computeDistanceMap(this.goal.x, this.goal.y);
        const du = d[this.index(this.userStart.x, this.userStart.y)];
        const da = d[this.index(this.aiStart.x, this.aiStart.y)];
        if (!Number.isFinite(du) || !Number.isFinite(da) || du !== da) {
          this._forceBalancedCorridors();
        }
      }

      // Reduce bridge count to make maze less open
      this._addRandomBridge();
    }

    // Count direction changes along the optimal path from (startX, startY) to goal
    _countPathTurns(startX, startY, distMap) {
      let x = startX;
      let y = startY;
      let turns = 0;
      let lastDir = -1;
      const maxSteps = this.w * this.h; // Prevent infinite loop
      
      for (let step = 0; step < maxSteps; step++) {
        if (x === this.goal.x && y === this.goal.y) break;
        
        const currentDist = distMap[this.index(x, y)];
        let bestDir = -1;
        let bestDist = currentDist;
        
        // Find direction that leads to shorter distance
        for (let di = 0; di < 4; di++) {
          if (this.hasWall(x, y, di)) continue;
          const nx = x + DIRS[di].dx;
          const ny = y + DIRS[di].dy;
          if (!this.inBounds(nx, ny)) continue;
          const nd = distMap[this.index(nx, ny)];
          if (nd < bestDist) {
            bestDist = nd;
            bestDir = di;
          }
        }
        
        if (bestDir === -1) break; // Dead end, shouldn't happen
        
        // Count turn if direction changed
        if (lastDir !== -1 && lastDir !== bestDir) {
          turns++;
        }
        lastDir = bestDir;
        
        x += DIRS[bestDir].dx;
        y += DIRS[bestDir].dy;
      }
      
      return turns;
    }
    _forceBalancedCorridors() {
      // Carve independent winding corridors from each start to the goal.
      // Ensure they have the same length by controlling step counts.
      const carveWindingPath = (startX, startY) => {
        let x = startX;
        let y = startY;
        const stepDirX = () => (x < this.goal.x ? 1 : 3);
        const stepDirY = () => (y < this.goal.y ? 2 : 0);
        let preferX = this.rng() < 0.5;
        let run = 0;
        let runLimit = 2 + Math.floor(this.rng() * 2);

        while (x !== this.goal.x || y !== this.goal.y) {
          if (run >= runLimit) {
            preferX = !preferX;
            run = 0;
            runLimit = 2 + Math.floor(this.rng() * 2);
          }
          const mustX = (x !== this.goal.x) && (y === this.goal.y);
          const mustY = (y !== this.goal.y) && (x === this.goal.x);
          let di;
          if (mustX) di = stepDirX();
          else if (mustY) di = stepDirY();
          else di = preferX ? stepDirX() : stepDirY();
          this._carveOne(x, y, di);
          x += DIRS[di].dx;
          y += DIRS[di].dy;
          run++;
        }
      };
      carveWindingPath(this.userStart.x, this.userStart.y);
      carveWindingPath(this.aiStart.x, this.aiStart.y);
    }

    _resetWalls() {
      for (let i = 0; i < this.cells.length; i++) this.cells[i] = 1 | 2 | 4 | 8;
    }

    index(x, y) {
      return y * this.w + x;
    }

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.w && y < this.h;
    }

    mirrorCell(x, y) {
      return { x: this.w - 1 - x, y: this.h - 1 - y };
    }

    mirrorDir(dirIndex) {
      // 180° rotation flips N<->S and E<->W
      return (dirIndex + 2) % 4;
    }

    hasWall(x, y, dirIndex) {
      const bit = DIRS[dirIndex].bit;
      return (this.cells[this.index(x, y)] & bit) !== 0;
    }

    _carveOne(x, y, dirIndex) {
      const dir = DIRS[dirIndex];
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!this.inBounds(nx, ny)) return false;
      const a = this.index(x, y);
      const b = this.index(nx, ny);
      this.cells[a] &= ~dir.bit;
      this.cells[b] &= ~dir.opp;
      return true;
    }

    _carveSymmetric(x, y, dirIndex) {
      const dir = DIRS[dirIndex];
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!this.inBounds(nx, ny)) return false;

      this._carveOne(x, y, dirIndex);

      const m = this.mirrorCell(x, y);
      const md = this.mirrorDir(dirIndex);

      if (m.x === x && m.y === y) return true;
      this._carveOne(m.x, m.y, md);
      return true;
    }

    _generateIndependentHalves() {
      // Generate two separate maze halves that meet at the goal.
      // Each half is carved independently using DFS, making them look unique.
      const visited = new Uint8Array(this.w * this.h);

      // Determine which half a cell belongs to (user half vs AI half).
      // User half: cells closer to userStart; AI half: cells closer to aiStart.
      // Cells equidistant belong to both (center line).
      const isUserHalf = (x, y) => {
        const du = Math.abs(x - this.userStart.x) + Math.abs(y - this.userStart.y);
        const da = Math.abs(x - this.aiStart.x) + Math.abs(y - this.aiStart.y);
        return du <= da;
      };

      const carveDFS = (startX, startY, isMyHalf) => {
        const stack = [{ x: startX, y: startY }];
        visited[this.index(startX, startY)] = 1;

        while (stack.length) {
          const cur = stack[stack.length - 1];
          const options = [];

          for (let di = 0; di < 4; di++) {
            const d = DIRS[di];
            const nx = cur.x + d.dx;
            const ny = cur.y + d.dy;
            if (!this.inBounds(nx, ny)) continue;
            if (visited[this.index(nx, ny)]) continue;
            // Only expand within our half (or into goal).
            if (nx === this.goal.x && ny === this.goal.y) {
              options.push(di);
            } else if (isMyHalf(nx, ny)) {
              options.push(di);
            }
          }

          if (options.length === 0) {
            stack.pop();
            continue;
          }

          const pick = options[Math.floor(this.rng() * options.length)];
          const dd = DIRS[pick];
          const nx = cur.x + dd.dx;
          const ny = cur.y + dd.dy;

          this._carveOne(cur.x, cur.y, pick);
          visited[this.index(nx, ny)] = 1;
          stack.push({ x: nx, y: ny });
        }
      };

      // Mark goal as visited so both halves can connect to it.
      visited[this.index(this.goal.x, this.goal.y)] = 1;

      // Carve user half starting from userStart.
      carveDFS(this.userStart.x, this.userStart.y, isUserHalf);

      // Carve AI half starting from aiStart.
      carveDFS(this.aiStart.x, this.aiStart.y, (x, y) => !isUserHalf(x, y) || (x === this.goal.x && y === this.goal.y));

      // Ensure goal is connected to both halves by carving from goal into each.
      // Find a user-half neighbor and an AI-half neighbor of the goal.
      for (let di = 0; di < 4; di++) {
        const d = DIRS[di];
        const nx = this.goal.x + d.dx;
        const ny = this.goal.y + d.dy;
        if (!this.inBounds(nx, ny)) continue;
        if (visited[this.index(nx, ny)]) {
          this._carveOne(this.goal.x, this.goal.y, di);
        }
      }
    }

    _addRandomBridge() {
      // Add only 1 wall break on each side to keep maze challenging
      this._addWallBreaksOnSide('user', 1);
      this._addWallBreaksOnSide('ai', 1);
    }

    _addWallBreaksOnSide(side, count) {
      // Find internal walls within a side and break some to create loops/choices.
      const isUserHalf = (x, y) => {
        const du = Math.abs(x - this.userStart.x) + Math.abs(y - this.userStart.y);
        const da = Math.abs(x - this.aiStart.x) + Math.abs(y - this.aiStart.y);
        return du < da;
      };

      const candidates = [];
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          // Only consider cells on the correct side.
          const cellIsUser = isUserHalf(x, y);
          if (side === 'user' && !cellIsUser) continue;
          if (side === 'ai' && cellIsUser) continue;

          for (let di = 0; di < 4; di++) {
            if (!this.hasWall(x, y, di)) continue;
            const d = DIRS[di];
            const nx = x + d.dx;
            const ny = y + d.dy;
            if (!this.inBounds(nx, ny)) continue;
            // Only break walls within the same side (internal loops).
            const neighborIsUser = isUserHalf(nx, ny);
            if (side === 'user' && neighborIsUser) candidates.push({ x, y, di });
            if (side === 'ai' && !neighborIsUser) candidates.push({ x, y, di });
          }
        }
      }

      // Shuffle and pick up to 'count' walls to break.
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }

      for (let i = 0; i < Math.min(count, candidates.length); i++) {
        const pick = candidates[i];
        this._carveOne(pick.x, pick.y, pick.di);
      }
    }

    neighborsOpen(x, y) {
      const out = [];
      for (let di = 0; di < 4; di++) {
        const d = DIRS[di];
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (!this.inBounds(nx, ny)) continue;
        if (this.hasWall(x, y, di)) continue;
        out.push({ x: nx, y: ny, dirIndex: di });
      }
      return out;
    }

    computeDistanceMap(fromX, fromY) {
      const dist = new Float32Array(this.w * this.h);
      dist.fill(Infinity);
      const q = [];
      const startI = this.index(fromX, fromY);
      dist[startI] = 0;
      q.push({ x: fromX, y: fromY });

      for (let qi = 0; qi < q.length; qi++) {
        const cur = q[qi];
        const cd = dist[this.index(cur.x, cur.y)];
        const ns = this.neighborsOpen(cur.x, cur.y);
        for (const n of ns) {
          const ni = this.index(n.x, n.y);
          if (dist[ni] !== Infinity) continue;
          dist[ni] = cd + 1;
          q.push({ x: n.x, y: n.y });
        }
      }

      return dist;
    }

    breakWallsAround(x, y, radius = 1) {
      const cells = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          if (Math.abs(dx) + Math.abs(dy) > radius) continue;
          cells.push({ x: nx, y: ny });
        }
      }

      for (const c of cells) {
        for (let di = 0; di < 4; di++) {
          if (!this.hasWall(c.x, c.y, di)) continue;
          this._carveOne(c.x, c.y, di);
        }
      }
    }
  }

  class MouseAgent {
    constructor({
      id,
      team,
      algorithm,
      hand,
      start,
      maze,
      baseSpeed,
      deploymentCost,
    }) {
      this.id = id;
      this.team = team;
      this.algorithm = algorithm;
      this.hand = hand;
      this.maze = maze;
      this.deploymentCost = deploymentCost;

      this.cell = { x: start.x, y: start.y };
      this.nextCell = null;
      this.progress = 0;
      this.speed = baseSpeed;

      this.reachedGoal = false;
      this.destroyed = false;
      this.spawnedAt = nowMs();

      this.visited = new Set();
      this.path = [{ x: start.x, y: start.y }];
      this.visited.add(this._cellKey(start.x, start.y));

      this.heading = this._initialHeading();
      this._stuckCounter = 0;
      this._recentKeys = [];
      this.distanceTravelled = 0;
      this.speedBoostCount = 0; // Track speed boosts (max 2)

      // Temporary effects (e.g., pickups)
      this.tempSpeedMult = 1;
      this.tempSpeedBoostUntilMs = 0;
      this.tempSpeedBoostStartedAtMs = 0;
      this.tempSpeedBoostDurationMs = 0;

      // Path-of-truth override (temporary shortest-path autopilot)
      this.truthUntilMs = 0;
      this.truthStartedAtMs = 0;
      this.truthDurationMs = 0;
      
      // Crazy mouse detection
      this._lastTwoCells = []; // Track last two cells for ping-pong detection
      this._pingPongCount = 0;
      this.isCrazy = false;
      this.crazyAnimationTime = 0;
      this.crazyRotation = 0;
      
      // Laser fence zap tracking
      this._lastZappedAt = 0;
      this._zappedEffect = 0; // For visual glow effect
      this._zappedMemory = null; // { cell: {x, y}, zappedAt: timestamp } - remembers blocked routes
      this._zappedMemoryRetryDelay = 15000; // Try again after 15 seconds
      
      // Hive Mind enhancements
      this.hiveMindBoost = 0; // Temporary intelligence boost from Hive Mind
      this._sharedDeadEnds = new Set(); // Dead ends learned from other mice

      // Personality trait (assigned on spawn)
      this.personality = null; // 'brave', 'curious', 'lucky', or null
      this._luckyPickupBonus = 1.5; // Lucky mice find 50% more from pickups

      // Betting
      this.hasBet = false;
      this.betAmount = 0;
      this.betReward = 0;
      
      // Sickness (from eating decoy cheese)
      this.isSick = false;
      this.sickUntilMs = 0;
      this.sickSpeedReduction = 0.65; // 35% slower when sick (was 0.8 -> now 15% more reduction)
      this.sickSwayPhase = 0;
      this.poopTrail = []; // { x, y, t, sourceId } for poop traces
      this.sickSourceId = null; // ID of the original cheese that caused sickness (to prevent re-infection from same chain)
    }

    _cellKey(x, y) {
      return `${x},${y}`;
    }

    _initialHeading() {
      const gx = this.maze.goal.x;
      const gy = this.maze.goal.y;
      const dx = gx - this.cell.x;
      const dy = gy - this.cell.y;
      if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
      return dy >= 0 ? 'S' : 'N';
    }

    isActive() {
      return !this.reachedGoal && !this.destroyed;
    }

    positionLerp() {
      if (!this.nextCell) return { x: this.cell.x, y: this.cell.y };
      return {
        x: this.cell.x + (this.nextCell.x - this.cell.x) * this.progress,
        y: this.cell.y + (this.nextCell.y - this.cell.y) * this.progress,
      };
    }

    distanceToGoalManhattan() {
      return (
        Math.abs(this.cell.x - this.maze.goal.x) +
        Math.abs(this.cell.y - this.maze.goal.y)
      );
    }

    _chooseNext(engine) {
      let open = this.maze.neighborsOpen(this.cell.x, this.cell.y);
      if (open.length === 0) return null;
      
      const tNow = nowMs();
      
      // Filter out directions blocked by laser fences and remember blocked routes
      if (engine?._isCellBlockedByLaserFence) {
        const blockedByFence = open.filter(n => engine._isCellBlockedByLaserFence(this.cell.x, this.cell.y, n.x, n.y));
        
        // Remember the first blocked cell for later retry
        if (blockedByFence.length > 0 && !this._zappedMemory) {
          const blocked = blockedByFence[0];
          this._zappedMemory = {
            cell: { x: blocked.x, y: blocked.y },
            zappedAt: tNow,
            fromCell: { x: this.cell.x, y: this.cell.y }
          };
        }
        
        open = open.filter(n => !engine._isCellBlockedByLaserFence(this.cell.x, this.cell.y, n.x, n.y));
        if (open.length === 0) return null; // Completely trapped by laser fence
      }
      
      // Check if we should be attracted back to a previously blocked route
      let zappedAttraction = null;
      if (this._zappedMemory && tNow - this._zappedMemory.zappedAt >= this._zappedMemoryRetryDelay) {
        // 15 seconds have passed - fence is definitely gone, try to go back
        zappedAttraction = this._zappedMemory.cell;
        // Clear memory once we're close to the remembered cell or after 30 seconds total
        const distToMemory = Math.abs(this.cell.x - zappedAttraction.x) + Math.abs(this.cell.y - zappedAttraction.y);
        if (distToMemory <= 1 || tNow - this._zappedMemory.zappedAt >= 30000) {
          this._zappedMemory = null;
        }
      }
      
      // Manual control: use pending direction from keyboard
      if (this.algorithm === 'manual' && engine?._pendingDirection) {
        const dirMap = { N: 0, E: 1, S: 2, W: 3 };
        const targetDirIndex = dirMap[engine._pendingDirection];
        const target = open.find(o => o.dirIndex === targetDirIndex);
        engine._pendingDirection = null; // Consume the input
        if (target) {
          this.heading = engine._pendingDirection || this.heading;
          return target;
        }
        // If direction not available, stay in place
        return null;
      }
      
      // AI manual (perfect path): always take shortest path like Path of Truth
      if (this.algorithm === 'aiManual') {
        const dist = engine?.distanceToGoal;
        if (dist) {
          let best = null;
          let bestD = Infinity;
          for (const di of [0, 1, 2, 3]) {
            const n = open.find(o => o.dirIndex === di) || null;
            if (!n) continue;
            const d = dist[this.maze.index(n.x, n.y)];
            if (!Number.isFinite(d)) continue;
            if (d < bestD) {
              bestD = d;
              best = n;
            }
          }
          if (best) {
            const headings = ['N', 'E', 'S', 'W'];
            this.heading = headings[best.dirIndex];
            return best;
          }
        }
      }

      // Path of Truth: temporarily follow the deterministic shortest path to the goal.
      {
        const t = nowMs();
        if (t < this.truthUntilMs) {
          const dist = engine?.distanceToGoal;
          if (dist) {
            let best = null;
            let bestD = Infinity;

            // Deterministic tie-breaker: N, E, S, W.
            for (const di of [0, 1, 2, 3]) {
              const n = open.find(o => o.dirIndex === di) || null;
              if (!n) continue;
              const d = dist[this.maze.index(n.x, n.y)];
              if (!Number.isFinite(d)) continue;
              if (d < bestD) {
                bestD = d;
                best = n;
              }
            }

            if (best) return best;
          }
        }
      }

      // Wanderer: random walk with preference for unvisited
      if (this.algorithm === 'wanderer') {
        const unvisited = open.filter((n) => !this.visited.has(this._cellKey(n.x, n.y)));
        let pool = unvisited.length ? unvisited : open;
        
        // If we have zapped memory attraction, bias towards that direction
        if (zappedAttraction && engine.rng() < 0.6) {
          const sorted = pool.slice().sort((a, b) => {
            const da = Math.abs(a.x - zappedAttraction.x) + Math.abs(a.y - zappedAttraction.y);
            const db = Math.abs(b.x - zappedAttraction.x) + Math.abs(b.y - zappedAttraction.y);
            return da - db;
          });
          return sorted[0];
        }
        
        return pool[Math.floor(engine.rng() * pool.length)];
      }

      // Sniffer: greedy with smart loop escape
      if (this.algorithm === 'sniffer') {
        const gx = this.maze.goal.x;
        const gy = this.maze.goal.y;

        // Count visits to each neighbor
        const visitCounts = new Map();
        for (const k of this._recentKeys) {
          visitCounts.set(k, (visitCounts.get(k) || 0) + 1);
        }

        const candidates = open.map(n => {
          const key = this._cellKey(n.x, n.y);
          const h = Math.abs(n.x - gx) + Math.abs(n.y - gy);
          const visited = this.visited.has(key);
          const recentVisits = visitCounts.get(key) || 0;
          
          // Heavy penalty for recently visited cells (loop detection)
          const recentPenalty = recentVisits * 15;
          // Lighter penalty for any visited cell
          const visitedPenalty = visited ? 8 : 0;
          // Randomness to break symmetry
          const noise = engine.rng() * 2;
          
          // Zapped memory attraction - pull towards remembered blocked route
          let zappedBonus = 0;
          if (zappedAttraction) {
            const distToZapped = Math.abs(n.x - zappedAttraction.x) + Math.abs(n.y - zappedAttraction.y);
            zappedBonus = -distToZapped * 3; // Strong pull towards remembered location
          }
          
          return { node: n, score: h + visitedPenalty + recentPenalty + noise + zappedBonus };
        });

        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].node;
      }

      // Wise but Fragile: knows goal direction but slow & can make wrong turns
      if (this.algorithm === 'wiseFragile') {
        const dist = engine.distanceToGoal;
        if (!dist) return open[0];

        // Sort by distance to goal (best first)
        const sorted = open.map(n => {
          const d = dist[this.maze.index(n.x, n.y)];
          return { node: n, dist: d };
        }).sort((a, b) => a.dist - b.dist);

        // If there are 2+ options, only 5% chance to pick a wrong one (reduced from 15%)
        if (sorted.length >= 2 && engine.rng() < 0.05) {
          // Pick the worse option (not the best)
          const wrongIndex = 1 + Math.floor(engine.rng() * (sorted.length - 1));
          return sorted[Math.min(wrongIndex, sorted.length - 1)].node;
        }

        return sorted[0].node;
      }

      // Tremaux: mark passages, prefer unmarked/less marked
      if (this.algorithm === 'tremaux') {
        // Initialize passage marks if needed
        if (!this._passageMarks) this._passageMarks = new Map();
        const hiveMult = 1 + this.hiveMindBoost;
        
        const candidates = open.map(n => {
          const key = this._cellKey(n.x, n.y);
          const marks = this._passageMarks.get(key) || 0;
          const gx = this.maze.goal.x;
          const gy = this.maze.goal.y;
          const h = Math.abs(n.x - gx) + Math.abs(n.y - gy);
          const deadEndPenalty = this._sharedDeadEnds.has(key) ? 50 * hiveMult : 0;
          
          // Zapped memory attraction - pull towards remembered blocked route
          let zappedBonus = 0;
          if (zappedAttraction) {
            const distToZapped = Math.abs(n.x - zappedAttraction.x) + Math.abs(n.y - zappedAttraction.y);
            zappedBonus = -distToZapped * 5; // Strong pull towards remembered location
          }
          
          // Prefer unmarked passages, use distance as tiebreaker
          return { node: n, key, score: marks * 100 * hiveMult + h + deadEndPenalty + zappedBonus + engine.rng() * 0.5 };
        });

        candidates.sort((a, b) => a.score - b.score);
        const chosen = candidates[0];
        
        // Mark the passage we're taking
        this._passageMarks.set(chosen.key, (this._passageMarks.get(chosen.key) || 0) + 1);
        
        return chosen.node;
      }

      // Explorer: systematic exploration, tries to cover new ground
      if (this.algorithm === 'explorer') {
        const gx = this.maze.goal.x;
        const gy = this.maze.goal.y;
        const hiveMult = 1 + this.hiveMindBoost;
        
        // Filter out known dead ends when Hive Mind is active
        const notDeadEnd = open.filter(n => !this._sharedDeadEnds.has(this._cellKey(n.x, n.y)));
        const searchPool = notDeadEnd.length > 0 ? notDeadEnd : open;
        
        // Strongly prefer unvisited cells
        const unvisited = searchPool.filter(n => !this.visited.has(this._cellKey(n.x, n.y)));
        
        if (unvisited.length > 0) {
          // Among unvisited, prefer those closer to goal (or zapped memory if active)
          unvisited.sort((a, b) => {
            let da = Math.abs(a.x - gx) + Math.abs(a.y - gy);
            let db = Math.abs(b.x - gx) + Math.abs(b.y - gy);
            
            // Zapped memory attraction overrides goal direction
            if (zappedAttraction) {
              da = Math.abs(a.x - zappedAttraction.x) + Math.abs(a.y - zappedAttraction.y);
              db = Math.abs(b.x - zappedAttraction.x) + Math.abs(b.y - zappedAttraction.y);
            }
            
            return da - db + (engine.rng() - 0.5);
          });
          return unvisited[0];
        }
        
        // All visited - backtrack towards goal, avoid dead ends
        const candidates = searchPool.map(n => {
          const key = this._cellKey(n.x, n.y);
          const h = Math.abs(n.x - gx) + Math.abs(n.y - gy);
          const recentCount = this._recentKeys.filter(k => k === key).length;
          const deadEndPenalty = this._sharedDeadEnds.has(key) ? 30 * hiveMult : 0;
          
          // Zapped memory attraction
          let zappedBonus = 0;
          if (zappedAttraction) {
            const distToZapped = Math.abs(n.x - zappedAttraction.x) + Math.abs(n.y - zappedAttraction.y);
            zappedBonus = -distToZapped * 4;
          }
          
          return { node: n, score: h + recentCount * 5 * hiveMult + deadEndPenalty + zappedBonus + engine.rng() };
        });
        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].node;
      }

      // Wallhugger: classic wall-following (with zapped memory influence)
      const order = this.hand === 'right' ? [1, 0, -1, 2] : [-1, 0, 1, 2];
      const curDir = DIR_INDEX[this.heading] ?? 0;

      // If zapped memory is active, occasionally override wall-following to head back
      if (zappedAttraction && engine.rng() < 0.5) {
        const sorted = open.slice().sort((a, b) => {
          const da = Math.abs(a.x - zappedAttraction.x) + Math.abs(a.y - zappedAttraction.y);
          const db = Math.abs(b.x - zappedAttraction.x) + Math.abs(b.y - zappedAttraction.y);
          return da - db;
        });
        if (sorted.length > 0) {
          const headings = ['N', 'E', 'S', 'W'];
          this.heading = headings[sorted[0].dirIndex];
          return sorted[0];
        }
      }

      const tryDirs = order
        .map((delta) => (curDir + delta + 4) % 4)
        .map((di) => ({ di, opt: open.find((n) => n.dirIndex === di) }))
        .filter((x) => x.opt);

      if (tryDirs.length) {
        const chosen = tryDirs[0];
        this.heading = DIRS[chosen.di].name;
        return chosen.opt;
      }

      return open[Math.floor(engine.rng() * open.length)];
    }

    update(dt, engine) {
      if (!this.isActive()) return;

      // Decay zapped effect over time
      if (this._zappedEffect > 0) {
        this._zappedEffect = Math.max(0, this._zappedEffect - dt * 2);
      }

      // Freeze effect pauses movement/decisions.
      if (engine?.isTeamFrozen?.(this.team)) return;
      
      // Decay hiveMindBoost over time (lasts ~10 seconds)
      if (this.hiveMindBoost > 0) {
        this.hiveMindBoost = Math.max(0, this.hiveMindBoost - dt * 0.5);
      }
      
      // Handle crazy mouse animation
      if (this.isCrazy) {
        this.crazyAnimationTime += dt;
        this.crazyRotation += dt * 15; // Fast spinning
        
        // After 1.5 seconds, explode the mouse
        if (this.crazyAnimationTime >= 1.5) {
          this.destroyed = true;
          engine.onMouseGoneCrazy(this);
        }
        return;
      }

      // If moving, advance.
      if (this.nextCell) {
        let mult = nowMs() < this.tempSpeedBoostUntilMs ? this.tempSpeedMult : 1;
        
        // Apply sickness slowdown
        const currentTime = nowMs();
        if (this.isSick && currentTime < this.sickUntilMs) {
          mult *= this.sickSpeedReduction;
          this.sickSwayPhase += dt * 8; // For visual wobble
          
          // Add poop trail periodically
          if (!this._lastPoopTime || currentTime - this._lastPoopTime > 800) {
            this._lastPoopTime = currentTime;
            if (this.poopTrail && this.poopTrail.length < 15) {
              this.poopTrail.push({ x: this.px, y: this.py, t: currentTime });
            }
          }
        } else if (this.isSick && currentTime >= this.sickUntilMs) {
          // Sickness wore off
          this.isSick = false;
          this.sickSpeedReduction = 1;
        }
        
        this.progress += dt * this.speed * mult;
        if (this.progress >= 1) {
          // Track ping-pong detection (same two cells back and forth)
          const currentKey = this._cellKey(this.cell.x, this.cell.y);
          const nextCellKey = this._cellKey(this.nextCell.x, this.nextCell.y);
          
          if (this._lastTwoCells.length >= 2) {
            const [cell1, cell2] = this._lastTwoCells.slice(-2);
            // Check if ping-ponging between same two cells
            if ((cell1 === currentKey && cell2 === nextCellKey) || 
                (cell1 === nextCellKey && cell2 === currentKey)) {
              this._pingPongCount++;
            } else {
              this._pingPongCount = 0;
            }
          }
          this._lastTwoCells.push(currentKey);
          if (this._lastTwoCells.length > 4) this._lastTwoCells.shift();
          
          // If ping-ponging 20+ times, go crazy!
          if (this._pingPongCount >= 20) {
            this.goCrazy();
            return;
          }
          
          this.cell = { x: this.nextCell.x, y: this.nextCell.y };
          this.nextCell = null;
          this.progress = 0;
          this.distanceTravelled++;

          const key = this._cellKey(this.cell.x, this.cell.y);
          this.path.push({ x: this.cell.x, y: this.cell.y });
          this.visited.add(key);

          this._recentKeys.push(key);
          if (this._recentKeys.length > 40) this._recentKeys.shift();

          engine.onMouseEnteredCell(this);

          if (this.cell.x === this.maze.goal.x && this.cell.y === this.maze.goal.y) {
            this.reachedGoal = true;
            engine.onMouseReachedGoal(this);
          }
        }
        return;
      }

      const chosen = this._chooseNext(engine);
      if (!chosen) {
        // Mouse is trapped (all directions blocked by walls or laser fence)
        // Play zap effect if laser fence is causing it
        const tNow = nowMs();
        const allNeighbors = this.maze.neighborsOpen(this.cell.x, this.cell.y);
        const hasLaserBlock = allNeighbors.some(n => 
          engine?._isCellBlockedByLaserFence?.(this.cell.x, this.cell.y, n.x, n.y)
        );
        if (hasLaserBlock && tNow - this._lastZappedAt >= 1000) {
          engine?.audio?.playSound('electric_zap');
          engine?._spawnFloatingText?.(this.cell.x, this.cell.y, '⚡TRAPPED!', '#ffff00');
          this._lastZappedAt = tNow;
          this._zappedEffect = 1.0;
        }
        return;
      }

      // Update heading based on movement direction
      const dx = chosen.x - this.cell.x;
      const dy = chosen.y - this.cell.y;
      if (dx > 0) this.heading = 'E';
      else if (dx < 0) this.heading = 'W';
      else if (dy > 0) this.heading = 'S';
      else if (dy < 0) this.heading = 'N';

      // Basic stuck heuristic for AI-hard: repeating too much.
      const nextKey = this._cellKey(chosen.x, chosen.y);
      const repeats = this._recentKeys.filter((k) => k === nextKey).length;
      this._stuckCounter = repeats >= 6 ? this._stuckCounter + 1 : Math.max(0, this._stuckCounter - 1);

      this.nextCell = { x: chosen.x, y: chosen.y };
      this.progress = 0;

      engine.addTrailSegment(this, this.cell, this.nextCell);
    }

    applyTempSpeedBoost(mult, durationMs) {
      const t = nowMs();
      this.tempSpeedMult = Math.max(this.tempSpeedMult, mult);
      const nextUntil = Math.max(this.tempSpeedBoostUntilMs, t + durationMs);
      this.tempSpeedBoostUntilMs = nextUntil;
      this.tempSpeedBoostStartedAtMs = t;
      this.tempSpeedBoostDurationMs = Math.max(0, nextUntil - t);
    }

    isLikelyLooping() {
      return this._stuckCounter >= 10;
    }

    applyDataLink(visitedUnion, deadEnds = null, recentPaths = null) {
      // Merge visited cells
      for (const key of visitedUnion) {
        this.visited.add(key);
      }
      
      // Share dead ends knowledge
      if (deadEnds) {
        for (const key of deadEnds) {
          this._sharedDeadEnds.add(key);
        }
      }
      
      // Share recent path info to avoid redundant exploration
      if (recentPaths) {
        for (const key of recentPaths) {
          if (!this._recentKeys.includes(key)) {
            this._recentKeys.push(key);
          }
        }
        // Keep recent keys reasonable
        while (this._recentKeys.length > 30) this._recentKeys.shift();
      }
      
      // Give temporary intelligence boost (decays over time)
      this.hiveMindBoost = 5.0;
    }

    boostSpeed(mult = 1.1) {
      if (this.speedBoostCount >= 2) return false;
      this.speed *= mult;
      this.speedBoostCount++;
      return true;
    }

    canBoostSpeed() {
      return this.speedBoostCount < 2;
    }

    destroy() {
      this.destroyed = true;
    }
    
    goCrazy() {
      this.isCrazy = true;
      this.crazyAnimationTime = 0;
    }
  }

  class CatAgent {
    constructor({ team, start, maze, baseSpeed, algorithm = 'sniffer' }) {
      this.team = team;
      this.maze = maze;
      this.cell = { x: start.x, y: start.y };
      this.nextCell = null;
      this.progress = 0;
      this.speed = baseSpeed;
      this.destroyed = false;
      this.spawnedAt = nowMs();

      // Cats use only explorer or tremaux (cartographer), NOT sniffer which can get stuck
      const validAlgos = ['explorer', 'tremaux'];
      this.algorithm = validAlgos.includes(algorithm) ? algorithm : 'explorer';
      this.visited = new Set();
      this.lastCell = null;
      this._recentCells = []; // Track recent cells to avoid ping-ponging
      this.heading = 'E';
      this.facingAngle = 0;
      this.visited.add(this._cellKey(this.cell.x, this.cell.y));

      // Hunger / sleepiness
      this.kills = 0;
      this.fullAtMs = 0;
      this.sleepy = false;
      
      // Sickness (from decoy cheese)
      this.isSick = false;
      this.sickUntilMs = 0;
      this.sickSpeedReduction = 1;
      
      // Lifetime tracking
      this.spawnedAtSec = 0; // Set by engine when spawned
    }

    isActive() {
      return !this.destroyed;
    }

    _cellKey(x, y) {
      return `${x},${y}`;
    }

    _setHeadingFrom(dx, dy) {
      if (dx > 0) {
        this.heading = 'E';
        this.facingAngle = 0;
      } else if (dx < 0) {
        this.heading = 'W';
        this.facingAngle = Math.PI;
      } else if (dy > 0) {
        this.heading = 'S';
        this.facingAngle = Math.PI / 2;
      } else if (dy < 0) {
        this.heading = 'N';
        this.facingAngle = -Math.PI / 2;
      }
    }

    positionLerp() {
      if (!this.nextCell) return { x: this.cell.x, y: this.cell.y };
      return {
        x: this.cell.x + (this.nextCell.x - this.cell.x) * this.progress,
        y: this.cell.y + (this.nextCell.y - this.cell.y) * this.progress,
      };
    }

    update(dt, engine) {
      if (!this.isActive()) return;
      if (!engine?.roundActive) return;

      // After the 2nd kill, start a 10s timer; when it expires, slow to 50% speed.
      if (this.fullAtMs > 0 && !this.sleepy) {
        const tNow = nowMs();
        if (tNow - this.fullAtMs >= 10000) {
          this.sleepy = true;
        }
      }

      if (this.nextCell) {
        let speedMult = this.sleepy ? 0.5 : 1;
        // Apply sickness speed reduction
        if (this.isSick && nowMs() < this.sickUntilMs) {
          speedMult *= this.sickSpeedReduction;
        } else if (this.isSick) {
          this.isSick = false;
          this.sickSpeedReduction = 1;
        }
        this.progress += dt * this.speed * speedMult;
        if (this.progress >= 1) {
          this.cell = { x: this.nextCell.x, y: this.nextCell.y };
          this.nextCell = null;
          this.progress = 0;
          this.visited.add(this._cellKey(this.cell.x, this.cell.y));
          
          // Track recent cells for anti-stuck behavior
          this._recentCells.push(this._cellKey(this.cell.x, this.cell.y));
          if (this._recentCells.length > 8) this._recentCells.shift();
          
          engine.onCatEnteredCell(this);
        }
        return;
      }

      let open = this.maze.neighborsOpen(this.cell.x, this.cell.y);
      if (!open.length) return;
      
      // Filter out directions blocked by laser fences
      if (engine?._isCellBlockedByLaserFence) {
        open = open.filter(n => !engine._isCellBlockedByLaserFence(this.cell.x, this.cell.y, n.x, n.y));
        if (!open.length) return; // Cat is trapped by laser fence
      }

      const target = this.team === TEAM_USER
        ? (engine?._lastSeenAiCell || null)
        : (engine?._lastSeenUserCellForAi || null);
      
      // If target team is frozen, cat loses scent and wanders randomly
      const targetTeamFrozen = this.team === TEAM_USER 
        ? engine?.isTeamFrozen?.(TEAM_AI)
        : engine?.isTeamFrozen?.(TEAM_USER);
      const effectiveTarget = targetTeamFrozen ? null : target;
      
      const curDist = effectiveTarget
        ? Math.abs(this.cell.x - effectiveTarget.x) + Math.abs(this.cell.y - effectiveTarget.y)
        : null;

      // Count recent visits to detect stuck behavior
      const recentVisitCounts = new Map();
      for (const key of this._recentCells) {
        recentVisitCounts.set(key, (recentVisitCounts.get(key) || 0) + 1);
      }

      let best = null;
      let bestScore = -Infinity;

      for (const n of open) {
        const key = this._cellKey(n.x, n.y);
        const isBacktrack = this.lastCell && n.x === this.lastCell.x && n.y === this.lastCell.y;
        const recentCount = recentVisitCounts.get(key) || 0;
        let score = engine.rng() * 0.08;

        // Explorer behavior: strongly prefer unvisited cells
        if (this.algorithm === 'explorer') {
          score += this.visited.has(key) ? -0.3 : 0.7;
        }
        
        // Tremaux/Cartographer behavior: count passage marks
        if (this.algorithm === 'tremaux') {
          score += this.visited.has(key) ? -0.2 : 0.5;
        }
        
        // Heavy penalty for recently visited cells (anti-stuck)
        score -= recentCount * 0.5;

        // Scent pull: prefer steps that reduce distance to last seen enemy.
        if (effectiveTarget) {
          const nd = Math.abs(n.x - effectiveTarget.x) + Math.abs(n.y - effectiveTarget.y);
          score += (curDist - nd) * 0.6;
          score += -nd * 0.05;
        }

        // Strong penalty for backtracking
        if (isBacktrack && open.length > 1) score -= 0.8;

        // Slight bias to avoid decoy cheese (cats dislike cheese smell)
        if (engine?._decoys) {
          for (const d of engine._decoys) {
            if (d.active && d.x === n.x && d.y === n.y) {
              score -= 0.4; // Cats try to avoid cheese, but can still be lured
            }
          }
        }

        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      }

      const chosen = best || open[Math.floor(engine.rng() * open.length)];
      
      this.lastCell = { x: this.cell.x, y: this.cell.y };
      this.nextCell = { x: chosen.x, y: chosen.y };
      this.progress = 0;
      this._setHeadingFrom(this.nextCell.x - this.cell.x, this.nextCell.y - this.cell.y);
    }
  }

  class ComputerAI {
    constructor(engine) {
      this.engine = engine;
      this.difficulty = 'medium';
      this._nextDeployAt = 0;
      this._nextCatTryAt = 0;
      this._nextDecoyTryAt = 0;
      this._nextWallBlastTryAt = 0;
      this._lastUpdateTime = 0;
    }

    setDifficulty(level) {
      this.difficulty = level;
      this._nextDeployAt = 0;
      this._nextCatTryAt = 0;
      this._nextDecoyTryAt = 0;
      this._nextWallBlastTryAt = 0;
      this._lastUpdateTime = 0;
    }

    update() {
      const e = this.engine;
      if (!e.roundActive) return;

      // Calculate elapsed time (time counts down from roundDuration)
      const elapsed = e.roundDuration - e.timeRemaining;

      // Count active AI mice
      const activeAiMice = e.mice.filter(m => m.team === TEAM_AI && m.isActive()).length;

      // AI can deploy a cat too (same unlock/cost as the user).
      {
        const hasAiCat = e.aiCat && e.aiCat.isActive();
        const canCat = !hasAiCat && elapsed >= e.catUnlockAt && e.aiScore >= e.catCost;
        if (canCat && elapsed >= this._nextCatTryAt) {
          const p = this.difficulty === 'easy' ? 0.35 : this.difficulty === 'medium' ? 0.55 : 0.85;
          if (e.rng() < p) {
            e.tryDeployCat(TEAM_AI, { silent: false });
          }
          this._nextCatTryAt = elapsed + 3.5 + e.rng() * 6.0;
        }
      }
      
      // All algorithms available to AI
      const allAlgos = ['wanderer', 'wallhugger', 'sniffer', 'tremaux', 'explorer'];
      
      // Distance map for ability decisions
      const dist = e.distanceToGoal;

      // Check if can deploy (respects cooldown and max active mice)
      const canDeploy = activeAiMice < e.maxMicePerRound && elapsed >= this._nextDeployAt;

      if (this.difficulty === 'easy') {
        if (canDeploy) {
          // Easy: picks random algorithms (including weak ones), much slower deployment
          // Weighted toward weaker algorithms
          const weightedAlgos = ['wanderer', 'wanderer', 'wallhugger', 'wallhugger', 'sniffer'];
          const algo = weightedAlgos[Math.floor(e.rng() * weightedAlgos.length)];
          if (e.deployAI(algo)) {
            // Slower deployment with high variance
            this._nextDeployAt = elapsed + e.getDeployCooldown(TEAM_AI) + 2 + e.rng() * 4;
          }
        }
        // Easy AI does NOT use any abilities (no speed boost, no sabotage, no destroy)
        return;
      }

      if (this.difficulty === 'medium') {
        if (canDeploy) {
          // Medium: prefers better algorithms but sometimes picks random
          const preferredAlgos = ['sniffer', 'explorer', 'tremaux', 'explorer'];
          const algo = preferredAlgos[Math.floor(e.rng() * preferredAlgos.length)];
          if (e.deployAI(algo)) {
            this._nextDeployAt = elapsed + e.getDeployCooldown(TEAM_AI) + e.rng() * 1.5;
          }
        }
        
        // Medium: occasionally uses decoy cheese (30% chance when available)
        if (elapsed >= this._nextDecoyTryAt && e._aiDecoyCooldown <= 0 && e.aiScore >= e.decoyCheeseCost) {
          if (e.rng() < 0.30) {
            e.tryAIDecoyCheese();
          }
          this._nextDecoyTryAt = elapsed + 20 + e.rng() * 15;
        }
        
        // Medium: moderate speed boost usage
        for (const m of e.mice) {
          if (m.team !== TEAM_AI || !m.isActive()) continue;
          const d = dist[e.maze.index(m.cell.x, m.cell.y)];
          if (Number.isFinite(d) && d <= 8 && m.canBoostSpeed?.() && e.aiScore >= e.speedBoostCost) {
            if (e.rng() < 0.6) e.trySpeedBoost(m);
          }
        }
        return;
      }

      // hard - Full AI with all abilities
      
      if (canDeploy) {
        // Hard: uses optimal algorithms, fast deployment
        const optimalAlgos = ['tremaux', 'tremaux', 'explorer', 'sniffer'];
        const algo = optimalAlgos[Math.floor(e.rng() * optimalAlgos.length)];
        if (e.deployAI(algo)) {
          // Faster deployment
          this._nextDeployAt = elapsed + e.getDeployCooldown(TEAM_AI) * 0.9;
        }
      }

      // Hard: Aggressively uses decoy cheese (60% chance when available)
      if (elapsed >= this._nextDecoyTryAt && e._aiDecoyCooldown <= 0 && e.aiScore >= e.decoyCheeseCost) {
        if (e.rng() < 0.60) {
          e.tryAIDecoyCheese();
        }
        this._nextDecoyTryAt = elapsed + 12 + e.rng() * 10;
      }
      
      // Hard: Uses wall blast strategically to help its mice OR destroy enemy decoys
      if (elapsed >= this._nextWallBlastTryAt && e._aiWallBlastCooldown <= 0 && e.aiScore >= e.wallBlastCost) {
        let blasted = false;
        
        // First check if there's an enemy decoy (user's decoy) to destroy
        const enemyDecoys = e._decoys?.filter(d => d.active && d.team === TEAM_USER) || [];
        if (enemyDecoys.length > 0 && e.rng() < 0.65) {
          // Target a random enemy decoy
          const targetDecoy = enemyDecoys[Math.floor(e.rng() * enemyDecoys.length)];
          e.tryAIWallBlast(targetDecoy.x, targetDecoy.y);
          blasted = true;
        }
        
        // Otherwise, help stuck mice
        if (!blasted) {
          const stuckMice = e.mice.filter(m => m.team === TEAM_AI && m.isActive() && m.isLikelyLooping?.());
          if (stuckMice.length > 0 && e.rng() < 0.50) {
            const targetMouse = stuckMice[Math.floor(e.rng() * stuckMice.length)];
            e.tryAIWallBlast(targetMouse.cell.x, targetMouse.cell.y);
          }
        }
        this._nextWallBlastTryAt = elapsed + 18 + e.rng() * 12;
      }

      // Boost mice close to center aggressively
      for (const m of e.mice) {
        if (m.team !== TEAM_AI || !m.isActive()) continue;
        const d = dist[e.maze.index(m.cell.x, m.cell.y)];
        if (Number.isFinite(d) && d <= 7 && m.canBoostSpeed?.() && e.aiScore >= e.speedBoostCost) {
          e.trySpeedBoost(m);
        }
      }

      // Destroy mice stuck in loops more aggressively
      for (const m of e.mice) {
        if (m.team !== TEAM_AI || !m.isActive()) continue;
        if (m.isLikelyLooping()) {
          e.destroyMouse(m);
        }
      }
    }
  }

  class GameEngine {
    constructor() {
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d', { alpha: false });

      this._fx = {
        fogCanvas: document.createElement('canvas'),
        fogCtx: null,
        fogMaskCanvas: document.createElement('canvas'),
        fogMaskCtx: null,
      };
      this._fx.fogCtx = this._fx.fogCanvas.getContext('2d');
      this._fx.fogMaskCtx = this._fx.fogMaskCanvas.getContext('2d');

      // UI Elements
      this.difficultyScreen = document.getElementById('difficultyScreen');
      this.gameScreen = document.getElementById('gameScreen');
      this.hudRound = document.getElementById('hudRound');
      this.hudTime = document.getElementById('hudTime');
      this.hudUserScore = document.getElementById('hudUserScore');
      this.hudAiScore = document.getElementById('hudAiScore');
      this.hudUserMice = document.getElementById('hudUserMice');
      this.hudAiMice = document.getElementById('hudAiMice');
      this.hudUserTotal = document.getElementById('hudUserTotal');
      this.hudAiTotal = document.getElementById('hudAiTotal');
      this.deployMeta = document.getElementById('deployMeta');
      this.message = document.getElementById('message');
      this.abilitiesCard = document.getElementById('abilitiesCard');

      this.algoSelect = document.getElementById('algoSelect');
      this.deployBtn = document.getElementById('deployBtn');
      this.speedBoostBtn = document.getElementById('speedBoostBtn');
      // Hive Mind removed
      this.doubleDownBtn = document.getElementById('doubleDownBtn');
      this.catDeployBtn = document.getElementById('catDeployBtn');
      this.destroyBtn = document.getElementById('destroyBtn');
      this.toggleHeatmapBtn = document.getElementById('toggleHeatmapBtn');
      this.toggleZoomBtn = document.getElementById('toggleZoomBtn');
      this.wallBlastBtn = document.getElementById('wallBlastBtn');
      this.decoyCheeseBtn = document.getElementById('decoyCheeseBtn');
      this.laserFenceBtn = document.getElementById('laserFenceBtn');
      this.manualMouseBtn = document.getElementById('manualMouseBtn');

      this.mouseListEl = document.getElementById('mouseList');
      this.aiMouseListEl = document.getElementById('aiMouseList');

      // Cache key to avoid re-rendering the mouse list every frame.
      this._mouseListKey = '';
      this._aiMouseListKey = '';

      this.overlay = document.getElementById('overlay');
      this.overlayTitle = document.getElementById('overlayTitle');
      this.overlayText = document.getElementById('overlayText');
      this.overlayBtn = document.getElementById('overlayBtn');

      this.roundOverlay = document.getElementById('roundOverlay');
      this.roundOverlayTitle = document.getElementById('roundOverlayTitle');
      this.roundOverlayText = document.getElementById('roundOverlayText');
      this.roundOverlayBtn = document.getElementById('roundOverlayBtn');
      this.countdownEl = document.getElementById('countdown');
      
      // New UI elements
      this._timerProgress = document.getElementById('timerProgress');
      this._deployReminderEl = document.getElementById('deployReminder');
      this._decoyGuideEl = document.getElementById('decoyGuide');
      this._betOverlay = document.getElementById('betOverlay');
      this._betCancelBtn = document.getElementById('betCancelBtn');

      this.audio = new AudioBus();

      this.maxRounds = 3;
      this.maxMicePerRound = 6;
      this.roundStartScore = 1000;
      this.timeDecayPerSecond = 1;
      this.victoryReward = 300;
      this.userDeployCooldown = 5; // user: 5s between deployments
      this.aiDeployCooldownByDifficulty = { easy: 6.5, medium: 6, hard: 5 };
      // Speed Boost: more expensive, max 2 per mouse (applies to user + AI)
      this.speedBoostCost = 35;
      this.maxSpeedBoosts = 2;
      // Hive Mind removed
      this.roundDuration = 180; // 3:00 countdown

      // Cat deploy
      this.catCost = 120;
      this.catUnlockAt = 35;
      this.catMaxLifetime = 70; // 70 seconds max lifetime
      this.userCat = null;
      this.aiCat = null;

      // === NEW ENGAGEMENT FEATURES ===
      // Live Commentary
      this._lastCommentaryAt = 0;
      this._commentaryCooldown = 2.5; // seconds between comments
      this._commentaryQueue = [];

      // Betting / Double Down
      this._bets = []; // { mouseId, amount, team }
      this.doubleDownCost = 50;

      // Active Sabotage Abilities
      this.wallBlastCost = 50;
      this.decoyCheeseCost = 30;
      this._decoys = []; // { id, x, y, team, spawnedAt, duration, active }
      this._nextDecoyId = 1; // Unique ID for tracking infection chains
      this._wallBlastMode = false;
      this._decoyPlaceMode = false; // User placing decoy cheese
      this._hoveredDecoyCell = null; // For decoy placement preview
      this._wallBlastCooldown = 0; // seconds remaining (user)
      this._wallBlastCooldownDuration = 15; // 15 second cooldown
      this._decoyCooldown = 0; // seconds remaining (user)
      this._decoyCooldownDuration = 30; // 30 second cooldown
      this._hoveredWallCell = null; // For wall blast preview
      
      // Decoy cheese sickness
      this._decoySicknessSpeed = 0.65; // 35% slower (was 0.8, now 15% more reduction)
      this._decoySicknessDuration = 10000; // 10 seconds
      
      // Laser Fence
      this._laserFences = []; // { x, y, team, spawnedAt, duration, active }
      this._laserFenceCost = 100;
      this._laserFenceCooldown = 0;
      this._laserFenceCooldownDuration = 60; // 60 second cooldown
      this._laserFenceDuration = 10000; // 10 seconds active
      this._laserFenceSize = 5; // 5x5 grid
      this._laserFencePlaceMode = false;
      this._hoveredLaserFenceCell = null;
      this._aiLaserFenceCooldown = 0;
      
      // Manual Mouse button state
      this._manualMouseQueued = false;
      
      // Deploy reminder
      this._deployReminderEl = null;
      this._showDeployReminder = false;
      this._roundStartTime = 0;
      
      // Bet modal
      this._betModalOpen = false;
      this._betTargetMouse = null;
      this._betOptions = {
        low: { cost: 25, reward: 60 },
        medium: { cost: 50, reward: 150 },
        high: { cost: 100, reward: 350 }
      };
      
      // AI Sabotage Cooldowns (separate from user)
      this._aiWallBlastCooldown = 0;
      this._aiDecoyCooldown = 0;

      // Desperation Mode (comeback mechanic)
      this._desperationMode = false;
      this._desperationThreshold = 150; // Score difference to trigger

      // Mini-objectives
      this._objectivesCompleted = { user: new Set(), ai: new Set() };
      this._explorationMilestone = 0.30; // 30%

      // Close-finish drama
      this._dramaMode = false;
      this._dramaShakeIntensity = 0;
      this._slowMotionFactor = 1;
      this._targetZoom = 1;
      this._currentZoom = 1;
      this._autoZoomEnabled = true;
      this._selectionZoomActive = false; // Zoom to selected mouse
      this._zoomCenter = null;
      this._targetZoomCenter = null; // Target for smooth camera pan
      
      // Manual controlled mouse (unlocks at 1:30 remaining)
      this._manualMouseUnlockTime = 90; // seconds into the round when manual mouse unlocks
      this._userManualMouse = null; // Reference to user's manual mouse
      this._aiManualMouse = null; // Reference to AI's manual (perfect path) mouse
      this._userManualDeployed = false; // Has user deployed manual mouse this round
      this._aiManualDeployed = false; // Has AI deployed manual mouse this round
      this._pendingDirection = null; // Pending direction input from user

      // Mouse personalities
      this._personalityTraits = ['brave', 'curious', 'lucky', 'normal', 'normal', 'normal'];

      // Status effect HUD timing (for progress bars)
      this._freezeStartedAtMsUser = 0;
      this._freezeDurationMsUser = 0;
      this._freezeStartedAtMsAi = 0;
      this._freezeDurationMsAi = 0;

      // "Last seen" positions (used for cat scent-bias)
      this._lastSeenUserCell = null;
      this._lastSeenAiCell = null;
      this._lastSeenUserAtMs = 0;
      this._lastSeenAiAtMs = 0;

      // Last seen USER mouse as seen by the AI team (used for AI cat scent-bias)
      this._lastSeenUserCellForAi = null;
      this._lastSeenUserAtMsForAi = 0;

      // Identity / list
      this._usedNames = new Set();

      // Algorithm costs (all mice cost the same now)
      this.algoCosts = {
        wanderer: 40,
        wallhugger: 40,
        sniffer: 40,
        explorer: 40,
        tremaux: 40,
        wiseFragile: 150,
      };
      
      // Track round scores for better end display
      this.roundScores = [];

      this.seedBase = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
      this.rng = mulberry32(this.seedBase);

      this.round = 1;
      this.userTotal = 0;
      this.aiTotal = 0;
      this.difficulty = 'medium';

      this.mice = [];
      this.userHeat = null;
      this.userExplored = null;
      this.aiExplored = null;
      this.trails = [];

      // Collision + explosion visuals
      this.blasts = [];

      // Cosmetic FX
      this.bloodStains = [];
      this.confetti = [];
      this.floatingTexts = []; // Floating text popups
      this.frostParticles = []; // Frost effect when a team is frozen
      this._finalVictory = false; // Track if user won final for continuous confetti

      // Pickups (spawn in symmetric pairs)
      this.pickupPairs = [];
      this.pickups = [];
      this._nextPickupPairId = 1;
      this.pickupRespawnDelayMs = 18000;
      this.pickupSpeedDurationMs = 5000;
      this.pickupSpeedMult = 1.65;
      this.pickupFreezeDurationMs = 4000; // Increased by 0.5 seconds
      this.pickupTruthDurationMs = 5000; // Extended to 5 seconds for better Path of Truth reveal
      this._distFromUserStart = null;
      this._distFromAiStart = null;
      this._freezeUntilMsUser = 0;
      this._freezeUntilMsAi = 0;
      this.showHeatmap = false;
      this.selectedMouseId = null;
      this._debugRevealMaze = false;

      this.timeRemaining = this.roundDuration;
      this.roundActive = false;
      this._decayAccumulator = 0;
      this._roundTransitionAt = 0;
      this._awaitingRoundAdvance = false;
      this._lastProgressMsgAt = -999;
      this._bestDistUser = Infinity;
      this._bestDistAI = Infinity;
      this._countdownValue = 3;
      this._countdownTimer = 0;
      this._isCountingDown = false;
      this._gameStarted = false;

      this.userScore = this.roundStartScore;
      this.aiScore = this.roundStartScore;
      this.userDeployed = 0;
      this.aiDeployed = 0;
      this.userLastDeployTime = -999; // Track last deploy time for cooldown
      this.aiLastDeployTime = -999;

      this.maze = null;
      this.distanceToGoal = null;

      this.ai = new ComputerAI(this);

      this._colors = {
        user: '#007AFF',
        ai: '#FF3B30',
        goal: '#FF9500',
        text: 'rgba(0,0,0,0.85)',
        wall: 'rgba(0,0,0,0.15)',
        wall2: 'rgba(0,0,0,0.20)',
      };

      this._bindUI();
      this._resizeObserver();

      this._lastT = nowMs();
      requestAnimationFrame(() => this._frame());
    }

    _ensureFxCanvases() {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const fog = this._fx?.fogCanvas;
      if (!fog) return;
      if (fog.width !== w) fog.width = w;
      if (fog.height !== h) fog.height = h;

      const mask = this._fx?.fogMaskCanvas;
      if (mask) {
        if (mask.width !== w) mask.width = w;
        if (mask.height !== h) mask.height = h;
      }
    }

    getDeployCooldown(team) {
      if (team === TEAM_USER) return this.userDeployCooldown;
      return this.aiDeployCooldownByDifficulty[this.difficulty] ?? 6;
    }

    _readCssColors() {
      try {
        const cs = getComputedStyle(document.documentElement);
        const user = cs.getPropertyValue('--user').trim();
        const ai = cs.getPropertyValue('--ai').trim();
        const goal = cs.getPropertyValue('--goal').trim();
        const text = cs.getPropertyValue('--text').trim();
        if (user) this._colors.user = user;
        if (ai) this._colors.ai = ai;
        if (goal) this._colors.goal = goal;
        if (text) this._colors.text = text;
      } catch {
        // ignore
      }
    }

    _bindUI() {
      this._readCssColors();

      // Loading UI elements
      this.loadingSection = document.getElementById('loadingSection');
      this.setupSection = document.getElementById('setupSection');
      this.loadingBarFill = document.getElementById('loadingBarFill');
      this.loadingPercent = document.getElementById('loadingPercent');
      this.startBtn = document.getElementById('startBtn');
      this.personalRecordValue = document.getElementById('personalRecordValue');
      this.recordOverlay = document.getElementById('recordOverlay');
      this.recordNameInput = document.getElementById('recordNameInput');
      this.recordSaveBtn = document.getElementById('recordSaveBtn');
      this.recordText = document.getElementById('recordText');
      
      // Selection state
      this._selectedDifficulty = null;
      this._selectedRounds = 3;
      
      // Load personal record from localStorage
      this._loadPersonalRecord();

      // Start loading assets
      this.audio.onLoadProgress = (loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        if (this.loadingBarFill) this.loadingBarFill.style.width = pct + '%';
        if (this.loadingPercent) this.loadingPercent.textContent = pct + '%';
      };
      
      this.audio.preloadAll().then(() => {
        // Hide loading, show setup
        if (this.loadingSection) this.loadingSection.style.display = 'none';
        if (this.setupSection) this.setupSection.style.display = 'block';
      });

      // Difficulty card selection (no longer starts game immediately)
      document.querySelectorAll('.difficulty-card').forEach(card => {
        card.addEventListener('click', () => {
          // Deselect all cards
          document.querySelectorAll('.difficulty-card').forEach(c => c.classList.remove('selected'));
          // Select this card
          card.classList.add('selected');
          this._selectedDifficulty = card.dataset.difficulty;
          this._updateStartButton();
        });
      });
      
      // Rounds selection
      document.querySelectorAll('input[name="rounds"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          this._selectedRounds = parseInt(e.target.value, 10);
          this._updateStartButton();
        });
      });
      
      // Start button
      if (this.startBtn) {
        this.startBtn.addEventListener('click', () => {
          if (!this._selectedDifficulty) return;
          
          this.difficulty = this._selectedDifficulty;
          this.maxRounds = this._selectedRounds;
          this.ai.setDifficulty(this.difficulty);
          
          // Start bg music NOW on button click
          this.audio.startBgMusic();
          
          this.difficultyScreen.classList.remove('active');
          this.gameScreen.classList.add('active');
          this._gameStarted = true;
          this._startRound(true);
        });
      }
      
      // Record save button
      if (this.recordSaveBtn) {
        this.recordSaveBtn.addEventListener('click', () => {
          const name = this.recordNameInput?.value?.trim() || 'Anonymous';
          this._savePersonalRecord(name);
          this.recordOverlay.style.display = 'none';
          this.overlay.style.display = '';
          this.overlay.classList.add('active');
        });
      }

      this.deployBtn.addEventListener('click', () => {
        this.deployUser(this.algoSelect.value);
      });

      this.speedBoostBtn.addEventListener('click', () => {
        const m = this.getSelectedMouse();
        if (!m) return;
        this.trySpeedBoost(m);
      });

      // Hive Mind removed

      // Double Down (betting) - now opens modal
      if (this.doubleDownBtn) {
        this.doubleDownBtn.addEventListener('click', () => {
          const m = this.getSelectedMouse();
          if (!m) {
            this.setMessage('Select a mouse to bet on!');
            this.audio.playSound('alert');
            return;
          }
          if (!m.isActive()) {
            this.setMessage('Cannot bet on inactive mouse!');
            this.audio.playSound('alert');
            return;
          }
          this._openBetModal(m);
        });
      }

      if (this.catDeployBtn) {
        this.catDeployBtn.addEventListener('click', () => {
          this.tryDeployCat();
        });
      }

      this.destroyBtn.addEventListener('click', () => {
        const m = this.getSelectedMouse();
        if (!m) return;
        this.destroyMouse(m);
      });

      this.toggleHeatmapBtn.addEventListener('click', () => {
        this.showHeatmap = !this.showHeatmap;
        this.setMessage(this.showHeatmap ? 'Heatmap: ON' : 'Heatmap: OFF');
      });

      // Auto-zoom toggle
      if (this.toggleZoomBtn) {
        this.toggleZoomBtn.addEventListener('click', () => {
          this._autoZoomEnabled = !this._autoZoomEnabled;
          this.toggleZoomBtn.textContent = this._autoZoomEnabled ? '🔍 Auto-Zoom: ON' : '🔍 Auto-Zoom: OFF';
          if (!this._autoZoomEnabled) {
            this._targetZoom = 1;
            this._zoomCenter = null;
          }
        });
      }

      // Wall Blast mode
      if (this.wallBlastBtn) {
        this.wallBlastBtn.addEventListener('click', () => {
          this._wallBlastMode = !this._wallBlastMode;
          this._decoyPlaceMode = false;
          this._laserFencePlaceMode = false;
          this.wallBlastBtn.classList.toggle('btn--active', this._wallBlastMode);
          if (this.decoyCheeseBtn) this.decoyCheeseBtn.classList.remove('btn--active');
          if (this.laserFenceBtn) this.laserFenceBtn.classList.remove('btn--active');
          if (this._decoyGuideEl) this._decoyGuideEl.classList.remove('active');
          this.setMessage(this._wallBlastMode ? '💣 Click maze to blast walls!' : 'Wall Blast cancelled.');
        });
      }

      // Decoy Cheese - click-to-place mode
      if (this.decoyCheeseBtn) {
        this.decoyCheeseBtn.addEventListener('click', () => {
          // Toggle decoy placement mode
          if (this._decoyCooldown > 0) {
            this.setMessage(`Decoy Cheese on cooldown: ${Math.ceil(this._decoyCooldown)}s`);
            this.audio.playSound('alert');
            return;
          }
          const effCost = this._desperationMode ? Math.floor(this.decoyCheeseCost * 0.5) : this.decoyCheeseCost;
          if (this.userScore < effCost) {
            this.setMessage('Not enough points for Decoy Cheese!');
            this.audio.playSound('alert');
            return;
          }
          this._decoyPlaceMode = !this._decoyPlaceMode;
          this._wallBlastMode = false;
          this._laserFencePlaceMode = false;
          this.decoyCheeseBtn.classList.toggle('btn--active', this._decoyPlaceMode);
          if (this.wallBlastBtn) this.wallBlastBtn.classList.remove('btn--active');
          if (this.laserFenceBtn) this.laserFenceBtn.classList.remove('btn--active');
          if (this._decoyGuideEl) this._decoyGuideEl.classList.toggle('active', this._decoyPlaceMode);
          this.setMessage(this._decoyPlaceMode ? '🧀 Click maze to place decoy cheese!' : 'Decoy placement cancelled.');
        });
      }
      
      // Laser Fence - click-to-place mode
      if (this.laserFenceBtn) {
        this.laserFenceBtn.addEventListener('click', () => {
          if (this._laserFenceCooldown > 0) {
            this.setMessage(`Laser Fence on cooldown: ${Math.ceil(this._laserFenceCooldown)}s`);
            this.audio.playSound('alert');
            return;
          }
          const effCost = this._desperationMode ? Math.floor(this._laserFenceCost * 0.5) : this._laserFenceCost;
          if (this.userScore < effCost) {
            this.setMessage('Not enough points for Laser Fence!');
            this.audio.playSound('alert');
            return;
          }
          this._laserFencePlaceMode = !this._laserFencePlaceMode;
          this._wallBlastMode = false;
          this._decoyPlaceMode = false;
          this.laserFenceBtn.classList.toggle('btn--active', this._laserFencePlaceMode);
          if (this.wallBlastBtn) this.wallBlastBtn.classList.remove('btn--active');
          if (this.decoyCheeseBtn) this.decoyCheeseBtn.classList.remove('btn--active');
          if (this._decoyGuideEl) this._decoyGuideEl.classList.remove('active');
          this.setMessage(this._laserFencePlaceMode ? '⚡ Click maze to deploy 5x5 laser fence!' : 'Laser Fence cancelled.');
        });
      }
      
      // Manual Mouse button - click to deploy a manually controlled mouse
      if (this.manualMouseBtn) {
        this.manualMouseBtn.addEventListener('click', () => {
          const remaining = this.timeRemaining;
          const unlockTime = 90; // Unlocks when 1:30 remaining (90 seconds)
          if (remaining > unlockTime) {
            const waitTime = Math.ceil(remaining - unlockTime);
            this.setMessage(`Manual Mouse unlocks in ${waitTime}s!`);
            this.audio.playSound('alert');
            return;
          }
          
          // Check if already deployed
          if (this._userManualDeployed) {
            this.setMessage('🎮 Manual mouse already deployed! Use WASD/Arrow keys.');
            this.audio.playSound('alert');
            return;
          }
          
          // Check max mice
          if (this.getActiveMiceCount(TEAM_USER) >= this.maxMicePerRound) {
            this.setMessage('Maximum mice deployed!');
            this.audio.playSound('alert');
            return;
          }
          
          // Deploy the manual mouse
          this._deployManualMouse(TEAM_USER);
          this.manualMouseBtn.classList.add('btn--active');
          this.setMessage('🎮 Manual mouse deployed! Use WASD or Arrow keys to control.');
        });
      }
      
      // Bet modal handlers
      if (this._betOverlay) {
        // Bet option buttons
        const betOptions = this._betOverlay.querySelectorAll('.bet-option');
        betOptions.forEach(btn => {
          btn.addEventListener('click', () => {
            const betLevel = btn.getAttribute('data-bet');
            this._placeBet(betLevel);
          });
        });
        
        // Cancel button
        if (this._betCancelBtn) {
          this._betCancelBtn.addEventListener('click', () => {
            this._closeBetModal();
          });
        }
        
        // Close on overlay click
        this._betOverlay.addEventListener('click', (e) => {
          if (e.target === this._betOverlay) {
            this._closeBetModal();
          }
        });
      }

      // Mouse list selection (event delegation). Use pointerdown so selection
      // works even if the list is re-rendered frequently.
      if (this.mouseListEl) {
        this.mouseListEl.addEventListener('pointerdown', (ev) => {
          const btn = ev.target?.closest?.('[data-mid]');
          if (!btn || !this.mouseListEl.contains(btn)) return;
          ev.preventDefault();
          ev.stopPropagation();
          const mid = btn.getAttribute('data-mid');
          if (mid) {
            this.selectedMouseId = mid;
            this._mouseListKey = ''; // Force refresh
          }
        });
      }

      this.overlayBtn.addEventListener('click', () => {
        this.overlay.classList.remove('active');
        // Show difficulty screen again
        this.round = 1;
        this.userTotal = 0;
        this.aiTotal = 0;
        this.roundScores = [];
        this._gameStarted = false;
        this.difficultyScreen.classList.add('active');
        this.gameScreen.classList.remove('active');
      });

      this.roundOverlayBtn.addEventListener('click', () => {
        this.roundOverlay.classList.remove('active');
        if (!this._awaitingRoundAdvance) return;
        this._awaitingRoundAdvance = false;
        this.round++;
        this._startRound(false);
      });
      
      // Keyboard controls for manual mouse
      document.addEventListener('keydown', (e) => {
        if (!this.roundActive || !this._userManualMouse || !this._userManualMouse.isActive()) return;
        
        let dir = null;
        switch (e.key) {
          case 'ArrowUp':
          case 'w':
          case 'W':
            dir = 'N';
            break;
          case 'ArrowDown':
          case 's':
          case 'S':
            dir = 'S';
            break;
          case 'ArrowLeft':
          case 'a':
          case 'A':
            dir = 'W';
            break;
          case 'ArrowRight':
          case 'd':
          case 'D':
            dir = 'E';
            break;
        }
        if (dir) {
          e.preventDefault();
          this._pendingDirection = dir;
        }
      });

      this.canvas.addEventListener('pointerdown', (ev) => {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((ev.clientX - rect.left) / rect.width) * this.canvas.width;
        const y = ((ev.clientY - rect.top) / rect.height) * this.canvas.height;
        this._handleCanvasClick(x, y);
      });

      // Mousemove for wall blast and decoy preview
      this.canvas.addEventListener('pointermove', (ev) => {
        const rect = this.canvas.getBoundingClientRect();
        const px = ((ev.clientX - rect.left) / rect.width) * this.canvas.width;
        const py = ((ev.clientY - rect.top) / rect.height) * this.canvas.height;
        const { cellSize, offsetX, offsetY } = this._layout();
        const cellX = Math.floor((px - offsetX) / cellSize);
        const cellY = Math.floor((py - offsetY) / cellSize);
        const validCell = this.maze && cellX >= 0 && cellX < this.maze.w && cellY >= 0 && cellY < this.maze.h;
        
        if (this._wallBlastMode && validCell) {
          this._hoveredWallCell = { x: cellX, y: cellY };
        } else {
          this._hoveredWallCell = null;
        }
        
        if (this._decoyPlaceMode && validCell) {
          this._hoveredDecoyCell = { x: cellX, y: cellY };
        } else {
          this._hoveredDecoyCell = null;
        }
        
        if (this._laserFencePlaceMode && validCell) {
          this._hoveredLaserFenceCell = { x: cellX, y: cellY };
        } else {
          this._hoveredLaserFenceCell = null;
        }
      });

      this.canvas.addEventListener('pointerleave', () => {
        this._hoveredWallCell = null;
        this._hoveredDecoyCell = null;
        this._hoveredLaserFenceCell = null;
      });
    }

    _resizeObserver() {
      const ro = new ResizeObserver(() => {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(320, Math.floor(rect.width * dpr));
        this.canvas.height = Math.max(320, Math.floor(rect.height * dpr));
      });
      ro.observe(this.canvas);
    }

    setMessage(text) {
      this.message.textContent = text || '';
    }

    revealEntireMaze() {
      if (!this.maze) return;
      if (this.userExplored) this.userExplored.fill(1);
      if (this.aiExplored) this.aiExplored.fill(1);
      this.setMessage('Debug: Revealed entire maze (fog disabled).');
    }

    getSelectedMouse() {
      if (this.selectedMouseId == null) return null;
      return this.mice.find((m) => m.id === this.selectedMouseId) || null;
    }

    _handleCanvasClick(px, py) {
      const { cellSize, offsetX, offsetY } = this._layout();

      // Calculate cell coordinates
      const cellX = Math.floor((px - offsetX) / cellSize);
      const cellY = Math.floor((py - offsetY) / cellSize);
      const validCell = this.maze && cellX >= 0 && cellX < this.maze.w && cellY >= 0 && cellY < this.maze.h;

      // Handle Wall Blast mode
      if (this._wallBlastMode && validCell) {
        this.tryWallBlast(cellX, cellY);
        this.wallBlastBtn?.classList.remove('btn--active');
        return;
      }
      
      // Handle Decoy placement mode
      if (this._decoyPlaceMode && validCell) {
        this._placeDecoyAtCell(cellX, cellY);
        return;
      }
      
      // Handle Laser Fence placement mode
      if (this._laserFencePlaceMode && validCell) {
        this._placeLaserFenceAtCell(cellX, cellY);
        return;
      }

      let best = null;
      let bestD2 = Infinity;
      // Much larger pick radius for easier clicking
      const pickRadius = Math.max(20, cellSize * 0.8);

      for (const m of this.mice) {
        if (!m.isActive() && !m.reachedGoal) continue;
        if (m.isCrazy) continue; // Can't select crazy mice
        const p = m.positionLerp();
        const mx = offsetX + (p.x + 0.5) * cellSize;
        const my = offsetY + (p.y + 0.5) * cellSize;
        const dx = px - mx;
        const dy = py - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2 && d2 <= pickRadius * pickRadius) {
          best = m;
          bestD2 = d2;
        }
      }

      if (best) {
        this.selectedMouseId = best.id;
      } else {
        this.selectedMouseId = null;
      }
    }

    _startRound(isFirst = false) {
      const dims = this._pickMazeDims();

      // Build a fair maze (regenerate if needed).
      for (let tries = 0; tries < 12; tries++) {
        this.maze = new Maze(dims.w, dims.h, this.rng);
        this.distanceToGoal = this.maze.computeDistanceMap(this.maze.goal.x, this.maze.goal.y);

        const du = this.distanceToGoal[this.maze.index(this.maze.userStart.x, this.maze.userStart.y)];
        const da = this.distanceToGoal[this.maze.index(this.maze.aiStart.x, this.maze.aiStart.y)];
        if (Number.isFinite(du) && Number.isFinite(da) && du === da) break;
      }

      this.mice = [];
      this.trails = [];
      this.blasts = [];
      this.userHeat = new Uint16Array(this.maze.w * this.maze.h);
      this.userExplored = new Uint8Array(this.maze.w * this.maze.h);
      this.aiExplored = new Uint8Array(this.maze.w * this.maze.h);

      // Starting tiles are always explored for their respective teams.
      this._markExplored(TEAM_USER, this.maze.userStart.x, this.maze.userStart.y);
      this._markExplored(TEAM_AI, this.maze.aiStart.x, this.maze.aiStart.y);

      // Debug: optionally reveal everything.
      if (this._debugRevealMaze) {
        if (this.userExplored) this.userExplored.fill(1);
        if (this.aiExplored) this.aiExplored.fill(1);
      }

      this._distFromUserStart = this.maze.computeDistanceMap(this.maze.userStart.x, this.maze.userStart.y);
      this._distFromAiStart = this.maze.computeDistanceMap(this.maze.aiStart.x, this.maze.aiStart.y);
      this._freezeUntilMsUser = 0;
      this._freezeUntilMsAi = 0;

      this.pickupPairs = [];
      this.pickups = [];
      this._nextPickupPairId = 1;
      this._initPickupsForRound();

      this.userScore = this.roundStartScore;
      this.aiScore = this.roundStartScore;
      this.userDeployed = 0;
      this.aiDeployed = 0;
      this.userLastDeployTime = -999;
      this.aiLastDeployTime = -999;

      this.timeRemaining = this.roundDuration;
      this.roundActive = false;
      this._decayAccumulator = 0;
      this._roundTransitionAt = 0;
      this._awaitingRoundAdvance = false;
      this._bestDistUser = Infinity;
      this._bestDistAI = Infinity;

      this.selectedMouseId = null;
      this._finalVictory = false; // Reset final victory flag for new game

      this.userCat = null;
      this.aiCat = null;
      this._usedNames = new Set();
      
      // Reset deploy reminder for new round
      this._showDeployReminder = false;
      if (this._deployReminderEl) this._deployReminderEl.classList.remove('active');
      
      // Reset decoy placement mode
      this._decoyPlaceMode = false;
      this._hoveredDecoyCell = null;
      if (this.decoyCheeseBtn) this.decoyCheeseBtn.classList.remove('btn--active');
      if (this._decoyGuideEl) this._decoyGuideEl.classList.remove('active');
      
      // Reset laser fence placement mode
      this._laserFencePlaceMode = false;
      this._hoveredLaserFenceCell = null;
      if (this.laserFenceBtn) this.laserFenceBtn.classList.remove('btn--active');
      this._laserFences = [];
      this._laserFenceCooldown = 0;
      this._aiLaserFenceCooldown = 0;
      
      // Reset all cooldowns for new round
      this._wallBlastCooldown = 0;
      this._aiWallBlastCooldown = 0;
      this._decoyCooldown = 0;
      this._aiDecoyCooldown = 0;
      this._decoys = [];
      this._catCooldown = 0;
      this._aiCatCooldown = 0;
      
      // Reset manual mouse state
      this._userManualDeployed = false;
      this._aiManualDeployed = false;
      this._userManualMouse = null;
      this._aiManualMouse = null;
      this._manualMouseQueued = false;
      if (this.manualMouseBtn) this.manualMouseBtn.classList.remove('btn--active');

      this.ai.setDifficulty(this.difficulty);

      if (!isFirst) this.audio.playSound('alert');
      this.setMessage(`Round ${this.round} — Get Ready!`);

      // Start countdown
      this._isCountingDown = true;
      this._countdownValue = 3;
      this._countdownTimer = 0;
      this.countdownEl.textContent = '3';
      this.countdownEl.classList.add('active');
      this.countdownEl.classList.add('pop');
    }

    isTeamFrozen(team) {
      const t = nowMs();
      if (team === TEAM_USER) return t < this._freezeUntilMsUser;
      return t < this._freezeUntilMsAi;
    }

    _freezeTeam(team, durationMs) {
      const t = nowMs();
      const until = t + durationMs;
      if (team === TEAM_USER) {
        this._freezeUntilMsUser = Math.max(this._freezeUntilMsUser, until);
        this._freezeStartedAtMsUser = t;
        this._freezeDurationMsUser = Math.max(0, this._freezeUntilMsUser - t);
      } else {
        this._freezeUntilMsAi = Math.max(this._freezeUntilMsAi, until);
        this._freezeStartedAtMsAi = t;
        this._freezeDurationMsAi = Math.max(0, this._freezeUntilMsAi - t);
      }
      // Play freeze sound and spawn frost particles
      this.audio.playSound('freeze');
      this._spawnFrostParticles(team);
    }

    _spawnFrostParticles(frozenTeam) {
      // Spawn frost particles on left side if user frozen, right side if AI frozen
      const side = frozenTeam === TEAM_USER ? 'left' : 'right';
      const t = nowMs();
      const count = 35;
      for (let i = 0; i < count; i++) {
        this.frostParticles.push({
          side,
          t0: t,
          y: Math.random(),        // 0-1 vertical position
          x: Math.random() * 0.15, // 0-0.15 horizontal offset from edge
          vy: (Math.random() - 0.5) * 0.0003, // slow drift
          vx: (Math.random() - 0.3) * 0.0002, // mostly inward drift
          size: 4 + Math.random() * 8,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.003,
          opacity: 0.6 + Math.random() * 0.4,
        });
      }
      // Limit total particles
      if (this.frostParticles.length > 200) {
        this.frostParticles.splice(0, this.frostParticles.length - 200);
      }
    }

    _initPickupsForRound() {
      // Spawn equal pickups on each side (user half and AI half), randomly placed.
      const types = [PICKUP_SPEED, PICKUP_FREEZE, PICKUP_TRUTH];
      for (const type of types) {
        this._spawnPickupOnSide(type, 'user');
        this._spawnPickupOnSide(type, 'ai');
      }
      // Spawn 2 extra freeze pickups on each side (3 total per side)
      for (let i = 0; i < 2; i++) {
        this._spawnPickupOnSide(PICKUP_FREEZE, 'user');
        this._spawnPickupOnSide(PICKUP_FREEZE, 'ai');
      }
    }

    _isUserHalf(x, y) {
      const du = Math.abs(x - this.maze.userStart.x) + Math.abs(y - this.maze.userStart.y);
      const da = Math.abs(x - this.maze.aiStart.x) + Math.abs(y - this.maze.aiStart.y);
      return du < da;
    }

    _spawnPickupOnSide(type, side) {
      const cell = this._pickCellOnSide(side);
      if (!cell) return false;

      const pairId = this._nextPickupPairId++;
      const pair = {
        id: pairId,
        type,
        ax: cell.x,
        ay: cell.y,
        bx: cell.x,
        by: cell.y,
        active: true,
        respawnAtMs: 0,
        side,
      };
      this.pickupPairs.push(pair);
      this.pickups.push({ pairId, type, x: cell.x, y: cell.y, active: true, side });
      return true;
    }

    _pickCellOnSide(side) {
      if (!this.maze || !this.distanceToGoal) return null;

      const distFromStart = side === 'user' ? this._distFromUserStart : this._distFromAiStart;
      if (!distFromStart) return null;
      const startCell = side === 'user' ? this.maze.userStart : this.maze.aiStart;
      const dStartGoal = distFromStart[this.maze.index(this.maze.goal.x, this.maze.goal.y)];
      if (!Number.isFinite(dStartGoal)) return null;

      const candidates = [];
      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          // Only consider cells on the correct side.
          const isUser = this._isUserHalf(x, y);
          if (side === 'user' && !isUser) continue;
          if (side === 'ai' && isUser) continue;

          if (x === this.maze.goal.x && y === this.maze.goal.y) continue;
          if (x === this.maze.userStart.x && y === this.maze.userStart.y) continue;
          if (x === this.maze.aiStart.x && y === this.maze.aiStart.y) continue;

          const dg = this.distanceToGoal[this.maze.index(x, y)];
          const ds = distFromStart[this.maze.index(x, y)];
          if (!Number.isFinite(dg) || !Number.isFinite(ds)) continue;
          if (ds < 4) continue;
          if (dg < 3) continue;
          if (ds + dg > dStartGoal + 8) continue;

          // Avoid colliding with existing pickups.
          if (this.pickups?.some?.(p => p.active && p.x === x && p.y === y)) continue;

          candidates.push({ x, y });
        }
      }

      if (!candidates.length) return null;
      return candidates[Math.floor(this.rng() * candidates.length)];
    }

    _deactivatePickupPair(pairId) {
      const pair = this.pickupPairs.find(p => p.id === pairId);
      if (!pair) return;
      pair.active = false;
      pair.respawnAtMs = nowMs() + this.pickupRespawnDelayMs;
      for (const p of this.pickups) {
        if (p.pairId !== pairId) continue;
        p.active = false;
      }
    }

    _respawnPickupPair(pair) {
      const side = pair.side || 'user';
      const cell = this._pickCellOnSide(side);
      if (!cell) return;
      pair.ax = cell.x;
      pair.ay = cell.y;
      pair.bx = cell.x;
      pair.by = cell.y;
      pair.active = true;
      pair.respawnAtMs = 0;
      let idx = 0;
      for (const p of this.pickups) {
        if (p.pairId !== pair.id) continue;
        if (idx === 0) {
          p.x = pair.ax; p.y = pair.ay;
        } else {
          p.x = pair.bx; p.y = pair.by;
        }
        p.active = true;
        idx++;
      }
    }

    _updatePickups() {
      if (!this.pickupPairs?.length) return;
      const t = nowMs();
      for (const pair of this.pickupPairs) {
        if (pair.active) continue;
        if (pair.respawnAtMs && t >= pair.respawnAtMs) {
          this._respawnPickupPair(pair);
        }
      }
    }

    _tryCollectPickup(mouse) {
      if (!mouse || !mouse.isActive()) return;
      if (!this.pickups?.length) return;
      for (const p of this.pickups) {
        if (!p.active) continue;
        if (p.x !== mouse.cell.x || p.y !== mouse.cell.y) continue;

        // Apply effect.
        if (p.type === PICKUP_SPEED) {
          mouse.applyTempSpeedBoost(this.pickupSpeedMult, this.pickupSpeedDurationMs);
          const who = mouse.team === TEAM_USER ? 'Your' : 'Computer\'s';
          this.setMessage(`⚡ ${who} mouse got a Speed Boost!`);
          this.audio.playSound('speed_boost');
        } else if (p.type === PICKUP_FREEZE) {
          const target = mouse.team === TEAM_USER ? TEAM_AI : TEAM_USER;
          this._freezeTeam(target, this.pickupFreezeDurationMs);
          const who = mouse.team === TEAM_USER ? 'You' : 'Computer';
          this.setMessage(`❄️ ${who} triggered Freeze! Opponent paused.`);
          // Note: freeze sound already played in _freezeTeam
        } else if (p.type === PICKUP_TRUTH) {
          const t = nowMs();
          mouse.truthStartedAtMs = t;
          mouse.truthDurationMs = this.pickupTruthDurationMs;
          mouse.truthUntilMs = t + this.pickupTruthDurationMs;
          const who = mouse.team === TEAM_USER ? 'Your' : 'Computer\'s';
          this.setMessage(`🟢 ${who} mouse found the Path of Truth!`);
          this.audio.playSound('truth');
        }

        // Keep symmetry fair: collecting one removes both and respawns together.
        this._deactivatePickupPair(p.pairId);
        return;
      }
    }

    _markExplored(team, x, y) {
      if (!this.maze) return;
      const i = this.maze.index(x, y);
      if (team === TEAM_USER) {
        if (this.userExplored) this.userExplored[i] = 1;
      } else {
        if (this.aiExplored) this.aiExplored[i] = 1;
      }
    }

    _pickMazeDims() {
      // Wider maze: extend left/right and make overall bigger.
      // Must be odd so the center is a single goal cell.
      const rect = this.canvas.getBoundingClientRect();
      const smaller = Math.min(rect.width || 900, rect.height || 900);
      const targetH = clamp(Math.floor(smaller / 16), 35, 47);
      const h = targetH % 2 === 0 ? targetH + 1 : targetH;

      const targetW = clamp(Math.floor(h * 1.55), h + 11, 75);
      const w = targetW % 2 === 0 ? targetW + 1 : targetW;
      return { w, h };
    }

    getAlgoCost(algo) {
      return this.algoCosts[algo] ?? 50;
    }

    getActiveMiceCount(team) {
      return this.mice.filter(m => m.team === team && m.isActive()).length;
    }

    getCooldownRemaining(team) {
      const elapsed = this.roundDuration - this.timeRemaining;
      const lastDeploy = team === TEAM_USER ? this.userLastDeployTime : this.aiLastDeployTime;
      const remaining = this.getDeployCooldown(team) - (elapsed - lastDeploy);
      return Math.max(0, remaining);
    }

    deployUser(algo) {
      if (!this.roundActive) return false;
      
      // Check active mice count (allows respawning if one was destroyed)
      const activeMice = this.getActiveMiceCount(TEAM_USER);
      if (activeMice >= this.maxMicePerRound) {
        this.setMessage('Max active mice reached.');
        return false;
      }

      // Check cooldown
      const cooldown = this.getCooldownRemaining(TEAM_USER);
      if (cooldown > 0) {
        this.setMessage(`Cooldown: ${cooldown.toFixed(1)}s remaining.`);
        this.audio.playSound('alert');
        return false;
      }

      // Get algorithm cost
      const cost = this.getAlgoCost(algo);
      if (this.userScore < cost) {
        this.setMessage(`Not enough points. Need ${cost} for ${this._algoLabel(algo)}.`);
        this.audio.playSound('alert');
        return false;
      }

      this.userScore -= cost;
      const elapsed = this.roundDuration - this.timeRemaining;
      this.userLastDeployTime = elapsed;

      const m = new MouseAgent({
        id: `u_${this.round}_${this.userDeployed}_${Math.floor(this.rng() * 1e9)}`,
        team: TEAM_USER,
        algorithm: algo,
        hand: 'left',
        start: this.maze.userStart,
        maze: this.maze,
        baseSpeed: algo === 'wiseFragile' ? 1.26 : 2.52, // 10% slower
        deploymentCost: cost,
      });

      this._assignMouseIdentity(m, this.userDeployed + 1);
      this._assignPersonality(m);
      this.mice.push(m);
      this.userDeployed++;
      this.userHeat[this.maze.index(m.cell.x, m.cell.y)]++;
      this._markExplored(TEAM_USER, m.cell.x, m.cell.y);

      this.audio.playSound('deploy');

      const label = this._algoLabel(algo);
      const personalityHint = m.personality ? ` (${m.personality})` : '';
      this.setMessage(`Deployed: ${label}${personalityHint} (-${cost} pts)`);
      return true;
    }

    deployAI(algo) {
      if (!this.roundActive) return false;
      
      // Check active mice count
      const activeMice = this.getActiveMiceCount(TEAM_AI);
      if (activeMice >= this.maxMicePerRound) return false;

      // Check cooldown
      const cooldown = this.getCooldownRemaining(TEAM_AI);
      if (cooldown > 0) return false;

      // Get algorithm cost
      const cost = this.getAlgoCost(algo);
      if (this.aiScore < cost) return false;

      this.aiScore -= cost;
      const elapsed = this.roundDuration - this.timeRemaining;
      this.aiLastDeployTime = elapsed;

      const m = new MouseAgent({
        id: `a_${this.round}_${this.aiDeployed}_${Math.floor(this.rng() * 1e9)}`,
        team: TEAM_AI,
        algorithm: algo,
        hand: 'right',
        start: this.maze.aiStart,
        maze: this.maze,
        baseSpeed: algo === 'wiseFragile' ? 1.26 : 2.52, // 10% slower
        deploymentCost: cost,
      });
      this._assignMouseIdentity(m, this.aiDeployed + 1); // Give AI mice names too
      this.mice.push(m);
      this.aiDeployed++;
      this._markExplored(TEAM_AI, m.cell.x, m.cell.y);

      this.audio.playSound('deploy');
      return true;
    }

    _deployManualMouse(team) {
      if (!this.roundActive) return false;
      
      // Check if already deployed
      if (team === TEAM_USER && this._userManualDeployed) return false;
      if (team === TEAM_AI && this._aiManualDeployed) return false;
      
      const isUser = team === TEAM_USER;
      const algo = isUser ? 'manual' : 'aiManual';
      const start = isUser ? this.maze.userStart : this.maze.aiStart;
      const deployedCount = isUser ? this.userDeployed : this.aiDeployed;
      
      const m = new MouseAgent({
        id: `${isUser ? 'u' : 'a'}_manual_${this.round}_${Math.floor(this.rng() * 1e9)}`,
        team: team,
        algorithm: algo,
        hand: isUser ? 'left' : 'right',
        start: start,
        maze: this.maze,
        baseSpeed: 1.89, // Between wiseFragile (1.26) and regular (2.52)
        deploymentCost: 0,
      });
      
      // Give it a special pilot identity
      m.displayName = isUser ? 'The Pilot' : 'AI Pilot';
      m.pilotMouse = true; // Flag for special rendering
      
      // Assign a personality for visual variety
      this._assignPersonality(m);
      
      this.mice.push(m);
      
      if (isUser) {
        this._userManualMouse = m;
        this._userManualDeployed = true;
        this.userDeployed++;
        this._spawnFloatingText(this.maze.userStart.x, this.maze.userStart.y, '⌨️ PILOT DEPLOYED!', '#ff00ff');
        this.audio.playSound('deploy');
        this._queueCommentary('⌨️ A special keyboard-controlled mouse enters the maze!', 3);
      } else {
        this._aiManualMouse = m;
        this._aiManualDeployed = true;
        this.aiDeployed++;
        this._spawnFloatingText(this.maze.aiStart.x, this.maze.aiStart.y, '🤖 AI PILOT!', '#00ffff');
        this.audio.playSound('deploy');
      }
      
      this._markExplored(team, m.cell.x, m.cell.y);
      return true;
    }

    destroyMouse(mouse) {
      if (!mouse || !mouse.isActive()) return;

      mouse.destroy();
      const refund = Math.floor(mouse.deploymentCost * 0.5);
      if (mouse.team === TEAM_USER) this.userScore += refund;
      else this.aiScore += refund;

      if (this.selectedMouseId === mouse.id) this.selectedMouseId = null;
      this.audio.playSound('destroy');
      this._spawnFloatingText(mouse.cell.x, mouse.cell.y, '💀 DESTROYED', '#ff3b30');
      this.setMessage(`Mouse destroyed. Refund: +${refund}`);
    }

    trySpeedBoost(mouse) {
      if (!mouse || !mouse.isActive()) return false;
      
      // Check if mouse has reached boost limit
      if (!mouse.canBoostSpeed()) {
        this.setMessage(`Mouse already at max speed boosts (${this.maxSpeedBoosts}).`);
        this.audio.playSound('alert');
        return false;
      }
      
      const cost = this.speedBoostCost;
      if (mouse.team === TEAM_USER) {
        if (this.userScore < cost) {
          this.setMessage('Not enough points for Speed Boost.');
          this.audio.playSound('alert');
          return false;
        }
        this.userScore -= cost;
      } else {
        if (this.aiScore < cost) return false;
        this.aiScore -= cost;
      }
      mouse.boostSpeed(1.2);
      this.audio.playSound('speed_boost');
      this.setMessage(`Speed +20%! (${mouse.speedBoostCount}/${this.maxSpeedBoosts} boosts)`);
      return true;
    }

    // Hive Mind function removed

    onMouseEnteredCell(mouse) {
      // Heatmap tracks user exploration.
      if (mouse.team === TEAM_USER) {
        const i = this.maze.index(mouse.cell.x, mouse.cell.y);
        if (this.userHeat) this.userHeat[i] = Math.min(65535, this.userHeat[i] + 1);
      }

      // Fog-of-war exploration.
      this._markExplored(mouse.team, mouse.cell.x, mouse.cell.y);

      // Pickup collection.
      this._tryCollectPickup(mouse);
    }

    onCatEnteredCell(cat) {
      // Cat reveals fog for its owning team.
      this._markExplored(cat.team, cat.cell.x, cat.cell.y);

      // Cat attacks the opposing team.
      const targetTeam = cat.team === TEAM_USER ? TEAM_AI : TEAM_USER;
      for (const m of this.mice) {
        if (!m.isActive()) continue;
        if (m.team !== targetTeam) continue;
        if (m.cell.x !== cat.cell.x || m.cell.y !== cat.cell.y) continue;
        
        // Cat cannot eat frozen mice - they are invisible/untouchable
        if (this.isTeamFrozen(m.team)) continue;
        
        // Check if mouse is sick - cat dies from eating poisoned mouse!
        const mouseWasSick = m.isSick && nowMs() < m.sickUntilMs;
        
        m.destroyed = true;
        if (this.selectedMouseId === m.id) this.selectedMouseId = null;
        this._spawnBloodStain(cat.cell.x, cat.cell.y);
        
        // If mouse was sick, cat dies too!
        if (mouseWasSick) {
          cat.destroyed = true;
          this.audio.playSound('bad_stomach');
          this._spawnFloatingText(cat.cell.x, cat.cell.y, '🐱💀🤮', '#33cc33');
          this._queueCommentary(`🐱💀 Cat died from eating a sick mouse!`, 3);
          this.setMessage('🐱💀 Cat ate a poisoned mouse and died!');
          // Clear the cat reference
          if (cat.team === TEAM_USER) {
            this.userCat = null;
          } else {
            this.aiCat = null;
          }
          return; // Cat is dead, stop processing
        }

        // Hunger tracking: after 2 kills, start the "full" timer.
        let announcedFull = false;
        if (cat && typeof cat.kills === 'number') {
          cat.kills++;
          if (cat.kills >= 2 && !cat.fullAtMs) {
            cat.fullAtMs = nowMs();
            announcedFull = true;
            this.setMessage('😴 Cat is full and falling asleep soon.');
          }
        }
        
        // Clear the old scent so cat doesn't linger at kill site
        // Force scent update to find next living mouse
        if (cat.team === TEAM_USER) {
          this._lastSeenAiCell = null;
          this._lastSeenAiAtMs = 0;
        } else {
          this._lastSeenUserCellForAi = null;
          this._lastSeenUserAtMsForAi = 0;
        }

        // Play both cat eating and mouse death sounds
        this.audio.playSound('cat_eats');
        this.audio.playSound('mouse_being_eaten');
        if (!announcedFull) this.setMessage('🐈 Cat caught a mouse!');
        // Continue (cat can keep moving).
      }
    }

    _updateLastSeen() {
      if (!this.maze || !this.userExplored) return;
      const t = nowMs();
      for (const m of this.mice) {
        if (!m.isActive()) continue;
        if (m.isCrazy) continue;
        const i = this.maze.index(m.cell.x, m.cell.y);

        // What the USER team has seen (used by user-owned cat to hunt AI mice)
        if (this.userExplored[i] && m.team === TEAM_AI) {
          this._lastSeenAiCell = { x: m.cell.x, y: m.cell.y };
          this._lastSeenAiAtMs = t;
        }

        // What the AI team has seen (used by AI-owned cat to hunt USER mice)
        if (this.aiExplored && this.aiExplored[i] && m.team === TEAM_USER) {
          this._lastSeenUserCellForAi = { x: m.cell.x, y: m.cell.y };
          this._lastSeenUserAtMsForAi = t;
        }
      }
    }

    _explodeAndBreakWalls(mice, x, y, reason = 'Collision') {
      for (const m of mice) {
        if (!m || !m.isActive()) continue;
        m.destroyed = true;
        if (this.selectedMouseId === m.id) this.selectedMouseId = null;
      }

      if (reason === 'Collision') {
        // Break walls around the blast to create new paths.
        if (this.maze) {
          this.maze.breakWallsAround(x, y, 1);
          // Update distance map so pathfinder benefits from new openings.
          this.distanceToGoal = this.maze.computeDistanceMap(this.maze.goal.x, this.maze.goal.y);
        }

        this._spawnBlast(x, y);
        this.audio.playSound('bomb'); // Explosion sound for mouse collision
        this.setMessage('💥 Head-on collision! Walls collapse nearby.');
      }
    }

    _spawnBlast(x, y) {
      this.blasts.push({ x, y, t0: nowMs() });
      if (this.blasts.length > 24) this.blasts.splice(0, this.blasts.length - 24);
    }

    _spawnBloodStain(x, y) {
      this.bloodStains.push({ x, y, t0: nowMs() });
      if (this.bloodStains.length > 28) this.bloodStains.shift();
    }

    _spawnFloatingText(cellX, cellY, text, color = '#ff3b30') {
      const { cellSize, offsetX, offsetY } = this._layout();
      const x = offsetX + (cellX + 0.5) * cellSize;
      const y = offsetY + (cellY + 0.5) * cellSize;
      this.floatingTexts.push({ x, y, text, color, t0: nowMs(), duration: 1800 });
      if (this.floatingTexts.length > 10) this.floatingTexts.shift();
    }

    _updateFloatingTexts() {
      if (!this.floatingTexts?.length) return;
      const t = nowMs();
      for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
        const ft = this.floatingTexts[i];
        if (t - ft.t0 > ft.duration) {
          this.floatingTexts.splice(i, 1);
        }
      }
    }

    _drawFloatingTexts() {
      if (!this.floatingTexts?.length) return;
      const ctx = this.ctx;
      const t = nowMs();
      const timerZoneTop = 60; // Area where timer is positioned
      const canvasCenterX = this.canvas.width / 2;
      const timerHalfWidth = 120;

      for (const ft of this.floatingTexts) {
        const age = t - ft.t0;
        const progress = age / ft.duration;
        if (progress >= 1) continue;
        
        // Float downward if in timer zone, otherwise float upward
        const inTimerZone = ft.y < timerZoneTop + 50 && 
                           Math.abs(ft.x - canvasCenterX) < timerHalfWidth;
        const yOffset = inTimerZone ? 50 * progress : -40 * progress;
        const alpha = 1 - Math.pow(progress, 2);
        const scale = 1 + progress * 0.3;
        
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${Math.round(18 * scale)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw outline
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeText(ft.text, ft.x, ft.y + yOffset);
        
        // Draw fill
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y + yOffset);
        ctx.restore();
      }
    }

    _drawBloodStains() {
      if (!this.bloodStains?.length) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const t = nowMs();

      for (const s of this.bloodStains) {
        const age = (t - s.t0) / 1000;
        const a = clamp(0.55 - age * 0.03, 0.18, 0.55);
        const cx = offsetX + (s.x + 0.5) * cellSize;
        const cy = offsetY + (s.y + 0.5) * cellSize;
        const r = Math.max(6, cellSize * 0.30);

        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(140,10,15,1)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 0.95, r * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = 'rgba(90,0,0,1)';
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.25, cy + r * 0.10, r * 0.70, r * 0.25, 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    _spawnConfetti(kind = 'round') {
      const n = kind === 'final' ? 140 : 85;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const colors = [this._colors.user, this._colors.goal, '#7dd3fc', '#fda4af'];
      for (let i = 0; i < n; i++) {
        const x = w * (0.2 + this.rng() * 0.6);
        const y = h * (0.12 + this.rng() * 0.08);
        const vx = (this.rng() - 0.5) * (kind === 'final' ? 220 : 160);
        const vy = -40 - this.rng() * (kind === 'final' ? 180 : 130);
        const size = 4 + this.rng() * 7;
        const rot = this.rng() * Math.PI * 2;
        const vr = (this.rng() - 0.5) * 9;
        const life = (kind === 'final' ? 3.2 : 2.3) + this.rng() * 0.8;
        this.confetti.push({ x, y, vx, vy, size, rot, vr, life, age: 0, color: colors[Math.floor(this.rng() * colors.length)] });
      }
      if (this.confetti.length > 420) this.confetti.splice(0, this.confetti.length - 420);
    }

    _updateConfetti(dt) {
      // Continuously spawn confetti during final victory
      if (this._finalVictory) {
        this._confettiSpawnTimer = (this._confettiSpawnTimer || 0) + dt;
        if (this._confettiSpawnTimer > 0.3) { // Spawn batch every 0.3s
          this._confettiSpawnTimer = 0;
          this._spawnConfetti('final');
        }
      }
      
      if (!this.confetti?.length) return;
      const g = 420;
      for (let i = this.confetti.length - 1; i >= 0; i--) {
        const p = this.confetti[i];
        p.age += dt;
        if (p.age >= p.life) {
          this.confetti.splice(i, 1);
          continue;
        }
        p.vy += g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    }

    _drawConfetti() {
      if (!this.confetti?.length) return;
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      for (const p of this.confetti) {
        const a = clamp(1 - p.age / p.life, 0, 1);
        if (a <= 0) continue;
        if (p.x < -40 || p.x > w + 40 || p.y > h + 60) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size * 0.5, -p.size * 0.22, p.size, p.size * 0.44);
        ctx.restore();
      }

      ctx.restore();
    }

    // Draw frozen glow effects ABOVE fog-of-war so they're visible even in dark areas
    _drawFrozenGlows() {
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const time = performance.now() / 1000;

      for (const m of this.mice) {
        if (!m.isActive() && !m.reachedGoal) continue;
        
        const isFrozen = this.isTeamFrozen(m.team);
        if (!isFrozen) continue;
        
        const p = m.positionLerp();
        const x = offsetX + (p.x + 0.5) * cellSize;
        const y = offsetY + (p.y + 0.5) * cellSize;
        const r = Math.max(4, cellSize * 0.32);
        
        // Calculate rotation based on heading for properly oriented glow
        const angles = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };
        const angle = angles[m.heading] || 0;
        
        const pulse = 0.5 + Math.sin(time * 8) * 0.5;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        
        // Draw glow ABOVE fog using screen blend mode
        ctx.globalCompositeOperation = 'screen';
        
        // Draw a mouse-shaped glow (body + head)
        ctx.beginPath();
        // Body glow (larger, centered)
        ctx.ellipse(0, 0, r * 1.4, r * 1.1, 0, 0, Math.PI * 2);
        // Head glow (offset to front)
        ctx.ellipse(r * 0.8, 0, r * 0.8, r * 0.8, 0, 0, Math.PI * 2);
        
        ctx.fillStyle = `rgba(120, 220, 255, ${0.4 + pulse * 0.4})`;
        ctx.shadowColor = 'rgba(120, 220, 255, 0.9)';
        ctx.shadowBlur = 20 * pulse;
        ctx.fill();
        ctx.restore();
      }
    }

    _drawFrostParticles() {
      if (!this.frostParticles?.length) return;
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const t = nowMs();
      const lifetime = 3500; // Particles fade over 3.5 seconds

      ctx.save();
      for (let i = this.frostParticles.length - 1; i >= 0; i--) {
        const p = this.frostParticles[i];
        const age = t - p.t0;
        if (age >= lifetime) {
          this.frostParticles.splice(i, 1);
          continue;
        }

        // Update position with drift
        p.y += p.vy * (t - p.t0);
        p.x += p.vx * (t - p.t0);
        p.rotation += p.rotSpeed * (t - p.t0);

        // Calculate screen position
        const screenX = p.side === 'left' ? p.x * w * 0.4 : w - p.x * w * 0.4;
        const screenY = p.y * h;

        // Fade out based on age
        const fadeProgress = age / lifetime;
        const alpha = p.opacity * (1 - fadeProgress * fadeProgress);
        if (alpha <= 0) continue;

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = alpha;

        // Draw snowflake/frost crystal
        const size = p.size;
        ctx.strokeStyle = '#aef';
        ctx.fillStyle = 'rgba(180, 220, 255, 0.6)';
        ctx.lineWidth = 1.5;

        // Simple 6-point snowflake
        ctx.beginPath();
        for (let j = 0; j < 6; j++) {
          const angle = (j * Math.PI) / 3;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
          // Add small branches
          const branchLen = size * 0.4;
          const branchX = Math.cos(angle) * size * 0.6;
          const branchY = Math.sin(angle) * size * 0.6;
          ctx.moveTo(branchX, branchY);
          ctx.lineTo(branchX + Math.cos(angle + 0.5) * branchLen, branchY + Math.sin(angle + 0.5) * branchLen);
          ctx.moveTo(branchX, branchY);
          ctx.lineTo(branchX + Math.cos(angle - 0.5) * branchLen, branchY + Math.sin(angle - 0.5) * branchLen);
        }
        ctx.stroke();

        // Center glow
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.25, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
      ctx.restore();

      // Also draw a subtle blue glow overlay on the frozen side
      const userFrozen = nowMs() < this._freezeUntilMsUser;
      const aiFrozen = nowMs() < this._freezeUntilMsAi;
      if (userFrozen || aiFrozen) {
        ctx.save();
        const glowWidth = w * 0.12;
        if (userFrozen) {
          const remainMs = this._freezeUntilMsUser - nowMs();
          const totalMs = this._freezeDurationMsUser || 3500;
          const glowAlpha = Math.min(0.35, 0.35 * (remainMs / totalMs));
          const grad = ctx.createLinearGradient(0, 0, glowWidth, 0);
          grad.addColorStop(0, `rgba(100, 180, 255, ${glowAlpha})`);
          grad.addColorStop(1, 'rgba(100, 180, 255, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, glowWidth, h);
        }
        if (aiFrozen) {
          const remainMs = this._freezeUntilMsAi - nowMs();
          const totalMs = this._freezeDurationMsAi || 3500;
          const glowAlpha = Math.min(0.35, 0.35 * (remainMs / totalMs));
          const grad = ctx.createLinearGradient(w, 0, w - glowWidth, 0);
          grad.addColorStop(0, `rgba(100, 180, 255, ${glowAlpha})`);
          grad.addColorStop(1, 'rgba(100, 180, 255, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(w - glowWidth, 0, glowWidth, h);
        }
        ctx.restore();
      }
    }

    _resolveMouseCollisions() {
      // If opposing mice occupy the same cell, both explode.
      // Also: wiseFragile mice get crushed by any same-team collision.
      const cellMap = new Map();
      for (const m of this.mice) {
        if (!m.isActive()) continue;
        if (m.isCrazy) continue;
        const key = `${m.cell.x},${m.cell.y}`;
        let arr = cellMap.get(key);
        if (!arr) {
          arr = [];
          cellMap.set(key, arr);
        }
        arr.push(m);
      }

      for (const [key, arr] of cellMap) {
        if (arr.length < 2) continue;

        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const hasUser = arr.some(m => m.team === TEAM_USER);
        const hasAi = arr.some(m => m.team === TEAM_AI);

        // Opposing team collision: all explode
        if (hasUser && hasAi) {
          this._explodeAndBreakWalls(arr, x, y, 'Collision');
          continue;
        }

        // Same-team collision: wiseFragile mice get crushed
        const wiseFragileMice = arr.filter(m => m.algorithm === 'wiseFragile');
        const otherMice = arr.filter(m => m.algorithm !== 'wiseFragile');
        if (wiseFragileMice.length > 0 && otherMice.length > 0) {
          // Crush all wiseFragile mice in the cell
          for (const wm of wiseFragileMice) {
            wm.destroyed = true;
            if (this.selectedMouseId === wm.id) this.selectedMouseId = null;
          }
          this._spawnBloodStain(x, y);
          this._spawnFloatingText(x, y, '💀 CRUSHED!', '#ff3b30');
          this.audio.playSound('destroy');
          this.setMessage('💀 Wise but Fragile crushed by fellow mouse!');
        }
      }
    }

    _assignMouseIdentity(mouse, number) {
      if (!mouse) return;
      mouse.displayNumber = number;
      mouse.displayName = this._nextFunnyName();
    }

    _nextFunnyName() {
      const names = [
        'Alice','Gustav','Sir Squeaks','Cheddar Chad','Quantum Nibbler','Baron Von Brie','Squeak Nicholson',
        'Mousetopher Walken','Nibble Tyson','Count Snackula','Lady Whiskers','Dr. Cheesenstein','Captain Crumb',
        'Fuzz Aldrin','Snack Sparrow','Duchess Gouda','General Tso','DJ Nibbles','Waffles','Spaghetti','Pickles',
        'Mister Bonk','Salsa','Biscuit','Nacho','Pistachio','Gizmo','Zigzag','Bubbles','Tofu','Marshmallow',
        'Sir Reginald Paws','Mega Munch','Tiny Thunder','Professor Scrumbles','The Honk','Kermit','Bananaphone',
        'Hamlet','Mozzarella Mike','Brie Larson','Cheese Lightning','Squeak-zilla','Nibbleroni','Agent Stilton',
      ];

      for (let tries = 0; tries < 80; tries++) {
        const pick = names[Math.floor(this.rng() * names.length)];
        if (!this._usedNames.has(pick)) {
          this._usedNames.add(pick);
          return pick;
        }
      }
      const fallback = `Mouse_${Math.floor(this.rng() * 9999)}`;
      this._usedNames.add(fallback);
      return fallback;
    }

    tryDeployCat(team = TEAM_USER, opts = {}) {
      if (!this.roundActive) return false;
      // Each team can have their own cat.
      const existingCat = team === TEAM_USER ? this.userCat : this.aiCat;
      if (existingCat && existingCat.isActive()) return false;
      const elapsed = this.roundDuration - this.timeRemaining;
      if (elapsed < this.catUnlockAt) return false;

      const silent = !!opts.silent;
      const cost = this.catCost;
      if (team === TEAM_USER) {
        if (this.userScore < cost) {
          if (!silent) {
            this.setMessage(`Not enough points for Cat (need ${cost}).`);
            this.audio.playSound('alert');
          }
          return false;
        }
        this.userScore -= cost;
      } else {
        if (this.aiScore < cost) return false;
        this.aiScore -= cost;
      }

      const algos = ['explorer', 'tremaux'];
      const algo = algos[Math.floor(this.rng() * algos.length)];
      const start = team === TEAM_USER ? this.maze.aiStart : this.maze.userStart;

      // Slightly faster than a mouse (mouse base speed is ~2.8 right now).
      const newCat = new CatAgent({ team, start, maze: this.maze, baseSpeed: 2.34, algorithm: algo }); // 93% of mouse speed (2.52)
      newCat.spawnedAtSec = elapsed; // Track spawn time for lifetime limit
      if (team === TEAM_USER) this.userCat = newCat;
      else this.aiCat = newCat;
      if (!silent) {
        this.setMessage(team === TEAM_USER ? '🐈 Your cat deployed!' : '🐈 Computer deployed a cat!');
        this.audio.playSound(team === TEAM_USER ? 'player_cat' : 'ai_cat');
      }
      return true;
    }

    onMouseGoneCrazy(mouse) {
      // Mouse went crazy from ping-ponging - no penalty, no reward
      if (this.selectedMouseId === mouse.id) this.selectedMouseId = null;
      this.audio.playSound('alert');
      const who = mouse.team === TEAM_USER ? 'Your' : 'Computer\'s';
      this.setMessage(`💥 ${who} mouse went crazy and exploded!`);
    }

    onMouseReachedGoal(mouse) {
      if (mouse.team === TEAM_USER) this.userScore += this.victoryReward;
      else this.aiScore += this.victoryReward;

      // Handle bet payout
      if (mouse.hasBet) this._resolveBet(mouse);

      // Check for underdog victory (free wanderer wins)
      if (mouse.algorithm === 'wanderer' && mouse.team === TEAM_USER) {
        const bonus = 50;
        this.userScore += bonus;
        this._queueCommentary(`🎯 UNDERDOG VICTORY! Wanderer wins! +${bonus} bonus!`, 3);
      }

      // Play win sound if user's mouse won, lose sound if AI's mouse won
      this.audio.playSound(mouse.team === TEAM_USER ? 'win' : 'lose');
      if (this.selectedMouseId === mouse.id) this.selectedMouseId = null;

      const who = mouse.team === TEAM_USER ? 'User' : 'Computer';
      this.setMessage(`${who} mouse reached the goal. +${this.victoryReward}`);

      // End round immediately
      this._endRound(`${who} reached goal`);
    }

    addTrailSegment(mouse, fromCell, toCell) {
      this.trails.push({
        mouseId: mouse.id,
        team: mouse.team,
        x0: fromCell.x,
        y0: fromCell.y,
        x1: toCell.x,
        y1: toCell.y,
        t0: this.timeRemaining,
      });
      if (this.trails.length > 2400) this.trails.splice(0, this.trails.length - 2400);
    }

    _algoLabel(algo) {
      if (algo === 'wanderer') return 'The Wanderer';
      if (algo === 'wallhugger') return 'The Wall Hugger';
      if (algo === 'sniffer') return 'The Sniffer';
      if (algo === 'wiseFragile') return 'Wise but Fragile';
      if (algo === 'tremaux') return 'The Cartographer';
      if (algo === 'explorer') return 'The Explorer';
      return algo;
    }

    // === LIVE COMMENTARY SYSTEM ===
    _queueCommentary(text, priority = 1) {
      this._commentaryQueue.push({ text, priority, t: nowMs() });
      // Sort by priority (higher = more important)
      this._commentaryQueue.sort((a, b) => b.priority - a.priority);
      if (this._commentaryQueue.length > 5) this._commentaryQueue.pop();
    }

    _updateCommentary(dt) {
      const t = nowMs() / 1000;
      if (t - this._lastCommentaryAt < this._commentaryCooldown) return;
      
      // Process queue
      if (this._commentaryQueue.length > 0) {
        const c = this._commentaryQueue.shift();
        this.setMessage(c.text);
        this._lastCommentaryAt = t;
        return;
      }
      
      // Generate dynamic commentary
      const activeMice = this.mice.filter(m => m.isActive() && !m.isCrazy);
      if (activeMice.length === 0) return;
      
      // Find leader
      let leader = null;
      let leaderDist = Infinity;
      for (const m of activeMice) {
        const d = this.distanceToGoal?.[this.maze.index(m.cell.x, m.cell.y)] ?? Infinity;
        if (d < leaderDist) { leaderDist = d; leader = m; }
      }
      
      // Check for close races
      const closeToGoal = activeMice.filter(m => {
        const d = this.distanceToGoal?.[this.maze.index(m.cell.x, m.cell.y)] ?? Infinity;
        return d <= 5;
      });
      
      if (closeToGoal.length >= 2) {
        const hasUser = closeToGoal.some(m => m.team === TEAM_USER);
        const hasAi = closeToGoal.some(m => m.team === TEAM_AI);
        if (hasUser && hasAi) {
          this._queueCommentary('🔥 CLOSE RACE! Multiple mice near the goal!', 3);
          this._lastCommentaryAt = t;
          return;
        }
      }
      
      // Leader update (occasionally)
      if (leader && leaderDist <= 8 && this.rng() < 0.03) {
        const name = leader.displayName || 'A mouse';
        const team = leader.team === TEAM_USER ? 'Your' : 'Enemy';
        this._queueCommentary(`🏃 ${team} ${name} is in the lead!`, 1);
        this._lastCommentaryAt = t;
      }
      
      // Lost mouse
      for (const m of activeMice) {
        if (m.team !== TEAM_USER) continue;
        const d = this.distanceToGoal?.[this.maze.index(m.cell.x, m.cell.y)] ?? 0;
        if (d > 20 && m._stuckCounter > 3 && this.rng() < 0.02) {
          const name = m.displayName || 'Mouse';
          this._queueCommentary(`😰 ${name} seems lost in a dead end!`, 1);
          this._lastCommentaryAt = t;
          break;
        }
      }
      
      // Cat hunting
      const cats = [this.userCat, this.aiCat].filter(c => c && c.isActive());
      for (const cat of cats) {
        for (const m of activeMice) {
          if (m.team === cat.team) continue;
          const dist = Math.abs(m.cell.x - cat.cell.x) + Math.abs(m.cell.y - cat.cell.y);
          if (dist <= 3 && this.rng() < 0.04) {
            const name = m.displayName || 'Mouse';
            const hunter = cat.team === TEAM_USER ? 'Your cat' : 'Enemy cat';
            this._queueCommentary(`💀 ${hunter} is hunting ${name}!`, 2);
            this._lastCommentaryAt = t;
            break;
          }
        }
      }
    }

    // === DRAMA MODE (close finish) ===
    _updateDramaMode(dt) {
      const activeMice = this.mice.filter(m => m.isActive() && !m.isCrazy);
      if (activeMice.length === 0) {
        this._dramaMode = false;
        this._slowMotionFactor = 1;
        return;
      }
      
      // Find closest mice to goal
      let closestUser = Infinity, closestAi = Infinity;
      let closestUserMouse = null, closestAiMouse = null;
      
      for (const m of activeMice) {
        const d = this.distanceToGoal?.[this.maze.index(m.cell.x, m.cell.y)] ?? Infinity;
        if (m.team === TEAM_USER && d < closestUser) { closestUser = d; closestUserMouse = m; }
        if (m.team === TEAM_AI && d < closestAi) { closestAi = d; closestAiMouse = m; }
      }
      
      // Drama mode triggers when both teams have mice within 4 cells of goal
      const nearGoal = Math.min(closestUser, closestAi) <= 4;
      const competitive = Math.abs(closestUser - closestAi) <= 2 && closestUser <= 6 && closestAi <= 6;
      
      // Start end_strings music when zooming to goal (any mouse within 5 cells)
      const anyNearGoal = Math.min(closestUser, closestAi) <= 5;
      if (anyNearGoal && !this.audio._endStringsPlaying) {
        this.audio.startEndStrings();
      } else if (!anyNearGoal && this.audio._endStringsPlaying) {
        this.audio.stopEndStrings(true); // Resume bg music
      }
      
      if (nearGoal && competitive) {
        if (!this._dramaMode) {
          this._queueCommentary('⚡ PHOTO FINISH INCOMING!', 3);
        }
        this._dramaMode = true;
        this._slowMotionFactor = Math.max(0.5, this._slowMotionFactor - dt * 0.5);
        this._dramaShakeIntensity = Math.min(8, this._dramaShakeIntensity + dt * 20);
        
        // Set zoom center to goal
        if (this._autoZoomEnabled && !this._selectionZoomActive) {
          this._targetZoom = 1.3;
          this._targetZoomCenter = { x: this.maze.goal.x, y: this.maze.goal.y };
        }
      } else if (Math.min(closestUser, closestAi) <= 6) {
        // Approaching goal - gentle zoom to leader
        if (this._autoZoomEnabled && !this._selectionZoomActive) {
          this._targetZoom = 1.15;
          const lead = closestUser < closestAi ? closestUserMouse : closestAiMouse;
          if (lead) {
            this._targetZoomCenter = { x: lead.cell.x, y: lead.cell.y };
          }
        }
        this._dramaMode = false;
        this._slowMotionFactor = Math.min(1, this._slowMotionFactor + dt);
        this._dramaShakeIntensity = Math.max(0, this._dramaShakeIntensity - dt * 10);
      } else {
        this._dramaMode = false;
        this._slowMotionFactor = Math.min(1, this._slowMotionFactor + dt);
        this._dramaShakeIntensity = Math.max(0, this._dramaShakeIntensity - dt * 10);
        if (this._autoZoomEnabled && !this._selectionZoomActive) {
          this._targetZoom = 1;
          this._targetZoomCenter = null;
        }
      }
    }

    _updateSelectionZoom() {
      // Zoom in slightly when a mouse is selected (similar to near-goal zoom)
      const selected = this.getSelectedMouse();
      if (selected && selected.isActive() && !selected.isCrazy) {
        // Only track if the mouse is close to the goal (within 8 cells)
        const dist = this.distanceToGoal?.[this.maze.index(selected.cell.x, selected.cell.y)] ?? Infinity;
        if (dist <= 8) {
          this._selectionZoomActive = true;
          this._targetZoom = 1.15;
          this._targetZoomCenter = { x: selected.cell.x, y: selected.cell.y };
        } else {
          this._selectionZoomActive = false;
        }
      } else {
        this._selectionZoomActive = false;
      }
    }

    _updateZoom(dt) {
      // Smooth zoom interpolation
      const zoomSpeed = 2; // Slower for smoother feel
      const diff = this._targetZoom - this._currentZoom;
      this._currentZoom += diff * dt * zoomSpeed;
      if (Math.abs(diff) < 0.005) this._currentZoom = this._targetZoom;
      
      // Smooth camera center interpolation
      if (this._zoomCenter && this._targetZoomCenter) {
        const dx = this._targetZoomCenter.x - this._zoomCenter.x;
        const dy = this._targetZoomCenter.y - this._zoomCenter.y;
        const panSpeed = 3; // Smooth pan
        this._zoomCenter.x += dx * dt * panSpeed;
        this._zoomCenter.y += dy * dt * panSpeed;
      } else if (this._targetZoomCenter) {
        this._zoomCenter = { ...this._targetZoomCenter };
      }
    }

    // === DESPERATION MODE ===
    _updateDesperation() {
      const scoreDiff = this.aiScore - this.userScore;
      const wasDesperate = this._desperationMode;
      this._desperationMode = scoreDiff >= this._desperationThreshold;
      
      if (this._desperationMode && !wasDesperate) {
        this._queueCommentary('🔥 DESPERATION MODE! Mice cost 50% less!', 3);
      }
    }

    getAlgoCost(algo) {
      let cost = this.algoCosts[algo] ?? 50;
      if (this._desperationMode) cost = Math.floor(cost * 0.5);
      return cost;
    }

    // === MINI OBJECTIVES ===
    _checkMiniObjectives() {
      // Exploration milestone (30%)
      const totalCells = this.maze.w * this.maze.h;
      
      for (const team of [TEAM_USER, TEAM_AI]) {
        const explored = team === TEAM_USER ? this.userExplored : this.aiExplored;
        if (!explored) continue;
        
        let count = 0;
        for (let i = 0; i < explored.length; i++) {
          if (explored[i]) count++;
        }
        
        const pct = count / totalCells;
        const objKey = 'explore30';
        
        if (pct >= this._explorationMilestone && !this._objectivesCompleted[team].has(objKey)) {
          this._objectivesCompleted[team].add(objKey);
          const bonus = 20;
          if (team === TEAM_USER) {
            this.userScore += bonus;
            this._queueCommentary(`🎯 OBJECTIVE: First to explore 30%! +${bonus} pts`, 2);
          } else {
            this.aiScore += bonus;
          }
        }
      }
    }

    // Helper to destroy decoys in a blast radius
    _destroyDecoysInRadius(centerX, centerY, radius) {
      let destroyed = 0;
      for (let i = this._decoys.length - 1; i >= 0; i--) {
        const d = this._decoys[i];
        if (!d.active) continue;
        const dx = Math.abs(d.x - centerX);
        const dy = Math.abs(d.y - centerY);
        if (dx <= radius && dy <= radius) {
          d.active = false;
          this._decoys.splice(i, 1);
          destroyed++;
        }
      }
      if (destroyed > 0) {
        this._spawnFloatingText(centerX, centerY, `🧀💥x${destroyed}`, '#ffcc00');
      }
      return destroyed;
    }

    // === DECOYS ===
    _updateDecoys(dt) {
      const t = nowMs();
      
      // Update cooldowns (user and AI)
      if (this._wallBlastCooldown > 0) this._wallBlastCooldown -= dt;
      if (this._decoyCooldown > 0) this._decoyCooldown -= dt;
      if (this._aiWallBlastCooldown > 0) this._aiWallBlastCooldown -= dt;
      if (this._aiDecoyCooldown > 0) this._aiDecoyCooldown -= dt;
      
      for (let i = this._decoys.length - 1; i >= 0; i--) {
        const d = this._decoys[i];
        if (!d.active) {
          this._decoys.splice(i, 1);
          continue;
        }
        
        // Check if any mouse is on the decoy (will eat it)
        let decoyEaten = false;
        for (const m of this.mice) {
          if (!m.isActive()) continue;
          if (m.cell.x === d.x && m.cell.y === d.y) {
            // Mouse eats the decoy - it disappears
            d.active = false;
            decoyEaten = true;
            
            // Apply sickness to enemy mouse that ate the decoy
            if (m.team !== d.team && m.sickSourceId !== d.id) {
              m.isSick = true;
              m.sickUntilMs = t + this._decoySicknessDuration;
              m.sickSpeedReduction = this._decoySicknessSpeed;
              m.sickSourceId = d.id; // Track infection source
              m.poopTrail = [];
              this.audio.playSound('bad_stomach');
              this._spawnFloatingText(m.px, m.py, '🤢', 'rgba(100,180,50,0.95)');
              this._queueCommentary(`🧀💀 ${m.team === TEAM_USER ? 'Your' : 'Enemy'} mouse ate the poisoned decoy!`, 2);
            } else {
              // Friendly mouse - small boost instead
              this._queueCommentary(`🧀 ${m.team === TEAM_USER ? 'Your' : 'Enemy'} mouse ate the cheese!`, 1);
            }
            break;
          }
        }
        
        // Check if cat is on the decoy (will eat it and get sick)
        if (!decoyEaten && d.active) {
          const cats = [this.userCat, this.aiCat].filter(c => c && c.isActive());
          for (const cat of cats) {
            if (cat.cell.x === d.x && cat.cell.y === d.y) {
              // Cat eats the decoy
              d.active = false;
              decoyEaten = true;
              
              // Make cat sick (slower and faster lifetime drain)
              cat.isSick = true;
              cat.sickUntilMs = t + 10000; // 10 seconds
              cat.sickSpeedReduction = 0.6; // 40% slower
              this.audio.playSound('bad_stomach');
              this._spawnFloatingText(cat.cell.x, cat.cell.y, '🐱🤢', 'rgba(100,180,50,0.95)');
              this._queueCommentary(`🧀🐱 ${cat.team === TEAM_USER ? 'Your' : 'Enemy'} cat ate the poisoned cheese!`, 2);
              break;
            }
          }
        }
        
        if (decoyEaten) {
          this._decoys.splice(i, 1);
          continue;
        }
        
        // Attract nearby enemy mice (only if still active)
        // Larger range and continuous attraction until cheese is eaten
        if (d.active) {
          for (const m of this.mice) {
            if (!m.isActive() || m.team === d.team) continue;
            const dist = Math.abs(m.cell.x - d.x) + Math.abs(m.cell.y - d.y);
            // Attraction range of 8 cells, continuously refreshes
            if (dist <= 8) {
              m._decoyDistracted = true;
              m._decoyTarget = { x: d.x, y: d.y };
            }
          }
        }
      }
      
      // Check for sickness spreading between mice (contact)
      this._updateSicknessSpread(t);
    }
    
    _updateSicknessSpread(t) {
      // Check if sick mice touch healthy mice OR healthy mice touch poop
      for (const m of this.mice) {
        if (!m.isActive()) continue;
        
        // Sick mouse touching healthy mice spreads sickness
        if (m.isSick && t < m.sickUntilMs) {
          for (const other of this.mice) {
            if (!other.isActive() || other === m) continue;
            // Only spread if they haven't been infected by this chain
            if (other.sickSourceId === m.sickSourceId) continue;
            // Check if same cell
            if (other.cell.x === m.cell.x && other.cell.y === m.cell.y) {
              other.isSick = true;
              other.sickUntilMs = t + this._decoySicknessDuration;
              other.sickSpeedReduction = this._decoySicknessSpeed;
              other.sickSourceId = m.sickSourceId; // Pass along same source
              other.poopTrail = [];
              this.audio.playSound('bad_stomach');
              this._spawnFloatingText(other.px, other.py, '🤢', 'rgba(100,180,50,0.95)');
              this._queueCommentary(`🤮 Sickness spread to ${other.team === TEAM_USER ? 'your' : 'enemy'} mouse!`, 2);
            }
          }
        }
        
        // Healthy mouse touching poop from sick mice
        if (!m.isSick || t >= m.sickUntilMs) {
          for (const other of this.mice) {
            if (!other.poopTrail || other.poopTrail.length === 0) continue;
            // Only check poop from mice with different infection source
            if (other.sickSourceId && m.sickSourceId === other.sickSourceId) continue;
            
            for (const poop of other.poopTrail) {
              // Check if mouse is near poop (within a cell)
              const poopCellX = Math.floor((poop.x - this._layout().offsetX) / this._layout().cellSize);
              const poopCellY = Math.floor((poop.y - this._layout().offsetY) / this._layout().cellSize);
              if (m.cell.x === poopCellX && m.cell.y === poopCellY) {
                m.isSick = true;
                m.sickUntilMs = t + this._decoySicknessDuration;
                m.sickSpeedReduction = this._decoySicknessSpeed;
                m.sickSourceId = other.sickSourceId; // Inherit source
                m.poopTrail = [];
                this.audio.playSound('bad_stomach');
                this._spawnFloatingText(m.px, m.py, '💩🤢', 'rgba(139,69,19,0.95)');
                this._queueCommentary(`💩 ${m.team === TEAM_USER ? 'Your' : 'Enemy'} mouse stepped in poop!`, 2);
                break;
              }
            }
          }
        }
      }
    }
    
    // === LASER FENCES ===
    _updateLaserFences(dt) {
      const t = nowMs();
      
      // Update cooldown
      if (this._laserFenceCooldown > 0) this._laserFenceCooldown -= dt;
      if (this._aiLaserFenceCooldown > 0) this._aiLaserFenceCooldown -= dt;
      
      // Clean up expired fences
      for (let i = this._laserFences.length - 1; i >= 0; i--) {
        const fence = this._laserFences[i];
        if (!fence.active || t - fence.spawnedAt >= fence.duration) {
          fence.active = false;
          this._laserFences.splice(i, 1);
        }
      }
    }

    // === WALL BLAST ===
    tryWallBlast(cellX, cellY) {
      if (!this.roundActive) return false;
      if (this._wallBlastCooldown > 0) {
        this.setMessage(`Wall Blast on cooldown: ${Math.ceil(this._wallBlastCooldown)}s`);
        this.audio.playSound('alert');
        return false;
      }
      const effCost = this._desperationMode ? Math.floor(this.wallBlastCost * 0.5) : this.wallBlastCost;
      if (this.userScore < effCost) {
        this.setMessage('Not enough points for Wall Blast!');
        this.audio.playSound('alert');
        return false;
      }
      
      this.userScore -= effCost;
      this.maze.breakWallsAround(cellX, cellY, 1);
      this.distanceToGoal = this.maze.computeDistanceMap(this.maze.goal.x, this.maze.goal.y);
      
      // Uncover the bombed area from fog
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = cellX + dx;
          const ty = cellY + dy;
          if (this.maze.inBounds(tx, ty)) {
            this._markExplored(TEAM_USER, tx, ty);
          }
        }
      }
      
      // Destroy any decoy cheeses in the blast radius
      this._destroyDecoysInRadius(cellX, cellY, 1);
      
      // Start cooldown
      this._wallBlastCooldown = this._wallBlastCooldownDuration;
      
      // Visual feedback - larger explosion
      this.blasts.push({ x: cellX, y: cellY, t0: nowMs(), isWallBlast: true });
      this.audio.playSound('bomb');
      this._queueCommentary('💥 WALL BLAST! New paths opened!', 2);
      
      this._wallBlastMode = false;
      this.wallBlastBtn?.classList.remove('btn--active');
      this._hoveredWallCell = null;
      return true;
    }

    // === DECOY CHEESE ===
    tryDecoyCheese() {
      if (!this.roundActive) return false;
      if (this._decoyCooldown > 0) {
        this.setMessage(`Decoy Cheese on cooldown: ${Math.ceil(this._decoyCooldown)}s`);
        this.audio.playSound('alert');
        return false;
      }
      const effCost = this._desperationMode ? Math.floor(this.decoyCheeseCost * 0.5) : this.decoyCheeseCost;
      if (this.userScore < effCost) {
        this.setMessage('Not enough points for Decoy Cheese!');
        this.audio.playSound('alert');
        return false;
      }
      
      // Find a random cell in the enemy (AI) half of the maze
      const isAiHalf = (x, y) => {
        const du = Math.abs(x - this.maze.userStart.x) + Math.abs(y - this.maze.userStart.y);
        const da = Math.abs(x - this.maze.aiStart.x) + Math.abs(y - this.maze.aiStart.y);
        return da < du;
      };
      
      const candidates = [];
      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          if (isAiHalf(x, y) && !(x === this.maze.goal.x && y === this.maze.goal.y)) {
            candidates.push({ x, y });
          }
        }
      }
      
      if (candidates.length === 0) {
        this.setMessage('No valid location for decoy!');
        return false;
      }
      
      const chosen = candidates[Math.floor(this.rng() * candidates.length)];
      
      this.userScore -= effCost;
      
      // Start cooldown
      this._decoyCooldown = this._decoyCooldownDuration;
      
      // Uncover the decoy area from fog (3x3 around it)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = chosen.x + dx;
          const ty = chosen.y + dy;
          if (this.maze.inBounds(tx, ty)) {
            this._markExplored(TEAM_USER, tx, ty);
          }
        }
      }
      
      this._decoys.push({
        id: this._nextDecoyId++,
        x: chosen.x,
        y: chosen.y,
        team: TEAM_USER,
        spawnedAt: nowMs(),
        duration: 8000,
        active: true
      });
      
      this.audio.playSound('deploy');
      this._queueCommentary('🧀 Decoy cheese dropped in enemy territory!', 1);
      
      return true;
    }
    
    // Place decoy cheese at a specific cell (user-clicked placement)
    _placeDecoyAtCell(cellX, cellY) {
      if (!this.roundActive) return false;
      if (this._decoyCooldown > 0) {
        this.setMessage(`Decoy Cheese on cooldown: ${Math.ceil(this._decoyCooldown)}s`);
        this.audio.playSound('alert');
        return false;
      }
      
      const effCost = this._desperationMode ? Math.floor(this.decoyCheeseCost * 0.5) : this.decoyCheeseCost;
      if (this.userScore < effCost) {
        this.setMessage('Not enough points for Decoy Cheese!');
        this.audio.playSound('alert');
        return false;
      }
      
      // Don't allow placement on the goal
      if (cellX === this.maze.goal.x && cellY === this.maze.goal.y) {
        this.setMessage('Cannot place decoy on the goal!');
        this.audio.playSound('alert');
        return false;
      }
      
      this.userScore -= effCost;
      this._decoyCooldown = this._decoyCooldownDuration;
      
      // Uncover the decoy area from fog (3x3 around it)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = cellX + dx;
          const ty = cellY + dy;
          if (this.maze.inBounds(tx, ty)) {
            this._markExplored(TEAM_USER, tx, ty);
          }
        }
      }
      
      this._decoys.push({
        id: this._nextDecoyId++,
        x: cellX,
        y: cellY,
        team: TEAM_USER,
        spawnedAt: nowMs(),
        duration: 8000,
        active: true
      });
      
      this.audio.playSound('deploy');
      this._queueCommentary('🧀 Decoy cheese placed!', 1);
      
      // Exit placement mode
      this._decoyPlaceMode = false;
      this._hoveredDecoyCell = null;
      this.decoyCheeseBtn?.classList.remove('btn--active');
      if (this._decoyGuideEl) this._decoyGuideEl.classList.remove('active');
      
      return true;
    }
    
    // Place laser fence at a specific cell (user-clicked placement)
    _placeLaserFenceAtCell(cellX, cellY) {
      if (!this.roundActive) return false;
      if (this._laserFenceCooldown > 0) {
        this.setMessage(`Laser Fence on cooldown: ${Math.ceil(this._laserFenceCooldown)}s`);
        this.audio.playSound('alert');
        return false;
      }
      
      const effCost = this._desperationMode ? Math.floor(this._laserFenceCost * 0.5) : this._laserFenceCost;
      if (this.userScore < effCost) {
        this.setMessage('Not enough points for Laser Fence!');
        this.audio.playSound('alert');
        return false;
      }
      
      this.userScore -= effCost;
      this._laserFenceCooldown = this._laserFenceCooldownDuration;
      
      const halfSize = Math.floor(this._laserFenceSize / 2);
      
      // Create the laser fence
      const newFence = {
        x: cellX,
        y: cellY,
        team: TEAM_USER,
        spawnedAt: nowMs(),
        duration: this._laserFenceDuration,
        active: true,
        size: this._laserFenceSize
      };
      this._laserFences.push(newFence);
      
      // Uncover the area within the laser fence perimeter
      for (let dy = -halfSize; dy <= halfSize; dy++) {
        for (let dx = -halfSize; dx <= halfSize; dx++) {
          const tx = cellX + dx;
          const ty = cellY + dy;
          if (this.maze.inBounds(tx, ty)) {
            this._markExplored(TEAM_USER, tx, ty);
          }
        }
      }
      
      // Push any entities that are exactly on the boundary
      this._pushEntitiesOffFenceBoundary(newFence);
      
      this.audio.playSound('laser_fence_deploy');
      this._spawnFloatingText(cellX, cellY, '⚡ LASER FENCE!', '#ff0000');
      this._queueCommentary('⚡ Laser fence deployed! Nobody can pass!', 2);
      
      // Exit placement mode
      this._laserFencePlaceMode = false;
      this._hoveredLaserFenceCell = null;
      this.laserFenceBtn?.classList.remove('btn--active');
      
      return true;
    }
    
    // Check if movement crosses the thin laser fence boundary
    _isCellBlockedByLaserFence(fromX, fromY, toX, toY) {
      const tNow = nowMs();
      for (const fence of this._laserFences) {
        if (!fence.active) continue;
        if (tNow - fence.spawnedAt >= fence.duration) continue;
        
        const halfSize = Math.floor(fence.size / 2);
        
        // Check if 'from' is inside the fence boundary
        const fromDx = fromX - fence.x;
        const fromDy = fromY - fence.y;
        const fromInside = Math.abs(fromDx) <= halfSize && Math.abs(fromDy) <= halfSize;
        
        // Check if 'to' is inside the fence boundary  
        const toDx = toX - fence.x;
        const toDy = toY - fence.y;
        const toInside = Math.abs(toDx) <= halfSize && Math.abs(toDy) <= halfSize;
        
        // Block if crossing the boundary (one inside, one outside)
        if (fromInside !== toInside) {
          return fence;
        }
      }
      return null;
    }
    
    // Check if an entity is exactly on the fence boundary and push them
    _isOnLaserFenceBoundary(cellX, cellY) {
      for (const fence of this._laserFences) {
        if (!fence.active) continue;
        const halfSize = Math.floor(fence.size / 2);
        const dx = cellX - fence.x;
        const dy = cellY - fence.y;
        
        // On boundary if exactly at the edge
        const onEdge = (Math.abs(dx) === halfSize && Math.abs(dy) <= halfSize) ||
                       (Math.abs(dy) === halfSize && Math.abs(dx) <= halfSize);
        if (onEdge) {
          return { fence, dx, dy };
        }
      }
      return null;
    }
    
    // Push entities off the laser fence boundary when deployed
    _pushEntitiesOffFenceBoundary(fence) {
      const halfSize = Math.floor(fence.size / 2);
      
      // Check all mice
      for (const m of this.mice) {
        if (!m.isActive()) continue;
        const dx = m.cell.x - fence.x;
        const dy = m.cell.y - fence.y;
        
        // Check if exactly on the boundary edge
        const onVerticalEdge = Math.abs(dx) === halfSize && Math.abs(dy) <= halfSize;
        const onHorizontalEdge = Math.abs(dy) === halfSize && Math.abs(dx) <= halfSize;
        
        if (onVerticalEdge || onHorizontalEdge) {
          // Zap and push
          this.audio.playSound('electric_zap');
          this._spawnFloatingText(m.cell.x, m.cell.y, '⚡ZAP!', '#ff0000');
          
          // Determine if closer to inside or outside and push accordingly
          const distToCenter = Math.max(Math.abs(dx), Math.abs(dy));
          
          // Push inward (toward center) or outward based on which is closer
          // If on edge, push outward (away from fence)
          if (onVerticalEdge) {
            m.cell.x += dx > 0 ? 1 : -1; // Push outward horizontally
          }
          if (onHorizontalEdge) {
            m.cell.y += dy > 0 ? 1 : -1; // Push outward vertically
          }
          
          // Clamp to maze bounds
          m.cell.x = Math.max(0, Math.min(this.maze.w - 1, m.cell.x));
          m.cell.y = Math.max(0, Math.min(this.maze.h - 1, m.cell.y));
          m.nextCell = null;
          m.progress = 0;
        }
      }
      
      // Check cats
      const cats = [this.userCat, this.aiCat].filter(c => c && c.isActive());
      for (const cat of cats) {
        const dx = cat.cell.x - fence.x;
        const dy = cat.cell.y - fence.y;
        
        const onVerticalEdge = Math.abs(dx) === halfSize && Math.abs(dy) <= halfSize;
        const onHorizontalEdge = Math.abs(dy) === halfSize && Math.abs(dx) <= halfSize;
        
        if (onVerticalEdge || onHorizontalEdge) {
          this.audio.playSound('electric_zap');
          this._spawnFloatingText(cat.cell.x, cat.cell.y, '⚡ZAP!', '#ff0000');
          
          if (onVerticalEdge) {
            cat.cell.x += dx > 0 ? 1 : -1;
          }
          if (onHorizontalEdge) {
            cat.cell.y += dy > 0 ? 1 : -1;
          }
          
          cat.cell.x = Math.max(0, Math.min(this.maze.w - 1, cat.cell.x));
          cat.cell.y = Math.max(0, Math.min(this.maze.h - 1, cat.cell.y));
          cat.nextCell = null;
          cat.progress = 0;
        }
      }
    }

    // === BET MODAL METHODS ===
    _openBetModal(mouse) {
      if (!mouse || !this._betOverlay) return;
      this._betModalOpen = true;
      this._betTargetMouse = mouse;
      this._betOverlay.classList.add('active');
      
      // Update bet option displays with current costs
      const options = this._betOverlay.querySelectorAll('.bet-option');
      options.forEach(opt => {
        const level = opt.getAttribute('data-bet');
        const info = this._betOptions[level];
        if (info) {
          const costSpan = opt.querySelector('.bet-cost');
          const rewardSpan = opt.querySelector('.bet-reward');
          if (costSpan) costSpan.textContent = `-${info.cost}`;
          if (rewardSpan) rewardSpan.textContent = `+${info.reward}`;
          // Disable if not enough points
          opt.classList.toggle('disabled', this.userScore < info.cost);
        }
      });
    }
    
    _closeBetModal() {
      this._betModalOpen = false;
      this._betTargetMouse = null;
      if (this._betOverlay) this._betOverlay.classList.remove('active');
    }
    
    _placeBet(level) {
      const mouse = this._betTargetMouse;
      const info = this._betOptions[level];
      if (!mouse || !info) {
        this._closeBetModal();
        return;
      }
      
      if (this.userScore < info.cost) {
        this.setMessage('Not enough points for this bet!');
        this.audio.playSound('alert');
        return;
      }
      
      // Deduct cost
      this.userScore -= info.cost;
      
      // Set the bet reward on the mouse
      mouse.betReward = info.reward;
      
      this.audio.playSound('deploy');
      this.setMessage(`🎲 Bet placed on ${mouse.name}! Reward: +${info.reward} if they win!`);
      this._queueCommentary(`💰 ${level.toUpperCase()} bet on ${mouse.name}!`, 2);
      
      this._closeBetModal();
    }

    // === AI SABOTAGE ABILITIES ===
    
    // AI places decoy cheese in USER's half of the maze
    tryAIDecoyCheese() {
      if (!this.roundActive) return false;
      if (this._aiDecoyCooldown > 0) return false;
      if (this.aiScore < this.decoyCheeseCost) return false;
      
      // Find a random cell in the USER's half of the maze
      const isUserHalf = (x, y) => {
        const du = Math.abs(x - this.maze.userStart.x) + Math.abs(y - this.maze.userStart.y);
        const da = Math.abs(x - this.maze.aiStart.x) + Math.abs(y - this.maze.aiStart.y);
        return du < da;
      };
      
      const candidates = [];
      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          if (isUserHalf(x, y) && !(x === this.maze.goal.x && y === this.maze.goal.y)) {
            candidates.push({ x, y });
          }
        }
      }
      
      if (candidates.length === 0) return false;
      
      const chosen = candidates[Math.floor(this.rng() * candidates.length)];
      
      this.aiScore -= this.decoyCheeseCost;
      this._aiDecoyCooldown = this._decoyCooldownDuration;
      
      this._decoys.push({
        id: this._nextDecoyId++,
        x: chosen.x,
        y: chosen.y,
        team: TEAM_AI,
        spawnedAt: nowMs(),
        duration: 8000,
        active: true
      });
      
      // Uncover the decoy area for the player since it's in their territory
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = chosen.x + dx;
          const ty = chosen.y + dy;
          if (this.maze.inBounds(tx, ty)) {
            this._markExplored(TEAM_USER, tx, ty);
          }
        }
      }
      
      this.audio.playSound('deploy');
      this._queueCommentary('🧀 AI placed decoy cheese in your territory!', 2);
      
      return true;
    }
    
    // AI uses wall blast to help its mice
    tryAIWallBlast(cellX, cellY) {
      if (!this.roundActive) return false;
      if (this._aiWallBlastCooldown > 0) return false;
      if (this.aiScore < this.wallBlastCost) return false;
      
      this.aiScore -= this.wallBlastCost;
      this.maze.breakWallsAround(cellX, cellY, 1);
      this.distanceToGoal = this.maze.computeDistanceMap(this.maze.goal.x, this.maze.goal.y);
      
      // Uncover the bombed area from fog (for AI team)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = cellX + dx;
          const ty = cellY + dy;
          if (this.maze.inBounds(tx, ty)) {
            this._markExplored(TEAM_AI, tx, ty);
          }
        }
      }
      
      // Destroy any decoy cheeses in the blast radius (AI can use this too)
      this._destroyDecoysInRadius(cellX, cellY, 1);
      
      this._aiWallBlastCooldown = this._wallBlastCooldownDuration;
      
      // Visual feedback
      this.blasts.push({ x: cellX, y: cellY, t0: nowMs(), isWallBlast: true });
      this.audio.playSound('bomb');
      this._queueCommentary('💥 AI blasted open new paths!', 2);
      
      return true;
    }

    // === BETTING / DOUBLE DOWN ===
    tryDoubleDown(mouse) {
      if (!mouse || !mouse.isActive()) return false;
      if (mouse.team !== TEAM_USER) return false;
      if (mouse.hasBet) {
        this.setMessage('Already bet on this mouse!');
        return false;
      }
      if (this.userScore < this.doubleDownCost) {
        this.setMessage('Not enough points to Double Down!');
        this.audio.playSound('alert');
        return false;
      }
      
      this.userScore -= this.doubleDownCost;
      mouse.hasBet = true;
      mouse.betAmount = this.doubleDownCost;
      this._bets.push({ mouseId: mouse.id, amount: this.doubleDownCost, team: TEAM_USER });
      
      this.audio.playSound('deploy');
      this._queueCommentary(`🎰 Double Down on ${mouse.displayName}! Win = +150 pts`, 2);
      return true;
    }

    _resolveBet(mouse) {
      if (!mouse.hasBet) return;
      // If this mouse reached the goal first
      const payout = 150;
      if (mouse.team === TEAM_USER) {
        this.userScore += payout;
        this._queueCommentary(`🎰 BET WON! ${mouse.displayName} delivers +${payout} pts!`, 3);
      }
      mouse.hasBet = false;
    }

    // === ASSIGN PERSONALITY ===
    _assignPersonality(mouse) {
      const traits = this._personalityTraits;
      const trait = traits[Math.floor(this.rng() * traits.length)];
      if (trait !== 'normal') {
        mouse.personality = trait;
      }
    }

    _layout() {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const pad = Math.max(10, Math.floor(Math.min(w, h) * 0.03));
      const zoom = this._currentZoom || 1;
      const cellSize = Math.floor(
        Math.min((w - pad * 2) / this.maze.w, (h - pad * 2) / this.maze.h) * zoom
      );
      const gridW = cellSize * this.maze.w;
      const gridH = cellSize * this.maze.h;
      let offsetX = Math.floor((w - gridW) / 2);
      let offsetY = Math.floor((h - gridH) / 2);
      
      // Pan towards zoom center if zoomed in
      if (zoom > 1 && this._zoomCenter) {
        const cx = this._zoomCenter.x;
        const cy = this._zoomCenter.y;
        const targetX = w / 2 - (cx + 0.5) * cellSize;
        const targetY = h / 2 - (cy + 0.5) * cellSize;
        offsetX = Math.floor(targetX);
        offsetY = Math.floor(targetY);
      }
      return { cellSize, offsetX, offsetY, gridW, gridH, zoom };
    }

    _endRound(reason) {
      if (!this.roundActive) return;
      this.roundActive = false;
      
      // Stop end strings music immediately if playing
      this.audio.stopEndStrings(false);
      
      // Pause background music immediately (win/lose music will play instead)
      this.audio.pauseBgMusic();

      // Freeze active mice.
      for (const m of this.mice) {
        if (m.isActive()) m.destroy();
      }

      // Clear blood stains at end of round
      this.bloodStains = [];

      // Clear decoys at end of round
      this._decoys = [];
      
      // Clear laser fences at end of round
      this._laserFences = [];

      // Reset zoom
      this._currentZoom = 1;
      this._targetZoom = 1;
      this._zoomCenter = null;
      this._targetZoomCenter = null;

      // Store round scores for final display
      this.roundScores.push({
        round: this.round,
        user: Math.floor(this.userScore),
        ai: Math.floor(this.aiScore)
      });

      this.userTotal += Math.floor(this.userScore);
      this.aiTotal += Math.floor(this.aiScore);

      this.setMessage(`Round ${this.round} ended (${reason}).`);

      if (this.round >= this.maxRounds) {
        this._checkAndShowNewRecord();
      } else {
        this._showRoundModal(reason);
        this._awaitingRoundAdvance = true;
      }
    }

    _maybeAdvanceRound(dt) {
      // Round flow is now user-driven via the Round Results modal.
      // Keep this method for safety, but do nothing.
      void dt;
    }

    _showRoundModal(reason) {
      const rs = this.roundScores[this.roundScores.length - 1];
      const user = rs?.user ?? Math.floor(this.userScore);
      const ai = rs?.ai ?? Math.floor(this.aiScore);

      const userWon = user > ai;
      const aiWon = ai > user;
      const isDraw = user === ai;

      // Play appropriate sound based on round outcome (only if not already played by goal reach)
      const goalReached = reason && reason.includes('reached goal');
      if (!goalReached) {
        if (userWon) {
          this.audio.playSound('win');
        } else if (aiWon) {
          this.audio.playSound('lose');
        }
      }

      // Dynamic title based on outcome
      let titleText, titleClass;
      if (userWon) {
        titleText = '🎉 You Win!';
        titleClass = 'round-title--win';
      } else if (aiWon) {
        titleText = '😞 You Lose';
        titleClass = 'round-title--lose';
      } else {
        titleText = '🤝 Draw';
        titleClass = 'round-title--draw';
      }

      this.roundOverlayTitle.textContent = titleText;
      this.roundOverlayTitle.className = `overlay__title ${titleClass}`;

      // Initial HTML with score placeholders
      this.roundOverlayText.innerHTML = `
        <div class="round-subtitle">Round ${this.round} • ${reason}</div>
        <div class="score-breakdown score-breakdown--animated">
          <div class="score-calc" id="scoreCalcLabel">
            <div class="score-calc__label">🧮 Calculating scores...</div>
          </div>
          <div class="score-row score-row--user${userWon ? ' score-row--winner' : ''}">
            <div class="score-row__label">You</div>
            <div class="score-row__value" id="userScoreAnim">0</div>
          </div>
          <div class="score-row score-row--ai${aiWon ? ' score-row--winner' : ''}">
            <div class="score-row__label">Computer</div>
            <div class="score-row__value" id="aiScoreAnim">0</div>
          </div>
          <div class="score-comparison${userWon ? ' comparison--win' : aiWon ? ' comparison--lose' : ''}" id="scoreComparisonRow" style="opacity:0">
            <span class="comparison__diff">${userWon ? '+' : ''}${user - ai}</span>
            <span class="comparison__label">${userWon ? 'ahead' : aiWon ? 'behind' : 'tied'}</span>
          </div>
          <div class="final-line" id="finalTotalsRow" style="opacity:0">
            <div class="final-line__label">Championship Totals</div>
            <div class="final-line__value">You ${Math.floor(this.userTotal)} • Computer ${Math.floor(this.aiTotal)}</div>
          </div>
        </div>
      `;
      this.roundOverlayBtn.textContent = this.round + 1 <= this.maxRounds ? `Next Round (Round ${this.round + 1})` : 'Continue';
      this.roundOverlay.classList.add('active');

      // Animate the scores counting up
      this._animateScoreCount(user, ai);

      // Spawn confetti if user won
      if (userWon) {
        this._spawnConfetti('round');
      }
    }

    _animateScoreCount(userFinal, aiFinal) {
      const userEl = document.getElementById('userScoreAnim');
      const aiEl = document.getElementById('aiScoreAnim');
      const calcLabel = document.getElementById('scoreCalcLabel');
      const compRow = document.getElementById('scoreComparisonRow');
      const totalsRow = document.getElementById('finalTotalsRow');
      
      if (!userEl || !aiEl) return;
      
      const duration = 1500; // 1.5 seconds
      const startTime = performance.now();
      
      const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        
        // Ease-out curve for nice deceleration
        const eased = 1 - Math.pow(1 - progress, 3);
        
        const currentUser = Math.floor(userFinal * eased);
        const currentAi = Math.floor(aiFinal * eased);
        
        userEl.textContent = currentUser;
        aiEl.textContent = currentAi;
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // Animation complete - show final values and hide "calculating"
          userEl.textContent = userFinal;
          aiEl.textContent = aiFinal;
          
          // Hide the "calculating" text
          if (calcLabel) {
            calcLabel.style.transition = 'opacity 0.3s';
            calcLabel.style.opacity = '0';
            setTimeout(() => { calcLabel.style.display = 'none'; }, 300);
          }
          
          // Show comparison and totals with fade-in
          if (compRow) {
            compRow.style.transition = 'opacity 0.4s';
            compRow.style.opacity = '1';
          }
          if (totalsRow) {
            setTimeout(() => {
              totalsRow.style.transition = 'opacity 0.4s';
              totalsRow.style.opacity = '1';
            }, 200);
          }
        }
      };
      
      requestAnimationFrame(animate);
    }
    
    _updateStartButton() {
      if (this.startBtn) {
        this.startBtn.disabled = !this._selectedDifficulty;
      }
    }
    
    _loadPersonalRecord() {
      try {
        const data = localStorage.getItem('mouseDeployRecord');
        if (data) {
          this._personalRecord = JSON.parse(data);
          if (this.personalRecordValue) {
            this.personalRecordValue.textContent = `${this._personalRecord.score} pts (${this._personalRecord.name})`;
          }
        } else {
          this._personalRecord = null;
        }
      } catch {
        this._personalRecord = null;
      }
    }
    
    _savePersonalRecord(name) {
      try {
        this._personalRecord = {
          score: this.userTotal,
          name: name,
          difficulty: this.difficulty,
          rounds: this.maxRounds,
          date: new Date().toISOString()
        };
        localStorage.setItem('mouseDeployRecord', JSON.stringify(this._personalRecord));
      } catch {
        // localStorage might be unavailable
      }
    }
    
    _checkAndShowNewRecord() {
      const winner = this.userTotal > this.aiTotal ? 'User' : this.userTotal < this.aiTotal ? 'Computer' : 'Tie';
      const isNewRecord = winner === 'User' && (!this._personalRecord || this.userTotal > this._personalRecord.score);
      
      if (isNewRecord) {
        // Show record entry overlay
        if (this.recordOverlay && this.recordText) {
          this.recordText.textContent = `Score: ${this.userTotal} pts on ${this.difficulty} difficulty!`;
          if (this.recordNameInput) this.recordNameInput.value = '';
          this.recordOverlay.style.display = 'flex';
          // Store pending final modal
          this._pendingFinalModal = true;
        } else {
          this._showFinalModal();
        }
      } else {
        this._showFinalModal();
      }
    }

    _showFinalModal() {
      // Make final overlay "grander" with a richer breakdown.
      const winner = this.userTotal === this.aiTotal ? 'Tie' : this.userTotal > this.aiTotal ? 'User' : 'Computer';
      
      // Play final win or lose sound
      if (winner === 'User') {
        this.audio.playSound('final_win');
      } else if (winner === 'Computer') {
        this.audio.playSound('lose');
      }
      
      let title, titleClass;
      if (winner === 'User') {
        title = '🏆 VICTORY!';
        titleClass = 'overlay__title--grand overlay__title--win';
      } else if (winner === 'Computer') {
        title = '💔 DEFEAT';
        titleClass = 'overlay__title--grand overlay__title--lose';
      } else {
        title = '🤝 DRAW';
        titleClass = 'overlay__title--grand overlay__title--draw';
      }

      // Confetti when the human wins the total game.
      if (winner === 'User') {
        this._finalVictory = true;
        this._spawnConfetti('final');
      }

      // Upgrade card style (grand)
      const card = this.overlay?.querySelector?.('.overlay__card');
      if (card) {
        card.classList.add('overlay__card--grand');
        card.classList.remove('overlay__card--win', 'overlay__card--lose');
        if (winner === 'User') card.classList.add('overlay__card--win');
        else if (winner === 'Computer') card.classList.add('overlay__card--lose');
      }
      this.overlayTitle.className = titleClass;
      this.overlayTitle.textContent = title;

      let rows = '';
      for (const rs of this.roundScores) {
        const userWon = rs.user > rs.ai;
        const mid = rs.user === rs.ai ? '–' : userWon ? '✓' : '✗';
        const rowClass = userWon ? 'round-table__row--win' : rs.user < rs.ai ? 'round-table__row--lose' : '';
        rows += `
          <div class="round-table__row ${rowClass}">
            <div class="round-table__round">Round ${rs.round}</div>
            <div class="round-table__you">${rs.user}</div>
            <div class="round-table__mid">${mid}</div>
            <div class="round-table__cpu">${rs.ai}</div>
          </div>
        `;
      }

      const diff = this.userTotal - this.aiTotal;
      const diffText = diff > 0 ? `+${diff} ahead` : diff < 0 ? `${diff} behind` : 'tied';
      const finalLine = `You ${Math.floor(this.userTotal)} • Computer ${Math.floor(this.aiTotal)}`;
      
      this.overlayText.innerHTML = `
        <div class="grand-badge"><span class="grand-badge__dot"></span> Championship Complete</div>
        <div class="final-verdict ${winner === 'User' ? 'verdict--win' : winner === 'Computer' ? 'verdict--lose' : ''}">
          ${winner === 'User' ? 'Congratulations! You outsmarted the computer!' : winner === 'Computer' ? 'The computer was too clever this time...' : 'An evenly matched battle!'}
        </div>
        <div class="score-breakdown">
          <div class="round-table">${rows}</div>
          <div class="final-line">
            <div class="final-line__label">Final Score</div>
            <div class="final-line__value">${finalLine}</div>
          </div>
          <div class="final-diff ${diff > 0 ? 'diff--win' : diff < 0 ? 'diff--lose' : ''}">${diffText}</div>
        </div>
      `;

      this.overlay.classList.add('active');
    }

    _updateRoundState(dt) {
      if (this._isCountingDown) {
        this._countdownTimer += dt;
        if (this._countdownTimer >= 1.0) {
          this._countdownTimer -= 1.0;
          this._countdownValue--;
          if (this._countdownValue > 0) {
            this.countdownEl.textContent = this._countdownValue;
            this.countdownEl.classList.remove('pop');
            void this.countdownEl.offsetWidth; // trigger reflow
            this.countdownEl.classList.add('pop');
            this.audio.playSound('alert');
          } else {
            this._isCountingDown = false;
            this.countdownEl.classList.remove('active');
            this.countdownEl.classList.remove('pop');
            this.roundActive = true;
            this.setMessage('Go! Deploy your mice!');
            this.audio.playSound('deploy');
            // Resume bg music for subsequent rounds (first round starts it via START button)
            if (this.round > 1) {
              this.audio.resumeBgMusic();
            }
          }
        }
        return;
      }

      if (!this.roundActive) return;

      // Count DOWN from 3 minutes
      this.timeRemaining -= dt;

      // Time decay
      this._decayAccumulator += dt;
      while (this._decayAccumulator >= 1) {
        this._decayAccumulator -= 1;
        this.userScore -= this.timeDecayPerSecond;
        this.aiScore -= this.timeDecayPerSecond;
      }

      // Clamp scores
      this.userScore = Math.max(-999999, this.userScore);
      this.aiScore = Math.max(-999999, this.aiScore);

      // AI thinking
      this.ai.update();
      
      // Check for manual mouse deployment (unlocks at 1:30 remaining = 90 seconds elapsed)
      const elapsed = this.roundDuration - this.timeRemaining;
      if (elapsed >= this._manualMouseUnlockTime) {
        // User manual mouse only deploys when user clicks the button (not auto)
        // AI manual (perfect path) mouse still auto-deploys
        if (!this._aiManualDeployed && this.getActiveMiceCount(TEAM_AI) < this.maxMicePerRound) {
          this._deployManualMouse(TEAM_AI);
        }
      }

      // Update mice
      for (const m of this.mice) m.update(dt, this);

      // Update cat (with lifetime check - sick cats drain 1.5x faster)
      if (this.userCat && this.userCat.isActive()) {
        this.userCat.update(dt, this);
        // Sick cats use extra lifetime (1.5x drain)
        if (this.userCat.isSick) {
          this.userCat.spawnedAtSec -= dt * 0.5; // Extra 0.5x drain
        }
        if (elapsed - this.userCat.spawnedAtSec >= this.catMaxLifetime) {
          this.userCat.destroyed = true;
          this.setMessage('🐈 Your cat got tired and wandered off.');
        }
      }
      if (this.aiCat && this.aiCat.isActive()) {
        this.aiCat.update(dt, this);
        // Sick cats use extra lifetime (1.5x drain)
        if (this.aiCat.isSick) {
          this.aiCat.spawnedAtSec -= dt * 0.5; // Extra 0.5x drain
        }
        if (elapsed - this.aiCat.spawnedAtSec >= this.catMaxLifetime) {
          this.aiCat.destroyed = true;
          this.setMessage('🐈 Enemy cat got tired and wandered off.');
        }
      }

      // Track where a mouse was "last seen" (only when in explored cells).
      this._updateLastSeen();

      // Resolve collisions after movement.
      this._resolveMouseCollisions();

      // Pickups respawn/update
      this._updatePickups();

      // === NEW ENGAGEMENT SYSTEMS ===
      this._updateCommentary(dt);
      this._updateSelectionZoom(); // Check selection zoom before drama mode
      this._updateDramaMode(dt);
      this._updateDesperation();
      this._updateDecoys(dt);
      this._updateLaserFences(dt);
      this._checkMiniObjectives();
      this._updateZoom(dt);

      // Time ran out - player with most points wins round
      if (this.timeRemaining <= 0) {
        this.timeRemaining = 0;
        this._endRound('time expired');
      }
    }

    _updateUI() {
      if (!this._gameStarted) return;

      this.hudRound.textContent = `Round ${this.round} / ${this.maxRounds}`;
      this.hudTime.textContent = formatTime(this.timeRemaining);
      this.hudUserScore.textContent = `${Math.floor(this.userScore)}`;
      this.hudAiScore.textContent = `${Math.floor(this.aiScore)}`;
      
      // Update totals below scores
      this.hudUserTotal.textContent = `Total: ${Math.floor(this.userTotal)}`;
      this.hudAiTotal.textContent = `Total: ${Math.floor(this.aiTotal)}`;
      
      // Update timer progress bar
      if (this._timerProgress) {
        const progress = (this.timeRemaining / this.roundDuration) * 100;
        this._timerProgress.style.width = `${progress}%`;
        // Change color as time runs out
        if (progress < 20) {
          this._timerProgress.style.background = 'linear-gradient(90deg, #ff3333, #ff6666)';
        } else if (progress < 40) {
          this._timerProgress.style.background = 'linear-gradient(90deg, #ffaa33, #ffcc66)';
        } else {
          this._timerProgress.style.background = 'linear-gradient(90deg, #4488ff, #66aaff)';
        }
      }
      
      // Deploy reminder logic
      const activeUser = this.mice.filter((m) => m.team === TEAM_USER && m.isActive());
      const elapsed = this.roundDuration - this.timeRemaining;
      const showDeployReminder = this.roundActive && (
        // Show after 7 seconds if no mice deployed
        (elapsed >= 7 && activeUser.length === 0) ||
        // Show when down to last mouse and time is running out
        (activeUser.length === 1 && this.timeRemaining < this.roundDuration * 0.3)
      );
      
      if (this._deployReminderEl) {
        const shouldShow = showDeployReminder && !this._showDeployReminder;
        if (shouldShow) {
          this._showDeployReminder = true;
          this._deployReminderEl.classList.add('active');
          // Auto-hide after 5 seconds
          setTimeout(() => {
            this._deployReminderEl?.classList.remove('active');
          }, 5000);
        }
      }
      
      const selected = this.getSelectedMouse();
      const activeUserMice = activeUser.length;

      // Populate mouse list for easy selection.
      if (this.mouseListEl) {
        const lines = [];
        const keyParts = [];
        for (const m of this.mice) {
          if (m.team !== TEAM_USER) continue;
          if (!m.isActive()) continue;
          const isSel = this.selectedMouseId === m.id;
          const num = m.displayNumber ?? '?';
          const nm = m.displayName ?? 'Mouse';
          const algo = this._algoLabel(m.algorithm);
          keyParts.push(`${m.id}:${m.algorithm}:${num}:${nm}`);
          lines.push(
            `<button class="mouse-item${isSel ? ' is-selected' : ''}" data-mid="${m.id}" type="button">` +
            `<div class="mouse-item__top">${num}# ${nm}</div>` +
            `<div class="mouse-item__sub">${algo}</div>` +
            `</button>`
          );
        }
        
        // Add user's cat to the list if active
        const hasUserCat = this.userCat && this.userCat.isActive();
        if (hasUserCat) {
          const elapsed = this.roundDuration - this.timeRemaining;
          const catLifeRemaining = Math.max(0, 90 - (elapsed - (this.userCat.spawnedAtSec || 0)));
          const catStatus = this.userCat.sleepy ? '😴 Sleepy' : 'Hunting';
          keyParts.push(`cat:${Math.floor(catLifeRemaining)}:${catStatus}`);
          lines.push(
            `<div class="mouse-item mouse-item--cat">` +
            `<div class="mouse-item__top">🐈 Your Cat</div>` +
            `<div class="mouse-item__sub">${catStatus} • ${Math.ceil(catLifeRemaining)}s left</div>` +
            `</div>`
          );
        }

        const selKey = this.selectedMouseId == null ? 'null' : String(this.selectedMouseId);
        const newKey = `${keyParts.join('|')}|sel=${selKey}`;
        if (newKey !== this._mouseListKey) {
          this._mouseListKey = newKey;
          this.mouseListEl.innerHTML = lines.length
            ? `<div class="mouse-list__title">Your Mice</div>${lines.join('')}`
            : `<div class="mouse-list__title">Your Mice</div><div class="mouse-list__empty">(none)</div>`;
        }
      }

      // AI Mouse list (read-only view)
      if (this.aiMouseListEl) {
        const aiLines = [];
        const aiKeyParts = [];
        const hasAiCat = this.aiCat && this.aiCat.isActive();
        for (const m of this.mice) {
          if (m.team !== TEAM_AI) continue;
          if (!m.isActive()) continue;
          const num = m.displayNumber ?? '?';
          const nm = m.displayName ?? 'Mouse';
          const algo = this._algoLabel(m.algorithm);
          aiKeyParts.push(`${m.id}:${m.algorithm}:${num}:${nm}`);
          aiLines.push(
            `<div class="mouse-item mouse-item--readonly">` +
            `<div class="mouse-item__top">${num}# ${nm}</div>` +
            `<div class="mouse-item__sub">${algo}</div>` +
            `</div>`
          );
        }

        // Cat indicator with lifetime
        if (hasAiCat) {
          const elapsed = this.roundDuration - this.timeRemaining;
          const catLifeRemaining = Math.max(0, 90 - (elapsed - (this.aiCat.spawnedAtSec || 0)));
          const catStatus = this.aiCat.sleepy ? '😴 Sleepy' : 'Hunting';
          aiKeyParts.push(`cat:${Math.floor(catLifeRemaining)}:${catStatus}`);
          aiLines.push(
            `<div class="mouse-item mouse-item--readonly mouse-item--cat">` +
            `<div class="mouse-item__top">🐈 Enemy Cat</div>` +
            `<div class="mouse-item__sub">${catStatus} • ${Math.ceil(catLifeRemaining)}s left</div>` +
            `</div>`
          );
        }

        const aiNewKey = aiKeyParts.join('|');
        if (aiNewKey !== this._aiMouseListKey) {
          this._aiMouseListKey = aiNewKey;
          this.aiMouseListEl.innerHTML = aiLines.length
            ? `<div class="mouse-list__title">Enemy Assets</div>${aiLines.join('')}`
            : `<div class="mouse-list__title">Enemy Assets</div><div class="mouse-list__empty">(none)</div>`;
        }
      }

      // Abilities panel - some require selection, some don't
      const hasActiveMice = activeUser.length > 0;
      
      if (selected && selected.team === TEAM_USER && selected.isActive()) {
        this.abilitiesCard.style.opacity = '1';
        this.abilitiesCard.style.pointerEvents = 'auto';
        // Speed boost: check cost AND if mouse can still be boosted
        this.speedBoostBtn.disabled = this.userScore < this.speedBoostCost || !selected.canBoostSpeed();
        this.destroyBtn.disabled = false;
        
        // Update speed boost button text
        if (!selected.canBoostSpeed()) {
          this.speedBoostBtn.textContent = '⚡ Max Boosted';
        } else {
          this.speedBoostBtn.textContent = `⚡ Speed Boost (-${this.speedBoostCost})`;
        }
      } else {
        this.abilitiesCard.style.opacity = hasActiveMice ? '0.8' : '0.5';
        this.abilitiesCard.style.pointerEvents = hasActiveMice ? 'auto' : 'none';
        this.speedBoostBtn.disabled = true;
        this.destroyBtn.disabled = true;
        this.speedBoostBtn.textContent = `⚡ Speed Boost (-${this.speedBoostCost})`;
      }
      // Hive Mind doesn't require selection
      // Hive Mind removed

      // --- New Engagement Abilities ---
      // Double Down: requires selected mouse
      if (this.doubleDownBtn) {
        const effDoubleDownCost = this._desperationMode ? Math.floor(this.doubleDownCost * 0.5) : this.doubleDownCost;
        const canDoubleDown = selected && selected.team === TEAM_USER && selected.isActive() && 
          this.userScore >= effDoubleDownCost && !this._bets.some(b => b.mouseId === selected.id);
        this.doubleDownBtn.disabled = !canDoubleDown;
        this.doubleDownBtn.textContent = `🎲 Bet (-${effDoubleDownCost})`;
      }

      // Wall Blast: doesn't require selection, has cooldown
      if (this.wallBlastBtn) {
        const effWallBlastCost = this._desperationMode ? Math.floor(this.wallBlastCost * 0.5) : this.wallBlastCost;
        const wallBlastReady = this._wallBlastCooldown <= 0;
        this.wallBlastBtn.disabled = this.userScore < effWallBlastCost || !wallBlastReady;
        if (!wallBlastReady) {
          this.wallBlastBtn.textContent = `💥 Blast (${Math.ceil(this._wallBlastCooldown)}s)`;
        } else {
          this.wallBlastBtn.textContent = `💥 Wall Blast (-${effWallBlastCost})`;
        }
        // Don't toggle class here - only in click handler
      }

      // Decoy Cheese: doesn't require selection, has cooldown
      if (this.decoyCheeseBtn) {
        const effDecoyCost = this._desperationMode ? Math.floor(this.decoyCheeseCost * 0.5) : this.decoyCheeseCost;
        const decoyReady = this._decoyCooldown <= 0;
        this.decoyCheeseBtn.disabled = this.userScore < effDecoyCost || !decoyReady;
        if (!decoyReady) {
          this.decoyCheeseBtn.textContent = `🧀 Decoy (${Math.ceil(this._decoyCooldown)}s)`;
        } else {
          this.decoyCheeseBtn.textContent = `🧀 Decoy (-${effDecoyCost})`;
        }
        // Don't toggle class here - only in click handler
      }
      
      // Laser Fence: doesn't require selection, has cooldown
      if (this.laserFenceBtn) {
        const effLaserCost = this._desperationMode ? Math.floor(this._laserFenceCost * 0.5) : this._laserFenceCost;
        const laserReady = this._laserFenceCooldown <= 0;
        this.laserFenceBtn.disabled = this.userScore < effLaserCost || !laserReady;
        if (!laserReady) {
          this.laserFenceBtn.textContent = `⚡ Fence (${Math.ceil(this._laserFenceCooldown)}s)`;
        } else {
          this.laserFenceBtn.textContent = `⚡ Laser Fence (-${effLaserCost})`;
        }
      }
      
      // Manual Mouse: unlocks at 1:30 remaining (90 seconds)
      if (this.manualMouseBtn) {
        const remaining = this.timeRemaining;
        const unlockTime = 90; // Unlocks when 1:30 remaining
        const isUnlocked = remaining <= unlockTime;
        this.manualMouseBtn.disabled = !isUnlocked;
        if (!isUnlocked) {
          const waitTime = Math.ceil(remaining - unlockTime);
          this.manualMouseBtn.textContent = `🎮 Manual (${waitTime}s)`;
        } else {
          this.manualMouseBtn.textContent = this._manualMouseQueued ? '🎮 Manual: ON' : '🎮 Manual Mouse';
        }
      }

      // Auto-Zoom toggle
      if (this.toggleZoomBtn) {
        this.toggleZoomBtn.textContent = this._autoZoomEnabled ? '🔍 Zoom: ON' : '🔍 Zoom: OFF';
      }

      // Desperation Mode indicator
      if (this._desperationMode) {
        this.abilitiesCard.classList.add('desperation');
      } else {
        this.abilitiesCard.classList.remove('desperation');
      }

      // Cat deploy (per-team)
      if (this.catDeployBtn) {
        const elapsed = this.roundDuration - this.timeRemaining;
        const readyIn = Math.max(0, this.catUnlockAt - elapsed);
        const hasUserCat = this.userCat && this.userCat.isActive();
        const canCat = this.roundActive && !hasUserCat && readyIn <= 0 && this.userScore >= this.catCost;
        this.catDeployBtn.disabled = !canCat;
        if (hasUserCat) this.catDeployBtn.textContent = '🐈 Your Cat Active';
        else if (readyIn > 0) this.catDeployBtn.textContent = `🐈 Cat (${readyIn.toFixed(0)}s)`;
        else this.catDeployBtn.textContent = `🐈 Deploy Cat (-${this.catCost})`;
      }

      // Deploy button - check cooldown and active mice count
      const cooldown = this.getCooldownRemaining(TEAM_USER);
      const canDeploy = this.roundActive && activeUserMice < this.maxMicePerRound && cooldown <= 0;
      this.deployBtn.disabled = !canDeploy;

      // Update deploy button text with cooldown
      if (cooldown > 0) {
        this.deployBtn.textContent = `Deploy (${cooldown.toFixed(1)}s)`;
      } else {
        this.deployBtn.textContent = 'Deploy Mouse';
      }

      // Get current algorithm cost
      const selectedAlgo = this.algoSelect.value;
      const algoCost = this.getAlgoCost(selectedAlgo);
      
      const selText = selected
        ? `Selected: ${selected.displayName ?? 'Mouse'} • ${this._algoLabel(selected.algorithm)} • Dist: ${selected.distanceTravelled}`
        : 'Pick a mouse from the list or click one.';

      // Cat status hint (per-team)
      let catHint = '';
      const cats = [this.userCat, this.aiCat].filter(c => c && c.isActive && c.isActive());
      for (const cat of cats) {
        if (cat.kills >= 2) {
          const who = cat.team === TEAM_AI ? 'CPU Cat' : 'Your Cat';
          if (cat.sleepy) catHint += ` • 😴 ${who} is sleepy`;
          else catHint += ` • 😴 ${who} is full`;
        }
      }
      
      let costText;
      if (activeUserMice >= this.maxMicePerRound) {
        costText = 'Max active mice. Destroy one to deploy more.';
      } else if (this.userScore < algoCost) {
        costText = `Need ${algoCost} pts for ${this._algoLabel(selectedAlgo)}`;
      } else {
        costText = `${this._algoLabel(selectedAlgo)}: -${algoCost} pts`;
      }
      
      this.deployMeta.textContent = (selected ? selText : costText) + catHint;
    }

    _drawBlasts() {
      if (!this.blasts?.length) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const t = nowMs();

      for (let i = this.blasts.length - 1; i >= 0; i--) {
        const b = this.blasts[i];
        const age = (t - b.t0) / 1000;
        const duration = b.isWallBlast ? 1.2 : 0.9;
        if (age > duration) {
          this.blasts.splice(i, 1);
          continue;
        }
        const cx = offsetX + (b.x + 0.5) * cellSize;
        const cy = offsetY + (b.y + 0.5) * cellSize;
        const p = clamp(age / duration, 0, 1);
        
        if (b.isWallBlast) {
          // Enhanced wall blast explosion with particles
          ctx.save();
          
          // Main explosion ring
          const r = (0.3 + p * 2.5) * cellSize;
          ctx.globalAlpha = (1 - p) * 0.95;
          ctx.strokeStyle = 'rgba(255,100,50,0.95)';
          ctx.lineWidth = Math.max(4, cellSize * 0.18);
          ctx.shadowColor = 'rgba(255,150,50,1)';
          ctx.shadowBlur = Math.max(20, cellSize * 1.2);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          
          // Inner flash
          if (p < 0.3) {
            const flashAlpha = (0.3 - p) / 0.3;
            ctx.fillStyle = `rgba(255,255,200,${flashAlpha * 0.8})`;
            ctx.beginPath();
            ctx.arc(cx, cy, cellSize * 1.2 * (1 - p * 2), 0, Math.PI * 2);
            ctx.fill();
          }
          
          // Debris particles
          for (let j = 0; j < 8; j++) {
            const angle = (j / 8) * Math.PI * 2 + age * 2;
            const dist = p * cellSize * 2.5;
            const px = cx + Math.cos(angle) * dist;
            const py = cy + Math.sin(angle) * dist;
            ctx.fillStyle = `rgba(139,90,43,${(1 - p) * 0.8})`;
            ctx.fillRect(px - 3, py - 3, 6, 6);
          }
          
          ctx.restore();
        } else {
          // Normal smaller blast
          const r = (0.2 + p * 1.8) * cellSize;
          ctx.save();
          ctx.globalAlpha = (1 - p) * 0.9;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = Math.max(2, cellSize * 0.10);
          ctx.shadowColor = 'rgba(255,200,80,0.8)';
          ctx.shadowBlur = Math.max(10, cellSize * 0.8);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    _drawWallBlastPreview() {
      if (!this._wallBlastMode || !this._hoveredWallCell) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const hx = this._hoveredWallCell.x;
      const hy = this._hoveredWallCell.y;
      
      ctx.save();
      
      // Draw blast radius indicator (highlights cells that will be affected)
      // Now drawn ABOVE fog so always visible
      const time = performance.now() / 1000;
      const pulse = 0.7 + Math.sin(time * 5) * 0.3;
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = hx + dx;
          const ty = hy + dy;
          if (!this.maze.inBounds(tx, ty)) continue;
          
          const px = offsetX + tx * cellSize;
          const py = offsetY + ty * cellSize;
          
          // Bright orange/red glow - visible over fog
          ctx.fillStyle = `rgba(255,120,50,${pulse * 0.45})`;
          ctx.shadowColor = 'rgba(255,150,50,1)';
          ctx.shadowBlur = 20;
          ctx.fillRect(px + 2, py + 2, cellSize - 4, cellSize - 4);
        }
      }
      
      // Draw crosshair at center - bigger and brighter
      const cx = offsetX + (hx + 0.5) * cellSize;
      const cy = offsetY + (hy + 0.5) * cellSize;
      
      ctx.strokeStyle = 'rgba(255,255,100,0.95)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255,200,50,1)';
      ctx.shadowBlur = 15;
      
      // Crosshair lines
      const crossSize = cellSize * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx - crossSize, cy);
      ctx.lineTo(cx + crossSize, cy);
      ctx.moveTo(cx, cy - crossSize);
      ctx.lineTo(cx, cy + crossSize);
      ctx.stroke();
      
      // Target circle
      ctx.beginPath();
      ctx.arc(cx, cy, crossSize * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      
      // Bomb icon at center
      ctx.shadowBlur = 10;
      ctx.font = `${Math.round(cellSize * 0.5)}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💣', cx, cy);
      
      ctx.restore();
    }

    _drawBackground() {
      const ctx = this.ctx;
      // Clear with bright theme
      ctx.fillStyle = '#F0F2F5';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    _drawMaze() {
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();

      ctx.lineWidth = Math.max(1, Math.floor(cellSize * 0.08));
      ctx.strokeStyle = this._colors.wall;

      // Don't draw maze walls inside fully unexplored cells.
      // This keeps unseen areas a surprise even though fog is a translucent overlay.
      const explored = this.userExplored;

      ctx.beginPath();
      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          if (explored && !explored[this.maze.index(x, y)]) continue;
          const px = offsetX + x * cellSize;
          const py = offsetY + y * cellSize;

          // N
          if (this.maze.hasWall(x, y, 0)) {
            ctx.moveTo(px, py);
            ctx.lineTo(px + cellSize, py);
          }
          // E
          if (this.maze.hasWall(x, y, 1)) {
            ctx.moveTo(px + cellSize, py);
            ctx.lineTo(px + cellSize, py + cellSize);
          }
          // S
          if (this.maze.hasWall(x, y, 2)) {
            ctx.moveTo(px + cellSize, py + cellSize);
            ctx.lineTo(px, py + cellSize);
          }
          // W
          if (this.maze.hasWall(x, y, 3)) {
            ctx.moveTo(px, py + cellSize);
            ctx.lineTo(px, py);
          }
        }
      }
      ctx.stroke();

      // Goal (pulsing beacon)
      const gx = offsetX + (this.maze.goal.x + 0.5) * cellSize;
      const gy = offsetY + (this.maze.goal.y + 0.5) * cellSize;
      const r = Math.max(4, cellSize * 0.25);

      const t = performance.now() / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      const ring = r * (1.6 + pulse * 0.9);

      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = this._colors.goal;
      ctx.lineWidth = Math.max(1, cellSize * 0.08);
      ctx.beginPath();
      ctx.arc(gx, gy, ring, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = this._colors.goal;
      ctx.shadowBlur = Math.max(6, cellSize * 0.35);
      ctx.fillStyle = this._colors.goal;
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw cheese in the middle of the goal
      ctx.font = `${Math.round(cellSize * 0.5)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧀', gx, gy);
      ctx.restore();
    }

    _drawPickups() {
      if (!this.pickups?.length) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const time = performance.now() / 1000;

      for (const p of this.pickups) {
        if (!p.active) continue;
        const cx = offsetX + (p.x + 0.5) * cellSize;
        const cy = offsetY + (p.y + 0.5) * cellSize;
        const floatY = Math.sin(time * 2.1 + p.pairId * 0.7 + p.x * 0.11) * (cellSize * 0.10);
        const r = Math.max(9, cellSize * 0.33);  // 50% larger pickups

        let col = 'rgba(255,255,255,0.95)';
        let glow = 'rgba(255,255,255,0.55)';
        let icon = '★';
        if (p.type === PICKUP_SPEED) {
          col = 'rgba(255,209,102,0.95)';
          glow = 'rgba(255,149,0,0.85)';
          icon = '⚡';
        } else if (p.type === PICKUP_FREEZE) {
          col = 'rgba(160,220,255,0.95)';
          glow = 'rgba(80,170,255,0.85)';
          icon = '❄';
        } else if (p.type === PICKUP_TRUTH) {
          col = 'rgba(155,255,185,0.95)';
          glow = 'rgba(60,220,120,0.85)';
          icon = '➤';
        }

        ctx.save();
        ctx.translate(cx, cy + floatY);
        
        // Outer pulsing glow - visible through fog
        const pulse = 0.6 + Math.sin(time * 2.5 + p.x * 0.5) * 0.4;
        ctx.globalAlpha = pulse;
        ctx.shadowColor = glow;
        ctx.shadowBlur = Math.max(25, cellSize * 1.2);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Main glow
        ctx.shadowColor = glow;
        ctx.shadowBlur = Math.max(15, cellSize * 0.7);

        // Orb
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // Inner highlight
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-r * 0.25, -r * 0.25, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Icon (scaled up with larger pickups)
        ctx.font = `bold ${Math.round(Math.max(16, cellSize * 0.55))}px ui-sans-serif, system-ui, Segoe UI, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillText(icon, 0, 1);

        ctx.restore();
      }
    }

    _drawDecoys() {
      if (!this._decoys || !this._decoys.length) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const time = performance.now() / 1000;

      for (const d of this._decoys) {
        if (!d.active) continue;
        const cx = offsetX + (d.x + 0.5) * cellSize;
        const cy = offsetY + (d.y + 0.5) * cellSize;
        const floatY = Math.sin(time * 3 + d.x * 0.3 + d.y * 0.5) * (cellSize * 0.10);

        ctx.save();
        ctx.translate(cx, cy + floatY);

        // Strong pulsing glow for decoy - much more visible
        const pulse = 0.7 + Math.sin(time * 3) * 0.3;
        const glowColor = d.team === TEAM_USER ? `rgba(255,220,80,${pulse})` : `rgba(255,100,100,${pulse})`;
        
        // Draw outer glow ring
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = Math.max(25, cellSize * 1.2);
        ctx.fillStyle = d.team === TEAM_USER ? 'rgba(255,200,50,0.4)' : 'rgba(255,80,80,0.4)';
        ctx.beginPath();
        ctx.arc(0, 0, cellSize * 0.45, 0, Math.PI * 2);
        ctx.fill();

        // Cheese wedge emoji - bigger
        ctx.shadowBlur = Math.max(18, cellSize * 0.8);
        ctx.font = `${Math.round(Math.max(28, cellSize * 0.85))}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🧀', 0, 2);

        // "TRAP" indicator for enemy decoys
        if (d.team === TEAM_AI) {
          ctx.shadowBlur = 0;
          ctx.font = `bold ${Math.round(cellSize * 0.22)}px ui-sans-serif`;
          ctx.fillStyle = 'rgba(255,50,50,0.95)';
          ctx.fillText('TRAP', 0, -cellSize * 0.5 - 6);
        }

        ctx.restore();
      }
    }
    
    _drawDecoyPreview() {
      // Draw decoy placement preview when in placement mode
      if (!this._decoyPlaceMode || !this._hoveredDecoyCell) return;
      
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const { x, y } = this._hoveredDecoyCell;
      const cx = offsetX + (x + 0.5) * cellSize;
      const cy = offsetY + (y + 0.5) * cellSize;
      const time = performance.now() / 1000;
      
      ctx.save();
      ctx.translate(cx, cy);
      
      // Pulsing highlight ring
      const pulse = 0.5 + Math.sin(time * 4) * 0.3;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = 'rgba(255,220,80,0.9)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255,200,50,0.8)';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(0, 0, cellSize * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      
      // Ghost cheese emoji
      ctx.globalAlpha = 0.6 + Math.sin(time * 3) * 0.2;
      ctx.shadowBlur = 10;
      ctx.font = `${Math.round(Math.max(24, cellSize * 0.7))}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧀', 0, 2);
      
      ctx.restore();
    }
    
    _drawLaserFences() {
      if (!this._laserFences || !this._laserFences.length) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const time = performance.now() / 1000;
      const tNow = nowMs();

      for (const fence of this._laserFences) {
        if (!fence.active) continue;
        const elapsed = tNow - fence.spawnedAt;
        if (elapsed >= fence.duration) continue;
        
        const halfSize = Math.floor(fence.size / 2);
        const remaining = (fence.duration - elapsed) / fence.duration;
        
        // Calculate fence boundary in pixels
        const fenceLeft = offsetX + (fence.x - halfSize) * cellSize;
        const fenceTop = offsetY + (fence.y - halfSize) * cellSize;
        const fenceWidth = (fence.size) * cellSize;
        const fenceHeight = (fence.size) * cellSize;
        
        // Pulsing effect - STRONGER
        const pulse = 0.6 + Math.sin(time * 15) * 0.4;
        const fadeAlpha = remaining * pulse;
        
        ctx.save();
        
        // MUCH stronger red glow
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 40 * remaining;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Draw thin laser fence border (like a wall)
        const lineWidth = Math.max(5, cellSize * 0.18);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = `rgba(255, 20, 20, ${fadeAlpha})`;
        
        // Main border rectangle
        ctx.beginPath();
        ctx.rect(fenceLeft, fenceTop, fenceWidth, fenceHeight);
        ctx.stroke();
        
        // Draw electric arcs along the border for effect
        ctx.lineWidth = Math.max(2, cellSize * 0.08);
        ctx.strokeStyle = `rgba(255, 80, 0, ${fadeAlpha * 0.8})`;
        
        const arcCount = 8;
        for (let i = 0; i < arcCount; i++) {
          const t = (time * 3 + i * 0.5) % 1;
          const arcPulse = Math.sin(t * Math.PI);
          if (arcPulse < 0.3) continue;
          
          ctx.globalAlpha = arcPulse * fadeAlpha;
          
          // Random position along perimeter
          const perimeterPos = ((time * 2 + i * 0.125) % 1) * 4;
          let ax, ay, bx, by;
          
          if (perimeterPos < 1) {
            // Top edge
            ax = fenceLeft + perimeterPos * fenceWidth;
            ay = fenceTop;
            bx = ax + (Math.sin(time * 20 + i) * cellSize * 0.3);
            by = ay + (Math.random() * cellSize * 0.2 - cellSize * 0.1);
          } else if (perimeterPos < 2) {
            // Right edge
            ax = fenceLeft + fenceWidth;
            ay = fenceTop + (perimeterPos - 1) * fenceHeight;
            bx = ax + (Math.random() * cellSize * 0.2 - cellSize * 0.1);
            by = ay + (Math.sin(time * 20 + i) * cellSize * 0.3);
          } else if (perimeterPos < 3) {
            // Bottom edge
            ax = fenceLeft + fenceWidth - (perimeterPos - 2) * fenceWidth;
            ay = fenceTop + fenceHeight;
            bx = ax + (Math.sin(time * 20 + i) * cellSize * 0.3);
            by = ay + (Math.random() * cellSize * 0.2 - cellSize * 0.1);
          } else {
            // Left edge
            ax = fenceLeft;
            ay = fenceTop + fenceHeight - (perimeterPos - 3) * fenceHeight;
            bx = ax + (Math.random() * cellSize * 0.2 - cellSize * 0.1);
            by = ay + (Math.sin(time * 20 + i) * cellSize * 0.3);
          }
          
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
        
        ctx.globalAlpha = 1;
        
        // Inner glow line
        ctx.lineWidth = Math.max(2, cellSize * 0.06);
        ctx.strokeStyle = `rgba(255, 200, 100, ${fadeAlpha * 0.6})`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.rect(fenceLeft + lineWidth/2, fenceTop + lineWidth/2, fenceWidth - lineWidth, fenceHeight - lineWidth);
        ctx.stroke();
        
        ctx.restore();
        
        // Draw center indicator with timer
        const centerX = offsetX + (fence.x + 0.5) * cellSize;
        const centerY = offsetY + (fence.y + 0.5) * cellSize;
        
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 10;
        ctx.font = `bold ${Math.round(cellSize * 0.35)}px ui-sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(255, 220, 0, ${remaining * 0.7})`;
        ctx.fillText('⚡', 0, -cellSize * 0.1);
        
        // Timer countdown
        const secsLeft = Math.ceil((fence.duration - elapsed) / 1000);
        ctx.font = `bold ${Math.round(cellSize * 0.25)}px ui-sans-serif`;
        ctx.fillStyle = `rgba(255, 255, 255, ${remaining * 0.85})`;
        ctx.fillText(`${secsLeft}s`, 0, cellSize * 0.2);
        ctx.restore();
      }
    }
    
    _drawLaserFencePreview() {
      if (!this._laserFencePlaceMode || !this._hoveredLaserFenceCell) return;
      
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const { x, y } = this._hoveredLaserFenceCell;
      const time = performance.now() / 1000;
      const halfSize = Math.floor(this._laserFenceSize / 2);
      
      // Calculate fence boundary in pixels
      const fenceLeft = offsetX + (x - halfSize) * cellSize;
      const fenceTop = offsetY + (y - halfSize) * cellSize;
      const fenceWidth = this._laserFenceSize * cellSize;
      const fenceHeight = this._laserFenceSize * cellSize;
      
      const pulse = 0.5 + Math.sin(time * 6) * 0.3;
      
      ctx.save();
      
      // Draw thin border preview
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 15;
      ctx.lineWidth = Math.max(4, cellSize * 0.12);
      ctx.strokeStyle = `rgba(255, 0, 0, ${pulse})`;
      ctx.setLineDash([cellSize * 0.3, cellSize * 0.15]);
      ctx.lineDashOffset = -time * cellSize * 2;
      
      ctx.beginPath();
      ctx.rect(fenceLeft, fenceTop, fenceWidth, fenceHeight);
      ctx.stroke();
      
      ctx.setLineDash([]);
      
      // Light interior fill
      ctx.fillStyle = `rgba(255, 100, 50, 0.1)`;
      ctx.fillRect(fenceLeft, fenceTop, fenceWidth, fenceHeight);
      
      ctx.restore();
      
      // Center indicator
      const centerX = offsetX + (x + 0.5) * cellSize;
      const centerY = offsetY + (y + 0.5) * cellSize;
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 12;
      ctx.font = `${Math.round(cellSize * 0.45)}px ui-sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.6 + Math.sin(time * 4) * 0.3;
      ctx.fillText('⚡', 0, 0);
      ctx.restore();
    }

    _drawHeatmap() {
      if (!this.showHeatmap || !this.userHeat) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();

      let max = 0;
      for (let i = 0; i < this.userHeat.length; i++) max = Math.max(max, this.userHeat[i]);
      if (max <= 1) return;

      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          const c = this.userHeat[this.maze.index(x, y)];
          if (!c) continue;
          const a = clamp((c / max) * 0.4, 0, 0.4);
          if (a <= 0.02) continue;
          ctx.fillStyle = `rgba(0,122,255,${a})`;
          ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
        }
      }
    }

    _drawFogOfWar() {
      // Fog is driven by user's explored mask.
      if (!this.maze || !this.userExplored) return;

      this._ensureFxCanvases();
      const fogCtx = this._fx.fogCtx;
      const fogCanvas = this._fx.fogCanvas;
      const maskCtx = this._fx.fogMaskCtx;
      const maskCanvas = this._fx.fogMaskCanvas;
      if (!fogCtx || !fogCanvas || !maskCtx || !maskCanvas) return;

      const { cellSize, offsetX, offsetY } = this._layout();

      // Build a solid explored mask (no additive overlap), then blur it once.
      // This avoids seams where two reveal circles overlap.
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.fillStyle = '#fff';
      // Slightly broaden reveal for a small "peek" beyond explored cells.
      const bleed = Math.max(1, Math.floor(cellSize * 0.08));
      for (let y = 0; y < this.maze.h; y++) {
        for (let x = 0; x < this.maze.w; x++) {
          if (!this.userExplored[this.maze.index(x, y)]) continue;
          maskCtx.fillRect(
            offsetX + x * cellSize - bleed,
            offsetY + y * cellSize - bleed,
            cellSize + bleed * 2,
            cellSize + bleed * 2
          );
        }
      }

      // Base darkness.
      fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
      fogCtx.globalCompositeOperation = 'source-over';
      // Restore prior darkness level.
      fogCtx.fillStyle = 'rgba(0,0,0,0.84)';
      fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);

      // Reveal using a single blurred mask draw.
      const blurPx = Math.max(6, cellSize * 0.46);
      fogCtx.globalCompositeOperation = 'destination-out';
      fogCtx.filter = `blur(${blurPx}px)`;
      fogCtx.drawImage(maskCanvas, 0, 0);
      fogCtx.filter = 'none';
      fogCtx.globalCompositeOperation = 'source-over';

      // Composite fog on top of the scene.
      const ctx = this.ctx;
      ctx.drawImage(fogCanvas, 0, 0);

      // Ensure the goal is always visible as a beacon through the darkness.
      // Draw on top of fog with additive blending.
      {
        const gx = offsetX + (this.maze.goal.x + 0.5) * cellSize;
        const gy = offsetY + (this.maze.goal.y + 0.5) * cellSize;
        const t = performance.now() / 1000;
        const pulse = 0.45 + 0.55 * Math.sin(t * 2.8);

        const r0 = Math.max(6, cellSize * 0.22);
        const r1 = Math.max(18, cellSize * (1.15 + pulse * 0.55));

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.95;

        const grad = ctx.createRadialGradient(gx, gy, r0 * 0.2, gx, gy, r1);
        grad.addColorStop(0, this._colors.goal);
        grad.addColorStop(0.22, this._colors.goal);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(gx, gy, r1, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = this._colors.goal;
        ctx.lineWidth = Math.max(1, cellSize * 0.10);
        ctx.beginPath();
        ctx.arc(gx, gy, r1 * 0.62, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
      }
    }

    _drawTrails() {
      // Trails only show for selected mouse.
      if (this.selectedMouseId == null) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();

      const maxAge = 9.0;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.5, cellSize * 0.14);

      for (let i = 0; i < this.trails.length; i++) {
        const s = this.trails[i];
        if (s.mouseId !== this.selectedMouseId) continue;
        const age = s.t0 - this.timeRemaining; // Since time counts down
        if (age > maxAge || age < 0) continue;

        const alpha = clamp(1 - age / maxAge, 0, 1) * 0.45;
        const col = s.team === TEAM_USER ? this._colors.user : this._colors.ai;

        const x0 = offsetX + (s.x0 + 0.5) * cellSize;
        const y0 = offsetY + (s.y0 + 0.5) * cellSize;
        const x1 = offsetX + (s.x1 + 0.5) * cellSize;
        const y1 = offsetY + (s.y1 + 0.5) * cellSize;

        ctx.strokeStyle = col.replace(')', `,${alpha})`).includes('rgba') ? col : col;

        // If color is hex, use rgba fallback.
        if (col.startsWith('#')) {
          const rgb = this._hexToRgb(col);
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
        } else if (!col.startsWith('rgba')) {
          ctx.strokeStyle = col;
        }

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }

    _drawMice() {
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const time = performance.now() / 1000; // For animations
      const tNow = nowMs();

      // Draw poop trails for sick mice first (underneath everything)
      for (const m of this.mice) {
        if (!m.poopTrail || m.poopTrail.length === 0) continue;
        
        // Clean up old poop (older than 5 seconds)
        m.poopTrail = m.poopTrail.filter(p => tNow - p.t < 5000);
        
        for (const poop of m.poopTrail) {
          const age = (tNow - poop.t) / 5000; // 0 to 1
          const alpha = 1 - age;
          const scale = 0.8 + age * 0.3;
          
          ctx.save();
          ctx.translate(poop.x, poop.y);
          ctx.scale(scale, scale);
          ctx.globalAlpha = alpha;
          ctx.font = `${Math.round(Math.max(10, cellSize * 0.35))}px ui-sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('💩', 0, 0);
          ctx.restore();
        }
      }

      // No full path history overlay (too noisy). Trails are handled separately.

      for (const m of this.mice) {
        // Show crazy mice during their animation, otherwise skip destroyed
        if (!m.isActive() && !m.reachedGoal && !m.isCrazy) continue;
        // Skip fully destroyed crazy mice
        if (m.destroyed && !m.isCrazy) continue;
        if (m.isCrazy && m.destroyed) continue;
        
        const p = m.positionLerp();
        const x = offsetX + (p.x + 0.5) * cellSize;
        const y = offsetY + (p.y + 0.5) * cellSize;
        const r = Math.max(4, cellSize * 0.32);
        const col = m.team === TEAM_USER ? this._colors.user : this._colors.ai;
        const isSel = this.selectedMouseId === m.id;

        // Speed boost: fiery trail behind the mouse (world-space, not rotated with the sprite).
        const boostActive = !m.isCrazy && tNow < m.tempSpeedBoostUntilMs && m.tempSpeedMult > 1.01;
        if (boostActive && m.nextCell) {
          const dx = m.nextCell.x - m.cell.x;
          const dy = m.nextCell.y - m.cell.y;
          const mag = Math.max(0.0001, Math.hypot(dx, dy));
          const ux = dx / mag;
          const uy = dy / mag;

          const len = Math.max(10, cellSize * 0.70);
          const bx = x - ux * (r * 0.85);
          const by = y - uy * (r * 0.85);
          const ex = bx - ux * len;
          const ey = by - uy * len;

          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = 'rgba(255,130,20,0.85)';
          ctx.shadowBlur = Math.max(10, cellSize * 0.55);

          const grad = ctx.createLinearGradient(bx, by, ex, ey);
          grad.addColorStop(0, 'rgba(255,235,170,0.70)');
          grad.addColorStop(0.45, 'rgba(255,140,40,0.38)');
          grad.addColorStop(1, 'rgba(255,40,0,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = Math.max(2, r * 0.55);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.translate(x, y);
        
        // Handle crazy mouse spinning/exploding animation
        if (m.isCrazy) {
          ctx.rotate(m.crazyRotation);
          // Scale down as it explodes
          const explodeProgress = m.crazyAnimationTime / 1.5;
          const scale = 1 + Math.sin(explodeProgress * Math.PI * 4) * 0.3;
          ctx.scale(scale, scale);
          
          // Draw explosion particles near end
          if (explodeProgress > 0.7) {
            const numParticles = 8;
            for (let i = 0; i < numParticles; i++) {
              const angle = (i / numParticles) * Math.PI * 2;
              const dist = (explodeProgress - 0.7) * r * 4;
              ctx.fillStyle = col;
              ctx.globalAlpha = 1 - explodeProgress;
              ctx.beginPath();
              ctx.arc(Math.cos(angle) * dist, Math.sin(angle) * dist, r * 0.2, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.globalAlpha = 1 - (explodeProgress - 0.7) * 3;
          }
        } else {
          // Calculate rotation based on heading
          const angles = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };
          const angle = angles[m.heading] || 0;
          ctx.rotate(angle);
        }
        
        // Selection glow
        if (isSel && !m.isCrazy) {
          ctx.shadowColor = col;
          ctx.shadowBlur = Math.max(12, cellSize * 0.5);
        }
        
        // Path of Truth glow (bright green aura)
        if (tNow < m.truthUntilMs && !m.isCrazy) {
          ctx.shadowColor = '#22FF44';
          ctx.shadowBlur = Math.max(18, cellSize * 0.7);
        }
        
        // Hive Mind boost glow (purple aura)
        if (m.hiveMindBoost > 0 && !m.isCrazy) {
          ctx.shadowColor = '#9933FF';
          ctx.shadowBlur = Math.max(15, cellSize * 0.6) * (m.hiveMindBoost / 5);
        }
        
        // Sick mouse glow (green, queasy)
        if (m.isSick && tNow < m.sickUntilMs && !m.isCrazy) {
          ctx.shadowColor = '#55AA33';
          ctx.shadowBlur = Math.max(12, cellSize * 0.5);
          // Apply wobble effect via translate
          const wobble = Math.sin(m.sickSwayPhase || 0) * r * 0.3;
          ctx.translate(wobble, 0);
        }
        
        // Zapped by laser fence - electric yellow glow effect
        if (m._zappedEffect > 0 && !m.isCrazy) {
          ctx.shadowColor = '#ffff00';
          ctx.shadowBlur = Math.max(25, cellSize * 0.9) * m._zappedEffect;
          // Draw lightning bolt arcs around the mouse
          const numArcs = 4;
          ctx.save();
          ctx.globalAlpha = m._zappedEffect;
          ctx.strokeStyle = '#ffff00';
          ctx.lineWidth = Math.max(1.5, cellSize * 0.05);
          for (let i = 0; i < numArcs; i++) {
            const arcAngle = (i / numArcs) * Math.PI * 2 + time * 10;
            const startR = r * 1.2;
            const endR = r * 1.8;
            ctx.beginPath();
            ctx.moveTo(Math.cos(arcAngle) * startR, Math.sin(arcAngle) * startR);
            // Zig-zag lightning
            const midAngle = arcAngle + Math.sin(time * 30 + i) * 0.3;
            ctx.lineTo(Math.cos(midAngle) * ((startR + endR) / 2), Math.sin(midAngle) * ((startR + endR) / 2));
            ctx.lineTo(Math.cos(arcAngle) * endR, Math.sin(arcAngle) * endR);
            ctx.stroke();
          }
          ctx.restore();
        }
        
        // Pilot mouse glow (magenta/cyan pulsing)
        if (m.pilotMouse && !m.isCrazy) {
          const pulsePhase = Math.sin(time * 4) * 0.5 + 0.5;
          const pilotColor = m.team === TEAM_USER ? '#FF00FF' : '#00FFFF';
          ctx.shadowColor = pilotColor;
          ctx.shadowBlur = Math.max(18, cellSize * 0.7) * (0.6 + pulsePhase * 0.4);
        }
        
        // Crazy mouse glow
        if (m.isCrazy) {
          ctx.shadowColor = '#FF0000';
          ctx.shadowBlur = Math.max(20, cellSize * 0.8);
        }
        
        // Tail (curved line behind) - with wiggle animation
        const tailWiggle = Math.sin(time * 8 + m.id.charCodeAt(0)) * r * 0.15;
        const sickTint = m.isSick && tNow < m.sickUntilMs;
        const pilotTint = m.pilotMouse ? (m.team === TEAM_USER ? '#DD44DD' : '#44DDDD') : null;
        const bodyColor = m.isCrazy ? '#FF6600' : (pilotTint || (sickTint ? '#88CC44' : col));
        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = Math.max(1.5, r * 0.2);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, 0);
        ctx.quadraticCurveTo(-r * 1.4, -r * 0.4 + tailWiggle, -r * 1.8, -r * 0.2 + tailWiggle * 1.5);
        ctx.stroke();
        
        // Body (oval)
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Head (smaller circle at front)
        ctx.beginPath();
        ctx.ellipse(r * 0.7, 0, r * 0.45, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Ears (two circles on top of head)
        const earSize = r * 0.3;
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(r * 0.8, -r * 0.4, earSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(r * 0.8, r * 0.4, earSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner ears (lighter)
        ctx.fillStyle = m.isCrazy ? '#FFCC00' : (m.team === TEAM_USER ? '#66B3FF' : '#FF8080');
        ctx.beginPath();
        ctx.arc(r * 0.8, -r * 0.4, earSize * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(r * 0.8, r * 0.4, earSize * 0.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Eyes - crazy eyes are spirals/X's
        if (m.isCrazy) {
          // Crazy spiral eyes
          ctx.strokeStyle = '#000';
          ctx.lineWidth = r * 0.05;
          ctx.beginPath();
          ctx.moveTo(r * 0.82, -r * 0.22);
          ctx.lineTo(r * 0.98, -r * 0.08);
          ctx.moveTo(r * 0.98, -r * 0.22);
          ctx.lineTo(r * 0.82, -r * 0.08);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(r * 0.82, r * 0.08);
          ctx.lineTo(r * 0.98, r * 0.22);
          ctx.moveTo(r * 0.98, r * 0.08);
          ctx.lineTo(r * 0.82, r * 0.22);
          ctx.stroke();
        } else {
          // Normal eyes
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(r * 0.9, -r * 0.15, r * 0.12, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(r * 0.9, r * 0.15, r * 0.12, 0, Math.PI * 2);
          ctx.fill();
          
          // Pupils
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(r * 0.93, -r * 0.15, r * 0.06, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(r * 0.93, r * 0.15, r * 0.06, 0, Math.PI * 2);
          ctx.fill();
        }
        
        // Nose (small dark dot at front)
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(r * 1.1, 0, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
        
        // Whiskers
        ctx.strokeStyle = '#666';
        ctx.lineWidth = Math.max(0.5, r * 0.05);
        // Left whiskers
        ctx.beginPath();
        ctx.moveTo(r * 0.95, -r * 0.1);
        ctx.lineTo(r * 1.3, -r * 0.35);
        ctx.moveTo(r * 0.95, -r * 0.05);
        ctx.lineTo(r * 1.35, -r * 0.1);
        // Right whiskers  
        ctx.moveTo(r * 0.95, r * 0.1);
        ctx.lineTo(r * 1.3, r * 0.35);
        ctx.moveTo(r * 0.95, r * 0.05);
        ctx.lineTo(r * 1.35, r * 0.1);
        ctx.stroke();
        
        // Selection ring
        if (isSel && !m.isCrazy) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Manual mouse arrow indicators (show transparent arrows around the mouse)
        if (m.pilotMouse && m.team === TEAM_USER && !m.isCrazy && m.isActive()) {
          ctx.restore(); // Restore to draw arrows without mouse rotation
          ctx.save();
          ctx.translate(x, y);
          
          const arrowDist = r * 2.5;
          const arrowSize = r * 0.8;
          const arrowAlpha = 0.35 + Math.sin(time * 3) * 0.15;
          
          ctx.globalAlpha = arrowAlpha;
          ctx.fillStyle = '#FF00FF';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.font = `bold ${Math.round(arrowSize * 2)}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Up arrow (W)
          ctx.fillText('▲', 0, -arrowDist);
          // Down arrow (S)
          ctx.fillText('▼', 0, arrowDist);
          // Left arrow (A)
          ctx.fillText('◀', -arrowDist, 0);
          // Right arrow (D)
          ctx.fillText('▶', arrowDist, 0);
          
          ctx.restore();
          ctx.save();
          ctx.translate(x, y);
          // Re-apply rotation for remaining drawing if any
          const angles = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };
          const angle = angles[m.heading] || 0;
          ctx.rotate(angle);
        }
        
        // "Mouse went insane!" floating text for crazy mice
        if (m.isCrazy) {
          ctx.restore(); // Restore first to draw text without rotation
          ctx.save();
          const pulse = 1 + Math.sin(time * 10) * 0.15;
          ctx.font = `bold ${Math.round(14 * pulse)}px Arial`;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FF0000';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 3;
          const textY = y - r * 2.5;
          ctx.strokeText('Mouse went insane!', x, textY);
          ctx.fillText('Mouse went insane!', x, textY);
          ctx.restore();
          continue; // Skip the normal restore since we already did it
        }
        
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    _drawCat() {
      // Draw both cats (userCat and aiCat)
      this._drawOneCat(this.userCat);
      this._drawOneCat(this.aiCat);
    }

    _drawOneCat(cat) {
      if (!cat || !cat.isActive()) return;
      const ctx = this.ctx;
      const { cellSize, offsetX, offsetY } = this._layout();
      const p = cat.positionLerp();
      const x = offsetX + (p.x + 0.5) * cellSize;
      const y = offsetY + (p.y + 0.5) * cellSize;
      const r = Math.max(6, cellSize * 0.38);
      const time = performance.now() / 1000;

      // Different tint for each team's cat
      const catColor = cat.team === TEAM_USER ? 'rgba(30,40,80,0.95)' : 'rgba(80,30,30,0.95)';

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(cat.facingAngle || 0);
      // Silhouette
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = Math.max(6, cellSize * 0.35);
      ctx.fillStyle = catColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.05, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      // Ears
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.55);
      ctx.lineTo(r * 0.55, -r * 0.95);
      ctx.lineTo(r * 0.8, -r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.2, r * 0.55);
      ctx.lineTo(r * 0.55, r * 0.95);
      ctx.lineTo(r * 0.8, r * 0.45);
      ctx.closePath();
      ctx.fill();
      // Eyes
      ctx.shadowBlur = 0;
      const pulse = 0.65 + 0.35 * Math.sin(time * 9.5);
      ctx.fillStyle = `rgba(255,245,160,${0.90 + pulse * 0.10})`;
      ctx.shadowColor = 'rgba(255,230,120,0.95)';
      ctx.shadowBlur = Math.max(18, cellSize * (0.85 + pulse * 0.45));
      ctx.beginPath();
      ctx.arc(r * 0.55, -r * 0.18, r * 0.12, 0, Math.PI * 2);
      ctx.arc(r * 0.55, r * 0.18, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _hexToRgb(hex) {
      const h = hex.replace('#', '').trim();
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      const n = Number.parseInt(full, 16);
      if (!Number.isFinite(n)) return { r: 255, g: 255, b: 255 };
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return { r, g, b };
    }

    _drawStatusEffectsHUD() {
      if (!this.roundActive) return;
      const ctx = this.ctx;
      const t = nowMs();

      const freezeUserS = Math.max(0, (this._freezeUntilMsUser - t) / 1000);
      const freezeAiS = Math.max(0, (this._freezeUntilMsAi - t) / 1000);

      // Pick a boost target (selected mouse first).
      let boostMouse = null;
      const sel = this.getSelectedMouse();
      if (sel && sel.isActive() && t < sel.tempSpeedBoostUntilMs && sel.tempSpeedMult > 1.01) boostMouse = sel;
      if (!boostMouse) {
        boostMouse = this.mice.find(m => m.team === TEAM_USER && m.isActive() && t < m.tempSpeedBoostUntilMs && m.tempSpeedMult > 1.01) || null;
      }

      const boostAi = this.mice.find(m => m.team === TEAM_AI && m.isActive() && t < m.tempSpeedBoostUntilMs && m.tempSpeedMult > 1.01) || null;

      const items = [];
      if (freezeUserS > 0.05) {
        const denom = Math.max(200, this._freezeDurationMsUser || (this.pickupFreezeDurationMs || 3500));
        const p = clamp((freezeUserS * 1000) / denom, 0, 1);
        items.push({ label: 'YOU FROZEN', value: `${freezeUserS.toFixed(1)}s`, p, color: 'rgba(120,205,255,1)', glow: 'rgba(120,205,255,0.9)' });
      }
      if (freezeAiS > 0.05) {
        const denom = Math.max(200, this._freezeDurationMsAi || (this.pickupFreezeDurationMs || 3500));
        const p = clamp((freezeAiS * 1000) / denom, 0, 1);
        items.push({ label: 'CPU FROZEN', value: `${freezeAiS.toFixed(1)}s`, p, color: 'rgba(120,205,255,1)', glow: 'rgba(120,205,255,0.9)' });
      }
      if (boostMouse) {
        const remS = Math.max(0, (boostMouse.tempSpeedBoostUntilMs - t) / 1000);
        const denom = Math.max(200, boostMouse.tempSpeedBoostDurationMs || (this.pickupSpeedDurationMs || 5000));
        const p = clamp((remS * 1000) / denom, 0, 1);
        const name = boostMouse.displayName || 'Mouse';
        items.push({ label: 'SPEED BOOST', value: `${name} • ${remS.toFixed(1)}s`, p, color: 'rgba(255,170,70,1)', glow: 'rgba(255,120,30,0.9)' });
      }
      if (boostAi) {
        const remS = Math.max(0, (boostAi.tempSpeedBoostUntilMs - t) / 1000);
        const denom = Math.max(200, boostAi.tempSpeedBoostDurationMs || (this.pickupSpeedDurationMs || 5000));
        const p = clamp((remS * 1000) / denom, 0, 1);
        items.push({ label: 'CPU BOOST', value: `${remS.toFixed(1)}s`, p, color: 'rgba(255,170,70,1)', glow: 'rgba(255,120,30,0.9)' });
      }

      // Path of Truth - user mouse
      const truthUser = this.mice.find(m => m.team === TEAM_USER && m.isActive() && t < m.truthUntilMs) || null;
      if (truthUser) {
        const remS = Math.max(0, (truthUser.truthUntilMs - t) / 1000);
        const denom = Math.max(200, truthUser.truthDurationMs || (this.pickupTruthDurationMs || 5000));
        const p = clamp((remS * 1000) / denom, 0, 1);
        const name = truthUser.displayName || 'Mouse';
        items.push({ label: '🟢 PATH OF TRUTH', value: `${name} • ${remS.toFixed(1)}s`, p, color: 'rgba(80,220,100,1)', glow: 'rgba(50,255,80,0.9)' });
      }
      // Path of Truth - AI mouse
      const truthAi = this.mice.find(m => m.team === TEAM_AI && m.isActive() && t < m.truthUntilMs) || null;
      if (truthAi) {
        const remS = Math.max(0, (truthAi.truthUntilMs - t) / 1000);
        const denom = Math.max(200, truthAi.truthDurationMs || (this.pickupTruthDurationMs || 5000));
        const p = clamp((remS * 1000) / denom, 0, 1);
        items.push({ label: '🟢 CPU TRUTH', value: `${remS.toFixed(1)}s`, p, color: 'rgba(80,220,100,1)', glow: 'rgba(50,255,80,0.9)' });
      }

      if (!items.length) return;

      const pad = 14;
      const w = Math.min(520, this.canvas.width - pad * 2); // Wider box
      const x0 = (this.canvas.width - w) / 2;
      let y0 = 75; // Start below the timer bar (was: pad)

      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${Math.max(12, Math.round(this.canvas.width * 0.015))}px ui-sans-serif, system-ui, Segoe UI, Arial`;

      for (const it of items) {
        const h = 44; // Taller box to separate text and bar

        // Backplate
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.fillRect(x0, y0, w, h);

        // Glow label
        ctx.globalAlpha = 1;
        ctx.shadowColor = it.glow;
        ctx.shadowBlur = 14;
        ctx.fillStyle = it.color;
        ctx.fillText(it.label, x0 + 12, y0 + 6);
        ctx.shadowBlur = 0;

        // Timer text
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.textAlign = 'right';
        ctx.fillText(it.value, x0 + w - 12, y0 + 6);
        ctx.textAlign = 'left';

        // Progress bar - moved lower
        const barX = x0 + 12;
        const barY = y0 + 32; // Lowered from 28
        const barW = w - 24;
        const barH = 6;
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = it.color;
        ctx.fillRect(barX, barY, barW * it.p, barH);
        ctx.globalAlpha = 1;

        y0 += h + 8;
      }

      ctx.restore();
    }

    _drawCommentary() {
      if (!this._commentaryQueue || !this._commentaryQueue.length) return;
      const ctx = this.ctx;
      const msg = this._commentaryQueue[0];
      if (!msg) return;

      const age = (performance.now() - msg.addedAt) / 1000;
      const fadeInDur = 0.3;
      const stayDur = msg.duration || 3;
      const fadeOutDur = 0.5;

      let alpha = 1;
      if (age < fadeInDur) {
        alpha = age / fadeInDur;
      } else if (age > stayDur - fadeOutDur) {
        alpha = Math.max(0, (stayDur - age) / fadeOutDur);
      }
      
      if (age > stayDur) {
        this._commentaryQueue.shift();
        return;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      
      // Position at bottom-center of canvas
      const x = this.canvas.width / 2;
      const y = this.canvas.height - 50;

      // Background pill
      ctx.font = `bold ${Math.max(14, Math.round(this.canvas.width * 0.018))}px ui-sans-serif, system-ui`;
      const textW = ctx.measureText(msg.text).width;
      const padX = 20;
      const padY = 8;
      
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      const rx = textW / 2 + padX;
      const ry = 16;
      ctx.roundRect(x - rx, y - ry, rx * 2, ry * 2, ry);
      ctx.fill();

      // Text with glow based on priority
      let glowColor = 'rgba(255,255,255,0.6)';
      let textColor = '#fff';
      if (msg.priority === 'high') {
        glowColor = 'rgba(255,200,50,0.9)';
        textColor = '#ffd700';
      } else if (msg.priority === 'danger') {
        glowColor = 'rgba(255,80,80,0.9)';
        textColor = '#ff6666';
      }

      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = textColor;
      ctx.fillText(msg.text, x, y);

      ctx.restore();
    }

    _render() {
      const ctx = this.ctx;
      
      // Screen shake effect
      if (this._dramaShakeIntensity && this._dramaShakeIntensity > 0) {
        ctx.save();
        const shakeX = (Math.random() - 0.5) * this._dramaShakeIntensity * 10;
        const shakeY = (Math.random() - 0.5) * this._dramaShakeIntensity * 10;
        ctx.translate(shakeX, shakeY);
      }

      this._drawBackground();
      this._drawHeatmap();
      this._drawTrails();
      this._drawBloodStains();
      this._drawMaze();
      this._drawDecoys();
      this._drawCat();
      this._drawMice();
      this._drawBlasts();
      this._drawFogOfWar();
      this._drawLaserFences(); // Draw laser fences ABOVE fog for visibility
      this._drawPickups(); // Draw pickups ABOVE fog with glow for visibility
      this._drawDecoyPreview(); // Draw decoy placement preview
      this._drawLaserFencePreview(); // Draw laser fence placement preview
      this._drawFrozenGlows(); // Draw frozen mice glow ABOVE fog for visibility
      this._drawWallBlastPreview(); // Draw after fog so it's visible in dark areas
      this._drawStatusEffectsHUD();
      this._drawFloatingTexts(); // Floating text popups
      this._drawConfetti();
      this._drawCommentary();
      this._drawFrostParticles(); // Frost overlay on screen edges

      // Restore from shake
      if (this._dramaShakeIntensity && this._dramaShakeIntensity > 0) {
        ctx.restore();
      }
    }

    _frame() {
      const t = nowMs();
      const dt = clamp((t - this._lastT) / 1000, 0, 0.05);
      this._lastT = t;

      if (this._gameStarted) {
        if (this._isCountingDown) {
          this._updateRoundState(dt);
        } else if (this.roundActive) {
          this._updateRoundState(dt);
        } else {
          this._maybeAdvanceRound(dt);
        }
        this._updateUI();
        this._updateConfetti(dt);
        this._updateFloatingTexts();
        this._render();
        this._updateWalkSounds();
      } else {
        // Stop walk sounds when game not running
        this.audio.stopAllLoops();
      }

      requestAnimationFrame(() => this._frame());
    }

    _updateWalkSounds() {
      if (!this.roundActive) {
        // Stop all walk sounds when round is not active
        this.audio.stopLoop('walk_1');
        this.audio.stopLoop('walk_2');
        return;
      }

      const userFrozen = this.isTeamFrozen(TEAM_USER);
      const aiFrozen = this.isTeamFrozen(TEAM_AI);

      // Check if user has any active (non-frozen) mice
      const userHasActiveMouse = this.mice.some(m => 
        m.team === TEAM_USER && m.isActive() && !m.isCrazy
      );
      // Check if AI has any active (non-frozen) mice
      const aiHasActiveMouse = this.mice.some(m => 
        m.team === TEAM_AI && m.isActive() && !m.isCrazy
      );

      // User walk sound: play if user has active mice AND user is not frozen
      if (userHasActiveMouse && !userFrozen) {
        this.audio.startLoop('walk_1');
      } else {
        this.audio.stopLoop('walk_1');
      }

      // AI walk sound: play if AI has active mice AND AI is not frozen
      if (aiHasActiveMouse && !aiFrozen) {
        this.audio.startLoop('walk_2');
      } else {
        this.audio.stopLoop('walk_2');
      }
    }
  }

  // Boot
  window.addEventListener('DOMContentLoaded', () => {
    const engine = new GameEngine();

    // Required helper: must not crash if audio files are missing.
    window.playSound = (effectName) => {
      try {
        engine.audio.playSound(effectName);
      } catch {
        // ignore
      }
    };
  });
})();
