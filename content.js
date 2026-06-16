/* =====================================================================
   Socket — content.js
   A torch / flashlight / space-shooter tool for any webpage (MV3).

   Others load. Socket unloads.

   Feature map (ALL single key presses):
     1. Torch toggle .......... T   (single press)
     2. Shooter mode .......... F   (single press, works without torch)
     3. Weapon switch ......... 1 / 2 / 3  (while shooter ON)
     4. Scroll to resize ...... wheel while torch ON
     5. Ship movement ......... W / A / S / D (while shooter ON)

   The whole thing is wrapped in an IIFE to avoid leaking globals and to
   guard against being injected more than once on the same page.
   ===================================================================== */
(function () {
  "use strict";

  // Guard against double injection (SPA navigations / re-injection).
  if (window.__socketLoaded) return;
  window.__socketLoaded = true;

  /* ===================================================================
     CONSTANTS & STATE
     =================================================================== */
  const DEFAULT_RADIUS = 120;      // default torch radius (px)
  const MIN_RADIUS = 30;           // scroll-to-resize minimum
  const MAX_RADIUS = 400;          // scroll-to-resize maximum
  const RADIUS_STEP = 15;          // px per scroll tick
  const TORCH_FLICKER = 0.025;     // 2.5% subtle flame flicker

  // Weapon modes.
  const WEAPON_SINGLE = 1;
  const WEAPON_SPREAD = 2;
  const WEAPON_BOMB = 3;

  // Shooter tuning.
  const BULLET_SPEED = 22;         // px per frame (single/spread)
  const BOMB_SPEED = 7;            // px per frame (bomb, slow)
  const BULLET_RADIUS = 3;         // visual core radius (single/spread)
  const BOMB_RADIUS = 8;           // visual core radius (bomb)
  const SPREAD_ANGLE = 15 * Math.PI / 180; // ± fan angle for spread
  const BOMB_BLAST_RADIUS = 150;   // bomb area-of-effect radius (px)
  const BOMB_COOLDOWN_MS = 2000;   // bomb cooldown window
  const SHIP_SIZE = 16;            // ship triangle radius (px)
  const TRAIL_MAX = 8;             // bullet trail history length

  // Physics constants (Asteroids style)
  const ROTATION_SPEED = 3.8;      // radians per second
  const THRUST_ACCEL = 550;        // pixels per second squared
  const MAX_SPEED = 500;           // maximum pixels per second
  const DRAG = 0.982;              // velocity retention factor per frame at 60fps

  // IDs used to identify our own injected nodes (never inspect/delete them).
  const OVERLAY_ID = "socket-overlay";
  const STYLE_ID = "socket-runtime-style";
  const FX_CANVAS_ID = "socket-fx-canvas";
  const MASK_CLASS = "socket-mask";
  const SHARD_CLASS = "socket-shard";

  const state = {
    torchOn: false,
    shooterOn: false,
    weapon: WEAPON_SINGLE,

    radius: DEFAULT_RADIUS,
    mouseX: window.innerWidth / 2,
    mouseY: window.innerHeight / 2,
    shipX: window.innerWidth / 2,
    shipY: window.innerHeight / 2,
    shipAngle: -Math.PI / 2,
    velX: 0,
    velY: 0,

    rafPending: false,            // mousemove rAF throttle flag
    flickerSeed: Math.random() * 1000,

    bullets: [],                  // active projectiles
    particles: [],                // active particle-burst dots
    flashes: [],                  // active radial flash bursts
    lastBombAt: 0,                // timestamp of last bomb fire
    scanActive: false,            // target scanner active flag
  };

  // Keyboard active key state.
  const activeKeys = {
    w: false,
    a: false,
    s: false,
    d: false
  };

  // DOM handles (created on activation, nulled on teardown).
  let overlayEl = null;
  let maskEl = null;
  let fxCanvasEl = null;
  let fxCtx = null;
  let audioCtx = null;

  const elementHpMap = new WeakMap();

  /* ===================================================================
     WEB AUDIO — programmatic sound effects (no audio files)
     =================================================================== */
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

  // Metallic clank on element hit
  function playClank() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(580, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }


  // Short sharp "click" when the torch/shooter turns on.
  function playClick() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.04);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  // Sharp rising "pew" laser sound when a bullet is fired.
  function playPew() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  // Short "boom" / "crunch" when an element is destroyed.
  // `big` produces a louder, longer explosion for bomb mode.
  function playBoom(big) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = big ? 0.5 : 0.28;
    const peak = big ? 0.5 : 0.3;

    // Noise burst for the "crunch".
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // Decaying white noise.
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(peak, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);

    // Low sine "thump" for body.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(big ? 160 : 220, now);
    osc.frequency.exponentialRampToValueAtTime(big ? 40 : 70, now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }



  /* ===================================================================
     HELPERS
     =================================================================== */

  // Is the focused/target element a text-entry context? If so, ignore shortcuts.
  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    // Walk up a few parents for contenteditable containers.
    let p = el;
    while (p) {
      if (p.isContentEditable) return true;
      p = p.parentElement;
    }
    return false;
  }

  // True if the node belongs to Socket's own overlay tree.
  function isOwnNode(node) {
    if (!node || node.nodeType !== 1) return true; // non-elements: treat as own/ignore
    if (node.id === OVERLAY_ID || node.id === FX_CANVAS_ID || node.id === STYLE_ID) return true;
    if (node.classList &&
        (node.classList.contains(MASK_CLASS) ||
         node.classList.contains(SHARD_CLASS))) return true;
    if (overlayEl && overlayEl.contains(node)) return true;
    return false;
  }

  /* ===================================================================
     OVERLAY CONSTRUCTION / TEARDOWN
     =================================================================== */
  function buildOverlay() {
    // Master overlay.
    overlayEl = document.createElement("div");
    overlayEl.id = OVERLAY_ID;

    // Dark mask layer (radial-gradient cutout updated each frame).
    maskEl = document.createElement("div");
    maskEl.className = MASK_CLASS;
    overlayEl.appendChild(maskEl);

    // Shooter / FX canvas (ship, bullets, particles, flashes).
    fxCanvasEl = document.createElement("canvas");
    fxCanvasEl.id = FX_CANVAS_ID;
    overlayEl.appendChild(fxCanvasEl);

    document.body.appendChild(overlayEl);

    sizeCanvas();
    document.documentElement.classList.add("socket-active");
  }

  function teardownOverlay() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = maskEl = fxCanvasEl = fxCtx = null;
    document.documentElement.classList.remove("socket-active");
  }

  function sizeCanvas() {
    if (!fxCanvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    fxCanvasEl.width = Math.floor(window.innerWidth * dpr);
    fxCanvasEl.height = Math.floor(window.innerHeight * dpr);
    fxCanvasEl.style.width = window.innerWidth + "px";
    fxCanvasEl.style.height = window.innerHeight + "px";
    fxCtx = fxCanvasEl.getContext("2d");
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ===================================================================
     RENDERING — mask cutout, flicker, flash
     =================================================================== */

  // Subtle flame flicker: tiny radius oscillation on a slow timer.
  function flickeredRadius() {
    const t = performance.now() / 1000;
    // Combine two slow sines + seed for an organic, non-periodic feel.
    const wobble =
      Math.sin(t * 2.3 + state.flickerSeed) * 0.5 +
      Math.sin(t * 5.1 + state.flickerSeed * 1.7) * 0.5;
    return state.radius * (1 + wobble * TORCH_FLICKER);
  }

  // Paint the dark mask with a radial "hole" at the torch position.
  function renderMask() {
    if (!maskEl) return;

    if (!state.torchOn) {
      maskEl.style.background = "transparent";
      return;
    }

    const r = flickeredRadius();
    const x = state.shooterOn ? state.shipX : state.mouseX;
    const y = state.shooterOn ? state.shipY : state.mouseY;

    // Warm bright core -> transparent edge -> dark surround.
    // Soft realistic glow: multiple color stops, no hard edge.
    const grad =
      `radial-gradient(circle ${r}px at ${x}px ${y}px, ` +
      `rgba(255,250,235,0.00) 0%, ` +     // fully clear core (page visible)
      `rgba(255,244,214,0.00) 55%, ` +    // still clear
      `rgba(20,16,8,0.25) 72%, ` +        // glow begins
      `rgba(0,0,0,0.85) 100%)`;           // full darkness outside

    maskEl.style.background = grad;
  }

  /* ===================================================================
     SHOOTER MODE — ship, firing, bullets (FEATURE 4 & 5)
     =================================================================== */

  // Aim direction (ship orientation angle).
  function aimAngle() {
    return state.shipAngle != null ? state.shipAngle : -Math.PI / 2;
  }

  // Spawn a single bullet from the ship center along `angle`.
  function spawnBullet(angle, opts) {
    const isBomb = opts && opts.bomb;
    const speed = isBomb ? BOMB_SPEED : BULLET_SPEED;
    let bx = state.shipX;
    let by = state.shipY;
    if (opts && opts.offsetSide) {
      const perpAngle = angle + Math.PI / 2;
      bx += Math.cos(perpAngle) * opts.offsetSide;
      by += Math.sin(perpAngle) * opts.offsetSide;
    }
    state.bullets.push({
      x: bx,
      y: by,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      bomb: !!isBomb,
      radius: isBomb ? BOMB_RADIUS : BULLET_RADIUS,
      trail: [],
      spawned: true,
    });
  }

  // Fire the current weapon from the ship toward the aim direction.
  function fireWeapon() {
    const angle = aimAngle();

    if (state.weapon === WEAPON_BOMB) {
      // Enforce cooldown.
      const now = performance.now();
      if (now - state.lastBombAt < BOMB_COOLDOWN_MS) return;
      state.lastBombAt = now;
      spawnBullet(angle, { bomb: true });
      playPew();
      return;
    }

    if (state.weapon === WEAPON_SPREAD) {
      // 3-way spread
      spawnBullet(angle - SPREAD_ANGLE);
      spawnBullet(angle);
      spawnBullet(angle + SPREAD_ANGLE);
      playPew();
      return;
    }

    // Single shot (default).
    spawnBullet(angle);
    playPew();
  }

  // Advance bullets, run hit detection, retire out-of-bounds bullets.
  function updateBullets() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];

      // Record trail history.
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > TRAIL_MAX) b.trail.shift();

      b.x += b.vx;
      b.y += b.vy;

      // Out of viewport -> remove.
      if (b.x < 0 || b.x > w || b.y < 0 || b.y > h) {
        state.bullets.splice(i, 1);
        continue;
      }

      // Skip hit detection in the very first frame to let the bullet render
      // and move out of the ship's immediate collision zone.
      if (b.spawned) {
        b.spawned = false;
        continue;
      }

      // Hit detection at the bullet's current position.
      const target = elementAtPoint(b.x, b.y);
      if (target && canRemove(target)) {
        if (b.bomb) {
          detonateBomb(b.x, b.y);
        } else {
          let hp = elementHpMap.get(target);
          if (hp === undefined) {
            hp = getElementMaxHp(target);
          }
          hp -= 1;
          elementHpMap.set(target, hp);

          if (hp <= 0) {
            destroyElement(target, b.x, b.y, false, false);
          } else {
            playClank();
            spawnSparkParticles(b.x, b.y);
            target.classList.add("socket-hit-flash");
            setTimeout(() => {
              if (target && target.parentNode) target.classList.remove("socket-hit-flash");
            }, 120);
          }
        }
        state.bullets.splice(i, 1);
      }
    }
  }

  // Hit-test a point with our overlay hidden so we resolve real content.
  function elementAtPoint(x, y) {
    if (!overlayEl) return null;
    const cx = Math.max(0, Math.min(window.innerWidth - 1, x));
    const cy = Math.max(0, Math.min(window.innerHeight - 1, y));
    const prevVis = overlayEl.style.visibility;
    overlayEl.style.visibility = "hidden";
    const el = document.elementFromPoint(cx, cy);
    overlayEl.style.visibility = prevVis;
    return el;
  }

  function isLargeContainer(el) {
    const rect = el.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    // Container threshold: covers major part of the screen
    if (rect.width > vpW * 0.7 && rect.height > vpH * 0.7) return true;
    if (rect.width * rect.height > vpW * vpH * 0.4) return true;
    return false;
  }

  // Returns true if the element behaves as a layout structure containing other block elements.
  function isStructuralLayout(el) {
    const tag = (el.tagName || "").toUpperCase();
    const structuralTags = ["DIV", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER", "NAV", "MAIN", "UL", "OL", "FORM"];
    if (structuralTags.includes(tag) && el.children.length > 0) {
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        const childTag = (child.tagName || "").toUpperCase();
        if (structuralTags.includes(childTag) || child.offsetHeight > 40) {
          return true;
        }
      }
    }
    return false;
  }

  function canRemove(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isOwnNode(el)) return false;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "HTML" || tag === "HEAD" || tag === "BODY" || tag === "SCRIPT" || tag === "STYLE" || tag === "LINK") return false;
    
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    
    if (isLargeContainer(el)) return false;
    if (isStructuralLayout(el)) return false;
    return true;
  }

  /* ===================================================================
     BOMB — area-of-effect destruction (WEAPON MODE 3)
     =================================================================== */
  function detonateBomb(hx, hy) {
    // Collect unique destroyable elements within the blast radius by
    // sampling points across the blast disc.
    const found = new Set();
    const step = 24;
    for (let dx = -BOMB_BLAST_RADIUS; dx <= BOMB_BLAST_RADIUS; dx += step) {
      for (let dy = -BOMB_BLAST_RADIUS; dy <= BOMB_BLAST_RADIUS; dy += step) {
        if (dx * dx + dy * dy > BOMB_BLAST_RADIUS * BOMB_BLAST_RADIUS) continue;
        const el = elementAtPoint(hx + dx, hy + dy);
        if (el && canRemove(el)) found.add(el);
      }
    }

    // Big shared FX once.
    spawnParticles(hx, hy, 40, true);
    spawnFlash(hx, hy, true);
    screenShake(true);
    playBoom(true);

    // Destroy each element (shatter only, FX already fired).
    found.forEach((el) => {
      let hp = elementHpMap.get(el);
      if (hp === undefined) {
        hp = getElementMaxHp(el);
      }
      hp -= 4; // bomb does 4 damage (enough to destroy large elements)
      elementHpMap.set(el, hp);

      if (hp <= 0) {
        destroyElement(el, hx, hy, true, true);
      } else {
        el.classList.add("socket-hit-flash");
        setTimeout(() => {
          if (el && el.parentNode) el.classList.remove("socket-hit-flash");
        }, 120);
      }
    });
  }

  /* ===================================================================
     DESTRUCTION SEQUENCE — shatter + particles + flash + shake
     =================================================================== */

  // `quiet` skips the per-element particle/flash/shake/sound (used by
  // bomb where the FX are fired once for the whole blast).
  function destroyElement(el, hx, hy, big, quiet) {
    if (!el || !el.parentNode || !canRemove(el)) return;

    const rect = el.getBoundingClientRect();
    spawnShatter(el, rect);

    if (!quiet) {
      spawnParticles(hx, hy, big ? 20 : 18, big);
      spawnFlash(hx, hy, big);
      screenShake(big);
      playBoom(big);
    }

    // Remove the original element from the DOM immediately; the shatter
    // clone (a detached fixed-position overlay) carries the animation.
    el.remove();
  }

  /* ===================================================================
     ARCADE GAME HELPERS & SYSTEMS
     =================================================================== */
  function getElementMaxHp(el) {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < 15000) return 1;
    if (area < 60000) return 2;
    return 4;
  }

  function spawnSparkParticles(x, y) {
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 4;
      state.particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 1.0,
        decay: 1 / 20, // decay faster, ~330ms
        size: 1.5 + Math.random() * 1.5,
        hue: 180 + Math.random() * 40, // Cyan to blue-ish sparks
      });
    }
  }





  // Clone the element, split it into 6-10 shards via clip-path, fly each
  // outward with rotation + scale-to-zero over 600ms using CSS transitions.
  function spawnShatter(el, rect) {
    if (rect.width < 1 || rect.height < 1) return;

    const shardCount = 6 + Math.floor(Math.random() * 5); // 6..10

    for (let i = 0; i < shardCount; i++) {
      const shard = el.cloneNode(true);
      shard.classList.add(SHARD_CLASS);

      // Strip ids to avoid duplicate-id side effects on the page.
      shard.removeAttribute("id");

      // Position the shard exactly over the original element.
      shard.style.position = "fixed";
      shard.style.left = rect.left + "px";
      shard.style.top = rect.top + "px";
      shard.style.width = rect.width + "px";
      shard.style.height = rect.height + "px";
      shard.style.margin = "0";
      shard.style.pointerEvents = "none";
      shard.style.zIndex = "2147483646";
      shard.style.transition =
        "transform 600ms cubic-bezier(.2,.7,.3,1), opacity 600ms ease-out";
      shard.style.willChange = "transform, opacity";
      shard.style.overflow = "hidden";

      // Random rectangular slice via clip-path.
      const x1 = Math.random() * 60;
      const x2 = 40 + Math.random() * 60;
      const y1 = Math.random() * 60;
      const y2 = 40 + Math.random() * 60;
      shard.style.clipPath =
        `polygon(${x1}% ${y1}%, ${x2}% ${y1}%, ${x2}% ${y2}%, ${x1}% ${y2}%)`;

      document.body.appendChild(shard);

      // Random outward vector + rotation.
      const ang = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 160;
      const tx = Math.cos(ang) * dist;
      const ty = Math.sin(ang) * dist;
      const rot = (Math.random() * 2 - 1) * 540;

      // Kick off the transition on the next frame.
      requestAnimationFrame(() => {
        shard.style.transform =
          `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(0)`;
        shard.style.opacity = "0";
      });

      // Clean up the shard after the animation completes.
      setTimeout(() => {
        if (shard.parentNode) shard.parentNode.removeChild(shard);
      }, 650);
    }
  }

  // Spawn glowing particle dots that fly out and fade on the FX canvas.
  function spawnParticles(x, y, count, big) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (big ? 4 : 2.5) + Math.random() * (big ? 7 : 4);
      state.particles.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 1,                       // 1 -> 0
        decay: 1 / (big ? 40 : 30),    // ~500-660ms at 60fps
        size: (big ? 2.5 : 1.5) + Math.random() * 2,
        hue: 35 + Math.random() * 25,  // warm orange/yellow
      });
    }
  }

  // Spawn a radial flash burst (fade in ~80ms, out ~200ms).
  function spawnFlash(x, y, big) {
    state.flashes.push({
      x: x,
      y: y,
      t: 0,                            // elapsed ms
      inMs: 80,
      outMs: 200,
      maxR: big ? 180 : 70,
      last: performance.now(),
    });
  }

  // Subtle body translate shake for 200ms.
  let shakeTimer = null;
  let shakeStart = 0;
  function screenShake(big) {
    const amp = big ? 10 : 5;
    shakeStart = performance.now();
    const duration = 200;

    function step() {
      const elapsed = performance.now() - shakeStart;
      if (elapsed >= duration) {
        document.body.style.transform = "";
        shakeTimer = null;
        return;
      }
      const decay = 1 - elapsed / duration;
      const dx = (Math.random() * 2 - 1) * amp * decay;
      const dy = (Math.random() * 2 - 1) * amp * decay;
      document.body.style.transform = `translate(${dx}px, ${dy}px)`;
      shakeTimer = requestAnimationFrame(step);
    }
    if (shakeTimer) cancelAnimationFrame(shakeTimer);
    shakeTimer = requestAnimationFrame(step);
  }

  /* ===================================================================
     FX CANVAS RENDERING — ship, bullets, particles, flashes, cooldown
     =================================================================== */
  function renderFx() {
    if (!fxCtx) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    fxCtx.clearRect(0, 0, w, h);

    renderFlashes();
    renderParticles();
    renderBullets();

    if (state.shooterOn) {
      renderShip();
      renderCooldown();
      renderSimpleHUD();
    }
  }

  function renderSimpleHUD() {
    fxCtx.save();
    fxCtx.fillStyle = "rgba(10, 10, 15, 0.8)"; // dark obsidian glass
    fxCtx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    fxCtx.lineWidth = 1.5;
    drawRoundedRect(fxCtx, 10, 10, 250, 50, 8);
    fxCtx.fill();
    fxCtx.stroke();
    
    fxCtx.textAlign = "left";
    fxCtx.textBaseline = "middle";
    fxCtx.font = "bold 13px 'Segoe UI', Tahoma, sans-serif";
    fxCtx.fillStyle = "#FFFFFF";
    fxCtx.fillText("SHOOTER MODE (ACTIVE)", 22, 25);
    
    fxCtx.font = "10px 'Segoe UI', Tahoma, sans-serif";
    fxCtx.fillStyle = "rgba(255, 255, 255, 0.6)";
    fxCtx.fillText("Press [F] to Exit | [C] for Combat Mode", 22, 43);
    
    fxCtx.restore();
  }

  // Glowing pulsing ship at its coordinates, pointing toward the direction it's facing.
  function renderShip() {
    const t = performance.now() / 1000;
    const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 6)); // 0.6..1.0
    const angle = aimAngle();
    const cx = state.shipX;
    const cy = state.shipY;

    fxCtx.save();
    fxCtx.translate(cx, cy);
    fxCtx.rotate(angle);

    const s = SHIP_SIZE;

    // Double thruster engine flames if accelerating (W)
    if (activeKeys.w) {
      fxCtx.save();
      const flameLen = (s * 0.9) + Math.random() * (s * 0.7);
      const offsets = [-s * 0.22, s * 0.22];
      
      for (const off of offsets) {
        // Outer flame
        fxCtx.beginPath();
        fxCtx.moveTo(-s * 0.4, off);
        fxCtx.lineTo(-s * 0.65, off - s * 0.15);
        fxCtx.lineTo(-s * 0.65 - flameLen, off);
        fxCtx.lineTo(-s * 0.65, off + s * 0.15);
        fxCtx.closePath();
        
        let flameGrad = fxCtx.createLinearGradient(-s * 0.65 - flameLen, off, -s * 0.4, off);
        flameGrad.addColorStop(0, "rgba(189, 0, 255, 0)"); // Purple fadeout
        flameGrad.addColorStop(0.4, "rgba(0, 114, 255, 0.5)"); // Electric Blue middle
        flameGrad.addColorStop(1, "rgba(0, 240, 255, 0.9)"); // Cyan hot base
        fxCtx.fillStyle = flameGrad;
        fxCtx.shadowColor = "#00F0FF";
        fxCtx.shadowBlur = 12;
        fxCtx.fill();

        // Inner hot plasma spike
        fxCtx.beginPath();
        fxCtx.moveTo(-s * 0.4, off);
        fxCtx.lineTo(-s * 0.55, off - s * 0.08);
        fxCtx.lineTo(-s * 0.55 - flameLen * 0.5, off);
        fxCtx.lineTo(-s * 0.55, off + s * 0.08);
        fxCtx.closePath();
        
        let innerGrad = fxCtx.createLinearGradient(-s * 0.55 - flameLen * 0.5, off, -s * 0.4, off);
        innerGrad.addColorStop(0, "rgba(0, 240, 255, 0)");
        innerGrad.addColorStop(1, "rgba(255, 255, 255, 0.95)");
        fxCtx.fillStyle = innerGrad;
        fxCtx.shadowColor = "#FFFFFF";
        fxCtx.shadowBlur = 6;
        fxCtx.fill();
      }
      fxCtx.restore();
    }

    // Ship body styling: Sleek Dual-Winged Fighter
    fxCtx.shadowColor = "rgba(0, 240, 255, 0.85)";
    fxCtx.shadowBlur = 20 * pulse;

    // Under-body plate
    fxCtx.beginPath();
    fxCtx.moveTo(s * 1.15, 0);
    fxCtx.lineTo(-s * 0.45, s * 0.28);
    fxCtx.lineTo(-s * 0.7, 0);
    fxCtx.lineTo(-s * 0.45, -s * 0.28);
    fxCtx.closePath();
    fxCtx.fillStyle = "#050a1d";
    fxCtx.strokeStyle = "#0052aa";
    fxCtx.lineWidth = 1.2;
    fxCtx.fill();
    fxCtx.stroke();

    // Wings (Left Wing)
    fxCtx.beginPath();
    fxCtx.moveTo(-s * 0.1, s * 0.18);
    fxCtx.lineTo(-s * 0.2, s * 0.75);
    fxCtx.lineTo(-s * 0.35, s * 0.82);
    fxCtx.lineTo(-s * 0.75, s * 0.78);
    fxCtx.lineTo(-s * 0.45, s * 0.18);
    fxCtx.closePath();
    const wingGrad = fxCtx.createLinearGradient(-s, s, 0, 0);
    wingGrad.addColorStop(0, "#0b1532");
    wingGrad.addColorStop(1, "#1a2c66");
    fxCtx.fillStyle = wingGrad;
    fxCtx.fill();
    fxCtx.strokeStyle = "#00F0FF";
    fxCtx.lineWidth = 1.8;
    fxCtx.stroke();

    // Wings (Right Wing)
    fxCtx.beginPath();
    fxCtx.moveTo(-s * 0.1, -s * 0.18);
    fxCtx.lineTo(-s * 0.2, -s * 0.75);
    fxCtx.lineTo(-s * 0.35, -s * 0.82);
    fxCtx.lineTo(-s * 0.75, -s * 0.78);
    fxCtx.lineTo(-s * 0.45, -s * 0.18);
    fxCtx.closePath();
    fxCtx.fillStyle = wingGrad;
    fxCtx.fill();
    fxCtx.strokeStyle = "#00F0FF";
    fxCtx.lineWidth = 1.8;
    fxCtx.stroke();

    // Wingtip Cannons (Left)
    fxCtx.beginPath();
    fxCtx.moveTo(-s * 0.18, s * 0.74);
    fxCtx.lineTo(-s * 0.08, s * 0.74);
    fxCtx.lineTo(-s * 0.08, s * 0.8);
    fxCtx.lineTo(-s * 0.18, s * 0.8);
    fxCtx.closePath();
    fxCtx.fillStyle = "#1e293b";
    fxCtx.fill();
    fxCtx.strokeStyle = "#00F0FF";
    fxCtx.lineWidth = 1.0;
    fxCtx.stroke();

    // Wingtip Cannon Barrel (Left)
    fxCtx.beginPath();
    fxCtx.moveTo(-s * 0.08, s * 0.77);
    fxCtx.lineTo(s * 0.15, s * 0.77);
    fxCtx.strokeStyle = "#FFFFFF";
    fxCtx.lineWidth = 1.2;
    fxCtx.stroke();

    // Wingtip Cannons (Right)
    fxCtx.beginPath();
    fxCtx.moveTo(-s * 0.18, -s * 0.74);
    fxCtx.lineTo(-s * 0.08, -s * 0.74);
    fxCtx.lineTo(-s * 0.08, -s * 0.8);
    fxCtx.lineTo(-s * 0.18, -s * 0.8);
    fxCtx.closePath();
    fxCtx.fillStyle = "#1e293b";
    fxCtx.fill();
    fxCtx.strokeStyle = "#00F0FF";
    fxCtx.lineWidth = 1.0;
    fxCtx.stroke();

    // Wingtip Cannon Barrel (Right)
    fxCtx.beginPath();
    fxCtx.moveTo(-s * 0.08, -s * 0.77);
    fxCtx.lineTo(s * 0.15, -s * 0.77);
    fxCtx.strokeStyle = "#FFFFFF";
    fxCtx.lineWidth = 1.2;
    fxCtx.stroke();

    // Main central fuselage
    fxCtx.beginPath();
    fxCtx.moveTo(s * 1.1, 0);
    fxCtx.lineTo(-s * 0.4, s * 0.2);
    fxCtx.lineTo(-s * 0.6, 0);
    fxCtx.lineTo(-s * 0.4, -s * 0.2);
    fxCtx.closePath();
    const bodyGrad = fxCtx.createLinearGradient(-s, 0, s, 0);
    bodyGrad.addColorStop(0, "#0b1532");
    bodyGrad.addColorStop(1, "#1a2c66");
    fxCtx.fillStyle = bodyGrad;
    fxCtx.fill();
    fxCtx.strokeStyle = "#00F0FF";
    fxCtx.lineWidth = 2.0;
    fxCtx.stroke();

    // Decorative neon energy wing stripes
    fxCtx.strokeStyle = "#00F0FF";
    fxCtx.lineWidth = 1.5;
    fxCtx.beginPath();
    fxCtx.moveTo(-s * 0.22, s * 0.3);
    fxCtx.lineTo(-s * 0.35, s * 0.7);
    fxCtx.moveTo(-s * 0.22, -s * 0.3);
    fxCtx.lineTo(-s * 0.35, -s * 0.7);
    fxCtx.stroke();

    // Glowing glass cockpit canopy
    fxCtx.save();
    fxCtx.shadowColor = "rgba(0, 240, 255, 0.9)";
    fxCtx.shadowBlur = 10;
    fxCtx.beginPath();
    fxCtx.ellipse(s * 0.15, 0, s * 0.32, s * 0.12, 0, 0, Math.PI * 2);
    const cockpitGrad = fxCtx.createRadialGradient(s * 0.2, 0, 0, s * 0.15, 0, s * 0.3);
    cockpitGrad.addColorStop(0, "#E0F7FF");
    cockpitGrad.addColorStop(0.5, "#00A2FF");
    cockpitGrad.addColorStop(1, "#02113b");
    fxCtx.fillStyle = cockpitGrad;
    fxCtx.fill();
    fxCtx.strokeStyle = "#FFFFFF";
    fxCtx.lineWidth = 1.2;
    fxCtx.stroke();

    // Cockpit reflection glare line
    fxCtx.beginPath();
    fxCtx.ellipse(s * 0.22, -s * 0.03, s * 0.15, s * 0.04, -Math.PI / 12, 0, Math.PI, true);
    fxCtx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    fxCtx.lineWidth = 1.0;
    fxCtx.stroke();
    fxCtx.restore();

    // Central Fusion Core Glow
    fxCtx.save();
    fxCtx.shadowColor = "#00F0FF";
    fxCtx.shadowBlur = 12 * pulse;
    fxCtx.fillStyle = "#FFFFFF";
    fxCtx.beginPath();
    fxCtx.arc(-s * 0.12, 0, 2.5 * pulse, 0, Math.PI * 2);
    fxCtx.fill();
    fxCtx.restore();

    fxCtx.restore();
  }



  function drawRoundedRect(ctx, x, y, width, height, radius) {
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




  // Bomb cooldown arc that fills up around the ship.
  function renderCooldown() {
    if (state.weapon !== WEAPON_BOMB) return;
    const now = performance.now();
    const elapsed = now - state.lastBombAt;
    if (elapsed >= BOMB_COOLDOWN_MS) return; // ready, no indicator

    const frac = elapsed / BOMB_COOLDOWN_MS; // 0 -> 1
    const cx = state.shipX;
    const cy = state.shipY;
    const r = SHIP_SIZE + 8;

    fxCtx.save();
    // Track.
    fxCtx.strokeStyle = "rgba(255,255,255,0.15)";
    fxCtx.lineWidth = 3;
    fxCtx.beginPath();
    fxCtx.arc(cx, cy, r, 0, Math.PI * 2);
    fxCtx.stroke();

    // Fill arc.
    fxCtx.strokeStyle = "rgba(120, 240, 255, 0.9)";
    fxCtx.lineWidth = 3;
    fxCtx.beginPath();
    fxCtx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    fxCtx.stroke();
    fxCtx.restore();
  }

  // Draw bullets with a glowing core and a fading trail.
  function renderBullets() {
    for (const b of state.bullets) {
      // Trail.
      for (let i = 0; i < b.trail.length; i++) {
        const p = b.trail[i];
        const a = (i + 1) / b.trail.length * 0.5;
        fxCtx.save();
        fxCtx.globalAlpha = a;
        fxCtx.fillStyle = b.bomb
          ? "rgba(255,150,40,1)"
          : "rgba(255,240,120,1)";
        fxCtx.shadowColor = b.bomb
          ? "rgba(255,120,0,0.9)"
          : "rgba(255,230,80,0.9)";
        fxCtx.shadowBlur = 8;
        fxCtx.beginPath();
        fxCtx.arc(p.x, p.y, b.radius * (0.4 + 0.6 * (i / b.trail.length)),
          0, Math.PI * 2);
        fxCtx.fill();
        fxCtx.restore();
      }

      // Bright core.
      fxCtx.save();
      fxCtx.shadowColor = b.bomb
        ? "rgba(255,120,0,1)"
        : "rgba(255,255,180,1)";
      fxCtx.shadowBlur = 14;
      fxCtx.fillStyle = "rgba(255,255,255,0.98)";
      fxCtx.beginPath();
      fxCtx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      fxCtx.fill();
      fxCtx.restore();
    }
  }

  // Advance + draw particle dots; remove dead ones.
  function renderParticles() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;       // mild drag
      p.vy *= 0.96;
      p.life -= p.decay;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      fxCtx.save();
      fxCtx.globalAlpha = Math.max(0, p.life);
      fxCtx.fillStyle = `hsl(${p.hue}, 100%, 70%)`;
      fxCtx.shadowColor = `hsl(${p.hue}, 100%, 60%)`;
      fxCtx.shadowBlur = 10;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      fxCtx.fill();
      fxCtx.restore();
    }
  }

  // Advance + draw radial flash bursts; remove finished ones.
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
      let alpha;
      if (f.t < f.inMs) {
        alpha = f.t / f.inMs;                  // fade in
      } else {
        alpha = 1 - (f.t - f.inMs) / f.outMs;  // fade out
      }
      const r = f.maxR * (0.5 + 0.5 * (f.t / total));
      const grad = fxCtx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
      grad.addColorStop(0.4, `rgba(255,180,80,${0.6 * alpha})`);
      grad.addColorStop(1, "rgba(255,120,0,0)");
      fxCtx.save();
      fxCtx.fillStyle = grad;
      fxCtx.beginPath();
      fxCtx.arc(f.x, f.y, r, 0, Math.PI * 2);
      fxCtx.fill();
      fxCtx.restore();
    }
  }

  /* ===================================================================
     MAIN RENDER LOOP
     =================================================================== */
  function updateShipPosition(tdelta) {
    const currentRotSpeed = ROTATION_SPEED;
    const currentAccel = THRUST_ACCEL;
    const currentMaxSpeed = MAX_SPEED;

    // 1. Rotation (A / D)
    if (activeKeys.a) {
      state.shipAngle -= currentRotSpeed * tdelta;
    }
    if (activeKeys.d) {
      state.shipAngle += currentRotSpeed * tdelta;
    }

    // 2. Thrust (W / S)
    if (activeKeys.w) {
      state.velX += Math.cos(state.shipAngle) * currentAccel * tdelta;
      state.velY += Math.sin(state.shipAngle) * currentAccel * tdelta;
    }
    if (activeKeys.s) {
      // Brake/Reverse thrust (decelerates towards opposite direction)
      state.velX -= Math.cos(state.shipAngle) * currentAccel * tdelta * 0.5;
      state.velY -= Math.sin(state.shipAngle) * currentAccel * tdelta * 0.5;
    }

    // 3. Apply drag/friction
    const dragFactor = Math.pow(DRAG, tdelta * 60);
    state.velX *= dragFactor;
    state.velY *= dragFactor;

    // 4. Limit to maximum speed
    const speed = Math.sqrt(state.velX * state.velX + state.velY * state.velY);
    if (speed > currentMaxSpeed) {
      state.velX = (state.velX / speed) * currentMaxSpeed;
      state.velY = (state.velY / speed) * currentMaxSpeed;
    }

    // 5. Update position coordinates
    state.shipX += state.velX * tdelta;
    state.shipY += state.velY * tdelta;

    // 6. Viewport Wrap-Around with Page Scrolling Camera
    const pad = SHIP_SIZE;
    if (state.shipX < -pad) {
      window.scrollBy(-window.innerWidth * 0.75, 0);
      state.shipX = window.innerWidth + pad;
    } else if (state.shipX > window.innerWidth + pad) {
      window.scrollBy(window.innerWidth * 0.75, 0);
      state.shipX = -pad;
    }

    if (state.shipY < -pad) {
      window.scrollBy(0, -window.innerHeight * 0.75);
      state.shipY = window.innerHeight + pad;
    } else if (state.shipY > window.innerHeight + pad) {
      window.scrollBy(0, window.innerHeight * 0.75);
      state.shipY = -pad;
    }
  }

  function renderFrame(tdelta) {
    renderMask();

    if (state.shooterOn) {
      updateShipPosition(tdelta);
      updateBullets();
    }
    renderFx();
  }

  // Continuous loop while overlay is active.
  let loopHandle = null;
  let lastFrameTime = 0;
  function startLoop() {
    lastFrameTime = performance.now();
    function tick() {
      if (!overlayActive) return;
      const now = performance.now();
      const tdelta = Math.min(0.1, (now - lastFrameTime) / 1000);
      lastFrameTime = now;
      renderFrame(tdelta);
      loopHandle = requestAnimationFrame(tick);
    }
    loopHandle = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (loopHandle) cancelAnimationFrame(loopHandle);
    loopHandle = null;
  }

  /* ===================================================================
     EVENT HANDLERS (mousemove, wheel, resize)
     =================================================================== */
  function onMouseMove(e) {
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
  }

  // Scroll to resize (FEATURE 7) — block page scroll, change radius.
  function onWheel(e) {
    if (!state.torchOn) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) {
      state.radius = Math.min(MAX_RADIUS, state.radius + RADIUS_STEP);
    } else if (e.deltaY > 0) {
      state.radius = Math.max(MIN_RADIUS, state.radius - RADIUS_STEP);
    }
  }

  function onResize() {
    sizeCanvas();
  }

  /* ===================================================================
     KEYBOARD CONTROL
     =================================================================== */
  function onKeyDown(e) {
    // Never hijack typing contexts.
    if (isEditableTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = (e.key || "").toLowerCase();

    // Escape exits active modes.
    if (key === "escape") {
      if (state.shooterOn) disableShooter();
      if (state.torchOn) toggleTorch();
      return;
    }

    // Torch (T)
    if (key === "t") {
      toggleTorch();
      return;
    }

    // Shooter (F)
    if (key === "f") {
      toggleShooter();
      e.preventDefault();
      return;
    }

    // Scanner (B)
    if (key === "b") {
      if (state.shooterOn) {
        toggleScan();
        e.preventDefault();
      }
      return;
    }

    // Combat (C)
    if (key === "c") {
      if (state.shooterOn) {
        chrome.runtime.sendMessage({ type: "socket:open_game" });
        e.preventDefault();
      }
      return;
    }

    // Spacebar to shoot (when shooter is active)
    if (key === " " || key === "spacebar") {
      if (state.shooterOn) {
        fireWeapon();
        e.preventDefault();
        return;
      }
    }

    // Movement and weapons when shooter is active.
    if (state.shooterOn) {
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        activeKeys[key] = true;
        e.preventDefault();
        return;
      }
      if (key === "1") {
        state.weapon = WEAPON_SINGLE;
        return;
      }
      if (key === "2") {
        state.weapon = WEAPON_SPREAD;
        return;
      }
      if (key === "3") {
        state.weapon = WEAPON_BOMB;
        return;
      }
    }
  }

  function onKeyUp(e) {
    const key = (e.key || "").toLowerCase();

    if (key === "w" || key === "a" || key === "s" || key === "d") {
      activeKeys[key] = false;
    }
  }

  /* ===================================================================
     FEATURE TOGGLES
     =================================================================== */
  let overlayActive = false;

  function ensureActive() {
    if (overlayActive) return;
    overlayActive = true;
    buildOverlay();
    addListeners();
    startLoop();
  }

  function checkTeardown() {
    if (!state.torchOn && !state.shooterOn) {
      overlayActive = false;
      stopLoop();
      removeListeners();
      clearFxState();
      teardownOverlay();
    }
  }

  function toggleScan() {
    if (!state.shooterOn) return;
    state.scanActive = !state.scanActive;
    if (state.scanActive) {
      document.body.classList.add("socket-scan-active");
      const all = document.body.getElementsByTagName("*");
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (canRemove(el)) {
          el.classList.add("socket-target");
        }
      }
      playClick();
    } else {
      clearScan();
      playClick();
    }
  }

  function clearScan() {
    state.scanActive = false;
    document.body.classList.remove("socket-scan-active");
    const elements = document.querySelectorAll(".socket-target");
    elements.forEach((el) => el.classList.remove("socket-target"));
  }

  function toggleTorch() {
    if (state.torchOn) {
      state.torchOn = false;
      checkTeardown();
    } else {
      state.torchOn = true;
      ensureActive();
      playClick();
    }
  }

  function toggleShooter() {
    if (state.shooterOn) {
      disableShooter();
    } else {
      state.shooterOn = true;
      state.weapon = WEAPON_SINGLE;
      state.shipX = state.mouseX;
      state.shipY = state.mouseY;
      state.shipAngle = -Math.PI / 2; // Facing upwards initially
      state.velX = 0;
      state.velY = 0;
      activeKeys.w = false;
      activeKeys.a = false;
      activeKeys.s = false;
      activeKeys.d = false;

      ensureActive();
      playClick();
    }
  }

  function disableShooter() {
    if (!state.shooterOn) return;
    state.shooterOn = false;
    state.bullets.length = 0;
    state.velX = 0;
    state.velY = 0;
    activeKeys.w = false;
    activeKeys.a = false;
    activeKeys.s = false;
    activeKeys.d = false;

    clearScan(); // Reset scanning outlines
    checkTeardown();
  }

  // Clear all transient FX state and undo any in-progress body shake.
  function clearFxState() {
    state.bullets.length = 0;
    state.particles.length = 0;
    state.flashes.length = 0;
    if (shakeTimer) {
      cancelAnimationFrame(shakeTimer);
      shakeTimer = null;
    }
    document.body.style.transform = "";
  }

  /* ===================================================================
     LISTENER MANAGEMENT (prevent memory leaks)
     =================================================================== */
  function addListeners() {
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize, { passive: true });
  }

  function removeListeners() {
    window.removeEventListener("mousemove", onMouseMove, { passive: true });
    window.removeEventListener("wheel", onWheel, { passive: false });
    window.removeEventListener("resize", onResize, { passive: true });
  }

  /* ===================================================================
     BOOTSTRAP — listeners are always live, overlay is created on demand.
     =================================================================== */
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);

  // Clean up if the page is unloaded while active.
  window.addEventListener("pagehide", function () {
    if (overlayActive) {
      state.torchOn = false;
      disableShooter();
      checkTeardown();
    }
  });
})();
