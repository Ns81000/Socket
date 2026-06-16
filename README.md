<div align="center">
  <img src="icons/icon128.png" alt="Socket Logo" width="128" height="128">
  
  # Socket
  
  **Others load. Socket unloads.**
</div>

A Manifest V3 browser extension that turns any webpage into a dark room with a moving flashlight—and lets you blow it apart with an Asteroids-style space shooter. It also features a standalone, high-performance canvas-based arcade game: **Combat Arena**.

Built with pure vanilla JavaScript, Canvas, and Web Audio API, with zero dependencies or external asset loads.

---

## Features

### 1. Torch Mode
Press **T** to toggle the torch on or off. The page goes dark (85% black overlay) and a warm radial spotlight follows your cursor (or ship). 
*   **Resize Spotlight:** Scroll the mouse wheel while Torch Mode is active to resize the spotlight radius between `30 px` and `400 px` in `15 px` increments.
*   **Organic Flicker:** The spotlight features a subtle, real-time flame flicker powered by non-periodic sine wave synthesis.

### 2. Shooter Mode (Webpage Destruction)
Press **F** to toggle Shooter Mode. It works independently of the torch, enabling you to pilot a fighter ship and destroy page elements.
*   **Asteroids-style Flight Physics:** Move using **W / A / S / D** (Thrust / Rotate Left / Brake & Reverse / Rotate Right) with realistic momentum, deceleration drag, and velocity capping.
*   **Scrolling Camera Camera:** When your ship flies off any viewport edge, the camera automatically scrolls the page by 75% of the viewport width/height and wraps the ship to the opposite side, allowing you to explore and destroy long webpages.
*   **Target Scanner (Press B):** Highlight destroyable elements on the page in cyan dashed boxes (`#00f0ff` outlines with a soft outer glow).
*   **Hybrid Target Filtering:** To keep pages readable and functional, structural layout wrappers (large containers covering >70% of the viewport, or grid wrappers/divs containing complex block children) are automatically bypassed by hit detection, focusing bullets on paragraph text leaves, headings, buttons, spans, links, and media.
*   **Element Durability (HP):** Elements have hit points based on their screen area:
    *   *Small (< 15,000 px²):* 1 HP
    *   *Medium (< 60,000 px²):* 2 HP
    *   *Large (≥ 60,000 px²):* 4 HP
    Element hits trigger a metallic clank sound, visual brightness flash, and cyan spark particles.
*   **Shatter FX:** Reaching 0 HP shatters the element into 6–10 random polygonal shards that spin and fly outward via CSS `clip-path` transitions, accompanied by canvas particle explosions, screen shake, and synthesized white-noise audio booms.

### 3. Combat Arena Mode
Press **C** while webpage Shooter Mode is active (or open `game.html` directly) to launch the standalone **Combat Arena** in a new tab.
*   **Launch Control:** Press any movement key (**W / A / S / D**) to launch your fighter, fading out the controls overlay and igniting the engine.
*   **Parallax Starfield:** Fly against a two-layer starfield background (90 distant stars, 45 close stars) shifting based on your fighter's velocity + a baseline downward drift.
*   **10-Wave Campaign:** Face 10 waves of increasingly difficult AI fleets containing Drones, Scouts, Cruisers, Bombers, Support Ships, and giant Bosses.
*   **Support Ship Shields:** Support ships project protective purple beam links onto nearby allies, making them immune to bullets until the support ship itself is destroyed.
*   **Floating Power-ups:** Destroyed enemies have a 25% chance to drop drifting crystals:
    *   *Shield (Cyan):* Renders a glowing deflection barrier around the ship for 10s.
    *   *Triple Shot (Red):* Upgrades weapon fire to a triple-line parallel laser for 8s.
    *   *Engine Overdrive (Green):* Doubles ship handling speed and acceleration for 8s.
*   **Arcade HUD & Systems:**
    *   *Top-Left Panel (Score & Wave):* Glassmorphic slate showing Score, Hi-Score (persisted in local storage as `socket_high_score`), Wave status (1-10 / FINAL), and a glowing progress bar of defeated enemies.
    *   *Top-Right Panel (System Status):* Shows music mute status and live power-up timers (Shield/Engine Overdrive) in seconds.
    *   *Bottom-Left Panel (Floating Circle Radar):* Features an active radar sweep indicating relative positions of the player (Cyan dot), power-ups (colored blips), and enemies (Boss: Magenta blip, Support: Purple blip, others: Red blips).
    *   *Bottom-Right Panel (Combo System):* Displays active Combo multiplier (e.g., `COMBO x3!`) and a yellow decay bar. Resets if no enemy is destroyed within 1.5 seconds.
*   **Replay & Exit:** Press **R** to replay the game after victory is declared. Press **C** or **Esc** to exit the game (closes the window).
*   **Fullscreen Mode:** Automatically requests browser fullscreen on any click or keydown.

---

## Keyboard Reference

