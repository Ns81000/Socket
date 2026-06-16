/* =====================================================================
   Socket Combat Arena — game.js
   A high-performance dedicated arcade canvas game loop.
   ===================================================================== */

(function () {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const controlsCard = document.getElementById("controls-card");

  let w = window.innerWidth;
  let h = window.innerHeight;

  // Game configuration & constants
  const SHIP_SIZE = 20;
  const ROTATION_SPEED = 4.2;
  const THRUST_ACCEL = 650;
  const MAX_SPEED = 550;
  const DRAG = 0.985;
  const BULLET_SPEED = 24;
  const BOMB_SPEED = 8;
  const BULLET_RADIUS = 3.5;
  const BOMB_RADIUS = 9;
  const BOMB_BLAST_RADIUS = 180;
  const BOMB_COOLDOWN_MS = 1800;
  const SPREAD_ANGLE = 15 * Math.PI / 180;

  // Curated ship styling palettes
  const styles = {
    player: { outline: "#00F0FF", glow: "rgba(0, 240, 255, 0.85)", fill1: "#0b1532", fill2: "#1a2c66" },
    drone: { outline: "#FFE600", glow: "rgba(255, 230, 0, 0.8)", fill1: "#141512", fill2: "#2a2d21" },
    scout: { outline: "#00E5FF", glow: "rgba(0, 229, 255, 0.8)", fill1: "#051821", fill2: "#0d3b4f" },
    cruiser: { outline: "#FF007F", glow: "rgba(255, 0, 127, 0.8)", fill1: "#250212", fill2: "#4c0525" },
    bomber: { outline: "#FF7700", glow: "rgba(255, 119, 0, 0.8)", fill1: "#260f02", fill2: "#542305" },
    support: { outline: "#BD00FF", glow: "rgba(189, 0, 255, 0.8)", fill1: "#1a022b", fill2: "#3b0561" },
    boss: { outline: "#00FF66", glow: "rgba(0, 255, 102, 0.85)", fill1: "#0a1d12", fill2: "#153a24" }
  };

  // Game state
  const state = {
    gameStarted: false,
    victoryDeclared: false,
    score: 0,
    highScore: parseInt(localStorage.getItem("socket_high_score") || "0", 10),
    comboCount: 0,
    lastDestroyTime: 0,
    waveNumber: 1,
    waveTransitionTimer: 0,
    waveTotalEnemies: 0,
    
    // Player
    shipX: w / 2,
    shipY: h / 2,
    shipAngle: -Math.PI / 2,
    velX: 0,
    velY: 0,
    weapon: 1, // 1: Single, 2: Spread, 3: Bomb
    lastBombAt: 0,

    // Collections
    bullets: [],
    particles: [],
    flashes: [],
    powerups: [],
    enemies: [],
    enemyBullets: [],
    scorePopups: [],
    activePowerups: { shield: 0, triple: 0, speed: 0 },

    // AI
    aiBehavior: "drift",
    aiBehaviorTimer: 0,
    musicOn: false,
    beatTime: 0,
    beatPulse: 0
  };

  const activeKeys = { w: false, a: false, s: false, d: false };

  // Parallax Starfield Background
  const starsLayer1 = []; // distant (slow)
  const starsLayer2 = []; // closer (fast)

  function initStarfield() {
    starsLayer1.length = 0;
    starsLayer2.length = 0;
    for (let i = 0; i < 90; i++) {
      starsLayer1.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() * 1.2 + 0.4,
        alpha: 0.3 + Math.random() * 0.6
      });
    }
    for (let i = 0; i < 45; i++) {
      starsLayer2.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() * 2.0 + 1.2,
        alpha: 0.5 + Math.random() * 0.5
      });
    }
  }

  function updateStarfield(tdelta) {
    const driftY = 25 * tdelta; // baseline downward movement
    const shipOffsetX1 = -state.velX * tdelta * 0.15;
    const shipOffsetY1 = -state.velY * tdelta * 0.15;
    const shipOffsetX2 = -state.velX * tdelta * 0.4;
    const shipOffsetY2 = -state.velY * tdelta * 0.4;

    for (const s of starsLayer1) {
      s.x += shipOffsetX1;
      s.y += shipOffsetY1 + driftY;
      if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
      else if (s.y < 0) { s.y = h; s.x = Math.random() * w; }
      if (s.x > w) s.x = 0;
      else if (s.x < 0) s.x = w;
    }
    for (const s of starsLayer2) {
      s.x += shipOffsetX2;
      s.y += shipOffsetY2 + driftY * 2.2;
      if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
      else if (s.y < 0) { s.y = h; s.x = Math.random() * w; }
      if (s.x > w) s.x = 0;
      else if (s.x < 0) s.x = w;
    }
  }

  function drawStarfield() {
    ctx.save();
    for (const s of starsLayer1) {
      ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    for (const s of starsLayer2) {
      ctx.fillStyle = `rgba(235, 248, 255, ${s.alpha})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.restore();
  }

  function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return a + diff * t;
  }

  // Audio manager
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function playClick() {
    const ctxAud = ensureAudio();
    if (!ctxAud) return;
    const now = ctxAud.currentTime;
    const osc = ctxAud.createOscillator();
    const gain = ctxAud.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.04);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain).connect(ctxAud.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  function playPew() {
    const ctxAud = ensureAudio();
    if (!ctxAud) return;
    const now = ctxAud.currentTime;
    const osc = ctxAud.createOscillator();
    const gain = ctxAud.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(ctxAud.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  function playBoom(big) {
    const ctxAud = ensureAudio();
    if (!ctxAud) return;
    const now = ctxAud.currentTime;
    const dur = big ? 0.6 : 0.32;
    const peak = big ? 0.5 : 0.3;

    const bufferSize = Math.floor(ctxAud.sampleRate * dur);
    const buffer = ctxAud.createBuffer(1, bufferSize, ctxAud.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctxAud.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctxAud.createGain();
    noiseGain.gain.setValueAtTime(peak, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(noiseGain).connect(ctxAud.destination);
    noise.start(now);
    noise.stop(now + dur);

    const osc = ctxAud.createOscillator();
    const gain = ctxAud.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(big ? 150 : 200, now);
    osc.frequency.exponentialRampToValueAtTime(big ? 35 : 60, now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(ctxAud.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  function playChime() {
    const ctxAud = ensureAudio();
    if (!ctxAud) return;
    const now = ctxAud.currentTime;
    const freq = [523.25, 659.25, 783.99, 1046.50];
    freq.forEach((f, idx) => {
      const osc = ctxAud.createOscillator();
      const gain = ctxAud.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now + idx * 0.08);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.08);
      gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.25);
      osc.connect(gain).connect(ctxAud.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.3);
    });
  }

  function playDeflect() {
    const ctxAud = ensureAudio();
    if (!ctxAud) return;
    const now = ctxAud.currentTime;
    const osc = ctxAud.createOscillator();
    const gain = ctxAud.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain).connect(ctxAud.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  function playEnemyShoot() {
    const ctxAud = ensureAudio();
    if (!ctxAud) return;
    const now = ctxAud.currentTime;
    const osc = ctxAud.createOscillator();
    const gain = ctxAud.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(ctxAud.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  function playBeatNote() {
    const ctxAud = ensureAudio();
    if (!ctxAud) return;
    const now = ctxAud.currentTime;
    const notes = [55.00, 65.41, 73.42, 49.00]; // A1, C2, D2, G1
    const f = notes[Math.floor(performance.now() / 2000) % notes.length];
    const osc = ctxAud.createOscillator();
    const gain = ctxAud.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 0.9, now + 0.22);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain).connect(ctxAud.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  function playVictoryFanfare() {
    const ctxAud = ensureAudio();
    if (!ctxAud) return;
    const now = ctxAud.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = ctxAud.createOscillator();
      const gain = ctxAud.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.12);
      gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.12 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.38);
      osc.connect(gain).connect(ctxAud.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.4);
    });
  }

  // Particle Generators
  function spawnParticles(x, y, count, big, color) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (big ? 4 : 2.5) + Math.random() * (big ? 7 : 4);
      state.particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 1,
        decay: 1 / (big ? 40 : 30),
        size: (big ? 2.5 : 1.5) + Math.random() * 2,
        color: color || "#00F0FF"
      });
    }
  }

  function spawnEnemyDebris(x, y, sizeFactor, type) {
    const count = 12 + Math.floor(Math.random() * 12);
    const color = styles[type]?.outline || "#FFE600";
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * 5.5;
      state.particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 1.0,
        decay: 1 / (25 + Math.random() * 20),
        size: (2.0 + Math.random() * 2.5) * sizeFactor,
        color: color
      });
    }
  }

  function spawnFlash(x, y, big) {
    state.flashes.push({
      x: x,
      y: y,
      t: 0,
      inMs: 80,
      outMs: 200,
      maxR: big ? 180 : 70,
      last: performance.now()
    });
  }

  function spawnShieldSparks(x, y) {
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 3;
      state.particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 1.0,
        decay: 1 / 15,
        size: 1.5 + Math.random() * 1.5,
        color: "#00F0FF" // Cyan shield sparks
      });
    }
  }

  // Weapon systems
  function spawnBullet(angle, opts) {
    const isBomb = opts && opts.bomb;
    const hasTriple = state.activePowerups.triple > 0;
    
    let bx = state.shipX;
    let by = state.shipY;
    
    bx += Math.cos(state.shipAngle) * SHIP_SIZE;
    by += Math.sin(state.shipAngle) * SHIP_SIZE;
    
    const r = isBomb ? BOMB_RADIUS : BULLET_RADIUS;
    const sp = isBomb ? BOMB_SPEED : BULLET_SPEED;
    
    if (isBomb) {
      state.bullets.push({
        x: bx,
        y: by,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp,
        radius: r,
        bomb: true,
        trail: []
      });
      state.lastBombAt = performance.now();
    } else if (hasTriple) {
      const perpAngle = angle + Math.PI / 2;
      const offsets = [-14, 0, 14];
      for (const off of offsets) {
        const sx = bx + Math.cos(perpAngle) * off;
        const sy = by + Math.sin(perpAngle) * off;
        state.bullets.push({
          x: sx,
          y: sy,
          vx: Math.cos(angle) * sp,
          vy: Math.sin(angle) * sp,
          radius: r,
          trail: []
        });
      }
    } else {
      state.bullets.push({
        x: bx,
        y: by,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp,
        radius: r,
        trail: []
      });
    }
    
    playPew();
  }

  function fireWeapon() {
    if (state.weapon === 3) {
      const now = performance.now();
      if (now - state.lastBombAt >= BOMB_COOLDOWN_MS) {
        spawnBullet(state.shipAngle, { bomb: true });
      }
    } else if (state.weapon === 2) {
      spawnBullet(state.shipAngle);
      spawnBullet(state.shipAngle - SPREAD_ANGLE);
      spawnBullet(state.shipAngle + SPREAD_ANGLE);
    } else {
      spawnBullet(state.shipAngle);
    }
  }

  // Spawning fleets
  function spawnEnemyFleet() {
    state.enemies.length = 0;
    
    let configs = [];
    if (state.waveNumber === 1) {
      configs = [{ type: "drone", sizeFactor: 0.6, maxHp: 1, count: 5 }];
    } else if (state.waveNumber === 2) {
      configs = [
        { type: "drone", sizeFactor: 0.6, maxHp: 1, count: 4 },
        { type: "scout", sizeFactor: 0.8, maxHp: 2, count: 2 }
      ];
    } else if (state.waveNumber === 3) {
      configs = [
        { type: "scout", sizeFactor: 0.8, maxHp: 2, count: 4 },
        { type: "cruiser", sizeFactor: 1.5, maxHp: 6, count: 1 }
      ];
    } else if (state.waveNumber === 4) {
      configs = [
        { type: "drone", sizeFactor: 0.6, maxHp: 1, count: 3 },
        { type: "cruiser", sizeFactor: 1.5, maxHp: 6, count: 2 },
        { type: "bomber", sizeFactor: 1.8, maxHp: 10, count: 1 }
      ];
    } else if (state.waveNumber === 5) {
      configs = [
        { type: "boss", sizeFactor: 2.5, maxHp: 25, count: 1 },
        { type: "scout", sizeFactor: 0.8, maxHp: 2, count: 3 }
      ];
    } else if (state.waveNumber === 6) {
      configs = [
        { type: "cruiser", sizeFactor: 1.5, maxHp: 6, count: 2 },
        { type: "support", sizeFactor: 1.3, maxHp: 5, count: 2 }
      ];
    } else if (state.waveNumber === 7) {
      configs = [
        { type: "scout", sizeFactor: 0.8, maxHp: 2, count: 8 }
      ];
    } else if (state.waveNumber === 8) {
      configs = [
        { type: "bomber", sizeFactor: 1.8, maxHp: 10, count: 2 },
        { type: "cruiser", sizeFactor: 1.5, maxHp: 6, count: 2 },
        { type: "support", sizeFactor: 1.3, maxHp: 5, count: 1 }
      ];
    } else if (state.waveNumber === 9) {
      configs = [
        { type: "drone", sizeFactor: 0.6, maxHp: 1, count: 4 },
        { type: "scout", sizeFactor: 0.8, maxHp: 2, count: 3 },
        { type: "cruiser", sizeFactor: 1.5, maxHp: 6, count: 2 },
        { type: "bomber", sizeFactor: 1.8, maxHp: 10, count: 1 },
        { type: "support", sizeFactor: 1.3, maxHp: 5, count: 1 }
      ];
    } else if (state.waveNumber === 10) {
      configs = [
        { type: "boss", sizeFactor: 3.5, maxHp: 60, count: 1 },
        { type: "scout", sizeFactor: 0.8, maxHp: 2, count: 3 },
        { type: "support", sizeFactor: 1.3, maxHp: 5, count: 2 }
      ];
    } else {
      return;
    }
    
    const padding = 100;
    const now = performance.now();
    let totalCount = 0;
    
    for (const cfg of configs) {
      for (let i = 0; i < cfg.count; i++) {
        let startX, startY;
        let attempts = 0;
        do {
          const edge = Math.floor(Math.random() * 4);
          if (edge === 0) { // Top
            startX = Math.random() * w;
            startY = -padding;
          } else if (edge === 1) { // Right
            startX = w + padding;
            startY = Math.random() * h;
          } else if (edge === 2) { // Bottom
            startX = Math.random() * w;
            startY = h + padding;
          } else { // Left
            startX = -padding;
            startY = Math.random() * h;
          }
          attempts++;
        } while (attempts < 10 && Math.sqrt(Math.pow(startX - state.shipX, 2) + Math.pow(startY - state.shipY, 2)) < 250);
        
        const angle = Math.random() * Math.PI * 2;
        let speed = 80;
        if (cfg.type === "drone") speed = 130;
        else if (cfg.type === "scout") speed = 165;
        else if (cfg.type === "cruiser") speed = 75;
        else if (cfg.type === "bomber") speed = 50;
        else if (cfg.type === "support") speed = 90;
        else if (cfg.type === "boss") speed = 30;
        
        state.enemies.push({
          type: cfg.type,
          x: startX,
          y: startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          hp: cfg.maxHp,
          maxHp: cfg.maxHp,
          sizeFactor: cfg.sizeFactor,
          angle: angle,
          targetAngle: angle,
          lastShotAt: now - Math.random() * 2000,
          formationTimer: Math.random() * 1000,
          hitFlashTimer: 0,
          bossPhase: 0,
          shieldedBy: null
        });
        totalCount++;
      }
    }
    state.waveTotalEnemies = totalCount;
  }

  function spawnPowerup(x, y) {
    const types = ["shield", "triple", "speed"];
    const type = types[Math.floor(Math.random() * types.length)];
    const ang = Math.random() * Math.PI * 2;
    const speed = 1.0 + Math.random() * 1.5;
    state.powerups.push({
      x: x,
      y: y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      type: type,
      size: 10,
      bobSeed: Math.random() * 1000,
      age: 0
    });
  }

  function rewardPoints(points, x, y) {
    const mult = Math.max(1, state.comboCount);
    const total = points * mult;
    state.score += total;
    if (state.score > state.highScore) {
      state.highScore = state.score;
      localStorage.setItem("socket_high_score", state.highScore.toString());
    }
    
    const popupText = mult > 1 ? `+${total.toLocaleString()} (${mult}x Combo!)` : `+${total.toLocaleString()}`;
    state.scorePopups.push({
      x: x,
      y: y,
      text: popupText,
      age: 0,
      maxAge: 1.2
    });

    state.comboCount++;
    state.lastDestroyTime = performance.now();
  }

  function destroyEnemy(enemy, hx, hy) {
    spawnEnemyDebris(hx, hy, enemy.sizeFactor, enemy.type);
    const outlineColor = styles[enemy.type]?.outline || "#FFE600";
    spawnParticles(hx, hy, 25, true, outlineColor);
    spawnFlash(hx, hy, true);
    playBoom(true);

    const idx = state.enemies.indexOf(enemy);
    if (idx !== -1) {
      state.enemies.splice(idx, 1);
    }

    let points = 2500;
    if (enemy.type === "boss") points = 10000;
    else if (enemy.type === "support") points = 5000;
    else if (enemy.type === "bomber") points = 4500;
    else if (enemy.type === "cruiser") points = 3500;
    else if (enemy.type === "scout") points = 2000;
    else if (enemy.type === "drone") points = 1000;

    rewardPoints(points, hx, hy);
    
    if (Math.random() < 0.25) {
      spawnPowerup(hx, hy);
    }
  }

  function detonateBomb(hx, hy) {
    spawnFlash(hx, hy, true);
    playBoom(true);
    spawnParticles(hx, hy, 35, true, "#FF8C00");

    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const dx = e.x - hx;
      const dy = e.y - hy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= BOMB_BLAST_RADIUS) {
        if (e.shieldedBy && state.enemies.includes(e.shieldedBy)) {
          // Shield absorbs bomb blast!
          spawnShieldSparks(e.x, e.y);
          playDeflect();
        } else {
          e.hp -= 4;
          e.hitFlashTimer = 0.15;
          if (e.hp <= 0) {
            destroyEnemy(e, e.x, e.y);
          } else {
            const pushAng = Math.atan2(dy, dx);
            e.vx += Math.cos(pushAng) * 200;
            e.vy += Math.sin(pushAng) * 200;
            playDeflect();
          }
        }
      }
    }
  }

  // Mechanics Updates
  function updateBullets() {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 8) b.trail.shift();
      
      b.x += b.vx;
      b.y += b.vy;

      if (b.x < 0) b.x = w;
      else if (b.x > w) b.x = 0;
      if (b.y < 0) b.y = h;
      else if (b.y > h) b.y = 0;

      b.age = (b.age || 0) + 1;
      if (b.age > 90) {
        state.bullets.splice(i, 1);
        continue;
      }

      let hit = false;
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radiusLimit = b.radius + (SHIP_SIZE * e.sizeFactor);

        if (dist < radiusLimit) {
          hit = true;
          if (b.bomb) {
            detonateBomb(b.x, b.y);
          } else {
            // Check if shielded by support ship
            if (e.shieldedBy && state.enemies.includes(e.shieldedBy)) {
              const shieldColor = "#BD00FF";
              spawnParticles(b.x, b.y, 8, false, shieldColor);
              playDeflect();
              spawnShieldSparks(b.x, b.y);
            } else {
              e.hp -= 1;
              e.hitFlashTimer = 0.12;
              const outlineColor = styles[e.type]?.outline || "#FFE600";
              spawnParticles(b.x, b.y, 6, false, outlineColor);
              playDeflect();
              if (e.hp <= 0) {
                destroyEnemy(e, e.x, e.y);
              }
            }
          }
          break;
        }
      }

      if (hit) {
        if (!b.bomb) state.bullets.splice(i, 1);
      }
    }
  }

  function updatePowerups(tdelta) {
    for (let i = state.powerups.length - 1; i >= 0; i--) {
      const p = state.powerups[i];
      p.age += tdelta;
      if (p.age >= 12.0) {
        state.powerups.splice(i, 1);
        continue;
      }

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < p.size || p.x > w - p.size) {
        p.vx *= -1;
        p.x = Math.max(p.size, Math.min(w - p.size, p.x));
      }
      if (p.y < p.size || p.y > h - p.size) {
        p.vy *= -1;
        p.y = Math.max(p.size, Math.min(h - p.size, p.y));
      }

      const dx = p.x - state.shipX;
      const dy = p.y - state.shipY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < p.size + SHIP_SIZE) {
        if (p.type === "shield") state.activePowerups.shield = 10;
        if (p.type === "triple") state.activePowerups.triple = 8;
        if (p.type === "speed") state.activePowerups.speed = 8;
        
        playChime();
        state.scorePopups.push({
          x: p.x,
          y: p.y,
          text: p.type.toUpperCase() + " ACTIVE!",
          age: 0,
          maxAge: 1.2
        });
        state.powerups.splice(i, 1);
      }
    }

    state.activePowerups.shield = Math.max(0, state.activePowerups.shield - tdelta);
    state.activePowerups.triple = Math.max(0, state.activePowerups.triple - tdelta);
    state.activePowerups.speed = Math.max(0, state.activePowerups.speed - tdelta);
  }

  function updateEnemies(tdelta) {
    const now = performance.now();

    if (state.enemies.length > 0) {
      state.aiBehaviorTimer += tdelta;
      if (state.aiBehaviorTimer >= 8.0) {
        state.aiBehaviorTimer = 0;
        const behaviors = ["drift", "formation", "orbit", "charge", "flank", "strafe"];
        state.aiBehavior = behaviors[Math.floor(Math.random() * behaviors.length)];
        
        state.scorePopups.push({
          x: w / 2,
          y: 140,
          text: `FLEET BEHAVIOR: ${state.aiBehavior.toUpperCase()}`,
          age: 0,
          maxAge: 1.5
        });
      }
    }

    // Resolve support ship shields
    const supportShips = state.enemies.filter(e => e.type === "support");
    for (const e of state.enemies) {
      e.shieldedBy = null;
      if (e.type === "support") continue;
      
      // Find closest support ship within 350px
      let closestSupport = null;
      let minDist = 350;
      for (const sup of supportShips) {
        const dx = sup.x - e.x;
        const dy = sup.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
          minDist = dist;
          closestSupport = sup;
        }
      }
      if (closestSupport) {
        e.shieldedBy = closestSupport;
      }
    }

    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      let fx = 0, fy = 0;

      // 1. Separation force
      for (const other of state.enemies) {
        if (other === e) continue;
        const dx = e.x - other.x;
        const dy = e.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const touchDist = SHIP_SIZE * (e.sizeFactor + other.sizeFactor) * 1.5;
        if (dist > 0 && dist < touchDist) {
          fx += (dx / dist) * (touchDist - dist) * 1.0;
          fy += (dy / dist) * (touchDist - dist) * 1.0;
        }
      }

      // 2. Coordinated steering forces based on behavior
      if (e.type === "boss") {
        const dx = state.shipX - e.x;
        const dy = state.shipY - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 200) {
          fx += (dx / dist) * 0.5;
          fy += (dy / dist) * 0.5;
        } else {
          const angle = Math.atan2(dy, dx) + Math.PI / 2;
          fx += Math.cos(angle) * 0.4;
          fy += Math.sin(angle) * 0.4;
        }
      } else if (state.aiBehavior === "charge") {
        const dx = state.shipX - e.x;
        const dy = state.shipY - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          fx += (dx / dist) * 2.2;
          fy += (dy / dist) * 2.2;
        }
      } else if (state.aiBehavior === "orbit") {
        const dx = e.x - state.shipX;
        const dy = e.y - state.shipY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          if (e.type === "drone" || e.type === "scout") {
            const orbitAngle = Math.atan2(dy, dx) + Math.PI / 2;
            const tx = state.shipX + Math.cos(orbitAngle) * 260;
            const ty = state.shipY + Math.sin(orbitAngle) * 260;
            fx += (tx - e.x) * 0.12;
            fy += (ty - e.y) * 0.12;
          } else {
            const targetDist = 380;
            const factor = (dist - targetDist) / dist;
            fx -= dx * factor * 0.15;
            fy -= dy * factor * 0.15;
          }
        }
      } else if (state.aiBehavior === "formation") {
        const cmd = state.enemies.find(x => x.type === "boss") || state.enemies.find(x => x.type === "cruiser") || state.enemies.find(x => x.type === "support") || state.enemies[0];
        if (e === cmd) {
          const dx = state.shipX - e.x;
          const dy = state.shipY - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            fx += (dx / dist) * 0.6;
            fy += (dy / dist) * 0.6;
          }
        } else {
          const followers = state.enemies.filter(x => x !== cmd);
          const idx = followers.indexOf(e);
          const side = (idx % 2 === 0) ? 1 : -1;
          const depth = Math.floor(idx / 2) + 1;
          const cmdAngle = cmd.angle;
          const wingAngle = cmdAngle + Math.PI + side * (Math.PI / 6);
          const tx = cmd.x + Math.cos(wingAngle) * (60 * depth);
          const ty = cmd.y + Math.sin(wingAngle) * (60 * depth);
          fx += (tx - e.x) * 0.2;
          fy += (ty - e.y) * 0.2;
        }
      } else if (state.aiBehavior === "flank") {
        const flankers = state.enemies.filter(x => x.type !== "boss" && x.type !== "support");
        const idx = flankers.indexOf(e);
        if (idx !== -1) {
          const group = idx % 2 === 0 ? -1 : 1;
          const tx = state.shipX + group * 220;
          const ty = state.shipY + Math.sin(performance.now() / 350 + idx) * 90;
          const dx = tx - e.x;
          const dy = ty - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            fx += (dx / dist) * 1.8;
            fy += (dy / dist) * 1.8;
          }
        } else {
          const dx = state.shipX - e.x;
          const dy = state.shipY - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 250) {
            fx += (dx / dist) * 0.6;
            fy += (dy / dist) * 0.6;
          }
        }
      } else if (state.aiBehavior === "strafe") {
        const flankers = state.enemies.filter(x => x.type !== "boss" && x.type !== "support");
        const idx = flankers.indexOf(e);
        if (idx !== -1) {
          const yOffset = (idx % 2 === 0) ? -160 : 160;
          const tx = (Math.sin(performance.now() / 900 + idx) * 0.45 + 0.5) * w;
          const ty = state.shipY + yOffset;
          const dx = tx - e.x;
          const dy = ty - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            fx += (dx / dist) * 1.5;
            fy += (dy / dist) * 1.5;
          }
        } else {
          const tx = state.shipX;
          const ty = state.shipY - 220;
          const dx = tx - e.x;
          const dy = ty - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            fx += (dx / dist) * 0.7;
            fy += (dy / dist) * 0.7;
          }
        }
      } else {
        const dx = state.shipX - e.x;
        const dy = state.shipY - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          fx += (dx / dist) * 0.25 + Math.sin(e.formationTimer + performance.now() / 500) * 0.12;
          fy += (dy / dist) * 0.25 + Math.cos(e.formationTimer + performance.now() / 500) * 0.12;
        }
      }

      // 3. Bullet Dodge Force
      let dodgeFx = 0, dodgeFy = 0;
      for (const b of state.bullets) {
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 110) {
          const bSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
          if (bSpeed > 0) {
            const bdx = b.vx / bSpeed;
            const bdy = b.vy / bSpeed;
            const toEnemyX = e.x - b.x;
            const toEnemyY = e.y - b.y;
            const dot = toEnemyX * bdx + toEnemyY * bdy;
            if (dot > 0) {
              const perpX = -bdy;
              const perpY = bdx;
              const side = (toEnemyX * perpX + toEnemyY * perpY) > 0 ? 1 : -1;
              dodgeFx += perpX * side * 1.8;
              dodgeFy += perpY * side * 1.8;
            }
          }
        }
      }
      fx += dodgeFx;
      fy += dodgeFy;

      // 4. Integrate velocities
      e.vx += fx * tdelta * 120;
      e.vy += fy * tdelta * 120;

      let maxSp = 80;
      if (e.type === "drone") maxSp = 130;
      else if (e.type === "scout") maxSp = 175;
      else if (e.type === "cruiser") maxSp = 80;
      else if (e.type === "bomber") maxSp = 55;
      else if (e.type === "support") maxSp = 100;
      else if (e.type === "boss") maxSp = 35;

      const speed = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
      if (speed > maxSp) {
        e.vx = (e.vx / speed) * maxSp;
        e.vy = (e.vy / speed) * maxSp;
      }

      e.x += e.vx * tdelta;
      e.y += e.vy * tdelta;

      if (e.hitFlashTimer > 0) {
        e.hitFlashTimer -= tdelta;
      }

      const currentSpeed = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
      if (currentSpeed > 5) {
        e.targetAngle = Math.atan2(e.vy, e.vx);
        e.angle = lerpAngle(e.angle, e.targetAngle, tdelta * 6);
      }

      // Wrap
      const pad = SHIP_SIZE * e.sizeFactor;
      if (e.x < -pad) e.x = w + pad;
      else if (e.x > w + pad) e.x = -pad;
      if (e.y < -pad) e.y = h + pad;
      else if (e.y > h + pad) e.y = -pad;

      // Shooting Logic
      if (e.type === "boss") {
        const bossShootCooldown = 1800;
        if (now - e.lastShotAt >= bossShootCooldown) {
          e.lastShotAt = now;
          e.bossPhase = (e.bossPhase || 0) + 1;
          const phase = e.bossPhase % 3;
          
          if (phase === 0) {
            const baseAngle = Math.atan2(state.shipY - e.y, state.shipX - e.x);
            for (let j = -2; j <= 2; j++) {
              const angle = baseAngle + j * (12 * Math.PI / 180);
              state.enemyBullets.push({
                x: e.x, y: e.y,
                vx: Math.cos(angle) * 7.5, vy: Math.sin(angle) * 7.5,
                radius: 5, spawned: true
              });
            }
          } else if (phase === 1) {
            for (let j = 0; j < 10; j++) {
              const angle = (j * 36) * Math.PI / 180;
              state.enemyBullets.push({
                x: e.x, y: e.y,
                vx: Math.cos(angle) * 5.5, vy: Math.sin(angle) * 5.5,
                radius: 4, spawned: true
              });
            }
          } else {
            const angle = Math.atan2(state.shipY - e.y, state.shipX - e.x);
            state.enemyBullets.push({
              x: e.x, y: e.y,
              vx: Math.cos(angle) * 3.5, vy: Math.sin(angle) * 3.5,
              radius: 12, spawned: true,
              bossBomb: true, age: 0
            });
          }
          playEnemyShoot();
        }
      } else if (e.type === "support") {
        // Support ships do not shoot, they focus entirely on shielding allies.
      } else if (e.type === "bomber") {
        const shootCooldown = 3800;
        if (now - e.lastShotAt >= shootCooldown) {
          e.lastShotAt = now;
          const angle = Math.atan2(state.shipY - e.y, state.shipX - e.x);
          state.enemyBullets.push({
            x: e.x, y: e.y,
            vx: Math.cos(angle) * 4.0, vy: Math.sin(angle) * 4.0,
            radius: 8.0, spawned: true,
            bomb: true, age: 0
          });
          playEnemyShoot();
        }
      } else if (e.type === "cruiser") {
        const shootCooldown = 2600;
        if (now - e.lastShotAt >= shootCooldown) {
          e.lastShotAt = now;
          const angle = Math.atan2(state.shipY - e.y, state.shipX - e.x);
          const perpAngle = angle + Math.PI / 2;
          const offsets = [-12, 12];
          for (const off of offsets) {
            const bx = e.x + Math.cos(perpAngle) * off;
            const by = e.y + Math.sin(perpAngle) * off;
            state.enemyBullets.push({
              x: bx, y: by,
              vx: Math.cos(angle) * 6.5, vy: Math.sin(angle) * 6.5,
              radius: 4.5, spawned: true
            });
          }
          playEnemyShoot();
        }
      } else if (e.type === "scout") {
        const shootCooldown = 1300;
        if (now - e.lastShotAt >= shootCooldown) {
          e.lastShotAt = now;
          const angle = Math.atan2(state.shipY - e.y, state.shipX - e.x);
          state.enemyBullets.push({
            x: e.x, y: e.y,
            vx: Math.cos(angle) * 11.0, vy: Math.sin(angle) * 11.0,
            radius: 3.5, spawned: true
          });
          playEnemyShoot();
        }
      } else {
        // drone / fallback
        const shootCooldown = 2200;
        if (now - e.lastShotAt >= shootCooldown) {
          e.lastShotAt = now;
          const angle = Math.atan2(state.shipY - e.y, state.shipX - e.x);
          state.enemyBullets.push({
            x: e.x, y: e.y,
            vx: Math.cos(angle) * 7.5, vy: Math.sin(angle) * 7.5,
            radius: 4, spawned: true
          });
          playEnemyShoot();
        }
      }
    }
  }

  function updateEnemyBullets(tdelta) {
    for (let i = state.enemyBullets.length - 1; i >= 0; i--) {
      const eb = state.enemyBullets[i];
      eb.x += eb.vx;
      eb.y += eb.vy;

      if (eb.x < 0 || eb.x > w || eb.y < 0 || eb.y > h) {
        state.enemyBullets.splice(i, 1);
        continue;
      }

      // Check detonation for bombs
      if (eb.bomb || eb.bossBomb) {
        eb.age = (eb.age || 0) + 1;
        const distToPlayer = Math.sqrt(Math.pow(eb.x - state.shipX, 2) + Math.pow(eb.y - state.shipY, 2));
        const triggerDist = eb.bossBomb ? 90 : 65;
        const maxAge = eb.bossBomb ? 140 : 110;

        if (eb.age > maxAge || distToPlayer < triggerDist) {
          playBoom(eb.bossBomb);
          spawnParticles(eb.x, eb.y, eb.bossBomb ? 20 : 10, true, eb.bossBomb ? "#FF003C" : "#FF5500");
          spawnFlash(eb.x, eb.y, eb.bossBomb);
          
          // Spawn shrapnel bullets
          const shrapnelCount = eb.bossBomb ? 8 : 4;
          const speed = eb.bossBomb ? 5.5 : 6.0;
          for (let j = 0; j < shrapnelCount; j++) {
            const angle = (j * (360 / shrapnelCount)) * Math.PI / 180;
            state.enemyBullets.push({
              x: eb.x, y: eb.y,
              vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
              radius: 3.5, spawned: true
            });
          }
          
          state.enemyBullets.splice(i, 1);
          continue;
        }
      }

      const dx = eb.x - state.shipX;
      const dy = eb.y - state.shipY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < eb.radius + SHIP_SIZE) {
        state.enemyBullets.splice(i, 1);

        if (state.activePowerups.shield > 0) {
          state.activePowerups.shield = Math.max(0, state.activePowerups.shield - 2.5);
          playDeflect();
          spawnShieldSparks(eb.x, eb.y);
        } else {
          const angle = Math.atan2(dy, dx);
          state.velX += Math.cos(angle) * 350;
          state.velY += Math.sin(angle) * 350;

          const penalty = (eb.bomb || eb.bossBomb) ? 2500 : 1000;
          state.score = Math.max(0, state.score - penalty);
          playBoom(true);
          
          state.scorePopups.push({
            x: state.shipX,
            y: state.shipY,
            text: `-${penalty} PTS!`,
            age: 0,
            maxAge: 1.2
          });
        }
      }
    }
  }

  function updateShipPosition(tdelta) {
    const hasSpeed = state.activePowerups.speed > 0;
    const currentRotSpeed = hasSpeed ? ROTATION_SPEED * 1.5 : ROTATION_SPEED;
    const currentAccel = hasSpeed ? THRUST_ACCEL * 1.8 : THRUST_ACCEL;
    const currentMaxSpeed = hasSpeed ? MAX_SPEED * 1.8 : MAX_SPEED;

    if (activeKeys.a) state.shipAngle -= currentRotSpeed * tdelta;
    if (activeKeys.d) state.shipAngle += currentRotSpeed * tdelta;

    if (activeKeys.w) {
      state.velX += Math.cos(state.shipAngle) * currentAccel * tdelta;
      state.velY += Math.sin(state.shipAngle) * currentAccel * tdelta;
    }
    if (activeKeys.s) {
      state.velX -= Math.cos(state.shipAngle) * currentAccel * tdelta * 0.5;
      state.velY -= Math.sin(state.shipAngle) * currentAccel * tdelta * 0.5;
    }

    const dragFactor = Math.pow(DRAG, tdelta * 60);
    state.velX *= dragFactor;
    state.velY *= dragFactor;

    const speed = Math.sqrt(state.velX * state.velX + state.velY * state.velY);
    if (speed > currentMaxSpeed) {
      state.velX = (state.velX / speed) * currentMaxSpeed;
      state.velY = (state.velY / speed) * currentMaxSpeed;
    }

    state.shipX += state.velX * tdelta;
    state.shipY += state.velY * tdelta;

    const pad = SHIP_SIZE;
    if (state.shipX < -pad) state.shipX = w + pad;
    else if (state.shipX > w + pad) state.shipX = -pad;
    if (state.shipY < -pad) state.shipY = h + pad;
    else if (state.shipY > h + pad) state.shipY = -pad;
  }

  function updateScorePopups(tdelta) {
    for (let i = state.scorePopups.length - 1; i >= 0; i--) {
      const p = state.scorePopups[i];
      p.age += tdelta;
      if (p.age >= p.maxAge) {
        state.scorePopups.splice(i, 1);
      }
    }
  }

  // Draw Functions
  function drawRoundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function renderShip() {
    const t = performance.now() / 1000;
    const pulse = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 7));
    const cx = state.shipX;
    const cy = state.shipY;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.shipAngle);

    const pulseFactor = (state.musicOn && state.beatPulse > 0) ? (1 + state.beatPulse * 0.15) : 1;
    const s = SHIP_SIZE * pulseFactor;

    // Double thruster engine flames
    if (activeKeys.w) {
      ctx.save();
      const flameLen = (s * 0.9) + Math.random() * (s * 0.7);
      const offsets = [-s * 0.22, s * 0.22];
      
      for (const off of offsets) {
        // Outer flame
        ctx.beginPath();
        ctx.moveTo(-s * 0.4, off);
        ctx.lineTo(-s * 0.65, off - s * 0.15);
        ctx.lineTo(-s * 0.65 - flameLen, off);
        ctx.lineTo(-s * 0.65, off + s * 0.15);
        ctx.closePath();
        
        let flameGrad = ctx.createLinearGradient(-s * 0.65 - flameLen, off, -s * 0.4, off);
        flameGrad.addColorStop(0, "rgba(189, 0, 255, 0)"); // Purple fadeout
        flameGrad.addColorStop(0.4, "rgba(0, 114, 255, 0.5)"); // Electric Blue middle
        flameGrad.addColorStop(1, "rgba(0, 240, 255, 0.9)"); // Cyan hot base
        ctx.fillStyle = flameGrad;
        ctx.shadowColor = "#00F0FF";
        ctx.shadowBlur = 12;
        ctx.fill();

        // Inner hot plasma spike
        ctx.beginPath();
        ctx.moveTo(-s * 0.4, off);
        ctx.lineTo(-s * 0.55, off - s * 0.08);
        ctx.lineTo(-s * 0.55 - flameLen * 0.5, off);
        ctx.lineTo(-s * 0.55, off + s * 0.08);
        ctx.closePath();
        
        let innerGrad = ctx.createLinearGradient(-s * 0.55 - flameLen * 0.5, off, -s * 0.4, off);
        innerGrad.addColorStop(0, "rgba(0, 240, 255, 0)");
        innerGrad.addColorStop(1, "rgba(255, 255, 255, 0.95)");
        ctx.fillStyle = innerGrad;
        ctx.shadowColor = "#FFFFFF";
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      ctx.restore();
    }

    // Ship body styling: Sleek Dual-Winged Fighter
    ctx.shadowColor = styles.player.glow;
    ctx.shadowBlur = 20 * pulse;

    // Under-body plate (slightly darker, wider)
    ctx.beginPath();
    ctx.moveTo(s * 1.15, 0);
    ctx.lineTo(-s * 0.45, s * 0.28);
    ctx.lineTo(-s * 0.7, 0);
    ctx.lineTo(-s * 0.45, -s * 0.28);
    ctx.closePath();
    ctx.fillStyle = "#050a1d";
    ctx.strokeStyle = "#0052aa";
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();

    // Wings (Left Wing)
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, s * 0.18);
    ctx.lineTo(-s * 0.2, s * 0.75); // wing tip base
    ctx.lineTo(-s * 0.35, s * 0.82); // wingtip
    ctx.lineTo(-s * 0.75, s * 0.78); // trailing wingtip
    ctx.lineTo(-s * 0.45, s * 0.18); // back to body
    ctx.closePath();
    const wingGrad = ctx.createLinearGradient(-s, s, 0, 0);
    wingGrad.addColorStop(0, styles.player.fill1);
    wingGrad.addColorStop(1, styles.player.fill2);
    ctx.fillStyle = wingGrad;
    ctx.fill();
    ctx.strokeStyle = styles.player.outline;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Wings (Right Wing)
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.18);
    ctx.lineTo(-s * 0.2, -s * 0.75);
    ctx.lineTo(-s * 0.35, -s * 0.82);
    ctx.lineTo(-s * 0.75, -s * 0.78);
    ctx.lineTo(-s * 0.45, -s * 0.18);
    ctx.closePath();
    ctx.fillStyle = wingGrad;
    ctx.fill();
    ctx.strokeStyle = styles.player.outline;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Wingtip Cannons (Left)
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, s * 0.74);
    ctx.lineTo(-s * 0.08, s * 0.74);
    ctx.lineTo(-s * 0.08, s * 0.8);
    ctx.lineTo(-s * 0.18, s * 0.8);
    ctx.closePath();
    ctx.fillStyle = "#1e293b";
    ctx.fill();
    ctx.strokeStyle = styles.player.outline;
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Wingtip Cannon Barrel (Left)
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, s * 0.77);
    ctx.lineTo(s * 0.15, s * 0.77);
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Wingtip Cannons (Right)
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, -s * 0.74);
    ctx.lineTo(-s * 0.08, -s * 0.74);
    ctx.lineTo(-s * 0.08, -s * 0.8);
    ctx.lineTo(-s * 0.18, -s * 0.8);
    ctx.closePath();
    ctx.fillStyle = "#1e293b";
    ctx.fill();
    ctx.strokeStyle = styles.player.outline;
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Wingtip Cannon Barrel (Right)
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, -s * 0.77);
    ctx.lineTo(s * 0.15, -s * 0.77);
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Main central fuselage
    ctx.beginPath();
    ctx.moveTo(s * 1.1, 0);
    ctx.lineTo(-s * 0.4, s * 0.2);
    ctx.lineTo(-s * 0.6, 0);
    ctx.lineTo(-s * 0.4, -s * 0.2);
    ctx.closePath();
    const bodyGrad = ctx.createLinearGradient(-s, 0, s, 0);
    bodyGrad.addColorStop(0, styles.player.fill1);
    bodyGrad.addColorStop(1, styles.player.fill2);
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = styles.player.outline;
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Decorative neon energy wing stripes
    ctx.strokeStyle = styles.player.outline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, s * 0.3);
    ctx.lineTo(-s * 0.35, s * 0.7);
    ctx.moveTo(-s * 0.22, -s * 0.3);
    ctx.lineTo(-s * 0.35, -s * 0.7);
    ctx.stroke();

    // Glowing glass cockpit canopy
    ctx.save();
    ctx.shadowColor = "rgba(0, 240, 255, 0.9)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(s * 0.15, 0, s * 0.32, s * 0.12, 0, 0, Math.PI * 2);
    const cockpitGrad = ctx.createRadialGradient(s * 0.2, 0, 0, s * 0.15, 0, s * 0.3);
    cockpitGrad.addColorStop(0, "#E0F7FF"); // Ice blue highlight
    cockpitGrad.addColorStop(0.5, "#00A2FF"); // Vibrant cobalt
    cockpitGrad.addColorStop(1, "#02113b"); // Deep sapphire
    ctx.fillStyle = cockpitGrad;
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Cockpit reflection glare line
    ctx.beginPath();
    ctx.ellipse(s * 0.22, -s * 0.03, s * 0.15, s * 0.04, -Math.PI / 12, 0, Math.PI, true);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.0;
    ctx.stroke();
    ctx.restore();

    // Central Fusion Core Glow
    ctx.save();
    ctx.shadowColor = "#00F0FF";
    ctx.shadowBlur = 12 * pulse;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(-s * 0.12, 0, 2.5 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Energy Shield effect
    if (state.activePowerups.shield > 0) {
      ctx.save();
      const baseRad = s * 1.9 + Math.sin(performance.now() / 100) * 2.5;
      
      // Outer rotating segmented ring
      ctx.shadowColor = "rgba(0, 240, 255, 0.9)";
      ctx.shadowBlur = 18;
      ctx.strokeStyle = "rgba(0, 240, 255, 0.8)";
      ctx.lineWidth = 2.0;
      
      ctx.beginPath();
      const rot = (performance.now() / 600) % (Math.PI * 2);
      ctx.arc(0, 0, baseRad, rot, rot + Math.PI * 0.45);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(0, 0, baseRad, rot + Math.PI * 0.67, rot + Math.PI * 1.12);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, baseRad, rot + Math.PI * 1.33, rot + Math.PI * 1.78);
      ctx.stroke();

      // Inner soft glow ring
      ctx.strokeStyle = "rgba(0, 240, 255, 0.3)";
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(0, 0, baseRad - 5, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.restore();
    }

    ctx.restore();
  }

  function renderEnemyShip(e) {
    const cx = e.x;
    const cy = e.y;
    const s = SHIP_SIZE * e.sizeFactor;
    const style = styles[e.type] || styles.drone;

    // Draw Shield Link in world coordinates
    if (e.shieldedBy) {
      ctx.save();
      ctx.strokeStyle = "rgba(189, 0, 255, 0.55)";
      ctx.lineWidth = 1.5 + 0.5 * Math.sin(performance.now() / 50);
      ctx.shadowColor = "#BD00FF";
      ctx.shadowBlur = 8;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(e.shieldedBy.x, e.shieldedBy.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(e.angle);

    // Hit flash
    if (e.hitFlashTimer > 0) {
      ctx.shadowColor = "rgba(255, 255, 255, 1.0)";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#FFFFFF";
      ctx.strokeStyle = "#FFFFFF";
      
      ctx.beginPath();
      if (e.type === "drone") {
        ctx.moveTo(s * 1.1, 0);
        ctx.lineTo(0, s * 0.5);
        ctx.lineTo(-s * 0.7, 0);
        ctx.lineTo(0, -s * 0.5);
      } else if (e.type === "scout") {
        ctx.moveTo(s * 1.2, 0);
        ctx.lineTo(s * 0.3, s * 0.25);
        ctx.lineTo(s * 0.4, s * 0.5);
        ctx.lineTo(-s * 0.2, s * 0.6);
        ctx.lineTo(-s * 0.7, s * 0.7);
        ctx.lineTo(-s * 0.4, s * 0.15);
        ctx.lineTo(-s * 0.55, 0);
        ctx.lineTo(-s * 0.4, -s * 0.15);
        ctx.lineTo(-s * 0.7, -s * 0.7);
        ctx.lineTo(-s * 0.2, -s * 0.6);
        ctx.lineTo(s * 0.4, -s * 0.5);
        ctx.lineTo(s * 0.3, -s * 0.25);
      } else if (e.type === "cruiser") {
        ctx.moveTo(s * 1.0, 0);
        ctx.lineTo(s * 0.4, s * 0.45);
        ctx.lineTo(s * 0.5, s * 0.7);
        ctx.lineTo(-s * 0.3, s * 0.8);
        ctx.lineTo(-s * 0.8, s * 0.45);
        ctx.lineTo(-s * 0.55, 0);
        ctx.lineTo(-s * 0.8, -s * 0.45);
        ctx.lineTo(-s * 0.3, -s * 0.8);
        ctx.lineTo(s * 0.5, -s * 0.7);
        ctx.lineTo(s * 0.4, -s * 0.45);
      } else if (e.type === "bomber") {
        ctx.moveTo(s * 0.8, 0);
        ctx.lineTo(0, s * 0.65);
        ctx.lineTo(-s * 0.7, s * 0.95);
        ctx.lineTo(-s * 0.9, s * 0.35);
        ctx.lineTo(-s * 0.65, 0);
        ctx.lineTo(-s * 0.9, -s * 0.35);
        ctx.lineTo(-s * 0.7, -s * 0.95);
        ctx.lineTo(0, -s * 0.65);
      } else if (e.type === "support") {
        for (let j = 0; j < 8; j++) {
          const ang = (j * 45) * Math.PI / 180;
          const rx = Math.cos(ang) * s;
          const ry = Math.sin(ang) * s;
          if (j === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
      } else { // boss
        ctx.moveTo(s * 1.4, 0);
        ctx.lineTo(s * 0.7, s * 0.25);
        ctx.lineTo(s * 0.8, s * 0.7);
        ctx.quadraticCurveTo(s * 0.2, s * 1.1, -s * 0.8, s * 1.2);
        ctx.lineTo(-s * 0.6, s * 0.5);
        ctx.lineTo(-s * 0.9, s * 0.45);
        ctx.lineTo(-s * 0.5, 0);
        ctx.lineTo(-s * 0.9, -s * 0.45);
        ctx.lineTo(-s * 0.6, -s * 0.5);
        ctx.lineTo(-s * 0.8, -s * 1.2);
        ctx.quadraticCurveTo(s * 0.2, -s * 1.1, s * 0.8, -s * 0.7);
        ctx.lineTo(s * 0.7, -s * 0.25);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    // Colors and Glows
    ctx.shadowColor = style.outline;
    ctx.shadowBlur = 12 * e.sizeFactor;
    ctx.strokeStyle = style.outline;

    const fillGrad = ctx.createLinearGradient(-s, 0, s, 0);
    fillGrad.addColorStop(0, style.fill1);
    fillGrad.addColorStop(1, style.fill2);
    ctx.fillStyle = fillGrad;

    // Draw Ship Models
    if (e.type === "drone") {
      ctx.beginPath();
      ctx.moveTo(s * 1.1, 0);
      ctx.lineTo(0, s * 0.5);
      ctx.lineTo(-s * 0.7, 0);
      ctx.lineTo(0, -s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Blinking red eye
      ctx.fillStyle = "#FF0033";
      ctx.shadowColor = "#FF0033";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s * 0.25, 0, 3, 0, Math.PI * 2);
      ctx.fill();

    } else if (e.type === "scout") {
      ctx.beginPath();
      ctx.moveTo(s * 1.2, 0);
      ctx.lineTo(s * 0.3, s * 0.25);
      ctx.lineTo(s * 0.4, s * 0.5);
      ctx.lineTo(-s * 0.2, s * 0.6);
      ctx.lineTo(-s * 0.7, s * 0.7);
      ctx.lineTo(-s * 0.4, s * 0.15);
      ctx.lineTo(-s * 0.55, 0);
      ctx.lineTo(-s * 0.4, -s * 0.15);
      ctx.lineTo(-s * 0.7, -s * 0.7);
      ctx.lineTo(-s * 0.2, -s * 0.6);
      ctx.lineTo(s * 0.4, -s * 0.5);
      ctx.lineTo(s * 0.3, -s * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cyan laser emitter core
      ctx.fillStyle = "#00FFFF";
      ctx.shadowColor = "#00FFFF";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s * 0.2, 0, 3, 0, Math.PI * 2);
      ctx.fill();

    } else if (e.type === "cruiser") {
      ctx.beginPath();
      ctx.moveTo(s * 1.0, 0);
      ctx.lineTo(s * 0.4, s * 0.45);
      ctx.lineTo(s * 0.5, s * 0.7);
      ctx.lineTo(-s * 0.3, s * 0.8);
      ctx.lineTo(-s * 0.8, s * 0.45);
      ctx.lineTo(-s * 0.55, 0);
      ctx.lineTo(-s * 0.8, -s * 0.45);
      ctx.lineTo(-s * 0.3, -s * 0.8);
      ctx.lineTo(s * 0.5, -s * 0.7);
      ctx.lineTo(s * 0.4, -s * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Glowing blue engine pods on flanks
      ctx.strokeStyle = "#00BFFF";
      ctx.strokeRect(-s * 0.2, s * 0.4, 6, 6);
      ctx.strokeRect(-s * 0.2, -s * 0.4, 6, 6);

    } else if (e.type === "bomber") {
      ctx.beginPath();
      ctx.moveTo(s * 0.8, 0);
      ctx.lineTo(0, s * 0.65);
      ctx.lineTo(-s * 0.7, s * 0.95);
      ctx.lineTo(-s * 0.9, s * 0.35);
      ctx.lineTo(-s * 0.65, 0);
      ctx.lineTo(-s * 0.9, -s * 0.35);
      ctx.lineTo(-s * 0.7, -s * 0.95);
      ctx.lineTo(0, -s * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Pulsing yellow bomb core
      const t = performance.now() / 120;
      ctx.fillStyle = "#FFAA00";
      ctx.shadowColor = "#FFAA00";
      ctx.shadowBlur = 10 + 4 * Math.sin(t);
      ctx.beginPath();
      ctx.arc(-s * 0.1, 0, s * 0.26, 0, Math.PI * 2);
      ctx.fill();

    } else if (e.type === "support") {
      ctx.beginPath();
      for (let j = 0; j < 8; j++) {
        const ang = (j * 45) * Math.PI / 180;
        const rx = Math.cos(ang) * s;
        const ry = Math.sin(ang) * s;
        if (j === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Inner ring
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.65, 0, Math.PI * 2);
      ctx.stroke();

      // Pulsing purple core
      const t = performance.now() / 150;
      ctx.fillStyle = "#BD00FF";
      ctx.shadowColor = "#BD00FF";
      ctx.shadowBlur = 10 + 4 * Math.sin(t);
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.3 * (1 + 0.15 * Math.sin(t)), 0, Math.PI * 2);
      ctx.fill();

      // Rotating nodes
      ctx.save();
      ctx.rotate(t * 0.2);
      ctx.fillStyle = "#FFFFFF";
      ctx.shadowBlur = 4;
      for (let j = 0; j < 4; j++) {
        const ang = (j * 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * s, Math.sin(ang) * s, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

    } else if (e.type === "boss") {
      ctx.beginPath();
      ctx.moveTo(s * 1.4, 0); // Nose center spear
      ctx.lineTo(s * 0.7, s * 0.25); // Nose joint
      ctx.lineTo(s * 0.8, s * 0.7); // Left wing blade tip
      ctx.quadraticCurveTo(s * 0.2, s * 1.1, -s * 0.8, s * 1.2); // Sweeping wing edge
      ctx.lineTo(-s * 0.6, s * 0.5); // Left trailing wing edge
      ctx.lineTo(-s * 0.9, s * 0.45); // Left engine pod
      ctx.lineTo(-s * 0.5, 0); // Center rear thrust bay
      ctx.lineTo(-s * 0.9, -s * 0.45);
      ctx.lineTo(-s * 0.6, -s * 0.5);
      ctx.lineTo(-s * 0.8, -s * 1.2);
      ctx.quadraticCurveTo(s * 0.2, -s * 1.1, s * 0.8, -s * 0.7);
      ctx.lineTo(s * 0.7, -s * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Laser emitters (Red/Orange glows)
      ctx.fillStyle = "#FF3C00";
      ctx.shadowColor = "#FF3C00";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s * 0.2, s * 0.5, 6, 0, Math.PI * 2);
      ctx.arc(s * 0.2, -s * 0.5, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Rotating shield rings
      ctx.save();
      ctx.strokeStyle = "#00FF66";
      ctx.lineWidth = 2.0;
      ctx.shadowColor = "#00FF66";
      ctx.shadowBlur = 10;
      const rot = (performance.now() / 600) % (Math.PI * 2);
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.35, rot, rot + Math.PI * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.35, rot + Math.PI * 0.67, rot + Math.PI * 1.02);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.35, rot + Math.PI * 1.33, rot + Math.PI * 1.68);
      ctx.stroke();
      ctx.restore();

      // Massive glowing core (Green)
      const pulse = 0.8 + 0.2 * Math.sin(performance.now() / 80);
      ctx.fillStyle = "#00FF66";
      ctx.shadowColor = "#00FF66";
      ctx.shadowBlur = 20 * pulse;
      ctx.beginPath();
      ctx.arc(-s * 0.08, 0, s * 0.22 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // Engine thruster exhaust flame
    const speed = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    if (speed > 12 || e.type === "boss") {
      ctx.save();
      const flicker = 0.85 + 0.15 * Math.sin(performance.now() / 30);
      
      if (e.type === "boss") {
        const offsets = [-s * 0.25, s * 0.25];
        const flameLen = (s * 0.65 + speed * 0.5) * flicker;
        for (const off of offsets) {
          ctx.beginPath();
          ctx.moveTo(-s * 0.5, off);
          ctx.lineTo(-s * 0.7, off - s * 0.15);
          ctx.lineTo(-s * 0.7 - flameLen, off);
          ctx.lineTo(-s * 0.7, off + s * 0.15);
          ctx.closePath();
          
          const flameGrad = ctx.createLinearGradient(-s * 0.7 - flameLen, off, -s * 0.5, off);
          flameGrad.addColorStop(0, "rgba(255, 60, 0, 0)");
          flameGrad.addColorStop(0.5, "rgba(255, 120, 0, 0.75)");
          flameGrad.addColorStop(1, "rgba(0, 255, 102, 0.95)");
          ctx.fillStyle = flameGrad;
          ctx.shadowColor = "#00FF66";
          ctx.shadowBlur = 10;
          ctx.fill();
        }
      } else if (e.type === "scout") {
        const flameLen = (s * 1.1 + speed * 0.4) * flicker;
        ctx.beginPath();
        ctx.moveTo(-s * 0.55, 0);
        ctx.lineTo(-s * 0.65, -s * 0.1);
        ctx.lineTo(-s * 0.65 - flameLen, 0);
        ctx.lineTo(-s * 0.65, s * 0.1);
        ctx.closePath();
        
        const flameGrad = ctx.createLinearGradient(-s * 0.65 - flameLen, 0, -s * 0.55, 0);
        flameGrad.addColorStop(0, "rgba(0, 191, 255, 0)");
        flameGrad.addColorStop(0.5, "rgba(0, 114, 255, 0.6)");
        flameGrad.addColorStop(1, "rgba(0, 240, 255, 0.95)");
        ctx.fillStyle = flameGrad;
        ctx.shadowColor = "#00F0FF";
        ctx.shadowBlur = 10;
        ctx.fill();
      } else {
        const flameLen = (s * 0.65 + speed * 0.4) * flicker;
        ctx.beginPath();
        ctx.moveTo(-s * 0.5, 0);
        ctx.lineTo(-s * 0.7, -s * 0.18);
        ctx.lineTo(-s * 0.7 - flameLen, 0);
        ctx.lineTo(-s * 0.7, s * 0.18);
        ctx.closePath();

        const flameGrad = ctx.createLinearGradient(-s * 0.7 - flameLen, 0, -s * 0.5, 0);
        flameGrad.addColorStop(0, "rgba(255, 60, 0, 0)");
        flameGrad.addColorStop(0.5, "rgba(255, 120, 0, 0.8)");
        flameGrad.addColorStop(1, "rgba(255, 230, 0, 0.95)");
        
        ctx.fillStyle = flameGrad;
        ctx.shadowColor = "#FF6600";
        ctx.shadowBlur = 8;
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw Shield bubble around shielded ship
    if (e.shieldedBy) {
      ctx.save();
      const shieldRad = s * 1.5 + Math.sin(performance.now() / 60) * 2.0;
      ctx.strokeStyle = "rgba(189, 0, 255, 0.8)";
      ctx.lineWidth = 2.0;
      ctx.shadowColor = "#BD00FF";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, shieldRad, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.fillStyle = "rgba(189, 0, 255, 0.08)";
      ctx.beginPath();
      ctx.arc(0, 0, shieldRad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function renderPowerups() {
    for (const p of state.powerups) {
      ctx.save();
      const pulse = 0.8 + 0.2 * Math.sin(p.age * 5.5 + p.bobSeed);
      const alpha = p.age > 10.0 ? (12.0 - p.age) / 2.0 : 1.0;
      ctx.globalAlpha = alpha;

      let color, glowColor;
      if (p.type === "shield") { color = "#00F0FF"; glowColor = "rgba(0,240,255,0.8)"; }
      else if (p.type === "triple") { color = "#FF3C00"; glowColor = "rgba(255,60,0,0.8)"; }
      else { color = "#00FF66"; glowColor = "rgba(0,255,102,0.8)"; }

      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 10 * pulse;
      ctx.fillStyle = color;

      ctx.beginPath();
      const r = p.size * pulse;
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function renderEnemyBullets() {
    for (const eb of state.enemyBullets) {
      ctx.save();
      ctx.shadowColor = "#FF003C";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#FF003C";
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, eb.radius, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, eb.radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function renderBullets() {
    for (const b of state.bullets) {
      for (let i = 0; i < b.trail.length; i++) {
        const p = b.trail[i];
        const a = (i + 1) / b.trail.length * 0.5;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = b.bomb ? "rgba(255,150,40,1)" : "rgba(120,240,255,1)";
        ctx.shadowColor = b.bomb ? "rgba(255,120,0,0.9)" : "rgba(0,240,255,0.9)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, b.radius * (0.4 + 0.6 * (i / b.trail.length)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.shadowColor = b.bomb ? "rgba(255,120,0,1)" : "rgba(0,240,255,1)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function renderParticles() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= p.decay;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function renderFlashes() {
    const now = performance.now();
    for (let i = state.flashes.length - 1; i >= 0; i--) {
      const f = state.flashes[i];
      f.t += now - f.last;
      f.last = now;
      const total = f.inMs + f.outMs;
      if (f.t >= total) {
        state.flashes.splice(i, 1);
        continue;
      }
      let alpha = f.t < f.inMs ? f.t / f.inMs : 1 - (f.t - f.inMs) / f.outMs;
      const r = f.maxR * (0.5 + 0.5 * (f.t / total));
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
      grad.addColorStop(0.4, `rgba(0,180,255,${0.6 * alpha})`);
      grad.addColorStop(1, "rgba(0,120,255,0)");
      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function renderScorePopups() {
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const p of state.scorePopups) {
      const pct = p.age / p.maxAge;
      const alpha = 1 - pct;
      const yOffset = -50 * pct;
      ctx.font = "bold 15px 'Segoe UI', Tahoma, sans-serif";
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
      ctx.shadowBlur = 4;
      ctx.fillText(p.text, p.x, p.y + yOffset);
    }
    ctx.restore();
  }

  function renderCooldown() {
    if (state.weapon !== 3) return;
    const now = performance.now();
    const elapsed = now - state.lastBombAt;
    if (elapsed >= BOMB_COOLDOWN_MS) return;

    const frac = elapsed / BOMB_COOLDOWN_MS;
    const cx = state.shipX;
    const cy = state.shipY;
    const r = SHIP_SIZE + 10;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(0, 240, 255, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function renderHUD() {
    // 1. TOP-LEFT PANEL: SCORES & WAVE PROGRESS (ULTRA-COMPACT)
    ctx.save();
    ctx.fillStyle = "rgba(8, 8, 14, 0.88)"; // Obsidian Slate Glass
    ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(0, 240, 255, 0.1)";
    ctx.shadowBlur = 10;
    drawRoundedRect(15, 12, 290, 48, 8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.textBaseline = "top";

    // SCORE & HI-SCORE ON ONE ROW
    ctx.textAlign = "left";
    ctx.font = "900 11px 'Orbitron', sans-serif";
    ctx.fillStyle = "#8CE7FF";
    ctx.fillText(`SCORE: ${state.score.toLocaleString()}`, 30, 18);

    ctx.textAlign = "right";
    ctx.fillStyle = "#FF8CEC";
    ctx.fillText(`HI-SCORE: ${state.highScore.toLocaleString()}`, 290, 18);

    // WAVE PROGRESS & COUNT ON SECOND ROW
    const enemiesLeft = state.enemies.length;
    const defeated = Math.max(0, state.waveTotalEnemies - enemiesLeft);
    const total = state.waveTotalEnemies || 1;
    const ratio = Math.min(1, defeated / total);

    ctx.textAlign = "left";
    ctx.font = "900 10px 'Orbitron', sans-serif";
    ctx.fillStyle = "#A3E2FF";
    const waveStr = state.waveNumber === 10 ? "FINAL" : state.waveNumber;
    ctx.fillText(`WAVE: ${waveStr} / 10`, 30, 32);

    ctx.textAlign = "right";
    ctx.fillText(`${defeated}/${total} DESTRUCTED`, 290, 32);

    // WAVE PROGRESS BAR
    ctx.strokeStyle = "rgba(0, 240, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(30, 47, 260, 4);
    ctx.fillStyle = "rgba(0, 240, 255, 0.1)";
    ctx.fillRect(30, 47, 260, 4);

    const barGrad = ctx.createLinearGradient(30, 0, 290, 0);
    barGrad.addColorStop(0, "#0072FF");
    barGrad.addColorStop(1, "#00F0FF");
    ctx.fillStyle = barGrad;
    ctx.fillRect(30, 48, 260 * ratio, 2);
    ctx.restore();


    // 2. TOP-RIGHT PANEL: SYSTEM STATUS (ULTRA-COMPACT)
    ctx.save();
    ctx.fillStyle = "rgba(8, 8, 14, 0.88)";
    ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(0, 240, 255, 0.1)";
    ctx.shadowBlur = 10;
    drawRoundedRect(w - 305, 12, 290, 48, 8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.textBaseline = "top";
    
    const rxStart = w - 305;
    
    // Header & Music status on Row 1
    ctx.textAlign = "left";
    ctx.font = "900 11px 'Orbitron', sans-serif";
    ctx.fillStyle = "#8CE7FF";
    ctx.fillText("SYSTEM STATUS", rxStart + 15, 18);

    ctx.textAlign = "right";
    ctx.font = "bold 10px 'Orbitron', sans-serif";
    ctx.fillStyle = state.musicOn ? "#00FF66" : "rgba(255, 255, 255, 0.35)";
    ctx.fillText(state.musicOn ? "MUSIC: ON" : "MUSIC: MUTED", rxStart + 275, 18);

    // Shield status & Engine status on Row 2
    ctx.textAlign = "left";
    ctx.font = "bold 10px 'Orbitron', sans-serif";
    const shActive = state.activePowerups.shield > 0;
    ctx.fillStyle = shActive ? "#00FFFF" : "rgba(255, 255, 255, 0.4)";
    ctx.fillText(shActive ? `SHIELD: ACTIVE [${state.activePowerups.shield.toFixed(1)}s]` : "SHIELD: READY", rxStart + 15, 36);

    ctx.textAlign = "right";
    const speedActive = state.activePowerups.speed > 0;
    ctx.fillStyle = speedActive ? "#00FF66" : "#0072FF";
    ctx.fillText(speedActive ? `ENGINE: OVERDRIVE [${state.activePowerups.speed.toFixed(1)}s]` : "ENGINE: STABLE", rxStart + 275, 36);
    ctx.restore();


    // 3. BOTTOM-LEFT PANEL: FLOATING CIRCLE RADAR ONLY
    ctx.save();
    const radarX = 60;
    const radarY = h - 60;
    const rr = 40;

    // Draw circular background glow
    ctx.fillStyle = "rgba(0, 10, 20, 0.65)";
    ctx.beginPath();
    ctx.arc(radarX, radarY, rr, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = "rgba(0, 240, 255, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(radarX, radarY, rr, 0, Math.PI * 2);
    ctx.stroke();

    // Concentric inner circle
    ctx.strokeStyle = "rgba(0, 240, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(radarX, radarY, rr * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(radarX - rr, radarY);
    ctx.lineTo(radarX + rr, radarY);
    ctx.moveTo(radarX, radarY - rr);
    ctx.lineTo(radarX, radarY + rr);
    ctx.stroke();

    // Sweep line
    const sweepAngle = (performance.now() / 400) % (Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(radarX, radarY);
    ctx.lineTo(radarX + Math.cos(sweepAngle) * rr, radarY + Math.sin(sweepAngle) * rr);
    ctx.stroke();

    const radarRange = Math.max(w, h) * 0.65;

    // Player dot
    ctx.fillStyle = "#00FFFF";
    ctx.beginPath();
    ctx.arc(radarX, radarY, 2, 0, Math.PI * 2);
    ctx.fill();

    // Powerup blips
    for (const p of state.powerups) {
      const dx = p.x - state.shipX;
      const dy = p.y - state.shipY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radarRange) {
        const bx = radarX + (dx / radarRange) * rr;
        const by = radarY + (dy / radarRange) * rr;
        const blipDist = Math.sqrt(Math.pow(bx - radarX, 2) + Math.pow(by - radarY, 2));
        if (blipDist <= rr) {
          ctx.fillStyle = p.type === "shield" ? "#00FFFF" : (p.type === "triple" ? "#FF3C00" : "#00FF66");
          ctx.beginPath();
          ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Enemy blips
    for (const enemy of state.enemies) {
      const dx = enemy.x - state.shipX;
      const dy = enemy.y - state.shipY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radarRange) {
        const bx = radarX + (dx / radarRange) * rr;
        const by = radarY + (dy / radarRange) * rr;
        const blipDist = Math.sqrt(Math.pow(bx - radarX, 2) + Math.pow(by - radarY, 2));
        if (blipDist <= rr) {
          ctx.fillStyle = enemy.type === "boss" ? "#FF007F" : (enemy.type === "support" ? "#BD00FF" : "#FF3333");
          ctx.beginPath();
          ctx.arc(bx, by, enemy.type === "boss" ? 3.0 : 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();


    // 4. COMBO PANEL (BOTTOM-RIGHT OF THE SCREEN - COMPACT)
    if (state.comboCount > 1) {
      ctx.save();
      ctx.fillStyle = "rgba(8, 8, 14, 0.88)";
      ctx.strokeStyle = "rgba(255, 225, 0, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "rgba(255, 225, 0, 0.1)";
      ctx.shadowBlur = 10;
      drawRoundedRect(w - 205, h - 60, 190, 45, 8);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const comboTimeLeft = Math.max(0, 1.5 - (performance.now() - state.lastDestroyTime) / 1000);
      const ratio = comboTimeLeft / 1.5;
      
      ctx.font = "italic bold 14px 'Orbitron', sans-serif";
      ctx.fillStyle = `rgba(255, 225, 0, ${0.4 + 0.6 * ratio})`;
      ctx.fillText(`COMBO x${state.comboCount}!`, w - 190, h - 52);
      
      ctx.fillStyle = `rgba(255, 225, 0, ${0.3 * ratio})`;
      ctx.fillRect(w - 190, h - 32, 160 * ratio, 4);
      ctx.restore();
    }
  }

  function renderFrame(tdelta) {
    if (state.musicOn && state.gameStarted) {
      state.beatTime += tdelta;
      if (state.beatTime >= 0.5) {
        state.beatTime -= 0.5;
        playBeatNote();
        state.beatPulse = 1.0;
      }
    }
    state.beatPulse = Math.max(0, state.beatPulse - tdelta * 4);

    if (state.gameStarted) {
      updateShipPosition(tdelta);
      updateBullets();
      
      if (!state.victoryDeclared) {
        if (state.enemies.length === 0) {
          if (state.waveTransitionTimer <= 0) {
            if (state.waveNumber >= 10) {
              state.victoryDeclared = true;
              playVictoryFanfare();
            } else {
              state.waveTransitionTimer = 3.0; // 3 seconds transition
              playChime();
            }
          } else {
            state.waveTransitionTimer -= tdelta;
            if (state.waveTransitionTimer <= 0) {
              state.waveNumber++;
              spawnEnemyFleet();
            }
          }
        }
      }

      updatePowerups(tdelta);
      updateEnemies(tdelta);
      updateEnemyBullets(tdelta);
      updateScorePopups(tdelta);
    }
    
    updateStarfield(tdelta);

    ctx.clearRect(0, 0, w, h);
    drawStarfield();
    renderFlashes();
    renderParticles();
    renderBullets();

    if (state.gameStarted) {
      renderPowerups();
      renderEnemyBullets();
      for (const e of state.enemies) {
        renderEnemyShip(e);
      }
      renderShip();
      renderCooldown();
      renderScorePopups();
      renderHUD();

      // Wave transitions overlay
      if (state.waveTransitionTimer > 0 && !state.victoryDeclared) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0, 240, 255, 0.8)";
        ctx.shadowBlur = 15;
        
        ctx.font = "italic bold 32px 'Orbitron', sans-serif";
        ctx.fillStyle = "#00F0FF";
        ctx.fillText("WAVE CLEARED!", w / 2, h / 2 - 20);
        
        ctx.font = "bold 18px 'Orbitron', sans-serif";
        ctx.fillStyle = "#FFFFFF";
        ctx.shadowBlur = 6;
        ctx.fillText(`NEXT WAVE IN ${Math.ceil(state.waveTransitionTimer)}s...`, w / 2, h / 2 + 25);
        ctx.restore();
      }

      // Victory overlay
      if (state.victoryDeclared) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        ctx.fillStyle = "rgba(8, 8, 12, 0.9)";
        ctx.strokeStyle = "rgba(0, 255, 102, 0.5)";
        ctx.lineWidth = 2.5;
        ctx.shadowColor = "rgba(0, 255, 102, 0.25)";
        ctx.shadowBlur = 25;
        
        const cardW = w > 520 ? 480 : w - 40;
        const cardH = 220;
        const cardX = w / 2 - cardW / 2;
        const cardY = h / 2 - cardH / 2;
        drawRoundedRect(cardX, cardY, cardW, cardH, 12);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        
        const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 150);
        ctx.shadowColor = `rgba(0, 255, 102, ${0.8 * pulse})`;
        ctx.shadowBlur = 15 * pulse;
        ctx.font = "italic bold 38px 'Orbitron', sans-serif";
        ctx.fillStyle = "#00FF66";
        ctx.fillText("VICTORY!", w / 2, h / 2 - 40);
        
        ctx.shadowBlur = 4;
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.font = "bold 18px 'Orbitron', sans-serif";
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText("ALL WAVES CLEARED", w / 2, h / 2 + 10);
        
        ctx.font = "14px 'Orbitron', sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.fillText(`FINAL SCORE: ${state.score.toLocaleString()}`, w / 2, h / 2 + 45);
        
        ctx.font = "italic 12px 'Orbitron', sans-serif";
        ctx.fillStyle = "rgba(0, 255, 102, 0.8)";
        ctx.fillText("Press [R] to Replay  |  [C] or [Esc] to Exit", w / 2, h / 2 + 75);
        ctx.restore();
      }
    }
  }

  // Input Listeners
  function restartGame() {
    state.victoryDeclared = false;
    state.gameStarted = false;
    state.score = 0;
    state.comboCount = 0;
    state.lastDestroyTime = 0;
    state.waveNumber = 1;
    state.waveTransitionTimer = 0;
    state.waveTotalEnemies = 0;

    state.shipX = w / 2;
    state.shipY = h / 2;
    state.shipAngle = -Math.PI / 2;
    state.velX = 0;
    state.velY = 0;
    state.weapon = 1;
    state.lastBombAt = 0;

    state.bullets = [];
    state.particles = [];
    state.flashes = [];
    state.powerups = [];
    state.enemies = [];
    state.enemyBullets = [];
    state.scorePopups = [];
    state.activePowerups = { shield: 0, triple: 0, speed: 0 };

    state.aiBehavior = "drift";
    state.aiBehaviorTimer = 0;
    state.beatTime = 0;
    state.beatPulse = 0;

    controlsCard.classList.remove("fade-out");
  }

  function onKeyDown(e) {
    const key = (e.key || "").toLowerCase();

    if (state.victoryDeclared && key === "r") {
      restartGame();
      e.preventDefault();
      return;
    }

    if (!state.gameStarted && (key === "w" || key === "a" || key === "s" || key === "d")) {
      state.gameStarted = true;
      controlsCard.classList.add("fade-out");
      spawnEnemyFleet();
      ensureAudio();
      state.musicOn = true;
      playClick();
      return;
    }

    if (key === "c" || key === "escape") {
      window.close();
      return;
    }

    if (key === "w" || key === "a" || key === "s" || key === "d") {
      activeKeys[key] = true;
      e.preventDefault();
      return;
    }

    if (key === " " || key === "spacebar") {
      if (state.gameStarted) {
        fireWeapon();
        e.preventDefault();
      }
      return;
    }

    if (key === "m") {
      if (state.gameStarted) {
        state.musicOn = !state.musicOn;
        if (!state.musicOn) {
          state.beatTime = 0;
        } else {
          playBeatNote();
          state.beatPulse = 1.0;
        }
        e.preventDefault();
      }
      return;
    }

    if (state.gameStarted) {
      if (key === "1") state.weapon = 1;
      if (key === "2") state.weapon = 2;
      if (key === "3") state.weapon = 3;
    }
  }

  function onKeyUp(e) {
    const key = (e.key || "").toLowerCase();
    if (key === "w" || key === "a" || key === "s" || key === "d") {
      activeKeys[key] = false;
    }
  }

  function onResize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    initStarfield();
  }

  // Initialization & Tick Loop
  canvas.width = w;
  canvas.height = h;
  initStarfield();

  function tryFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const docEl = document.documentElement;
      const requestFS = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
      if (requestFS) {
        requestFS.call(docEl).catch(err => {
          // Silent catch to prevent console cluttering on unapproved gestures
        });
      }
    }
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("resize", onResize);
  window.addEventListener("click", tryFullscreen, { capture: true, passive: true });
  window.addEventListener("keydown", tryFullscreen, { capture: true, passive: true });

  let lastFrameTime = performance.now();
  function tick() {
    const now = performance.now();
    const tdelta = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    
    if (state.comboCount > 0 && now - state.lastDestroyTime > 1500) {
      state.comboCount = 0;
    }

    renderFrame(tdelta);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