| Key | Action | Context |
|:---:|:---|:---|
| **`T`** | Toggle Torch Overlay on / off | Webpage |
| **`F`** | Toggle Shooter Mode on / off | Webpage |
| **`B`** | Toggle Target Scan Mode on / off | Webpage (Shooter ON) |
| **`C`** | Open Combat Arena in a new tab | Webpage (Shooter ON) |
| **`W` / `S`** | Apply Forward Thrust / Decelerate, Brake & Reverse | Shooter / Combat Arena |
| **`A` / `D`** | Rotate Ship Left / Right | Shooter / Combat Arena |
| **`Space`** | Fire Weapon | Shooter / Combat Arena |
| **`1` / `2` / `3`** | Switch Weapon (Single / Spread / Bomb) | Shooter / Combat Arena |
| **`M`** | Toggle Procedural Music Loop | Combat Arena |
| **`R`** | Replay / Restart game | Combat Arena (Victory Screen) |
| **`Esc`** | Exit active modes / Close game window | Always |
| **Scroll Up/Down**| Increase / Decrease Spotlight Radius | Torch ON |

*Note: Keyboard inputs are ignored when typing in editable webpage contexts (inputs, textareas, dropdowns, contenteditables).*

---

## Weapon Arsenal

1.  **Single Shot (Default):** Standard high-velocity white-core laser with a yellow/orange trail.
2.  **Spread Shot:** Fires a 3-way fan-out pattern (±15° spread angle) for wider area coverage.
3.  **Bomb:** Fires a slow, heavy energy bomb.
    *   *Webpage Mode:* 150 px blast radius. Inflicts 4 damage on impact. Cooldown is 2.0s (displayed as a radial cyan charging arc around the ship).
    *   *Combat Arena:* 180 px blast radius. Inflicts 4 damage. Cooldown is 1.8s. Enemies not destroyed are physically pushed away by the blast wave.

---

## Sound Effects (Web Audio API)

All sounds are generated procedurally on-the-fly using browser synthesizers:
*   *Click:* Fast-decaying square wave chime when toggling modes.
*   *Pew:* Square oscillator sweeping from 900Hz to 220Hz on weapon fire.
*   *Boom:* Low sine wave thump + white noise burst on element/ship destruction.
*   *Clank:* Sine wave sweep from 580Hz to 150Hz on hitting a durable element.
*   *Chime:* Arpeggiated C-E-G-C triangle wave melody on power-up collections or wave clears.
*   *Deflect:* Sawtooth sweep (400Hz to 200Hz) when shields absorb a projectile.
*   *Enemy Shoot:* Sawtooth wave sweeping from 260Hz to 80Hz on enemy fire.
*   *Music Beat:* Synthesized sliding triangle wave walking bass notes (A1/C2/D2/G1) acting as background music.
*   *Victory Fanfare:* Retro arpeggiated audio fanfare triggered upon defeating the Wave 10 Boss.

---

## Tuning Constants

### Webpage Mode (`content.js`)

| Constant | Default | Description |
|----------|---------|-------------|
| `DEFAULT_RADIUS` | 120 | Starting torch radius (px) |
| `MIN_RADIUS` | 30 | Minimum torch radius (px) |
| `MAX_RADIUS` | 400 | Maximum torch radius (px) |
| `RADIUS_STEP` | 15 | Radius change per scroll tick (px) |
| `TORCH_FLICKER` | 0.025 | Flicker amplitude (2.5% of radius) |
| `BULLET_SPEED` | 22 | Single/spread bullet speed (px/frame) |
| `BOMB_SPEED` | 7 | Bomb projectile speed (px/frame) |
| `BULLET_RADIUS` | 3 | Single/spread bullet visual radius (px) |
| `BOMB_RADIUS` | 8 | Bomb projectile visual radius (px) |
| `SPREAD_ANGLE` | 15° | Fan half-angle for spread shot |
| `BOMB_BLAST_RADIUS` | 150 | Bomb area-of-effect radius (px) |
| `BOMB_COOLDOWN_MS` | 2000 | Bomb recharge time (ms) |
| `SHIP_SIZE` | 16 | Ship triangle radius (px) |
| `TRAIL_MAX` | 8 | Bullet trail history length (frames) |
| `ROTATION_SPEED` | 3.8 | Ship rotation speed (radians/sec) |
| `THRUST_ACCEL` | 550 | Ship thrust acceleration force (px/sec²) |
| `MAX_SPEED` | 500 | Ship terminal velocity cap (px/sec) |
| `DRAG` | 0.982 | Friction speed decay factor per frame |

### Combat Arena (`game.js`)

| Constant | Default | Description |
|----------|---------|-------------|
| `SHIP_SIZE` | 20 | Ship triangle radius (px) |
| `ROTATION_SPEED` | 4.2 | Ship rotation speed (radians/sec) |
| `THRUST_ACCEL` | 650 | Ship thrust acceleration force (px/sec²) |
| `MAX_SPEED` | 550 | Ship terminal velocity cap (px/sec) |
| `DRAG` | 0.985 | Friction speed decay factor per frame |
| `BULLET_SPEED` | 24 | Single/spread bullet speed (px/frame) |
| `BOMB_SPEED` | 8 | Bomb projectile speed (px/frame) |
| `BULLET_RADIUS` | 3.5 | Single/spread bullet visual radius (px) |
| `BOMB_RADIUS` | 9 | Bomb projectile visual radius (px) |
| `BOMB_BLAST_RADIUS` | 180 | Bomb area-of-effect radius (px) |
| `BOMB_COOLDOWN_MS` | 1800 | Bomb recharge time (ms) |
| `SPREAD_ANGLE` | 15° | Fan half-angle for spread shot |

---

## Installation

Socket is loaded manually as an unpacked developer extension:
1. Open Chrome (or any Chromium browser) and navigate to `chrome://extensions`.
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the directory containing `manifest.json`.
4. Open any HTTP/HTTPS page and press **T** or **F** to play!
